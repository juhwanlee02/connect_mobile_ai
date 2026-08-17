// 폰(web) 상태 스토어: 순수 상태 관리만 담당(DOM 접근 금지, 렌더 없음).
// WebSocket 메시지(projects/stage_update/chat_history/assistant/log/status/preview/local_user)를
// applyMessage로 흡수해 store를 갱신하고, 렌더 트리거용 events 배열을 돌려준다.
// 의존성 0, 브라우저·vitest(node) 양쪽에서 그대로 import 가능한 순수 ESM.

// v2: 스텝 정의는 스냅샷(snapshot.steps)이 정본. 아래 폴백은 steps가 없는
// 옛 스냅샷(호스트가 항상 승격해 보내므로 사실상 방어용)만을 위한 것이다.
const FALLBACK_STEPS = [
  ["ideation", "아이디어"], ["wireframe", "구조"], ["business", "비즈니스 모델"], ["prd", "PRD"],
  ["mockup", "목업"], ["estimate", "산정"], ["develop", "개발"], ["test", "테스트"], ["release", "릴리즈"],
].map(([id, label]) => ({ id, label, kind: "builtin", timeoutMin: 20 }));

export function snapshotSteps(snap) {
  return Array.isArray(snap.steps) && snap.steps.length > 0 ? snap.steps : FALLBACK_STEPS;
}

export function stepLabel(snap, stageId) {
  if (stageId === "done") return "완료";
  const s = snapshotSteps(snap).find((x) => x.id === stageId);
  return s ? s.label : stageId;
}

// store: { screen, projects, pendingConfirm, viewer, templates, tplPrompt }
// viewer: null | { project, key, kind:"md"|"iframe", label, url?, content? }
export function createStore() {
  return {
    screen: { name: "home" },
    projects: {},
    pendingConfirm: null,
    viewer: null,
    templates: null,
    tplPrompt: null,
    ideasLibrary: [],
    ideasProposed: { project: "", items: [] },
    preferences: {
      updatedAt: "",
      neverAgain: [],
      dislikedPatterns: [],
      wants: [],
    },
    provider: "claude",
    model: "opus",
  };
}

function ensureProject(store, name) {
  if (!store.projects[name]) {
    store.projects[name] = {
      kind: "legacy",
      target: "ios",
      archived: false,
      pipeline: null,
      chat: [],
      preview: "",
      busy: false,
      form: null, // 비즈니스 모델 설문 스키마(host의 form 메시지로 채워짐)
      skills: null, // 보조 스킬 목록(skills_get 응답 전 null = 미요청/로딩)
    };
  }
  return store.projects[name];
}

function isAwaitingConfirm(p) {
  return p.kind === "pipeline" && !!p.pipeline && p.pipeline.stageStatus === "awaiting_confirm";
}

// msg를 store에 반영하고, 렌더 트리거/알림용 events 배열을 반환한다(기본 빈 배열).
export function applyMessage(store, msg, now) {
  const events = [];
  switch (msg.type) {
    case "projects": {
      const pipelineSet = new Set(msg.pipelines || []);
      const archivedSet = new Set(msg.archived || []);
      // 호스트가 보낸 names가 진실 소스: 삭제(project_delete)로 더는 존재하지 않는 프로젝트는 제거한다.
      const namesSet = new Set(msg.names || []);
      const pruned = [];
      Object.keys(store.projects).forEach((name) => {
        if (!namesSet.has(name)) {
          delete store.projects[name];
          pruned.push(name);
        }
      });
      if (pruned.length > 0) events.push({ type: "pruned", projects: pruned });
      (msg.names || []).forEach((name) => {
        const p = ensureProject(store, name);
        p.kind = pipelineSet.has(name) ? "pipeline" : "legacy";
        p.archived = archivedSet.has(name);
        if (msg.targets && msg.targets[name]) p.target = msg.targets[name];
      });
      break;
    }
    case "stage_update": {
      const p = ensureProject(store, msg.project);
      const prevStatus = p.pipeline ? p.pipeline.stageStatus : null;
      p.kind = "pipeline";
      p.pipeline = msg.pipeline; // 스냅샷 통째 교체
      if (prevStatus !== "awaiting_confirm" && msg.pipeline.stageStatus === "awaiting_confirm") {
        events.push({ type: "attention", project: msg.project });
      }
      if (store.pendingConfirm && store.pendingConfirm.project === msg.project) {
        // 해당 프로젝트의 stage_update는 내용과 무관하게 confirm ack로 간주
        store.pendingConfirm = null;
        events.push({ type: "confirm_acked" });
      }
      break;
    }
    case "chat_history": {
      const p = ensureProject(store, msg.project);
      // 재접속 재동기화 규약: 통째 교체
      p.chat = (msg.entries || []).map((e) => ({ ts: e.ts, role: e.role, text: e.text }));
      break;
    }
    case "assistant": {
      const p = ensureProject(store, msg.project);
      p.chat.push({ ts: now, role: "assistant", text: msg.text });
      break;
    }
    case "log": {
      const p = ensureProject(store, msg.project);
      p.chat.push({ ts: now, role: "log", text: msg.text });
      break;
    }
    case "local_user": {
      // 폰이 자체 전송한 사용자 채팅(호스트로부터 오는 메시지가 아님)
      const p = ensureProject(store, msg.project);
      p.chat.push({ ts: now, role: "user", text: msg.text });
      break;
    }
    case "status": {
      const p = ensureProject(store, msg.project);
      p.busy = msg.state === "working";
      if (msg.state === "error" && msg.text) {
        events.push({ type: "status_error", project: msg.project, text: msg.text });
      }
      break;
    }
    case "preview": {
      const p = ensureProject(store, msg.project);
      p.preview = msg.url;
      break;
    }
    case "artifact": {
      // 열려 있는 뷰어가 이 프로젝트/키를 기다리는 중이면 내용을 채운다(다른 화면으로 넘어간 뒤 도착한 응답은 무시).
      if (store.viewer && store.viewer.project === msg.project && store.viewer.key === msg.key) {
        store.viewer.content = msg.content;
      }
      break;
    }
    case "form": {
      const p = ensureProject(store, msg.project);
      p.form = msg.schema && Array.isArray(msg.schema.questions) ? msg.schema : null;
      break;
    }
    case "skills": {
      const p = ensureProject(store, msg.project);
      p.skills = Array.isArray(msg.items) ? msg.items : [];
      break;
    }
    case "settings": {
      if (msg.provider === "claude" || msg.provider === "codex" || msg.provider === "cursor") {
        store.provider = msg.provider;
      }
      if (typeof msg.model === "string" && msg.model) store.model = msg.model;
      break;
    }
    case "ideas_library": {
      store.ideasLibrary = Array.isArray(msg.items) ? msg.items : [];
      break;
    }
    case "ideas_proposed": {
      store.ideasProposed = {
        project: typeof msg.project === "string" ? msg.project : "",
        items: Array.isArray(msg.items) ? msg.items : [],
      };
      break;
    }
    case "preferences": {
      store.preferences = {
        updatedAt: typeof msg.updatedAt === "string" ? msg.updatedAt : "",
        neverAgain: Array.isArray(msg.neverAgain) ? msg.neverAgain : [],
        dislikedPatterns: Array.isArray(msg.dislikedPatterns) ? msg.dislikedPatterns : [],
        wants: Array.isArray(msg.wants) ? msg.wants : [],
      };
      break;
    }
    case "tpl_list": {
      store.templates = Array.isArray(msg.templates) ? msg.templates : [];
      break;
    }
    case "tpl_prompt": {
      store.tplPrompt = {
        id: msg.id, stepId: msg.stepId,
        body: typeof msg.body === "string" ? msg.body : "",
        overridden: msg.overridden === true,
      };
      break;
    }
    default:
      break;
  }
  return events;
}

export function markConfirmSent(store, project, stage, now) {
  store.pendingConfirm = { project, stage, sentAt: now };
}

// 전송 후 8000ms를 넘겼는지(응답 없음 → 재확인 UI 트리거용)
export function confirmTimedOut(store, now) {
  if (!store.pendingConfirm) return false;
  return now - store.pendingConfirm.sentAt > 8000;
}

// 폰 배지 규칙: error > done > awaiting_confirm > running/starting > awaiting_feedback > pending.
// 레거시(파이프라인 없음) 프로젝트는 busy 여부만으로 판단.
export function statusBadge(p) {
  if (p.kind !== "pipeline" || !p.pipeline) {
    return p.busy ? { label: "작업 중", cls: "run" } : { label: "대기", cls: "pend" };
  }
  const snap = p.pipeline;
  if (snap.stageStatus === "error") return { label: "오류", cls: "err" };
  if (snap.stage === "done") return { label: "완료", cls: "done" };
  if (snap.stageStatus === "awaiting_confirm") return { label: "확인 대기", cls: "wait" };
  if (snap.stageStatus === "running" || snap.stageStatus === "starting") {
    return { label: "진행 중", cls: "run" };
  }
  if (snap.stageStatus === "awaiting_feedback") return { label: "피드백 중", cls: "wait" };
  return { label: "대기", cls: "pend" };
}

// 0..1 (done=1). snapshot.steps 내 순번 기준 (index+1)/steps.length.
export function stageProgress(snapshot) {
  if (snapshot.stage === "done") return 1;
  const steps = snapshotSteps(snapshot);
  const i = steps.findIndex((s) => s.id === snapshot.stage);
  if (i === -1) return 0;
  return (i + 1) / steps.length;
}

// 컴팩트 진행 헤더(접힘 상태) 한 줄 텍스트: "2/7 PRD · 진행 중" 형식.
// done이면 "완료 🎉". 상태 라벨은 statusBadge를 재사용(파이프라인 프로젝트로 감싸 호출).
export function stageLineText(snap) {
  if (snap.stage === "done") return "완료 🎉";
  const steps = snapshotSteps(snap);
  const idx = steps.findIndex((s) => s.id === snap.stage);
  const stepNo = idx === -1 ? 0 : idx + 1;
  const label = stepLabel(snap, snap.stage);
  const status = statusBadge({ kind: "pipeline", pipeline: snap }).label;
  return `${stepNo}/${steps.length} ${label} · ${status}`;
}

// 산출물 라벨: 알려진 키는 한글 라벨, 그 외는 키 그대로.
const ARTIFACT_LABELS = {
  ideas: "아이디어 노트", wireframe: "구조 후보", business: "비즈니스 모델", prd: "PRD", mockup: "목업",
  estimate: "산정 결과", preview: "미리보기", release: "릴리즈 노트",
  devBrief: "기능 브리프", wireframeCandidates: "구조 메타",
};

// artifacts 경로 값(예: "preview/index.html")을 정적 서빙 URL(/preview/<project>/<인코딩>)로.
// 경로 세그먼트별 인코딩, .. 세그먼트는 보안상 거부(null 반환).
export function staticArtifactUrl(project, value) {
  if (typeof value !== "string" || value === "") return null;
  const parts = value.split("/");
  if (parts.some((p) => p === "..")) return null;
  const encoded = parts.map((p) => encodeURIComponent(p)).join("/");
  return `/preview/${encodeURIComponent(project)}/${encoded}`;
}

// 스냅샷에 preview 산출물이 있으면 그 정적 URL(상대경로)을, 없거나 .. 위반이면 null을 반환한다.
// 인라인 상시 미리보기(app.js)와 산출물 버튼(아래) 양쪽이 같은 규칙을 공유하도록 분리.
export function previewUrl(snapshot) {
  return staticArtifactUrl(snapshot.project, (snapshot.artifacts || {}).preview);
}

// 파이프라인 스냅샷의 artifacts 맵을 뷰어 버튼 목록으로 변환.
// .md로 끝나면 md(artifact_get로 내용 요청), mockup/preview 키는 iframe(정적 서빙 URL).
export function artifactButtons(snapshot) {
  const artifacts = snapshot.artifacts || {};
  return Object.keys(artifacts).map((key) => {
    const value = artifacts[key];
    const label = ARTIFACT_LABELS[key] || key;
    // wireframe/mockup/preview 키는 정적 서빙(iframe), 그 외(주로 .md 텍스트 산출물)는 artifact_get으로 내용 요청.
    if (key === "wireframe" || key === "mockup" || key === "preview") {
      const url = staticArtifactUrl(snapshot.project, value);
      if (url === null) return null; // .. 세그먼트 등 — 건너뛰기
      return { key, label, kind: "iframe", url };
    }
    // mockup/preview 외 키는 .md 텍스트 산출물일 때만 버튼 생성(manager가 그 외 확장자엔
    // artifact_get에 응답하지 않아 뷰어가 "불러오는 중…"에서 영구히 멈추는 것을 방지).
    if (typeof value === "string" && value.endsWith(".md")) {
      return { key, label, kind: "md" };
    }
    return null;
  }).filter(b => b !== null);
}

// 기기 프레임 프리셋: iphone/android는 고정 크기, full은 컨테이너 100%(null).
const FRAME_PRESETS = {
  iphone: { w: 390, h: 844 },
  android: { w: 360, h: 800 },
  full: null,
};

export function framePreset(name) {
  return Object.prototype.hasOwnProperty.call(FRAME_PRESETS, name) ? FRAME_PRESETS[name] : null;
}

// 뷰어 오버레이 열기/닫기: btn은 artifactButtons()가 만든 항목({key,label,kind,url?}).
// frame 기본은 "full"(꽉 채움) — 폰에서 iphone 프레임을 축소해 보여주면 실제보다 작게 보여
// "미리보기가 너무 작다"는 실사용 피드백이 있었다. 기기 프레임은 칩으로 선택.
export function openViewer(store, project, btn) {
  store.viewer = {
    project,
    key: btn.key,
    kind: btn.kind,
    label: btn.label,
    url: btn.url || null,
    content: null,
    frame: "full",
  };
}

export function closeViewer(store) {
  store.viewer = null;
}

export function setViewerFrame(store, name) {
  if (store.viewer) store.viewer.frame = name;
}

// 홈 화면용 정렬: active는 awaiting_confirm 우선, archived는 분리 목록.
export function homeProjects(store) {
  const active = [];
  const archived = [];
  Object.keys(store.projects).forEach((name) => {
    const p = store.projects[name];
    if (p.archived) archived.push(name);
    else active.push(name);
  });
  active.sort((a, b) => {
    const wa = isAwaitingConfirm(store.projects[a]) ? 0 : 1;
    const wb = isAwaitingConfirm(store.projects[b]) ? 0 : 1;
    return wa - wb;
  });
  return { active, archived };
}
