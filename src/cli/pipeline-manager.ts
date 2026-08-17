// 파이프라인 상태머신: 큐·confirm/rollback/cancel/sync·exit0 강등.
// 규칙(스펙 §3·§6·§8): 스킬 비실행 중 전이는 host가 pipeline.json에 쓴다.
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, watch, writeFileSync,
} from "node:fs";
import { join, normalize, sep } from "node:path";
import {
  DEFAULT_STEPS, isPriorStage, mergeSnapshot, nextStage, stepTimeoutMs,
  type Stage,
} from "../shared/pipeline.js";
import {
  hasPipeline, readPipelineHostState, readPipelineState,
  writePipelineHostState, writePipelineState,
} from "./pipeline-store.js";
import { readProposedIdeas } from "./idea-memory.js";
import { listProjects, projectDir } from "./projects.js";
import type { Executor, RunHandle } from "./executor.js";
import type { HostOutbound, PhoneOutbound } from "../shared/protocol.js";

export interface PipelineManagerOpts {
  projectsRoot: string;
  repoRoot?: string;
  send: (m: HostOutbound) => void;
  createExecutor: (workdir: string) => Executor;
  now?: () => Date;
}

interface Running { handle: RunHandle; startedAt: number; label: string }

// 폰에 보여줄 실행/큐 미리보기 한 줄의 길이 상한
const PREVIEW_TEXT_MAX = 80;
function previewText(text: string): string {
  const line = text.split("\n")[0].trim();
  return line.length > PREVIEW_TEXT_MAX ? line.slice(0, PREVIEW_TEXT_MAX) + "…" : line;
}

// 보조 스킬 한글 카탈로그: 프로젝트에 시드되는 .claude/commands/skills/<id>/ 기준.
// SKILL.md 형식이 제각각(frontmatter 있는 것/없는 것)이라 파싱 대신 여기서 매핑한다.
// 목록에 없는 디렉터리는 id 그대로 노출(새 스킬 추가 시에도 최소한 보이게).
const SKILL_CATALOG: Array<{ id: string; label: string; desc: string }> = [
  { id: "zero-cost-on-device", label: "운영비 0원 · 온디바이스", desc: "서버·유료 API 없이 기기 내부에서 동작하도록 제한" },
  { id: "color_theme_black_white", label: "다크/라이트 테마 전환", desc: "해/달 버튼으로 흑백 테마를 즉시 전환" },
  { id: "localization-prompt", label: "다국어 지원", desc: "앱 문구를 여러 언어로 번역·적용" },
  { id: "persist_user_settings", label: "설정 저장", desc: "사용자 설정을 기기에 저장해 재실행에도 유지" },
  { id: "overflow-fix", label: "화면 깨짐(오버플로) 수정", desc: "글자·위젯이 넘치는 곳을 전체 점검·수정" },
  { id: "interstitial-splash-ad", label: "전면 광고(시작 화면)", desc: "앱 시작 시 전면 광고 노출(테스트 ID)" },
  { id: "reward-ads", label: "보상형 광고 티켓", desc: "광고 시청으로 티켓 획득, 티켓으로 화면 잠금 해제" },
  { id: "version-check", label: "업데이트 안내", desc: "새 버전이 나오면 업데이트 안내 표시" },
  { id: "app_release_info", label: "릴리즈 정보 도우미", desc: "스토어 등록 정보 작성 보조" },
  { id: "app-store-screenshots", label: "스토어 스크린샷 생성", desc: "스토어용 스크린샷 자동 캡처·합성" },
];

// 오류로 끝난 단계를 사람 개입 없이 이어서 재시도하는 횟수 상한(연속). 초과하면 멈추고
// 수동 재시도/피드백을 기다린다. confirm·rollback·사용자 피드백·정상 종료 시 0으로 리셋된다.
const AUTO_RETRY_MAX = 2;

// done 이후 유지보수 실행의 상한(수정 + 웹 재빌드까지 포함하므로 develop/release와 같은 60분).
const MAINTENANCE_TIMEOUT_MS = 60 * 60_000;

export class PipelineManager {
  private queues = new Map<string, string[]>();      // project → 대기 피드백
  private running = new Map<string, Running>();
  private watchers = new Map<string, { close: () => void }>(); // project → watcher(보관/삭제 시 개별 close)
  private watched = new Set<string>();               // attachWatcher 중복 등록 방지
  private lastEmitted = new Map<string, string>();
  private autoRetry = new Map<string, number>();    // project → 연속 자동 재시도 횟수
  private userCancelled = new Set<string>();         // 사용자가 직접 중단한 실행(자동 재시도 억제)
  private stopped = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private now: () => Date;

  constructor(private opts: PipelineManagerOpts) {
    this.now = opts.now ?? (() => new Date());
  }

  private dir(project: string): string {
    return projectDir(this.opts.projectsRoot, project);
  }

  emitUpdate(project: string, force = false): void {
    if (this.stopped) return;
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state) return;
    const host = readPipelineHostState(d);
    const q = this.queues.get(project) ?? [];
    const running = this.running.get(project);
    // 투명성: 큐 개수뿐 아니라 "지금 뭐가 돌고, 뭐가 대기 중인지"를 폰에서 볼 수 있게 한다.
    const snap = {
      ...mergeSnapshot(state, host, q.length),
      runningText: running ? previewText(running.label) : null,
      queued: q.map(previewText),
    };
    const key = JSON.stringify(snap);
    if (!force && this.lastEmitted.get(project) === key) return; // 중복·에코 억제
    this.lastEmitted.set(project, key);
    this.opts.send({ type: "stage_update", project, pipeline: snap });
  }

  // 디렉터리 단위 watch: rename(원자적 쓰기) 후에도 이벤트가 계속 온다(스펙 §3).
  attachWatcher(project: string): void {
    if (this.watched.has(project)) return; // 이미 붙어 있으면 중복 등록하지 않음(멱등)
    this.watched.add(project);
    const d = this.dir(project);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(d, (_event, filename) => {
      if (
        filename !== "pipeline.json"
        && filename !== "pipeline.host.json"
        && filename !== "PROPOSED_IDEAS.json"
      ) return;
      if (timer) { clearTimeout(timer); this.timers.delete(timer); }
      timer = setTimeout(() => {
        this.timers.delete(timer!);
        this.readAndEmit(project, 3);
        // 후보 파일이 바뀌면 폰 목록도 즉시 갱신(연구소 UI)
        if (filename === "PROPOSED_IDEAS.json") {
          this.opts.send({
            type: "ideas_proposed",
            project,
            items: readProposedIdeas(d),
          });
        }
      }, 150); // 디바운스
      this.timers.add(timer);
    });
    watcher.on("error", () => {}); // watch 대상 삭제 등으로 인한 EventEmitter error가 프로세스를 죽이지 않도록
    this.watchers.set(project, { close: () => watcher.close() });
  }

  /**
   * host 프로세스 재시작 후: 디스크에 running/starting으로 남아 있지만
   * 실제 실행 핸들이 없는 좀비 상태를 오류로 강등한다.
   * (안 하면 폰에 "진행 중"이 영원히 떠 대기처럼 보인다.)
   */
  recoverStaleRuns(): void {
    for (const name of listProjects(this.opts.projectsRoot)) {
      if (!hasPipeline(this.dir(name))) continue;
      if (this.running.has(name)) continue;
      const d = this.dir(name);
      const state = readPipelineState(d);
      if (!state) continue;
      if (state.stageStatus !== "running" && state.stageStatus !== "starting") continue;
      const host = readPipelineHostState(d);
      host.error = "이전에 하던 작업이 끊겼어요. 채팅으로 이어서 하거나 재시도를 눌러 주세요.";
      writePipelineHostState(d, host);
      writePipelineState(d, { ...state, stageStatus: "error" });
      this.opts.send({
        type: "log",
        project: name,
        text: "⚠️ 이전 실행이 끊긴 상태라 대기/진행 표시를 오류로 정리했어요. 다시 이어서 실행할 수 있어요.",
      });
      this.emitUpdate(name, true);
    }
  }

  /** 새 파이프라인 프로젝트가 pending이면 첫 단계를 바로 시작한다. */
  startIfPending(project: string, suffix?: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state || state.stage === "done") return;
    if (state.stageStatus !== "pending") return;
    if (this.running.has(project)) return;
    writePipelineState(d, { ...state, stageStatus: "starting" });
    this.emitUpdate(project);
    this.runStage(project, state.stage, suffix);
  }

  isRunning(project: string): boolean {
    return this.running.has(project);
  }

  // 삭제/보관 시 감시·큐·중복억제 상태를 함께 정리(호출자는 반드시 디렉터리 이동/삭제 전에 호출할 것)
  detachWatcher(project: string): void {
    this.queues.delete(project);
    this.lastEmitted.delete(project);
    this.autoRetry.delete(project);
    this.userCancelled.delete(project);
    if (!this.watched.has(project)) return;
    this.watched.delete(project);
    this.watchers.get(project)?.close();
    this.watchers.delete(project);
  }

  // 파싱 실패 시 재시도(쓰기 도중 부분 파일을 error로 오판하지 않기 — 스펙 §3)
  private readAndEmit(project: string, retries: number): void {
    // detachWatcher 이후 도착한 지연 이벤트(디바운스 타이머가 이미 예약돼 있던 경우)는 무시한다.
    if (this.stopped || !this.watched.has(project)) return;
    const state = readPipelineState(this.dir(project));
    if (!state) {
      if (retries > 0) {
        const t = setTimeout(() => {
          this.timers.delete(t);
          this.readAndEmit(project, retries - 1);
        }, 100);
        this.timers.add(t);
      }
      return;
    }
    this.emitUpdate(project);
  }

  // 파이프라인 메시지면 처리하고 true. 아니면 false(호출자가 레거시 경로로).
  handleMessage(msg: PhoneOutbound): boolean {
    switch (msg.type) {
      case "confirm": this.confirm(msg.project, msg.stage); return true;
      case "stage_rollback": this.rollback(msg.project, msg.toStage as Stage); return true;
      case "stage_cancel": this.cancel(msg.project); return true;
      case "pipeline_sync": this.sync(); return true;
      case "artifact_get": this.artifact(msg.project, msg.key); return true;
      case "artifact_set": this.artifactSet(msg.project, msg.key, msg.content); return true;
      case "form_get": this.formGet(msg.project); return true;
      case "form_submit": this.formSubmit(msg.project, msg.answers); return true;
      case "skills_get": this.skillsGet(msg.project); return true;
      default: return false;
    }
  }

  handleFeedback(project: string, text: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state) return;
    // 사용자가 직접 보낸 지시(수동 재시도 버튼 포함)는 새 개입이므로 자동 재시도 카운터를 리셋한다.
    this.autoRetry.delete(project);
    if (this.running.has(project)) {
      const q = this.queues.get(project) ?? [];
      q.push(text);
      this.queues.set(project, q);
      this.emitUpdate(project);
      return;
    }
    // done 이후에도 채팅은 계속 동작한다(실사용 피드백: "끝나면 입력이 안 돼요") —
    // 단계 스킬 대신 유지보수 모드로 요청을 그대로 실행한다.
    if (state.stage === "done") {
      this.runMaintenance(project, text);
      return;
    }
    this.runStage(project, state.stage, `피드백: ${text}`);
  }

  private confirm(project: string, stage: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    // 멱등성: 현재 stage·awaiting_confirm과 일치할 때만 1회 처리
    if (!state || state.stage !== stage || state.stageStatus !== "awaiting_confirm") return;
    // in-flight 선점 금지: 실행 중이면 무시(폰 UI는 running 중 버튼 비활성)
    if (this.running.has(project)) return;
    this.autoRetry.delete(project); // 단계 전환 → 자동 재시도 카운터 리셋
    this.notifyQueueFlush(project); // stage 전환 → 잔여 큐 flush
    const next = nextStage(state.steps, state.stage);
    if (!next) return;
    const host = readPipelineHostState(d);
    host.history.push({ stage: state.stage, confirmedAt: this.now().toISOString() });
    host.error = null;
    writePipelineHostState(d, host);
    if (next === "done") {
      writePipelineState(d, { ...state, stage: "done", stageStatus: "pending" });
      this.emitUpdate(project);
      return;
    }
    writePipelineState(d, { ...state, stage: next, stageStatus: "starting" });
    this.emitUpdate(project);
    this.runStage(project, next);
  }

  private rollback(project: string, toStage: Stage): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state || this.running.has(project)) return;
    if (!isPriorStage(state.steps, toStage, state.stage)) return;
    this.autoRetry.delete(project); // 롤백 → 자동 재시도 카운터 리셋
    this.notifyQueueFlush(project);
    const host = readPipelineHostState(d);
    host.sessionId = null; // 롤백은 새 세션(스펙 §8: 재수화)
    host.error = null;
    writePipelineHostState(d, host);
    writePipelineState(d, { ...state, stage: toStage, stageStatus: "starting" });
    this.emitUpdate(project);
    this.runStage(project, toStage);
  }

  // stage 전환(confirm/rollback)으로 잔여 큐를 버릴 때, 대기 개수가 있으면 취소 통지(스펙 §6).
  private notifyQueueFlush(project: string): void {
    const flushed = this.queues.get(project)?.length ?? 0;
    if (flushed > 0)
      this.opts.send({
        type: "log",
        project,
        text: `⚠️ 단계가 바뀌어 대기 중이던 명령 ${flushed}개가 취소됐어요`,
      });
    this.queues.delete(project);
  }

  private cancel(project: string): void {
    const r = this.running.get(project);
    if (!r) {
      this.opts.send({ type: "log", project, text: "중단할 실행이 이미 종료됐어요" });
      this.emitUpdate(project);
      return;
    }
    this.userCancelled.add(project); // 사용자 중단은 자동 재시도 대상이 아니다
    this.notifyQueueFlush(project);
    const d = this.dir(project);
    const host = readPipelineHostState(d);
    host.error = "사용자가 작업을 중단했어요";
    writePipelineHostState(d, host);
    this.demoteIfStuck(d);
    this.opts.send({ type: "log", project, text: "■ 중단 요청을 보냈어요" });
    this.emitUpdate(project);
    r.handle.cancel();
    // 실제 프로세스 종료 후 running 정리는 execute()의 done 체인이 수행한다.
  }

  private sync(): void {
    for (const name of listProjects(this.opts.projectsRoot)) {
      // 재접속 시 상태 무변경이라도 재전송(dedupe는 watch 에코 억제용이지 sync 계약 대상이 아님)
      if (hasPipeline(this.dir(name))) this.emitUpdate(name, true);
    }
  }

  private artifact(project: string, key: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    const rel = state?.artifacts[key];
    if (!rel || !rel.endsWith(".md")) return;
    const base = normalize(d);
    const path = normalize(join(d, rel));
    if (!(path === base || path.startsWith(base + sep))) return; // 경로 탈출 방지(접두사 우회 차단)
    try {
      this.opts.send({ type: "artifact", project, key, content: readFileSync(path, "utf8") });
    } catch { /* 파일 없음 → 무시 */ }
  }

  // 폰에서 산출물 md를 직접 수정(스펙 §4): 실행 중 거부·1MB 상한·미등록/비md 무시·
  // 경로 탈출 무시·원자적 쓰기 후 log+artifact 회신.
  private artifactSet(project: string, key: string, content: string): void {
    const d = this.dir(project);
    if (this.running.has(project)) {
      this.opts.send({ type: "log", project, text: "⚠️ 작업이 끝난 뒤 수정해 주세요 (Claude가 파일을 쓰는 중이에요)" });
      return;
    }
    if (typeof content !== "string" || Buffer.byteLength(content) > 1024 * 1024) {
      this.opts.send({ type: "log", project, text: "⚠️ 문서가 너무 커요(1MB 제한)" });
      return;
    }
    const state = readPipelineState(d);
    const rel = state?.artifacts[key];
    if (!rel || !rel.endsWith(".md")) return;
    const base = normalize(d);
    const path = normalize(join(d, rel));
    if (!(path === base || path.startsWith(base + sep))) return;
    try {
      const tmp = `${path}.tmp-${process.pid}`;
      writeFileSync(tmp, content);
      renameSync(tmp, path);
    } catch {
      this.opts.send({ type: "log", project, text: "⚠️ 저장에 실패했어요" });
      return;
    }
    this.opts.send({ type: "log", project, text: `📝 사용자가 문서를 직접 수정했어요 (${rel})` });
    this.opts.send({ type: "artifact", project, key, content });
  }

  // 보조 스킬 목록: 프로젝트에 실제로 시드된 .claude/commands/skills/* 디렉터리를 스캔해
  // 카탈로그 순서(카탈로그에 없는 것은 뒤에 id 그대로)로 폰에 보낸다.
  private skillsGet(project: string): void {
    const skillsDir = join(this.dir(project), ".claude", "commands", "skills");
    // 기존 프로젝트에도 새로 분리된 선택형 아키텍처 제약 스킬을 제공한다.
    const zeroCostSource = this.opts.repoRoot
      ? join(this.opts.repoRoot, "commands", "skills", "zero-cost-on-device")
      : "";
    const zeroCostTarget = join(skillsDir, "zero-cost-on-device");
    if (zeroCostSource && existsSync(zeroCostSource) && !existsSync(zeroCostTarget)) {
      try {
        mkdirSync(skillsDir, { recursive: true });
        cpSync(zeroCostSource, zeroCostTarget, { recursive: true });
      } catch { /* 읽기 전용/잠금 프로젝트면 기존 목록만 제공 */ }
    }
    let dirs: string[];
    try {
      dirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch { dirs = []; } // 스킬 미시드 프로젝트(레거시 등) → 빈 목록
    const present = new Set(dirs);
    const items = SKILL_CATALOG.filter((s) => present.has(s.id));
    for (const d of dirs) {
      if (!SKILL_CATALOG.some((s) => s.id === d)) items.push({ id: d, label: d, desc: "" });
    }
    this.opts.send({ type: "skills", project, items });
  }

  // 비즈니스 모델 설문 폼 스키마 전달: 스킬이 쓴 artifacts.businessForm(json)을 읽어 폰에 보낸다.
  private formGet(project: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    const rel = state?.artifacts["businessForm"];
    if (!rel || !rel.endsWith(".json")) return;
    const base = normalize(d);
    const path = normalize(join(d, rel));
    if (!(path === base || path.startsWith(base + sep))) return; // 경로 탈출 방지
    try {
      const schema = JSON.parse(readFileSync(path, "utf8"));
      if (!schema || !Array.isArray(schema.questions)) return; // 최소 형태 검증
      this.opts.send({ type: "form", project, schema });
    } catch { /* 없음/파싱 실패 → 무시 */ }
  }

  // 설문 제출: business/answers.json(고정 경로)에 원자적 저장 후 스킬을 피드백으로 재호출한다.
  private formSubmit(project: string, answers: Record<string, string>): void {
    const d = this.dir(project);
    if (this.running.has(project)) {
      this.opts.send({ type: "log", project, text: "⚠️ 작업이 끝난 뒤 제출해 주세요 (Claude가 작업 중이에요)" });
      return;
    }
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (typeof k === "string" && typeof v === "string" && k.length <= 64 && v.length <= 256) clean[k] = v;
    }
    if (Object.keys(clean).length === 0) return;
    const state = readPipelineState(d);
    if (!state || state.stage !== "business") return; // 비즈니스 단계에서만 유효
    const path = join(d, "business", "answers.json");
    try {
      mkdirSync(join(d, "business"), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(clean, null, 2));
      renameSync(tmp, path);
    } catch {
      this.opts.send({ type: "log", project, text: "⚠️ 제출 저장에 실패했어요" });
      return;
    }
    this.opts.send({ type: "log", project, text: "📝 비즈니스 모델 설문을 제출했어요" });
    this.handleFeedback(project, "설문 폼을 제출했습니다. business/answers.json을 읽어 결정을 확정해줘.");
  }

  private runStage(project: string, stage: string, suffix?: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    const timeoutMs = stepTimeoutMs(state?.steps ?? DEFAULT_STEPS, stage);
    // 재시도/피드백으로 이 단계를 다시 돌릴 때, demoteIfStuck가 pipeline.json에 남긴
    // "error"를 실행 시작 시점에 지운다 — 스킬의 첫 응답(수십 초)이 오기 전까지 진행
    // 표시가 되도록 낙관적으로 "starting"으로 전이한다(confirm/rollback 경로는 이미
    // starting을 써둔 뒤 진입하므로 no-op). host.error는 execute가 공통으로 지운다.
    if (state && state.stageStatus === "error") {
      writePipelineState(d, { ...state, stageStatus: "starting" });
    }
    const command = suffix ? `/pipeline-${stage} ${suffix}` : `/pipeline-${stage}`;
    // 폰 표시용 실행 라벨: 피드백이면 그 내용, 단계 시작이면 단계명
    const label = suffix ?? `${stage} 단계 시작`;
    this.execute(project, command, timeoutMs, `${stage} 단계가 제한 시간을 초과했어요`, label);
  }

  // 출시(done) 이후 유지보수 실행: 단계 스킬(/pipeline-*)이 아니라 사용자의 수정 요청을
  // 그대로 실행한다(스펙 확장 — 실사용 피드백: 완료 후에도 계속 고칠 수 있어야 한다).
  // 파이프라인 전이는 없으며, 앱을 고쳤으면 미리보기 재빌드까지 지시해 폰에서 결과가 보이게 한다.
  private runMaintenance(project: string, text: string): void {
    const command = [
      "유지보수 모드입니다 — 이 프로젝트의 파이프라인은 이미 완료(done) 상태입니다.",
      "pipeline.json은 읽기만 하고 절대 수정하지 마세요(stage/stageStatus 전이 금지).",
      "아래 요청을 반영하세요. app/ 소스를 고쳤다면 반드시 미리보기를 갱신합니다:",
      `1) cd app && flutter build web --release --base-href=/preview/${project}/preview/ --pwa-strategy=none --dart-define=SEED=true (완료 후 별도 호출로 cd .. 복귀)`,
      "2) cp -R app/build/web/. preview/",
      "끝나면 무엇을 어떻게 바꿨는지 채팅으로 쉬운 말로 보고하세요. 릴리즈 산출물(release/)도 다시 만들어야 할 큰 변경이면 그 사실을 함께 알려주세요.",
      "",
      `요청: ${text}`,
    ].join("\n");
    this.execute(project, command, MAINTENANCE_TIMEOUT_MS, "수정 작업이 제한 시간을 초과했어요", text);
  }

  // runStage/runMaintenance 공통 실행 본문: host.error 클리어 → executor 실행 →
  // 타임아웃·종료 처리(강등·큐 드레인·자동 재시도). label은 폰 표시용 실행 요약.
  private execute(project: string, command: string, timeoutMs: number, timeoutText: string, label: string): void {
    const d = this.dir(project);
    const host = readPipelineHostState(d);
    // 이전 실패의 흔적을 실행 시작 시점에 지운다. host.error가 남아 있으면 mergeSnapshot이
    // 스킬이 쓸 "running"을 계속 "error"로 덮어써(pipeline.ts) 실제로 진행 중인데도
    // 폰 UI에 "오류 + 재시도"만 보인다.
    if (host.error !== null) {
      host.error = null;
      writePipelineHostState(d, host);
    }
    this.emitUpdate(project);
    const executor = this.opts.createExecutor(d);
    // 실행 시작 즉시 안내: CLI의 첫 응답까지 수십 초 걸릴 수 있어, 이 한 줄이 없으면
    // 사용자에게 멈춘 것처럼 보인다(실사용 피드백).
    this.opts.send({
      type: "log",
      project,
      text: "⏳ AI가 작업을 시작했어요 — 첫 응답까지 몇십 초 걸릴 수 있어요",
    });
    const handle = executor.run(command, {
      continueSession: false,
      resumeSessionId: host.sessionId ?? undefined,
      onEvent: (e) => {
        if (e.role === "assistant") this.opts.send({ type: "assistant", project, text: e.text });
        else if (e.role === "log") this.opts.send({ type: "log", project, text: e.text });
      },
    });
    this.running.set(project, { handle, startedAt: Date.now(), label });
    this.emitUpdate(project); // runningText가 즉시 폰에 반영되도록(내용이 바뀌므로 dedupe 통과)
    // 단계 상한 타임아웃(스펙 §8): 초과 시 그룹 킬 + host error 기록.
    // handle.cancel() 이후 done이 resolve/reject 어느 쪽으로 끝나도 아래 timedOut 가드가
    // 타임아웃 에러 문구를 취소/성공 처리로 덮어쓰지 않게 막는다(이중 처리 방지).
    let timedOut = false;
    let runFailed = false; // done이 reject로 끝났는지(=진짜 실패). 자동 재시도는 이 경로에서만.
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      timedOut = true;
      handle.cancel();
      const h = readPipelineHostState(d);
      h.error = timeoutText;
      writePipelineHostState(d, h);
      this.demoteIfStuck(d);
    }, timeoutMs);
    this.timers.add(timer);
    handle.done
      .then((result) => {
        if (timedOut) return;
        const h = readPipelineHostState(d);
        if (this.userCancelled.has(project)) {
          h.error = "사용자가 작업을 중단했어요";
          writePipelineHostState(d, h);
          this.demoteIfStuck(d);
          return;
        }
        if (result.sessionId) h.sessionId = result.sessionId;
        h.error = null; // 성공 종료 → 이전 재시도의 error를 클리어(스펙 §3)
        writePipelineHostState(d, h);
        this.demoteIfStuck(d);
      })
      .catch((err) => {
        if (timedOut) return;
        runFailed = true;
        const h = readPipelineHostState(d);
        h.error = this.userCancelled.has(project)
          ? "사용자가 작업을 중단했어요"
          : String(err);
        writePipelineHostState(d, h);
        // 실패/취소 경로에서도 stageStatus가 running/starting에 고착되지 않도록 강등
        this.demoteIfStuck(d);
      })
      .finally(() => {
        clearTimeout(timer);
        this.timers.delete(timer);
        this.running.delete(project);
        const cancelledByUser = this.userCancelled.delete(project);
        this.emitUpdate(project);
        this.drainQueue(project);
        // 대기 큐가 이어받았으면 그게 곧 연속 실행이므로 자동 재시도는 하지 않는다.
        if (this.running.has(project)) return;
        // 진짜 실패(reject)로 끝났고, 사용자 중단·타임아웃이 아닐 때만 자동으로 이어서 재시도한다.
        // 정상 종료(성공)·exit-0 강등은 스킬이 턴을 끝낸 것이므로 건드리지 않는다.
        if (runFailed && !cancelledByUser && !timedOut) this.maybeAutoRetry(project);
        else this.autoRetry.delete(project);
      });
  }

  // 오류로 끝난 단계를 사람 개입 없이 이어서 재시도한다(스펙 확장 — 실사용 피드백: 에러가 나면
  // Claude가 이어서 고치길 기대하는데 "에러"로 멈춰 보인다). 연속 AUTO_RETRY_MAX회를 넘기면
  // 멈추고 수동 개입(재시도/피드백)을 기다린다. 호출 조건은 finally에서 이미 걸러진다.
  private maybeAutoRetry(project: string): void {
    if (this.stopped) return;
    const d = this.dir(project);
    const state = readPipelineState(d);
    const host = readPipelineHostState(d);
    const inError = host.error !== null || state?.stageStatus === "error";
    if (!state || state.stage === "done" || !inError) {
      this.autoRetry.delete(project);
      return;
    }
    const n = this.autoRetry.get(project) ?? 0;
    const reason = (host.error ?? "").replace(/^Error:\s*/i, "").trim().slice(0, 180);
    const reasonSuffix = reason ? `\n원인: ${reason}` : "";
    if (n >= AUTO_RETRY_MAX) {
      this.opts.send({
        type: "log",
        project,
        text:
          `⚠️ 자동으로 ${AUTO_RETRY_MAX}번 더 시도했는데도 계속 막혀서 멈췄어요. ` +
          `채팅으로 상황을 알려주시거나 재시도를 눌러 주세요.` +
          reasonSuffix,
      });
      return; // 수동 개입 대기(카운터는 confirm/rollback/사용자 피드백 때 리셋)
    }
    this.autoRetry.set(project, n + 1);
    this.opts.send({
      type: "log",
      project,
      text:
        `⚠️ 오류가 나서 자동으로 이어서 다시 시도할게요 (${n + 1}/${AUTO_RETRY_MAX})` +
        reasonSuffix,
    });
    // runStage 시작 시 host.error를 지우고 starting으로 전이하므로(위 참조) 폰에는 즉시 "진행 중"이 뜬다.
    this.runStage(project, state.stage, "피드백: 방금 오류가 났어요. 원인을 찾아 고치고 이 단계를 끝까지 완료해 주세요.");
  }

  // exit-0 강등(스펙 §8): 스킬이 상태 갱신을 깜빡한 채 종료(성공/실패/취소 공통)
  private demoteIfStuck(d: string): void {
    const s = readPipelineState(d);
    if (s && (s.stageStatus === "running" || s.stageStatus === "starting")) {
      writePipelineState(d, { ...s, stageStatus: "error" });
    }
  }

  private drainQueue(project: string): void {
    const q = this.queues.get(project);
    if (!q || q.length === 0) return;
    const state = readPipelineState(this.dir(project));
    if (!state) { this.queues.delete(project); return; }
    const text = q.shift()!;
    if (q.length === 0) this.queues.delete(project);
    // 실행 중 쌓인 메시지는 종료 상태와 무관하게 순서대로 이어서 실행한다 — awaiting_confirm에서
    // 보류하면 사용자가 미리 보내 둔 지시가 영영 실행되지 않는다(실사용 피드백). done이면
    // 유지보수 모드로 이어받는다.
    if (state.stage === "done") this.runMaintenance(project, text);
    else this.runStage(project, state.stage, `피드백: ${text}`);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const w of this.watchers.values()) w.close();
    for (const [, r] of this.running) r.handle.cancel();
  }
}
