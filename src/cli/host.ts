import { join } from "node:path";
import { WebSocket } from "ws";
import { handleCommand } from "./agent.js";
import { nextBackoff } from "./backoff.js";
import { CodexExecutor, CursorExecutor, RealExecutor, type Executor } from "./executor.js";
import { readHostSettings, writeHostSettings } from "./settings-store.js";
import {
  listProjects,
  listProjectTargets,
  createProject,
  createPipelineProject,
  isPipelineProject,
  slugifyProjectName,
  projectDir,
  moveProjectToTrash,
  readProjectTarget,
  readProjectMeta,
  writeProjectMeta,
  targetSystemPrompt,
} from "./projects.js";
import { PipelineManager } from "./pipeline-manager.js";
import { hasPipeline, readPipelineState } from "./pipeline-store.js";
import { appendChat, readChat } from "./chat-log.js";
import {
  addImagesToPrompt,
  ImageAttachmentError,
  saveImageAttachments,
} from "./image-attachments.js";
import {
  claimIdeaForProject,
  deleteIdeaFromLibrary,
  ensureIdeaMemory,
  findIdeaInLibrary,
  keepProposedIdea,
  readIdeaLibrary,
  seedDirectIdeaForProject,
  readPreferencesView,
  readProposedIdeas,
  writePreferencesView,
} from "./idea-memory.js";
import type { HostOutbound, ProjectTarget } from "../shared/protocol.js";
import {
  cloneTemplate, createTemplate, deleteTemplate, getStepPrompt, getTemplate, listTemplates,
  resetStepPrompt, setStepPrompt, setTemplateSteps, DEFAULT_TEMPLATE_ID, DEVELOPMENT_TEMPLATE_ID,
} from "../shared/template-store.js";

export interface HostOptions {
  relayUrl: string;
  password?: string;
  projectsRoot: string;
  onCode?: (code: string) => void;
  log?: (msg: string) => void;
  // 테스트 주입용. 기본은 프로젝트 폴더로 RealExecutor 생성.
  createExecutor?: (workdir: string) => Executor;
  // 파이프라인 프로젝트 생성 시 commands/pipeline·commands/skills·templates 등을
  // 시드할 리포 루트(launch.ts가 아는 실제 리포 루트). 생략하면 자산 시드를 하지
  // 않는다(기존 테스트 호환).
  repoRoot?: string;
  // 템플릿(곁가지) 저장소의 루트. 생략 시 process.cwd().
  configRoot?: string;
}

// 폰에 보낸 한 메시지를 PC 터미널 로그 형식으로 변환해 출력한다.
export function mirrorToTerminal(
  log: (msg: string) => void,
  m: HostOutbound,
): void {
  const tag = "project" in m ? `[${m.project}]` : "";
  if (m.type === "assistant") log(`🤖 ${tag} ${m.text}`);
  else if (m.type === "log") log(`·  ${tag} ${m.text}`);
  else if (m.type === "status")
    log(`▶  ${tag} ${m.state}${m.text ? ": " + m.text : ""}`);
  else if (m.type === "preview") log(`🌐 ${tag} ${m.url}`);
  else if (m.type === "error") log(`⚠️  ${m.text}`);
}

export function startHost(opts: HostOptions): void {
  const { relayUrl, password, projectsRoot, repoRoot } = opts;
  const log = opts.log ?? ((m: string) => console.log(m));
  const configRoot = opts.configRoot ?? process.cwd();
  ensureIdeaMemory(projectsRoot);
  // 실행할 때 저장된 제공자에 맞춰 Claude / Codex / Cursor CLI executor를 만든다.
  const createExecutor =
    opts.createExecutor ??
    ((wd: string) => {
      const settings = readHostSettings(configRoot);
      const model = () => readHostSettings(configRoot).model;
      if (settings.provider === "codex") return new CodexExecutor(wd, model);
      if (settings.provider === "cursor") return new CursorExecutor(wd, model);
      return new RealExecutor(wd, model);
    });
  const busy = new Set<string>();
  const started = new Set<string>();
  let attempt = 0;
  const tplOpts = {
    repoRoot: repoRoot ?? configRoot,
    pipelinesRoot: join(configRoot, "pipelines"),
  };

  // 폰으로 나가는 assistant/log 메시지를 프로젝트별 chat.jsonl에 기록한다.
  // (manager의 send 래퍼와 레거시 teeSend 공통 지점 — 폰 새로고침 시 히스토리 소실 방지)
  const recordOutbound = (m: HostOutbound) => {
    if ((m.type === "assistant" || m.type === "log") && "project" in m && m.project) {
      try {
        appendChat(projectDir(projectsRoot, m.project), {
          ts: new Date().toISOString(), role: m.type, text: m.text,
        });
      } catch { /* 기록 실패가 전송을 막지 않게 */ }
    }
  };

  // 재연결마다 manager를 새로 만들면 watcher가 누적되므로, 연결과 무관하게 1회만
  // 생성한다. send는 재연결 후에도 항상 "현재" ws로 나가도록 클로저로 참조한다.
  let activeWs: WebSocket | null = null;
  // relay가 발급한 페어링 코드와, host 전용 재연결 비밀(reconnectKey)을 기억해
  // 두었다가 재연결 시 ?code=&reconnectKey=로 제시한다. relay는 이 키가 저장된
  // 세션의 키와 일치할 때만 세션(코드·폰 연결)을 재획득시켜 준다(폰이 새로
  // 재페어링할 필요 없음). reconnectKey는 code와 달리 폰에는 절대 노출되지
  // 않는 host 전용 비밀이다 — 세션 하이재킹 방지(스펙 §4).
  let pairingCode: string | undefined;
  let reconnectKey: string | undefined;
  const manager = new PipelineManager({
    projectsRoot,
    repoRoot,
    send: (m) => {
      recordOutbound(m);
      if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
      activeWs.send(JSON.stringify(m));
      mirrorToTerminal(log, m);
    },
    createExecutor,
  });
  for (const name of listProjects(projectsRoot)) {
    if (hasPipeline(projectDir(projectsRoot, name))) manager.attachWatcher(name);
  }
  // 재시작 전에 running으로 남은 좀비 상태를 정리(폰에 가짜 "진행 중"이 고착되지 않게).
  manager.recoverStaleRuns();

  function connect(): void {
    const params = new URLSearchParams();
    if (password) params.set("secret", password);
    if (pairingCode) params.set("code", pairingCode);
    if (reconnectKey) params.set("reconnectKey", reconnectKey);
    const qs = params.toString();
    const hostUrl = `${relayUrl}/host${qs ? `?${qs}` : ""}`;
    const ws = new WebSocket(hostUrl);
    activeWs = ws;
    const send = (m: HostOutbound) => ws.send(JSON.stringify(m));
    const sendProjects = () => {
      const names = listProjects(projectsRoot);
      send({
        type: "projects",
        names,
        targets: listProjectTargets(projectsRoot),
        pipelines: names.filter((n) => isPipelineProject(projectsRoot, n)),
        archived: names.filter((n) => readProjectMeta(projectsRoot, n).archived === true),
      });
    };

    let reconnectScheduled = false;
    const scheduleReconnect = () => {
      if (reconnectScheduled) return;
      reconnectScheduled = true;
      const delay = nextBackoff(attempt++);
      log(`중계서버 연결 종료 — ${delay}ms 후 재연결 시도`);
      setTimeout(connect, delay);
    };

    ws.on("open", () => {
      attempt = 0;
      log(`중계서버 연결됨: ${relayUrl}`);
    });

    ws.on("message", (data) => {
      try {
        handleIncoming(data);
      } catch (e) {
        log(`⚠️ 메시지 처리 오류: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    // 실제 메시지 처리 본문. 비JSON 프레임(JSON.parse 실패)이나 createProject의
    // seedPipelineAssets throw 등 예상치 못한 예외가 host 프로세스를 죽이지 않도록
    // ws.on("message") 콜백에서 통째로 try/catch로 감싼다(위 참조).
    function handleIncoming(data: WebSocket.RawData): void {
      const msg = JSON.parse(data.toString());
      // ① 파이프라인 전용 메시지 우선 라우팅(confirm/rollback/cancel/sync/artifact_get/artifact_set)
      // project 필드를 갖는 5종은 manager 호출 전에 레거시 command 경로와 동일하게
      // 슬러그화·실존 검증한다(project 누락 시 TypeError로 host가 죽거나, 경로 탈출로
      // projectsRoot 밖 디렉터리를 지정하는 것을 막기 위함). pipeline_sync는 project가
      // 없으므로 검증 없이 통과시킨다.
      if (
        msg.type === "confirm" ||
        msg.type === "stage_rollback" ||
        msg.type === "stage_cancel" ||
        msg.type === "artifact_get" ||
        msg.type === "artifact_set" ||
        msg.type === "form_get" ||
        msg.type === "form_submit" ||
        msg.type === "skills_get"
      ) {
        const raw = String(msg.project ?? "");
        const project = slugifyProjectName(raw);
        if (!project || !listProjects(projectsRoot).includes(project)) {
          send({
            type: "status",
            project: raw,
            state: "error",
            text: "프로젝트를 찾을 수 없어요",
          });
          return;
        }
        msg.project = project;
      }
      // ── 템플릿(곁가지) 라우팅: 프로젝트와 무관한 전역 메시지 ──
      const sendTplList = () =>
        send({ type: "tpl_list", templates: listTemplates(tplOpts) });
      const tplFail = (r: { ok: false; error: string }) =>
        send({ type: "error", text: r.error });
      const sendPrompt = (id: string, stepId: string) => {
        const r = getStepPrompt(tplOpts, id, stepId);
        if (r.ok) send({ type: "tpl_prompt", id, stepId, ...r.value });
        else tplFail(r);
      };
      if (msg.type === "tpl_list") { sendTplList(); return; }
      if (msg.type === "tpl_create") {
        const r = createTemplate(tplOpts, String(msg.name ?? ""));
        r.ok ? sendTplList() : tplFail(r);
        return;
      }
      if (msg.type === "tpl_clone") {
        const r = cloneTemplate(tplOpts, String(msg.basedOn ?? ""), String(msg.name ?? ""));
        r.ok ? sendTplList() : tplFail(r);
        return;
      }
      if (msg.type === "tpl_delete") {
        const r = deleteTemplate(tplOpts, String(msg.id ?? ""));
        r.ok ? sendTplList() : tplFail(r);
        return;
      }
      if (msg.type === "tpl_steps_set") {
        const r = setTemplateSteps(tplOpts, String(msg.id ?? ""), Array.isArray(msg.steps) ? msg.steps : []);
        r.ok ? sendTplList() : tplFail(r);
        return;
      }
      if (msg.type === "tpl_prompt_get") {
        sendPrompt(String(msg.id ?? ""), String(msg.stepId ?? ""));
        return;
      }
      if (msg.type === "tpl_prompt_set") {
        const id = String(msg.id ?? ""), stepId = String(msg.stepId ?? "");
        const r = setStepPrompt(tplOpts, id, stepId, String(msg.body ?? ""));
        r.ok ? (sendPrompt(id, stepId), sendTplList()) : tplFail(r);
        return;
      }
      if (msg.type === "tpl_prompt_reset") {
        const id = String(msg.id ?? ""), stepId = String(msg.stepId ?? "");
        const r = resetStepPrompt(tplOpts, id, stepId);
        r.ok ? (sendPrompt(id, stepId), sendTplList()) : tplFail(r);
        return;
      }
      // ── 전역 설정(CLI 제공자/모델): 프로젝트와 무관한 전역 메시지 ──
      if (msg.type === "settings_get") {
        send({ type: "settings", ...readHostSettings(configRoot) });
        return;
      }
      if (msg.type === "settings_set") {
        // 제공자별 허용목록 밖 값이면 저장하지 않는다.
        // 성공/실패와 무관하게 실제 저장값을 회신해 폰이 진짜 상태를 반영하게 한다.
        const current = readHostSettings(configRoot);
        writeHostSettings(
          configRoot,
          msg.provider === "claude" || msg.provider === "codex" || msg.provider === "cursor"
            ? msg.provider
            : current.provider,
          String(msg.model ?? ""),
        );
        send({ type: "settings", ...readHostSettings(configRoot) });
        return;
      }
      if (msg.type === "ideas_library_get") {
        send({ type: "ideas_library", items: readIdeaLibrary(projectsRoot) });
        return;
      }
      if (msg.type === "ideas_delete") {
        const result = deleteIdeaFromLibrary(projectsRoot, String(msg.slug ?? ""));
        if (!result.ok) {
          send({ type: "error", text: result.error });
          return;
        }
        send({ type: "ideas_library", items: readIdeaLibrary(projectsRoot) });
        return;
      }
      if (msg.type === "ideas_proposed_get") {
        const p = slugifyProjectName(String(msg.project ?? ""));
        if (!p || !listProjects(projectsRoot).includes(p)) return;
        send({
          type: "ideas_proposed",
          project: p,
          items: readProposedIdeas(projectDir(projectsRoot, p)),
        });
        return;
      }
      if (msg.type === "ideas_keep") {
        const p = slugifyProjectName(String(msg.project ?? ""));
        const slug = String(msg.slug ?? "");
        if (!p || !listProjects(projectsRoot).includes(p)) return;
        const result = keepProposedIdea(
          projectsRoot,
          projectDir(projectsRoot, p),
          slug,
          String(msg.feedback ?? ""),
        );
        if (!result.ok) {
          send({ type: "error", text: result.error });
          return;
        }
        send({
          type: "ideas_proposed",
          project: p,
          items: readProposedIdeas(projectDir(projectsRoot, p)),
        });
        send({ type: "ideas_library", items: readIdeaLibrary(projectsRoot) });
        send(readPreferencesView(projectsRoot));
        send({
          type: "log",
          project: p,
          text: `✅ 「${result.idea.oneLiner}」을(를) 보관함에 넣었어요. 다음 회의에서 비슷한 신박함을 더 가져올게요.`,
        });
        return;
      }
      if (msg.type === "preferences_get") {
        send(readPreferencesView(projectsRoot));
        return;
      }
      if (msg.type === "preferences_set") {
        const result = writePreferencesView(projectsRoot, {
          neverAgain: Array.isArray(msg.neverAgain) ? msg.neverAgain : [],
          dislikedPatterns: Array.isArray(msg.dislikedPatterns) ? msg.dislikedPatterns : [],
          wants: Array.isArray(msg.wants) ? msg.wants : [],
        });
        if (!result.ok) {
          send({ type: "error", text: result.error });
          return;
        }
        send(result.value);
        return;
      }
      if (manager.handleMessage(msg)) return;
      if (msg.type === "project_archive" || msg.type === "project_delete") {
        // 검증은 다른 프로젝트 메시지와 동일: 슬러그화 + 실존 확인(경로 탈출·미존재 프로젝트 차단)
        const p = slugifyProjectName(String(msg.project ?? ""));
        if (!p || !listProjects(projectsRoot).includes(p)) {
          send({
            type: "status",
            project: String(msg.project ?? p ?? ""),
            state: "error",
            text: "프로젝트를 찾을 수 없어요",
          });
          return;
        }
        if (manager.isRunning(p) || busy.has(p)) {
          send({
            type: "status",
            project: p,
            state: "error",
            text: "실행 중에는 보관/삭제할 수 없어요 — 먼저 중단하세요",
          });
          return;
        }
        try {
          if (msg.type === "project_archive") {
            writeProjectMeta(projectsRoot, p, { archived: msg.archived === true });
          } else {
            // 감시 중이던 디렉터리를 이동하기 전에 반드시 watcher를 먼저 떼어낸다
            // (붙어 있는 채로 rename하면 watch 대상이 사라져 불필요한 에러 처리가 필요해짐).
            manager.detachWatcher(p);
            moveProjectToTrash(projectsRoot, p);
            // 재생성 시 옛 세션을 이어받지 않도록(--continue 오사용 방지) started 기록도 정리한다.
            started.delete(p);
          }
        } catch (e) {
          // 삭제 실패 시 watcher를 이미 떼었으면 목록/상태 감시가 끊기므로 복구한다.
          if (
            msg.type === "project_delete" &&
            hasPipeline(projectDir(projectsRoot, p)) &&
            listProjects(projectsRoot).includes(p)
          ) {
            manager.attachWatcher(p);
          }
          send({
            type: "status",
            project: p,
            state: "error",
            text: "보관/삭제 처리에 실패했어요: " + (e instanceof Error ? e.message : String(e)),
          });
          return;
        }
        sendProjects();
        return;
      }
      if (msg.type === "code") {
        pairingCode = msg.code;
        reconnectKey = msg.reconnectKey;
        opts.onCode?.(msg.code);
      } else if (msg.type === "listProjects") {
        sendProjects();
      } else if (msg.type === "createProject") {
        const name = slugifyProjectName(String(msg.name ?? ""));
        if (!name) {
          send({
            type: "status",
            project: String(msg.name ?? ""),
            state: "error",
            text: "이름은 영문/숫자만 쓸 수 있어요",
          });
          return;
        }
        if (msg.pipeline === true) {
          const ideaSlug = typeof msg.ideaSlug === "string" ? msg.ideaSlug : "";
          const template =
            typeof msg.template === "string" && msg.template
              ? msg.template
              // 구버전/잘못된 클라이언트가 template을 누락해도 보관함 아이디어를 다시
              // 아이디어 발산(default)으로 보내지 않는다.
              : ideaSlug ? DEVELOPMENT_TEMPLATE_ID : DEFAULT_TEMPLATE_ID;
          const templateInfo = getTemplate(tplOpts, template);
          if (!templateInfo) {
            send({ type: "status", project: name, state: "error", text: "템플릿을 찾을 수 없어요" });
            return;
          }
          const initialPrompt =
            typeof msg.initialPrompt === "string" ? msg.initialPrompt.trim().slice(0, 4000) : "";
          if (ideaSlug && !findIdeaInLibrary(projectsRoot, ideaSlug)) {
            send({
              type: "status",
              project: name,
              state: "error",
              text: "개발할 공용 아이디어를 먼저 선택해 주세요",
            });
            return;
          }
          const existingPipeline = readPipelineState(projectDir(projectsRoot, name));
          if (existingPipeline && existingPipeline.template !== template) {
            send({
              type: "status",
              project: name,
              state: "error",
              text: "같은 이름의 프로젝트가 다른 템플릿으로 이미 만들어져 있어요. 기존 프로젝트를 삭제하거나 새 이름을 사용해 주세요.",
            });
            return;
          }
          if (!createPipelineProject(projectsRoot, name, repoRoot, {
            pipelinesRoot: tplOpts.pipelinesRoot, template,
          })) {
            send({
              type: "status",
              project: name,
              state: "error",
              text: "같은 이름의 기존 프로젝트가 있어요",
            });
            return;
          }
          if (templateInfo.developmentFlow) {
            const prepared = ideaSlug
              ? claimIdeaForProject(
                projectsRoot,
                projectDir(projectsRoot, name),
                ideaSlug,
                name,
              )
              : seedDirectIdeaForProject(projectDir(projectsRoot, name), name);
            if (!prepared.ok) {
              send({ type: "status", project: name, state: "error", text: prepared.error });
              return;
            }
          }
          manager.attachWatcher(name);
          // 아이디어 기반 개발 템플릿(복제본 포함)은 생성만 하고 멈추면 "대기"에 고착된다
          // — 첫 단계(개발 논의)를 바로 켠다.
          // (폰에서 이어 보내는 command와 레이스 나지 않도록 host가 직접 kickoff)
          if (templateInfo.developmentFlow) {
            manager.startIfPending(
              name,
              ideaSlug
                ? "피드백: 선택된 아이디어로 개발하기 전에 기능·MVP 범위만 먼저 짧게 논의해줘. UI 구조는 다음 단계에서 후보 5개로 고를 거야. 코드는 쓰지 마."
                : initialPrompt
                  ? `피드백: 저장하지 않은 즉석 아이디어로 새 앱을 시작할 거야.\n\n사용자 아이디어:\n${initialPrompt}\n\n이 내용을 바탕으로 제품 정의와 MVP 범위를 대화로 구체화해줘. UI 구조와 코드는 아직 만들지 마.`
                  : "피드백: 저장된 아이디어 없이 새 앱을 시작할 거야. 먼저 무엇을 만들지 질문하며 대화로 제품 정의와 MVP 범위를 정해줘. UI 구조와 코드는 아직 만들지 마.",
            );
          } else {
            manager.emitUpdate(name);
          }
          sendProjects();
          return;
        }
        const target: ProjectTarget =
          msg.target === "android" || msg.target === "web" ? msg.target : "ios";
        createProject(projectsRoot, name, target);
        sendProjects();
      } else if (msg.type === "command") {
        // 보안: project를 슬러그로 정규화하고 실존하는 프로젝트만 허용한다.
        // (raw 값을 그대로 cwd로 쓰면 "../../etc" 같은 경로 탈출이 가능)
        const raw = String(msg.project ?? "");
        const project = slugifyProjectName(raw);
        if (!project || !listProjects(projectsRoot).includes(project)) {
          send({
            type: "status",
            project: raw,
            state: "error",
            text: "프로젝트를 찾을 수 없어요",
          });
          return;
        }
        const rawText = String(msg.text ?? "");
        let commandText: string;
        let imageCount = 0;
        try {
          const imagePaths = saveImageAttachments(
            projectDir(projectsRoot, project),
            msg.attachments,
          );
          imageCount = imagePaths.length;
          commandText = addImagesToPrompt(rawText, imagePaths);
        } catch (e) {
          send({
            type: "status",
            project,
            state: "error",
            text: e instanceof ImageAttachmentError
              ? e.message
              : "이미지 첨부를 저장하지 못했어요",
          });
          return;
        }
        if (!commandText.trim()) {
          send({ type: "status", project, state: "error", text: "메시지나 이미지를 입력해 주세요" });
          return;
        }
        // 폰 새로고침 후에도 히스토리가 남도록, 파이프라인/레거시 분기 전에 user 발화를 기록한다.
        try {
          appendChat(projectDir(projectsRoot, project), {
            ts: new Date().toISOString(),
            role: "user",
            text: rawText.trim() || `📎 이미지 ${imageCount}개`,
          });
        } catch { /* 기록 실패가 명령 처리를 막지 않게 */ }
        // ② 파이프라인 프로젝트: manager가 큐잉·재호출 래핑을 전담(targetSystemPrompt 미주입)
        if (isPipelineProject(projectsRoot, project)) {
          manager.handleFeedback(project, commandText);
          return;
        }
        // ③ 레거시 프로젝트: 기존 handleCommand 경로
        if (busy.has(project)) {
          send({
            type: "status",
            project,
            state: "error",
            text: "이미 작업 중이에요",
          });
          return;
        }
        // executor를 먼저 만들어 busy 추가 후 동기 throw로 인한 누수를 막는다
        const continueSession = started.has(project);
        started.add(project);
        const executor = createExecutor(projectDir(projectsRoot, project));
        const systemPrompt = targetSystemPrompt(
          readProjectTarget(projectsRoot, project),
        );
        // 폰으로 보내는 내용을 PC 터미널에도 그대로 미러링한다.
        // (PC에서 보는 화면과 폰에서 보는 화면이 똑같아 보이도록)
        const teeSend = (m: HostOutbound) => {
          recordOutbound(m);
          send(m);
          mirrorToTerminal(log, m);
        };
        busy.add(project);
        void handleCommand(
          project,
          commandText,
          executor,
          teeSend,
          continueSession,
          systemPrompt,
        ).finally(() => busy.delete(project));
      } else if (msg.type === "chat_history_get") {
        // 검증은 command와 동일: 슬러그화 + 실존 확인(경로 탈출·미존재 프로젝트 차단)
        const p = slugifyProjectName(String(msg.project ?? ""));
        if (!p || !listProjects(projectsRoot).includes(p)) return;
        send({
          type: "chat_history",
          project: p,
          entries: readChat(projectDir(projectsRoot, p), 200),
        });
      } else if (msg.type === "error") {
        console.error(
          `⚠️  릴레이 오류: ${msg.text} (RELAY_PASSWORD가 서버와 일치하는지 확인하세요)`,
        );
      }
    }

    ws.on("close", () => {
      if (activeWs === ws) activeWs = null;
      scheduleReconnect();
    });
    ws.on("error", () => {
      // error 뒤에 close가 이어지며 scheduleReconnect가 중복을 막는다
    });
  }

  connect();
}
