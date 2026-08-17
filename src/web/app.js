// 폰 웹앱 배선(DOM): 상태는 전부 store.js(순수 모듈)에 위임하고,
// 여기서는 WebSocket 송수신 + 단일 render()로 화면 3개(pair/home/project)를 토글한다.
import {
  createStore,
  applyMessage,
  markConfirmSent,
  confirmTimedOut,
  statusBadge,
  stageProgress,
  homeProjects,
  artifactButtons,
  framePreset,
  openViewer,
  closeViewer,
  setViewerFrame,
  snapshotSteps,
  stepLabel,
  stageLineText,
  previewUrl,
} from "./store.js";
import { renderMarkdown } from "./markdown.js";

const $ = (id) => document.getElementById(id);

const store = createStore();
let ws = null;
let paired = false;
// relay가 paired 메시지로 전달한 /preview/** 인증 토큰. store에는 저장하지 않는다
// (URL 순수성 계약: store는 raw url만 들고, 조립은 이 레이어 책임 — 1B-4 연장).
let previewToken = null;
let archOpen = false; // 홈 "보관됨" 섹션 펼침 여부
// ---------- 비즈니스 모델 설문 폼 상태 ----------
const formPending = new Set();  // form_get을 이미 보낸 프로젝트(중복 요청 억제)
let formSel = {};               // 현재 폼의 {질문id: 선택값}
let formSelProject = null;      // formSel이 어느 프로젝트 폼의 것인지(대상 바뀌면 기본값으로 초기화)
let confirmTimeoutShown = false; // pendingConfirm 8초 초과 → [다시 전송] 노출
let toastTimer = null;
let mdEditing = false; // 뷰어 md 직접 수정 모드(textarea 표시) 여부
let mdSaving = false; // artifact_set 전송 후 artifact 회신 대기 중 여부
let mdSaveTimer = null; // 저장 확인(artifact 회신) 5초 타임아웃
let pendingImages = []; // { name, mime, base64, preview } — 전송 전 메모리에만 유지
let ideaOpenSlug = null;
let proposedOpenSlug = null;
/** idea-lab: "chat" | "ideas" — 대화와 후보 리스트를 화면 전환 */
let ideaViewMode = "chat";
let ideaViewAutoOpened = false;
/** false | "direct" | "templates" */
let templateProjectMode = false;
let ideaDevelopmentTemplate = "development";

function openIdeaPicker(template = "development") {
  ideaDevelopmentTemplate = template;
  ideaOpenSlug = null;
  send({ type: "ideas_library_get" });
  renderIdeaPicker();
  $("ideaPicker").hidden = false;
}

function closeIdeaPicker() {
  $("ideaPicker").hidden = true;
  ideaOpenSlug = null;
  ideaDevelopmentTemplate = "development";
}

function openNewProjectSheet() {
  templateProjectMode = false;
  send({ type: "tpl_list" });
  $("newProjectSheet").hidden = false;
  renderNewProjectSheet();
}

function closeNewProjectSheet() {
  $("newProjectSheet").hidden = true;
  templateProjectMode = false;
}

function renderNewProjectSheet() {
  const panel = $("templateProjectPanel");
  panel.hidden = !templateProjectMode;
  $("directIdeaInput").hidden = templateProjectMode !== "direct";
  $("modeIdeaLab").hidden = templateProjectMode;
  $("modeDirectDevelop").hidden = templateProjectMode;
  $("modeDevelop").hidden = templateProjectMode;
  $("modeTemplate").hidden = templateProjectMode;
  if (!templateProjectMode) return;

  const list = $("newProjectTemplates");
  list.innerHTML = "";
  if (templateProjectMode === "direct") {
    const btn = el("button", "mode-row");
    btn.type = "button";
    btn.appendChild(el("strong", "", "🚀 대화 시작"));
    btn.appendChild(el("span", "", "기능 논의 → 구조 후보 → 개발 순서로 진행해요"));
    btn.onclick = () => startProjectWithTemplate("development", true);
    list.appendChild(btn);
    return;
  }
  if (!store.templates) {
    list.appendChild(el("p", "hint", "템플릿을 불러오는 중…"));
    return;
  }

  // 기본 제공 템플릿은 전용 버튼으로 시작하고, 여기에는 사용자가 만든 복제본만 표시한다.
  const templates = store.templates.filter((t) => !t.readonly);
  templates.forEach((t) => {
    const btn = el("button", "mode-row");
    btn.type = "button";
    btn.appendChild(el("strong", "", `📋 ${t.name}`));
    btn.appendChild(el("span", "", t.steps.map((s) => s.label).join(" → ")));
    btn.onclick = () => startProjectWithTemplate(t.id, t.developmentFlow);
    list.appendChild(btn);
  });
  if (templates.length === 0) {
    list.appendChild(el("p", "hint", "사용할 수 있는 템플릿이 없어요."));
  }
}

function startProjectWithTemplate(template, startsImmediately = false) {
  const input = $("templateProjectName");
  const initialPrompt = startsImmediately ? $("directIdeaInput").value.trim() : "";
  const name = input.value.trim().toLowerCase();
  if (!name) {
    toast("프로젝트 이름을 입력해 주세요");
    input.focus();
    return;
  }
  if (/[^a-z0-9-]/.test(name) || !/^[a-z]/.test(name)) {
    toast("영문 소문자로 시작하고, 영문/숫자/하이픈만 쓸 수 있어요");
    input.focus();
    return;
  }
  send({
    type: "createProject",
    name,
    pipeline: true,
    template,
    ...(initialPrompt ? { initialPrompt } : {}),
  });
  closeNewProjectSheet();
  input.value = "";
  $("directIdeaInput").value = "";
  toast(startsImmediately
    ? initialPrompt
      ? "아이디어를 바탕으로 기능 논의를 시작했어요."
      : "프로젝트를 만들고 있어요. 들어가서 만들 앱을 대화로 알려주세요."
    : "프로젝트를 만들었어요. 홈에서 열어 첫 지시를 보내세요.");
}

function startIdeaLab() {
  closeNewProjectSheet();
  if (store.projects["idea-lab"]) {
    openProject("idea-lab");
    return;
  }
  send({ type: "createProject", name: "idea-lab", pipeline: true, template: "idea-lab" });
  send({
    type: "command",
    project: "idea-lab",
    text: "새 아이디어 연구소 회의를 시작해서 최종 후보 20개를 제안해줘",
  });
  toast("아이디어 연구소를 만들고 있어요");
}

function createProjectFromIdea(idea, nameInput) {
  let name = (nameInput?.value || idea.slug || "").trim().toLowerCase();
  if (!name) {
    toast("프로젝트 이름을 입력해 주세요");
    nameInput?.focus();
    return;
  }
  if (/[^a-z0-9-]/.test(name) || !/^[a-z]/.test(name)) {
    toast("영문 소문자로 시작하고, 영문/숫자/하이픈만 쓸 수 있어요");
    nameInput?.focus();
    return;
  }
  // onclick에 함수 참조를 직접 넘기면 브라우저 MouseEvent가 첫 인자로 들어올 수 있다.
  // 보관함 개발은 잘못된 값이 섞여도 반드시 development 템플릿으로 보정한다.
  const template = typeof ideaDevelopmentTemplate === "string"
    ? ideaDevelopmentTemplate
    : "development";
  closeIdeaPicker();
  // host가 development 생성 직후 첫 단계(개발 논의)를 자동 시작하므로 command를 따로 보내지 않는다
  // (create보다 command가 먼저 가면 "프로젝트 없음"으로 먹히거나 대기만 남던 문제 방지).
  send({
    type: "createProject",
    name,
    pipeline: true,
    template,
    ideaSlug: idea.slug,
  });
  toast("먼저 기능을 맞추고, 이어서 구조 후보를 고를게요");
}

function deleteIdea(idea) {
  if (!confirm(`「${idea.oneLiner}」\n\n이 아이디어를 보관함에서 삭제할까요?`)) return;
  send({ type: "ideas_delete", slug: idea.slug });
  if (ideaOpenSlug === idea.slug) ideaOpenSlug = null;
  toast("아이디어를 삭제했어요");
}

function keepProposedIdea(idea) {
  const name = currentProject();
  if (!name || !idea?.slug) return;
  if (idea.kept) {
    toast("이미 보관함에 넣은 아이디어예요");
    return;
  }
  const feedback = prompt(
    "왜 좋았는지 한 줄로 적어 주세요.\n예: 와 이런 신박한 걸 원했어요",
    "",
  );
  if (feedback === null) return;
  send({
    type: "ideas_keep",
    project: name,
    slug: idea.slug,
    feedback: feedback.trim(),
  });
  toast("보관함에 넣고, 다음 회의에 비슷한 신박함을 반영할게요");
}

function setIdeaViewMode(mode) {
  ideaViewMode = mode === "ideas" ? "ideas" : "chat";
  const screen = $("screen-project");
  if (screen) screen.classList.toggle("ideas-mode", ideaViewMode === "ideas");
  const chatTab = $("ideaTabChat");
  const listTab = $("ideaTabList");
  if (chatTab) {
    chatTab.classList.toggle("on", ideaViewMode === "chat");
    chatTab.setAttribute("aria-selected", ideaViewMode === "chat" ? "true" : "false");
  }
  if (listTab) {
    listTab.classList.toggle("on", ideaViewMode === "ideas");
    listTab.setAttribute("aria-selected", ideaViewMode === "ideas" ? "true" : "false");
  }
}

function syncIdeaViewToggle(projectName, count) {
  const toggle = $("ideaViewToggle");
  const countEl = $("ideaTabCount");
  if (!toggle) return;
  const show = count > 0;
  toggle.classList.toggle("on", show);
  if (countEl) {
    countEl.hidden = !show;
    countEl.textContent = String(count);
  }
  if (!show) {
    ideaViewAutoOpened = false;
    setIdeaViewMode("chat");
    return;
  }
  // 후보가 새로 생기면 한 번 리스트 전체 화면으로 연다 (반쪽 끼워넣기 방지)
  if (!ideaViewAutoOpened) {
    ideaViewAutoOpened = true;
    setIdeaViewMode("ideas");
  } else {
    setIdeaViewMode(ideaViewMode);
  }
}

function renderIdeaProposed(projectName) {
  const pane = $("ideaProposed");
  const list = $("ideaProposedList");
  if (!pane || !list) return;
  const proposed = store.ideasProposed;
  const items = proposed && proposed.project === projectName ? (proposed.items || []) : [];
  syncIdeaViewToggle(projectName, items.length);
  pane.hidden = items.length === 0 || ideaViewMode !== "ideas";
  if (items.length === 0) {
    list.textContent = "";
    return;
  }
  list.textContent = "";
  items.forEach((idea, index) => {
    const open = proposedOpenSlug === idea.slug;
    const row = el("article", "idea-row" + (open ? " open" : ""));
    const summary = el("div", "idea-summary");
    summary.appendChild(el("span", "idea-num", String(index + 1)));
    const main = el("div", "idea-main");
    const meta = [idea.direction, idea.category].filter(Boolean).join(" · ") || idea.slug;
    main.appendChild(el("div", "idea-meta", meta));
    main.appendChild(el("div", "idea-title", idea.oneLiner));
    if (idea.sourceApp) {
      main.appendChild(el("div", "idea-ref", "참고: " + idea.sourceApp));
    }
    if (idea.kept) main.appendChild(el("div", "idea-kept", "✓ 보관됨"));
    summary.appendChild(main);
    summary.appendChild(el("span", "idea-chevron", "›"));
    summary.onclick = () => {
      proposedOpenSlug = open ? null : idea.slug;
      renderIdeaProposed(projectName);
    };
    row.appendChild(summary);

    const detail = el("div", "idea-detail");
    detail.appendChild(el("div", "idea-detail-body", idea.detail || "상세 설명이 아직 없어요."));
    appendIdeaReferenceBlock(detail, idea);
    const actions = el("div", "idea-actions");
    const keep = el("button", "btn primary", idea.kept ? "보관됨" : "이 아이디어 보관");
    keep.type = "button";
    keep.disabled = !!idea.kept;
    keep.onclick = (event) => {
      event.stopPropagation();
      keepProposedIdea(idea);
    };
    actions.appendChild(keep);
    detail.appendChild(actions);
    row.appendChild(detail);
    list.appendChild(row);
  });
}

function appendIdeaReferenceBlock(detail, idea) {
  if (!idea?.sourceApp && !idea?.inspirationBasis) return;
  const box = el("div", "idea-ref-block");
  if (idea.sourceApp) {
    box.appendChild(el("div", "idea-ref-line", "레퍼런스: " + idea.sourceApp));
  }
  if (idea.inspirationBasis) {
    box.appendChild(el("div", "idea-ref-sub", "참고한 점: " + idea.inspirationBasis));
  }
  detail.appendChild(box);
}

function renderIdeaPicker() {
  const list = $("ideaPickerList");
  if (!list) return;
  list.textContent = "";
  const ideas = store.ideasLibrary || [];
  if (ideas.length === 0) {
    list.appendChild(el(
      "div",
      "idea-empty",
      "아직 보관한 아이디어가 없어요.\n홈에서 「아이디어 연구소」로 후보를 만든 뒤\n맘에 드는 것만 보관해 주세요.\n(개발을 시작하면 보관함에서 자동으로 빠져요)",
    ));
    return;
  }
  ideas.forEach((idea, index) => {
    const open = ideaOpenSlug === idea.slug;
    const row = el("article", "idea-row" + (open ? " open" : ""));
    const summary = el("div", "idea-summary");
    summary.appendChild(el("span", "idea-num", String(index + 1)));
    const main = el("div", "idea-main");
    const meta = [idea.direction, idea.category].filter(Boolean).join(" · ") || idea.slug;
    main.appendChild(el("div", "idea-meta", meta));
    main.appendChild(el("div", "idea-title", idea.oneLiner));
    if (idea.sourceApp) {
      main.appendChild(el("div", "idea-ref", "참고: " + idea.sourceApp));
    }
    summary.appendChild(main);
    summary.appendChild(el("span", "idea-chevron", "›"));
    summary.onclick = () => {
      ideaOpenSlug = open ? null : idea.slug;
      renderIdeaPicker();
    };
    row.appendChild(summary);

    const detail = el("div", "idea-detail");
    detail.appendChild(el("div", "idea-detail-body", idea.detail || "상세 설명이 아직 없어요."));
    appendIdeaReferenceBlock(detail, idea);
    const nameInput = document.createElement("input");
    nameInput.className = "idea-name";
    nameInput.placeholder = "프로젝트 이름 (영문)";
    nameInput.value = idea.slug;
    nameInput.autocapitalize = "none";
    nameInput.autocomplete = "off";
    nameInput.onclick = (event) => event.stopPropagation();
    detail.appendChild(nameInput);
    const actions = el("div", "idea-actions");
    const start = el("button", "btn primary", "이걸로 개발 논의");
    start.type = "button";
    start.onclick = (event) => {
      event.stopPropagation();
      createProjectFromIdea(idea, nameInput);
    };
    const remove = el("button", "btn danger", "삭제");
    remove.type = "button";
    remove.onclick = (event) => {
      event.stopPropagation();
      deleteIdea(idea);
    };
    actions.appendChild(start);
    actions.appendChild(remove);
    detail.appendChild(actions);
    row.appendChild(detail);
    list.appendChild(row);
  });
}

// ---------- attention 배지·알림음 ----------
const ORIGINAL_TITLE = document.title; // "connect-pc-mobile-claude"
const attentionProjects = new Set(); // 배지가 켜져 있는(미확인) 프로젝트 이름
let audioCtx = null; // 최초 사용자 제스처(connect 클릭) 후 lazy 생성

function updateTitle() {
  document.title = attentionProjects.size > 0 ? "● " + ORIGINAL_TITLE : ORIGINAL_TITLE;
}

function clearAttention(name) {
  if (attentionProjects.delete(name)) updateTitle();
}

function ensureAudioCtx() {
  if (audioCtx) return audioCtx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctor();
  } catch (e) {
    audioCtx = null; // 미지원 환경 등 — 무음으로 무시
  }
  return audioCtx;
}

// 880Hz 0.15s 비프 2회(짧은 간격). AudioContext가 없으면(생성 실패/미제스처) 조용히 무시.
function beep() {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [t0, t0 + 0.25].forEach((start) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.2;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  } catch (e) {
    // 재생 실패는 무시
  }
}

// ---------- 관리 시트(보관/복원·삭제) ----------
let manageProject = null;

function openManageSheet(name) {
  const p = store.projects[name];
  if (!p) return;
  manageProject = name;
  const running = statusBadge(p).cls === "run";
  $("manageTitle").textContent = name;
  $("manageRunNotice").hidden = !running;
  const archiveBtn = $("manageArchive");
  archiveBtn.textContent = p.archived ? "📦 복원" : "📦 보관";
  archiveBtn.disabled = running;
  $("manageDelete").disabled = running;
  $("manageSheet").hidden = false;
}

function closeManageSheet() {
  $("manageSheet").hidden = true;
  manageProject = null;
}

const ICON = { ios: "🍎", android: "🤖", web: "🌐" };
// 호스트의 TARGET_VIEWPORT와 동일하게 유지
const SIZE = { ios: [390, 844], android: [412, 915], web: [1280, 800] };

// preview 메시지의 캐시버스터·절대 URL 변환은 app.js 책임(store는 raw url만 저장).
const previewSrc = {}; // project -> 인증 토큰+캐시버스터 붙인 절대 URL

function appendQueryParam(url, key, value) {
  return url + (url.includes("?") ? "&" : "?") + key + "=" + value;
}

// preview/뷰어 iframe URL에 relay 인증 토큰(?t=)과 캐시버스터(?cb=)를 부착한다.
// 서브리소스(iframe 내부에서 상대경로로 로드되는 것들)는 relay가 발급한 HttpOnly
// 쿠키로 자동 인증되므로 부착이 불필요 — 진입 URL 1회만 부착하면 된다.
function withPreviewAuth(url) {
  let out = url;
  if (previewToken) out = appendQueryParam(out, "t", previewToken);
  return appendQueryParam(out, "cb", Date.now());
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function currentProject() {
  return store.screen.name === "project" ? store.screen.project : null;
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

// ---------- 컴팩트 진행 헤더 접힘/펼침(프로젝트별 localStorage) ----------
function stageOpenKey(name) {
  return "cpmc_stage_open:" + name;
}
function isStageOpen(name) {
  try { return localStorage.getItem(stageOpenKey(name)) === "1"; } catch { return false; }
}
function setStageOpen(name, open) {
  try {
    if (open) localStorage.setItem(stageOpenKey(name), "1");
    else localStorage.removeItem(stageOpenKey(name));
  } catch {}
}

// ---------- 렌더 ----------

function render() {
  const scr = paired ? store.screen.name : "pair";
  $("screen-pair").hidden = scr !== "pair";
  $("screen-home").hidden = scr !== "home";
  $("screen-project").hidden = scr !== "project";
  $("screen-templates").hidden = scr !== "templates";
  $("screen-settings").hidden = scr !== "settings";
  $("screen-prefs").hidden = scr !== "prefs";
  $("screen-tpl-edit").hidden = scr !== "tpl-edit";
  if (scr === "home") renderHome();
  else if (scr === "project") renderProject();
  else if (scr === "prefs") renderPrefs();
  else if (scr === "templates") renderTemplates();
  else if (scr === "settings") renderSettings();
  else if (scr === "tpl-edit") renderTplEdit();
  renderViewer();
  renderPromptEditor();
  renderSkillsSheet();
  if (!$("newProjectSheet").hidden) renderNewProjectSheet();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// 채팅 항목의 ts(ISO 문자열 또는 epoch ms)를 "14:03" 형식으로. 값이 없거나 파싱 불가면 빈 문자열.
function fmtChatTime(ts) {
  if (ts === undefined || ts === null || ts === "") return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function projectCard(name) {
  const p = store.projects[name];
  const badge = statusBadge(p);
  const isPipe = p.kind === "pipeline";
  const awaiting = isPipe && p.pipeline && p.pipeline.stageStatus === "awaiting_confirm";

  const card = el("div", "pcard" + (awaiting ? " attn" : "") + (p.archived ? " dim" : ""));
  const row = el("div", "row");
  row.appendChild(el("span", "name", isPipe ? name : (ICON[p.target] || "🍎") + " " + name));
  row.appendChild(el("span", "spacer"));
  row.appendChild(el("span", "chip " + badge.cls, badge.label));
  const moreBtn = el("button", "morebtn", "⋯");
  moreBtn.title = "관리";
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    openManageSheet(name);
  };
  row.appendChild(moreBtn);
  card.appendChild(row);

  if (isPipe && !p.pipeline) {
    // projects 목록엔 있지만 pipeline_sync 스냅샷이 아직 안 온 상태
    const meta = el("div", "meta");
    meta.appendChild(el("span", "", "파이프라인 · 동기화 중…"));
    card.appendChild(meta);
  } else if (isPipe) {
    const snap = p.pipeline;
    const bar = el("div", "minibar");
    const fill = el("i", snap.stage === "done" ? "full" : "");
    fill.style.width = Math.round(stageProgress(snap) * 100) + "%";
    bar.appendChild(fill);
    card.appendChild(bar);

    const meta = el("div", "meta");
    const steps = snapshotSteps(snap);
    const stepNo = snap.stage === "done"
      ? steps.length
      : steps.findIndex((s) => s.id === snap.stage) + 1;
    meta.appendChild(
      el("span", "", `${stepNo}/${steps.length} · ${stepLabel(snap, snap.stage)}`),
    );
    meta.appendChild(el("span", "spacer"));
    if (snap.queueLength > 0) {
      meta.appendChild(el("span", "chip q", `명령 ${snap.queueLength}개 대기`));
    }
    card.appendChild(meta);
  } else {
    const meta = el("div", "meta");
    meta.appendChild(el("span", "", "빠른 웹앱"));
    card.appendChild(meta);
  }

  card.onclick = () => openProject(name);
  return card;
}

function renderHome() {
  const { active, archived } = homeProjects(store);

  const list = $("home-list");
  list.innerHTML = "";
  active.forEach((name) => list.appendChild(projectCard(name)));

  $("home-archived").hidden = archived.length === 0;
  $("archToggle").textContent = `보관됨 ${archived.length}개 ${archOpen ? "▴" : "▾"}`;
  const arch = $("arch-list");
  arch.hidden = !archOpen;
  arch.innerHTML = "";
  archived.forEach((name) => arch.appendChild(projectCard(name)));
}

function openProject(name) {
  store.screen = { name: "project", project: name };
  clearAttention(name); // 프로젝트 화면 진입 시 배지 해제
  send({ type: "chat_history_get", project: name });
  send({ type: "ideas_proposed_get", project: name });
  proposedOpenSlug = null;
  ideaViewMode = "chat";
  ideaViewAutoOpened = false;
  setIdeaViewMode("chat");
  render();
}

function renderProject() {
  const name = currentProject();
  const p = store.projects[name];
  if (!p) {
    store.screen = { name: "home" };
    render();
    return;
  }
  const isPipe = p.kind === "pipeline";
  const hasSnap = isPipe && !!p.pipeline;
  const badge = statusBadge(p);

  $("projName").textContent = isPipe ? name : (ICON[p.target] || "🍎") + " " + name;
  const badgeEl = $("projBadge");
  badgeEl.className = "chip " + badge.cls;
  badgeEl.textContent = badge.label;

  $("screen-project").classList.toggle("legacy", !isPipe);
  $("stepper").hidden = !hasSnap;
  $("stageCard").hidden = !hasSnap;
  $("stageLine").hidden = !hasSnap;
  $("stageWrap").hidden = !hasSnap || !isStageOpen(name);
  $("frameWrap").hidden = isPipe;

  if (hasSnap) {
    renderStageLine(name, p.pipeline);
    renderStepper(name, p.pipeline);
    renderStageCard(name, p.pipeline);
    renderPipePreview(name, p.pipeline);
  } else {
    $("pipePreview").hidden = true;
  }
  renderIdeaProposed(name);
  renderChat(p);

  if (!isPipe) {
    const url = previewSrc[name] || "about:blank";
    const frame = $("frame");
    if (frame.getAttribute("src") !== url) frame.src = url;
    applyFrameMode();
  }
}

// 접힘 기본 컴팩트 헤더 한 줄: 미니 진행바+"N/M 라벨 · 상태" 텍스트+(awaiting_confirm이면)인라인 컨펌+▾/▴.
// 탭하면 접힘/펼침 토글(프로젝트별 localStorage 기억) — 상태 전이로 자동 펼치지 않는다.
function renderStageLine(name, snap) {
  $("stageLineText").textContent = stageLineText(snap);
  $("stageLineBar").style.width = Math.round(stageProgress(snap) * 100) + "%";

  const badge = statusBadge({ kind: "pipeline", pipeline: snap });
  $("stageLine").className = "stageline " + badge.cls;

  const awaiting = snap.stageStatus === "awaiting_confirm";
  const confirmBtn = $("stageLineConfirm");
  confirmBtn.hidden = !awaiting;
  if (awaiting) {
    const mine = store.pendingConfirm && store.pendingConfirm.project === name;
    confirmBtn.textContent = mine ? "확인 중…" : "✓ 컨펌";
    confirmBtn.disabled = mine;
    confirmBtn.onclick = (e) => {
      e.stopPropagation();
      doConfirm(name, snap.stage);
    };
  }

  const open = isStageOpen(name);
  $("stageLineToggle").textContent = open ? "▴" : "▾";
  $("stageLine").onclick = () => {
    setStageOpen(name, !open);
    render();
  };
}

function renderStepper(name, snap) {
  const wrap = $("stepper");
  wrap.innerHTML = "";
  const steps = snapshotSteps(snap);
  const curIdx = snap.stage === "done"
    ? steps.length
    : steps.findIndex((s) => s.id === snap.stage);
  steps.forEach((s, i) => {
    let cls = "step";
    if (i < curIdx) cls += " done";
    else if (i === curIdx) {
      if (snap.stageStatus === "running" || snap.stageStatus === "starting") cls += " run-cur";
      else if (snap.stageStatus === "error") cls += " err-cur";
      else cls += " cur";
    }
    const step = el("div", cls);
    step.appendChild(el("i"));
    step.appendChild(document.createTextNode(s.label));
    if (i < curIdx) {
      step.onclick = () => {
        if (confirm(`'${s.label}' 단계부터 다시 할까요?\n기존 산출물은 history/에 보관됩니다.`)) {
          send({ type: "stage_rollback", project: name, toStage: s.id });
        }
      };
    }
    wrap.appendChild(step);
  });
}

function doConfirm(name, stage) {
  send({ type: "confirm", project: name, stage });
  markConfirmSent(store, name, stage, Date.now());
  confirmTimeoutShown = false;
  render();
}

function renderStageCard(name, snap) {
  const card = $("stageCard");
  card.innerHTML = "";
  const label = stepLabel(snap, snap.stage);
  const st = snap.stageStatus;

  const h = el("div", "h");
  const d = el("div", "d");
  card.appendChild(h);
  card.appendChild(d);

  if (snap.stage === "done") {
    h.textContent = "🎉 출시 준비 완료";
    d.textContent = "릴리즈 패키지까지 완성됐어요. 고치고 싶은 게 있으면 언제든 채팅으로 보내세요 — 바로 수정하고 미리보기를 갱신해요.";
    return;
  }

  if (st === "awaiting_confirm") {
    h.textContent = `${label} 단계 확인 필요`;
    h.appendChild(el("span", "chip wait", "확인 필요"));
    d.textContent = "산출물을 확인하고 컨펌하면 다음 단계로 넘어갑니다. 고칠 게 있으면 채팅으로 보내세요.";
    renderArtifactButtons(card, name, snap);
    const mine = store.pendingConfirm && store.pendingConfirm.project === name;
    const btn = el("button", "btn primary", mine ? "확인 중…" : "✓ 컨펌하고 다음 단계로");
    if (mine) btn.disabled = true;
    else btn.onclick = () => doConfirm(name, snap.stage);
    card.appendChild(btn);
    if (mine && confirmTimeoutShown) {
      d.textContent = "PC 응답이 없어요. 연결을 확인하고 다시 전송해 보세요.";
      const retry = el("button", "btn ghost", "다시 전송");
      retry.onclick = () => doConfirm(name, store.pendingConfirm.stage);
      card.appendChild(retry);
    }
  } else if (st === "running" || st === "starting") {
    h.textContent = `${label} 진행 중`;
    // 투명성: 지금 뭐가 돌고 있는지 + 대기 큐에 뭐가 쌓였는지 내용으로 보여준다.
    d.textContent = snap.runningText
      ? `지금 하는 중: ${snap.runningText}`
      : "PC에서 AI가 작업 중입니다.";
    const queued = snap.queued || [];
    if (queued.length > 0) {
      card.appendChild(el("div", "qhead", `대기 중 ${queued.length}개 — 끝나는 대로 순서대로 실행돼요`));
      queued.forEach((t, i) => card.appendChild(el("div", "qline", `${i + 1}. ${t}`)));
    }
    const stop = el("button", "btn danger", "■ 중단");
    stop.onclick = () => {
      if (confirm("진행 중인 작업을 중단할까요?")) send({ type: "stage_cancel", project: name });
    };
    card.appendChild(stop);
  } else if (st === "error") {
    h.textContent = `${label} 단계 오류`;
    h.className = "h err";
    d.textContent = snap.error || "오류가 발생했습니다. 재시도해 보세요.";
    const retry = el("button", "btn primary", "재시도");
    retry.onclick = () => {
      const text = "이어서 다시 시도해줘";
      applyMessage(store, { type: "local_user", project: name, text }, Date.now());
      send({ type: "command", project: name, text });
      render();
    };
    card.appendChild(retry);
  } else if (st === "awaiting_feedback") {
    if (snap.stage === "business") {
      renderBusinessForm(card, name, h, d);
    } else {
      h.textContent = `${label} — 피드백 대기`;
      h.appendChild(el("span", "chip wait", "답변 필요"));
      d.textContent = snap.stage === "ideation"
        ? "아이디어 초안을 확인하고, 마음에 드는 후보나 수정 의견을 아래 채팅으로 보내주세요."
        : snap.stage === "wireframe"
          ? "구조 후보 5개를 열어보고, 마음에 드는 후보를 아래 채팅으로 알려주세요."
          : "질문에 답하거나 의견을 아래 채팅으로 보내주세요.";
      // wireframe-dev는 후보 선택 전 awaiting_feedback 상태이므로 이때도 HTML 열기 버튼이 필요하다.
      // 산출물이 없는 단계는 내부에서 no-op이므로 모든 일반 피드백 단계에 안전하게 호출한다.
      renderArtifactButtons(card, name, snap);
    }
  } else {
    // pending
    h.textContent = `${label} 단계 대기 중`;
    d.textContent = "아래 채팅으로 첫 지시를 보내면 이 단계가 시작됩니다.\n예) \"아이디어 리서치 시작해줘\"";
    const start = el("button", "btn primary", "시작하기");
    start.onclick = () => $("cmd").focus();
    card.appendChild(start);
  }
}

// 단계 카드에 산출물 열기 버튼들을 붙인다(awaiting_confirm 및 피드백 대기 때 호출됨).
// 미리보기는 하단 「미리보기 열기」로 항상 열 수 있으므로 여기서는 제외한다.
function renderArtifactButtons(card, name, snap) {
  const btns = artifactButtons(snap).filter((b) => b.key !== "preview");
  if (btns.length === 0) return;
  const row = el("div", "artifacts");
  btns.forEach((b) => {
    const btn = el("button", "btn ghost", "📄 " + b.label + " 열기");
    btn.onclick = () => openArtifact(name, b);
    row.appendChild(btn);
  });
  card.appendChild(row);
}

// 비즈니스 모델 설문 폼을 단계 카드에 렌더한다(business 단계 awaiting_feedback일 때만 호출).
// 스키마가 아직 없으면 form_get을 1회 보내고 "불러오는 중"을 보여준다. 선택 상태는 DOM이 아니라
// formSel(JS 상태)에 두어 로그 도착 등으로 재렌더돼도 사용자의 선택이 유지되게 한다.
function renderBusinessForm(card, name, h, d) {
  const p = store.projects[name];
  const schema = p && p.form;
  h.textContent = "💰 비즈니스 모델";
  h.appendChild(el("span", "chip wait", "선택 필요"));
  if (!schema) {
    d.textContent = "설문을 불러오는 중…";
    if (!formPending.has(name)) {
      formPending.add(name);
      send({ type: "form_get", project: name });
    }
    return;
  }
  d.textContent = "수익화 방식과 데이터 저장 방식을 고르고 제출하세요. ⚠️는 서버비가 드는 선택이에요(막지 않고 나중에 연동으로 남깁니다).";
  // 폼 대상이 바뀌었으면 각 질문의 기본값으로 초기화
  if (formSelProject !== name) {
    formSel = {};
    schema.questions.forEach((q) => {
      formSel[q.id] = q.default || (q.options[0] && q.options[0].value);
    });
    formSelProject = name;
  }
  const form = el("div", "bizform");
  schema.questions.forEach((q) => {
    const grp = el("div", "bq");
    grp.appendChild(el("div", "bqlabel", q.label));
    (q.options || []).forEach((opt) => {
      const on = formSel[q.id] === opt.value;
      const row = el("div", "bopt" + (on ? " sel" : "") + (opt.warn ? " warn" : ""));
      row.appendChild(el("span", "bradio"));
      row.appendChild(el("span", "btxt", opt.label));
      if (opt.warn) row.appendChild(el("span", "bflag", "⚠ " + opt.warn));
      row.onclick = () => { formSel[q.id] = opt.value; render(); };
      grp.appendChild(row);
    });
    form.appendChild(grp);
  });
  card.appendChild(form);
  const submit = el("button", "btn primary", "제출하고 PRD 준비 →");
  submit.onclick = () => {
    send({ type: "form_submit", project: name, answers: { ...formSel } });
    toast("제출했어요 — Claude가 결정을 정리합니다");
  };
  card.appendChild(submit);
}

// preview 산출물이 생기면 단계와 무관하게 「미리보기 열기」버튼만 항상 표시한다.
// 인라인 iframe은 쓰지 않고, 누르면 전체화면 뷰어로 연다.
function renderPipePreview(name, snap) {
  const rel = previewUrl(snap);
  $("pipePreview").hidden = !rel;
}

$("pipePreviewOpen").onclick = () => {
  const name = currentProject();
  const p = name ? store.projects[name] : null;
  const rel = p && p.pipeline ? previewUrl(p.pipeline) : null;
  if (!rel) return;
  openArtifact(name, { key: "preview", label: "미리보기", kind: "iframe", url: rel });
};

// 산출물 뷰어 열기: md는 artifact_get으로 내용 요청(도착 시 applyMessage가 채움), iframe은 URL만으로 즉시 렌더.
// iframe의 경우 캐시버스터를 추가해 매번 새로 로드되도록 함.
function openArtifact(name, btn) {
  resetMdEdit(); // 스텝 편집기와 동일하게 다른 문서를 열 때 편집 상태를 초기화
  if (btn.kind === "iframe") {
    btn.url = withPreviewAuth(btn.url);
  }
  openViewer(store, name, btn);
  if (btn.kind === "md") send({ type: "artifact_get", project: name, key: btn.key });
  render();
}

function renderChat(p) {
  const list = $("chatList");
  // innerHTML을 비우기 전에 "이미 하단 근처였는지"와 현재 스크롤 위치를 먼저 측정해야 한다
  // (비운 뒤에는 scrollHeight가 0이 되어 scrollTop이 0으로 클램프되므로).
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const prevTop = list.scrollTop;
  list.innerHTML = "";
  p.chat.forEach((entry) => {
    const time = fmtChatTime(entry.ts);
    if (entry.role === "user") {
      const row = el("div", "msg me");
      row.appendChild(el("div", "bub me", entry.text));
      if (time) row.appendChild(el("span", "ts", time));
      list.appendChild(row);
    } else if (entry.role === "assistant") {
      const row = el("div", "msg ai");
      const bub = el("div", "bub ai");
      bub.innerHTML = renderMarkdown(entry.text); // renderMarkdown은 HTML escape 포함(테스트 보장)
      row.appendChild(bub);
      if (time) row.appendChild(el("span", "ts", time));
      list.appendChild(row);
    } else {
      const line = el("div", "logline");
      if (time) line.appendChild(el("span", "ts-inline", time + " "));
      line.appendChild(document.createTextNode("· " + entry.text));
      list.appendChild(line);
    }
  });
  // 하단 근처였으면 새 메시지를 보여주도록 맨 아래로, 아니면 읽던 위치를 절대값으로 복원한다
  // (내용이 같으면 재빌드해도 scrollHeight가 동일하므로 위치가 유지된다).
  list.scrollTop = nearBottom ? list.scrollHeight : prevTop;
}

// ---------- 기기 프레임 맞춤: dims(w,h)를 wrap 크기에 맞춰 축소(contain) — null이면 꽉 채움 ----------

function fitFrame(frame, wrap, dims) {
  if (!dims) {
    // "꽉 채움": 스케일 없이 컨테이너 100%
    frame.style.position = "static";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.transform = "none";
    frame.style.left = "";
    frame.style.top = "";
    return;
  }
  const { w: dw, h: dh } = dims;
  const W = wrap.clientWidth || 360;
  const H = wrap.clientHeight || 480;
  const scale = Math.min(W / dw, H / dh);
  frame.style.position = "absolute";
  frame.style.width = dw + "px";
  frame.style.height = dh + "px";
  frame.style.transform = "scale(" + scale + ")";
  frame.style.transformOrigin = "0 0";
  frame.style.left = (W - dw * scale) / 2 + "px";
  frame.style.top = (H - dh * scale) / 2 + "px";
}

// 레거시 미리보기: 대상 기기 크기(SIZE)를 컨테이너에 맞춰 축소
function applyFrameMode() {
  const name = currentProject();
  const p = name ? store.projects[name] : null;
  if (!p || p.kind === "pipeline") return;
  const [dw, dh] = SIZE[p.target] || SIZE.ios;
  fitFrame($("frame"), $("frameWrap"), { w: dw, h: dh });
}

// 산출물 뷰어(iframe): framePreset() 기반 — "꽉 채움" 선택 시 null이 되어 fitFrame이 컨테이너 100%로 채움
function applyViewerFrameMode() {
  const v = store.viewer;
  if (!v || v.kind !== "iframe") return;
  fitFrame($("viewerFrame"), $("viewerFrameWrap"), framePreset(v.frame));
}

// ---------- 산출물 뷰어 오버레이 ----------

const FRAME_CHIPS = [
  ["iphone", "iPhone"],
  ["android", "Android"],
  ["full", "꽉 채움"],
];

function renderViewerChips(current) {
  const wrap = $("viewerChips");
  wrap.innerHTML = "";
  FRAME_CHIPS.forEach(([name, label]) => {
    const chip = el("button", "vchip" + (current === name ? " active" : ""), label);
    chip.onclick = () => {
      setViewerFrame(store, name);
      render();
    };
    wrap.appendChild(chip);
  });
}

function renderViewer() {
  const v = store.viewer;
  $("viewer").hidden = !v;
  if (!v) return;
  $("viewerTitle").textContent = v.label;
  const isMd = v.kind === "md";
  $("viewerEditBtn").hidden = !isMd;
  $("viewerEditBtn").disabled = mdEditing || v.content == null;
  $("viewerMd").hidden = !isMd || mdEditing;
  $("viewerEditArea").hidden = !isMd || !mdEditing;
  $("viewerEditBtns").hidden = !isMd || !mdEditing;
  $("viewerChips").hidden = isMd;
  $("viewerFrameWrap").hidden = isMd;
  if (isMd) {
    if (mdEditing) {
      $("viewerEditSave").textContent = mdSaving ? "저장 중…" : "저장";
      $("viewerEditSave").disabled = mdSaving;
      $("viewerEditCancel").disabled = mdSaving;
    } else {
      $("viewerMd").innerHTML =
        v.content == null ? "<p>불러오는 중…</p>" : renderMarkdown(v.content);
    }
  } else {
    renderViewerChips(v.frame);
    const frame = $("viewerFrame");
    if (frame.getAttribute("src") !== v.url) frame.src = v.url;
    applyViewerFrameMode();
  }
}

// 편집 모드/저장 대기/타임아웃 타이머를 모두 초기화(문서 전환·닫기 시 호출).
function resetMdEdit() {
  mdEditing = false;
  mdSaving = false;
  clearTimeout(mdSaveTimer);
  mdSaveTimer = null;
}

$("viewerClose").onclick = () => {
  resetMdEdit();
  closeViewer(store);
  render();
};

$("viewerEditBtn").onclick = () => {
  const v = store.viewer;
  if (!v || v.content == null || mdEditing) return;
  mdEditing = true;
  $("viewerEditArea").value = v.content;
  render();
};

$("viewerEditCancel").onclick = () => {
  resetMdEdit();
  render();
};

$("viewerEditSave").onclick = () => {
  const v = store.viewer;
  if (!v || mdSaving) return;
  mdSaving = true;
  send({ type: "artifact_set", project: v.project, key: v.key, content: $("viewerEditArea").value });
  clearTimeout(mdSaveTimer);
  mdSaveTimer = setTimeout(() => {
    mdSaving = false;
    toast("저장 확인이 안 왔어요 — 채팅을 확인하세요");
    render();
  }, 5000);
  render();
};

// ---------- 보조 스킬 시트: 골라서 채팅으로 적용 요청 ----------

let skillsSheetOpen = false;

$("skillsBtn").onclick = () => {
  const name = currentProject();
  if (!name) return;
  skillsSheetOpen = true;
  const p = store.projects[name];
  if (p && p.skills == null) send({ type: "skills_get", project: name }); // 최초 1회 요청
  render();
};

function closeSkillsSheet() {
  skillsSheetOpen = false;
  render();
}
$("skillsBackdrop").onclick = closeSkillsSheet;
$("skillsCancel").onclick = closeSkillsSheet;

// 스킬 선택 = 즉시 전송이 아니라 입력창 프리필 — 사용자가 문구를 덧붙여 보낼 수 있게.
function renderSkillsSheet() {
  if (store.screen.name !== "project") skillsSheetOpen = false;
  $("skillsSheet").hidden = !skillsSheetOpen;
  if (!skillsSheetOpen) return;
  const name = currentProject();
  const p = name ? store.projects[name] : null;
  const list = $("skillsList");
  list.innerHTML = "";
  if (!p || p.skills == null) {
    list.appendChild(el("div", "hint", "목록을 불러오는 중…"));
    return;
  }
  if (p.skills.length === 0) {
    list.appendChild(el("div", "hint", "이 프로젝트에 쓸 수 있는 스킬이 없어요"));
    return;
  }
  p.skills.forEach((s) => {
    const row = el("div", "skillrow");
    row.appendChild(el("div", "sklabel", "🧩 " + s.label));
    if (s.desc) row.appendChild(el("div", "skdesc", s.desc));
    row.onclick = () => {
      const cmd = $("cmd");
      cmd.value = `'${s.label}' 스킬을 적용해줘 (.claude/commands/skills/${s.id}/SKILL.md 지침대로)`;
      skillsSheetOpen = false;
      render();
      autosizeCmd();
      cmd.focus();
    };
    list.appendChild(row);
  });
}

// ---------- 관리 시트: 보관/복원·삭제 ----------

$("manageCancel").onclick = closeManageSheet;
$("manageBackdrop").onclick = closeManageSheet;

$("manageArchive").onclick = () => {
  if (!manageProject) return;
  const p = store.projects[manageProject];
  if (!p) return;
  send({ type: "project_archive", project: manageProject, archived: !p.archived });
  closeManageSheet();
};

$("manageDelete").onclick = () => {
  if (!manageProject) return;
  const name = manageProject;
  const input = prompt(`삭제하려면 프로젝트 이름을 정확히 입력하세요\n\n${name}`);
  if (input !== name) return; // 취소 또는 이름 불일치 — 삭제 중단
  send({ type: "project_delete", project: name });
  closeManageSheet();
};

// ---------- 페어링 ----------

// 페어링 화면 상태줄: 버튼 눌림/연결중/성공/실패를 사용자에게 보여준다.
function pairStatus(text, kind) {
  const el2 = $("pairStatus");
  el2.hidden = !text;
  el2.textContent = text;
  const c = { info: ["#13314a", "#9cf"], err: ["#4a1313", "#f88"], ok: ["#13401f", "#8f8"] };
  const [bg, fg] = c[kind] || c.info;
  el2.style.background = bg;
  el2.style.color = fg;
}

function setConnecting(on) {
  const b = $("connect");
  b.disabled = on;
  b.textContent = on ? "로그인 중…" : "로그인";
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === "attention") {
      if (navigator.vibrate) navigator.vibrate(80);
      beep();
      // 지금 해당 프로젝트 화면을 보고 있으면 배지/타이틀은 켜지 않는다(이미 보이는 중).
      if (currentProject() !== ev.project) {
        attentionProjects.add(ev.project);
        updateTitle();
      }
    }
    if (ev.type === "confirm_acked") confirmTimeoutShown = false;
    if (ev.type === "pruned") ev.projects.forEach((name) => clearAttention(name));
    if (ev.type === "status_error") toast(ev.text);
  }
}

// ---------- 로그인 · 자동 로그인 ----------
// localStorage는 origin 단위 — 터널 주소가 바뀌는 재시작 후에는 첫 1회 로그인이 필요하다(스펙 §2).
const AUTH_KEY = "cpmc_auth";
function savedAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
function saveAuth(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {} }
// 토큰만 폐기하고 아이디는 남겨 다음 방문 시 로그인 폼에 아이디가 프리필되게 한다.
function clearAuth() {
  const prev = savedAuth();
  try {
    if (prev && prev.id) saveAuth({ id: prev.id });
    else localStorage.removeItem(AUTH_KEY);
  } catch {}
}

let loginId = ""; // 마지막으로 시도한 아이디(paired 시 토큰과 함께 저장)
let retryTimer = null;
let retryCount = 0;
const RETRY_DELAYS = [1500, 3000, 6000]; // 순단 재접속 백오프: 최대 3회
// 자동 재접속 체인이 진행 중인지 나타내는 지속 플래그. 매 close마다 재산출되는 live `paired`와
// 달리, 체인 성공·소진·수동 로그인 때만 해제된다 — 재시도 소켓 자체는 paired에 도달한 적이
// 없으므로 wasPaired만으로는 체인 진행 여부를 알 수 없다.
let reconnecting = false;

function startConnection(query, silent) {
  clearTimeout(retryTimer);
  if (ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; // stale 소켓이 전역 상태를 만지지 못하게
    try { ws.close(); } catch {}
  }
  paired = false;
  previewToken = null;
  pairStatus(silent ? "🔄 자동 로그인 중…" : "⏳ 연결 중…", "info");
  if (!silent) setConnecting(true);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/phone?${query}`);

  ws.onopen = () => pairStatus("🔌 서버 연결됨 — 인증 확인 중…", "info");
  ws.onerror = () => pairStatus("❌ 연결 오류 — 주소·네트워크를 확인하세요", "err");

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "paired") {
      paired = true;
      retryCount = 0; // 재접속 성공 — 다음 순단에 대비해 카운터 리셋
      reconnecting = false;
      previewToken = msg.token;
      if (msg.phoneToken && loginId) saveAuth({ id: loginId, phoneToken: msg.phoneToken });
      setConnecting(false);
      pairStatus("", "ok");
      store.screen = { name: "home" };
      send({ type: "listProjects" });
      send({ type: "pipeline_sync" });
      send({ type: "tpl_list" });
      send({ type: "ideas_library_get" });
      send({ type: "preferences_get" });
      render();
      return;
    }
    if (msg.type === "error") {
      // 인증 계열 오류면 저장 토큰을 폐기해 로그인 폼으로 유도
      if (!paired && /만료|올바르지 않|초기 설정/.test(msg.text)) {
        clearAuth();
        reconnecting = false; // 만료 확정 — 재접속 체인을 여기서도 끊는다(다음 onclose는 토큰 부재로 자연 중단)
      }
      if (paired) toast("❌ " + msg.text);
      else pairStatus("❌ " + msg.text, "err");
      return;
    }
    if (msg.type === "preview") {
      // 절대 URL 변환 + 인증 토큰/캐시버스터 부착은 app.js 책임(store에는 raw url이 저장됨)
      const base = /^https?:\/\//.test(msg.url) ? msg.url : location.origin + msg.url;
      previewSrc[msg.project] = withPreviewAuth(base);
    }
    const events = applyMessage(store, msg, Date.now());
    if (msg.type === "ideas_library" && !$("ideaPicker").hidden) renderIdeaPicker();
    if (msg.type === "ideas_proposed") {
      const cur = currentProject();
      if (cur && msg.project === cur) renderIdeaProposed(cur);
    }
    // 폼 스키마가 도착하면 중복요청 억제 플래그를 풀어 준다(재생성 시 재요청 가능).
    if (msg.type === "form") formPending.delete(msg.project);
    // awaiting_confirm이 해소된(=더 이상 그 상태가 아닌) 프로젝트는 배지/타이틀을 원복한다.
    if (msg.type === "stage_update" && attentionProjects.has(msg.project)) {
      if (!msg.pipeline || msg.pipeline.stageStatus !== "awaiting_confirm") clearAttention(msg.project);
    }
    if (
      msg.type === "stage_update" && msg.pipeline?.stage === "ideation" &&
      msg.pipeline.stageStatus !== "running" && msg.pipeline.stageStatus !== "starting"
    ) {
      send({ type: "ideas_library_get" });
      send({ type: "ideas_proposed_get", project: msg.project });
    }
    // 편집 저장 후 도착한 artifact 회신(applyMessage가 이미 store.viewer.content를 갱신) → 편집 모드 해제.
    if (
      msg.type === "artifact" && mdEditing &&
      store.viewer && store.viewer.project === msg.project && store.viewer.key === msg.key
    ) {
      resetMdEdit();
    }
    // md 저장 대기 중 같은 프로젝트에서 "⚠️"로 시작하는 로그(저장 거부 등)가 오면 5초 타임아웃을
    // 기다리지 않고 즉시 저장 대기를 풀고 그 로그 텍스트를 토스트로 보여준다.
    if (
      msg.type === "log" && mdSaving &&
      store.viewer && store.viewer.project === msg.project &&
      typeof msg.text === "string" && msg.text.startsWith("⚠️")
    ) {
      mdSaving = false;
      clearTimeout(mdSaveTimer);
      mdSaveTimer = null;
      toast(msg.text);
    }
    render();
    handleEvents(events);
  };

  // PC(host)만 끊긴 경우 relay는 폰 소켓을 유지하고 error 통지만 보낸다 — 여기는 폰 소켓 자체가 끊겼을 때만 탄다.
  // paired 상태였다면 저장 토큰으로 조용히 재접속을 시도하고, 세션이 진짜 만료면 재시도의 error 응답이
  // 토큰을 지워 로그인 폼으로 복귀한다.
  ws.onclose = () => {
    setConnecting(false);
    const wasPaired = paired;
    paired = false;
    previewToken = null;
    render();
    const auth = savedAuth();
    // wasPaired: 이 소켓이 paired에 도달했었는지(첫 순단). reconnecting: 재시도 체인이 이미 진행 중인지
    // — 재시도 소켓 자체는 이번 close에서 paired였던 적이 없으므로 wasPaired만으로는 체인이 끊긴다(버그).
    if ((wasPaired || reconnecting) && auth && auth.phoneToken && retryCount < RETRY_DELAYS.length) {
      // 순단 — 토큰으로 조용히 재접속(세션 만료면 위 error 처리에서 토큰이 지워져 폼으로 감)
      // 최대 3회까지 백오프(1.5s/3s/6s)하며, paired 성공 시 카운터가 리셋된다.
      reconnecting = true;
      const delay = RETRY_DELAYS[retryCount];
      retryCount++;
      pairStatus(`🔄 연결이 끊겨 자동 재접속 중… (${retryCount}/${RETRY_DELAYS.length})`, "info");
      retryTimer = setTimeout(
        () => startConnection(`id=${encodeURIComponent(auth.id)}&phoneToken=${encodeURIComponent(auth.phoneToken)}`, true),
        delay,
      );
      return;
    }
    const wasReconnecting = reconnecting;
    retryCount = 0;
    reconnecting = false;
    if (!wasPaired && !wasReconnecting) {
      if ($("pairStatus").textContent.indexOf("❌") === -1)
        pairStatus("❌ 연결 실패 — 아이디·비밀번호를 확인하세요", "err");
    } else {
      // 재시도를 모두 소진했거나 저장된 토큰이 없는 순단 — 오도성 있는 자격증명 문구 대신 네트워크 안내
      pairStatus("🔌 연결이 끊겼어요 — 네트워크 확인 후 다시 로그인해 주세요", "err");
    }
  };
}

$("connect").onclick = () => {
  ensureAudioCtx();
  loginId = $("loginId").value.trim().toLowerCase();
  const pw = $("pw").value;
  if (!loginId) { pairStatus("⚠️ 아이디를 입력하세요", "err"); return; }
  reconnecting = false; // 수동 로그인 — 이전 자동 재접속 체인을 명시적으로 종료
  retryCount = 0;
  startConnection(`id=${encodeURIComponent(loginId)}&secret=${encodeURIComponent(pw)}`, false);
};

// 공유 링크(#id=testuser) → 아이디 자동 입력. 비밀번호는 절대 링크에 담지 않는다.
(function prefillFromLink() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const id = hash ? new URLSearchParams(hash).get("id") : null;
  if (id) {
    $("loginId").value = id.trim().toLowerCase();
    history.replaceState(null, "", location.pathname + location.search);
    $("pw").focus();
  }
})();

// 자동 로그인: 이 origin에 저장된 토큰이 있으면 폼 없이 바로 시도
(function autoLogin() {
  const auth = savedAuth();
  if (!auth || !auth.phoneToken) {
    if (auth && auth.id && !$("loginId").value) $("loginId").value = auth.id;
    return;
  }
  loginId = auth.id;
  $("loginId").value = auth.id;
  startConnection(`id=${encodeURIComponent(auth.id)}&phoneToken=${encodeURIComponent(auth.phoneToken)}`, true);
})();

// 아이디/비밀번호 칸에서 Enter로 로그인
for (const id of ["loginId", "pw"]) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("connect").click();
  });
}

// ---------- 파이프라인 템플릿(곁가지) ----------
let tplEditId = null;   // 스텝 편집 중인 템플릿 id
let promptCtx = null;   // { id, stepId, kind } 프롬프트 편집 대상

function tplById(id) {
  return (store.templates || []).find((t) => t.id === id) || null;
}

function renderTemplates() {
  const list = $("tplList");
  list.innerHTML = "";
  if (!store.templates) {
    list.appendChild(el("p", "hint", "불러오는 중…"));
    return;
  }
  const groups = [
    { title: "기본 템플릿", items: store.templates.filter((t) => t.readonly) },
    { title: "내 템플릿", items: store.templates.filter((t) => !t.readonly) },
  ];
  groups.forEach((group) => {
    list.appendChild(el("div", "tpl-section-title", group.title));
    if (group.items.length === 0) {
      list.appendChild(el("div", "hint", "아직 만든 템플릿이 없어요."));
      return;
    }
    group.items.forEach((t) => {
    const card = el("div", "tplcard");
    const row = el("div", "row");
    row.appendChild(el("b", "", t.name + (t.readonly ? " 🔒" : "")));
    row.appendChild(el("span", "spacer"));
    row.appendChild(el("span", "hint", `${t.steps.length}스텝`));
    card.appendChild(row);
    card.appendChild(el("div", "hint", t.steps.map((s) => s.label).join(" → ")));
    const btns = el("div", "btnrow");
    const dup = el("button", "btn ghost", "복제");
    dup.onclick = () => {
      const name = prompt("새 템플릿 이름", t.name + " 사본");
      if (name) send({ type: "tpl_clone", basedOn: t.id, name });
    };
    btns.appendChild(dup);
    if (!t.readonly) {
      const edit = el("button", "btn ghost", "스텝 편집");
      edit.onclick = () => { tplEditId = t.id; store.screen = { name: "tpl-edit" }; render(); };
      btns.appendChild(edit);
      const del = el("button", "btn danger", "삭제");
      del.onclick = () => {
        if (confirm(`'${t.name}' 템플릿을 삭제할까요?\n(이미 만든 프로젝트에는 영향 없음)`))
          send({ type: "tpl_delete", id: t.id });
      };
      btns.appendChild(del);
    } else {
      const view = el(
        "button",
        "btn ghost",
        t.promptEditable ? "프롬프트 편집" : "프롬프트 보기",
      );
      view.onclick = () => { tplEditId = t.id; store.screen = { name: "tpl-edit" }; render(); };
      btns.appendChild(view);
    }
    card.appendChild(btns);
    list.appendChild(card);
    });
  });
}

// 스텝 목록을 서버 형식으로 직렬화해 저장
function sendSteps(t, steps) {
  send({
    type: "tpl_steps_set", id: t.id,
    steps: steps.map((s) => ({ id: s.id, label: s.label, kind: s.kind, enabled: s.enabled !== false })),
  });
}

function renderTplEdit() {
  const t = tplById(tplEditId);
  if (!t) { store.screen = { name: "templates" }; render(); return; }
  $("tplEditTitle").textContent = t.name;
  $("tplAddStep").hidden = t.readonly;
  const wrap = $("tplSteps");
  wrap.innerHTML = "";
  t.steps.forEach((s, i) => {
    const off = s.enabled === false;
    const row = el("div", "steprow row" + (off ? " off" : ""));
    row.appendChild(el("span", "",
      `${i + 1}. ${s.label}` + (s.overridden ? " ✏️" : "") + (off ? " (꺼짐)" : "")));
    row.appendChild(el("span", "spacer"));
    if (!t.readonly) {
      const up = el("button", "btn ghost", "↑");
      up.disabled = i === 0;
      up.onclick = () => {
        const next = t.steps.slice();
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        sendSteps(t, next);
      };
      const down = el("button", "btn ghost", "↓");
      down.disabled = i === t.steps.length - 1;
      down.onclick = () => {
        const next = t.steps.slice();
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        sendSteps(t, next);
      };
      row.appendChild(up);
      row.appendChild(down);
    }
    const editP = el("button", "btn ghost", "✏️ 프롬프트");
    editP.onclick = () => {
      promptCtx = {
        id: t.id,
        stepId: s.id,
        kind: s.kind,
        hasDefault: t.readonly || s.kind === "builtin",
        readonly: t.readonly && !t.promptEditable,
      };
      store.tplPrompt = null;
      const ta = $("promptBody");
      ta.value = "";
      delete ta.dataset.dirty;
      send({ type: "tpl_prompt_get", id: t.id, stepId: s.id });
      render();
    };
    row.appendChild(editP);
    if (!t.readonly) {
      const toggle = el("button", "btn ghost", off ? "켜기" : "끄기");
      toggle.onclick = () =>
        sendSteps(t, t.steps.map((x) => (x.id === s.id ? { ...x, enabled: off } : x)));
      row.appendChild(toggle);
    }
    if (!t.readonly) {
      const del = el("button", "btn danger", "✕");
      del.onclick = () => {
        if (t.steps.length <= 1) { toast("스텝은 1개 이상이어야 해요"); return; }
        if (confirm(`'${s.label}' 스텝을 뺄까요?`))
          sendSteps(t, t.steps.filter((x) => x.id !== s.id));
      };
      row.appendChild(del);
    }
    wrap.appendChild(row);
  });
}

$("openTemplates").onclick = () => {
  send({ type: "tpl_list" });
  store.screen = { name: "templates" };
  render();
};
$("tplCreate").onclick = () => {
  const name = prompt("새 템플릿 이름", "내 작업 템플릿");
  if (name?.trim()) send({ type: "tpl_create", name: name.trim() });
};
$("tplBack").onclick = () => { store.screen = { name: "home" }; render(); };

// ---------- 설정 화면(CLI 제공자 + 모델) ----------
const PROVIDER_OPTIONS = [
  { id: "claude", label: "Claude Code", desc: "Anthropic CLI" },
  { id: "codex", label: "Codex", desc: "OpenAI CLI" },
  { id: "cursor", label: "Cursor Agent", desc: "Cursor 구독 CLI" },
];
const MODEL_OPTIONS = {
  claude: [
    { id: "opus", label: "Opus", desc: "고품질 (기본)" },
    { id: "sonnet", label: "Sonnet", desc: "빠름 · 저렴" },
    { id: "fable", label: "Fable", desc: "최소" },
  ],
  codex: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", desc: "최신 코딩 모델 (기본)" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", desc: "고성능" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", desc: "균형" },
    { id: "gpt-5.5", label: "GPT-5.5", desc: "이전 세대" },
    { id: "gpt-5.4", label: "GPT-5.4", desc: "이전 세대" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", desc: "빠름" },
  ],
  cursor: [
    { id: "composer-2.5", label: "Composer 2.5", desc: "Cursor 코딩 (기본)" },
    { id: "composer-2", label: "Composer 2", desc: "이전 Composer" },
    { id: "auto", label: "Auto", desc: "Cursor가 모델 선택" },
    { id: "gpt-5.2", label: "GPT-5.2", desc: "OpenAI" },
    { id: "gpt-5", label: "GPT-5", desc: "OpenAI" },
    { id: "claude-4.6-sonnet", label: "Claude 4.6 Sonnet", desc: "Anthropic" },
    { id: "claude-4.6-opus", label: "Claude 4.6 Opus", desc: "Anthropic" },
    { id: "claude-4-sonnet", label: "Claude 4 Sonnet", desc: "Anthropic" },
    { id: "claude-4-opus", label: "Claude 4 Opus", desc: "Anthropic" },
  ],
};
function renderSettings() {
  const providers = $("providerOpts");
  providers.textContent = "";
  PROVIDER_OPTIONS.forEach((p) => {
    const row = el("div", "bopt" + (store.provider === p.id ? " sel" : ""));
    row.appendChild(el("span", "bradio"));
    row.appendChild(el("span", "btxt", `${p.label} — ${p.desc}`));
    row.appendChild(el("span", "bflag", store.provider === p.id ? "현재" : ""));
    row.onclick = () => {
      if (store.provider === p.id) return;
      store.provider = p.id;
      store.model = MODEL_OPTIONS[p.id][0].id;
      send({ type: "settings_set", provider: store.provider, model: store.model });
      render();
    };
    providers.appendChild(row);
  });

  const wrap = $("modelOpts");
  wrap.textContent = "";
  MODEL_OPTIONS[store.provider].forEach((m) => {
    const row = el("div", "bopt" + (store.model === m.id ? " sel" : ""));
    row.appendChild(el("span", "bradio"));
    row.appendChild(el("span", "btxt", `${m.label} — ${m.desc}`));
    row.appendChild(el("span", "bflag", store.model === m.id ? "현재" : ""));
    row.onclick = () => {
      if (store.model === m.id) return;
      store.model = m.id; // 낙관적 갱신(회신 settings로 확정)
      send({ type: "settings_set", provider: store.provider, model: m.id });
      render();
    };
    wrap.appendChild(row);
  });
}
function prefsState() {
  const p = store.preferences || {};
  return {
    neverAgain: Array.isArray(p.neverAgain) ? p.neverAgain.slice() : [],
    dislikedPatterns: Array.isArray(p.dislikedPatterns) ? p.dislikedPatterns.slice() : [],
    wants: Array.isArray(p.wants) ? p.wants.slice() : [],
  };
}

function savePrefs(next, note) {
  store.preferences = {
    ...(store.preferences || {}),
    neverAgain: next.neverAgain,
    dislikedPatterns: next.dislikedPatterns,
    wants: next.wants,
  };
  send({
    type: "preferences_set",
    neverAgain: next.neverAgain,
    dislikedPatterns: next.dislikedPatterns,
    wants: next.wants,
  });
  if (note) toast(note);
  renderPrefs();
}

function askProjectSource(current) {
  const value = prompt("어느 프로젝트에서 나온 피드백인가요? (공통이면 비워도 됨)", current || "");
  if (value === null) return null;
  return value.trim().slice(0, 80);
}

function prefTitleWithProject(project, text) {
  const wrap = el("div", "pt");
  if (project) wrap.appendChild(el("span", "pref-pill", project));
  wrap.appendChild(document.createTextNode(text || "(내용 없음)"));
  return wrap;
}

function renderPrefs() {
  const prefs = store.preferences || {
    neverAgain: [], dislikedPatterns: [], wants: [], updatedAt: "",
  };
  const meta = $("prefsMeta");
  meta.textContent = "";
  meta.appendChild(el("span", "chip ban", `금지 ${prefs.neverAgain.length + prefs.dislikedPatterns.length}`));
  meta.appendChild(el("span", "chip want", `원함 ${prefs.wants.length}`));
  if (prefs.updatedAt) meta.appendChild(el("span", "chip", `업데이트 ${prefs.updatedAt}`));

  const body = $("prefsBody");
  body.textContent = "";

  // ── 하지 말 것 (never_again) ──
  const banSec = el("section", "pref-sec ban");
  const banH = el("div", "pref-sec-h");
  banH.appendChild(el("strong", "", "다시 하지 말 것"));
  banH.appendChild(el("span", "", "출처 프로젝트 표시"));
  banSec.appendChild(banH);
  banSec.appendChild(el("div", "pref-sec-d", "어느 프로젝트에서 나온 피드백인지 함께 보여요. 다른 앱엔 참고만 하고, 같은 실수는 반복하지 않아요."));
  if (prefs.neverAgain.length === 0) {
    banSec.appendChild(el("div", "pref-empty", "아직 없어요. 채팅에서 싫은 점을 말하면 여기 쌓여요."));
  } else {
    prefs.neverAgain.forEach((item, index) => {
      const row = el("div", "pref-item");
      const main = el("div", "");
      main.appendChild(prefTitleWithProject(item.sourceProject, item.pattern));
      if (item.reason) main.appendChild(el("div", "ps", item.reason));
      if (item.date) main.appendChild(el("div", "pmeta", item.date));
      main.style.cursor = "pointer";
      main.onclick = () => {
        const pattern = prompt("금지할 방향 (짧게)", item.pattern || "");
        if (pattern === null) return;
        const reason = prompt("이유 (한 줄)", item.reason || "");
        if (reason === null) return;
        const project = askProjectSource(item.sourceProject || "");
        if (project === null) return;
        const next = prefsState();
        next.neverAgain[index] = {
          ...item,
          pattern: pattern.trim().slice(0, 80),
          reason: reason.trim().slice(0, 160),
          sourceProject: project,
        };
        if (!next.neverAgain[index].pattern) {
          toast("내용은 비울 수 없어요. 삭제하려면 ×를 누르세요");
          return;
        }
        savePrefs(next, "금지 항목을 수정했어요");
      };
      const del = el("button", "pref-x", "×");
      del.type = "button";
      del.onclick = () => {
        if (!confirm(`「${item.pattern}」을(를) 지울까요?`)) return;
        const next = prefsState();
        next.neverAgain.splice(index, 1);
        savePrefs(next, "금지 항목을 지웠어요");
      };
      row.appendChild(main);
      row.appendChild(del);
      banSec.appendChild(row);
    });
  }
  const banAdd = el("div", "pref-add col");
  const banInput = document.createElement("input");
  banInput.placeholder = "예: 콘텐츠 없는 빈 홈";
  const banRow = el("div", "pref-add-row");
  const banBtn = el("button", "btn ghost", "추가");
  banBtn.type = "button";
  banBtn.onclick = () => {
    const pattern = banInput.value.trim();
    if (!pattern) return;
    const project = askProjectSource("");
    if (project === null) return;
    const next = prefsState();
    next.neverAgain.unshift({
      id: `na-ui-${Date.now()}`,
      pattern: pattern.slice(0, 80),
      reason: "직접 추가",
      date: new Date().toISOString().slice(0, 10),
      sourceProject: project || "수동",
      rawFeedback: pattern.slice(0, 120),
    });
    banInput.value = "";
    savePrefs(next, "금지 항목을 추가했어요");
  };
  banRow.appendChild(banInput);
  banRow.appendChild(banBtn);
  banAdd.appendChild(banRow);
  banSec.appendChild(banAdd);
  body.appendChild(banSec);

  // ── 피하고 싶은 패턴 ──
  const dislikeSec = el("section", "pref-sec ban");
  const dH = el("div", "pref-sec-h");
  dH.appendChild(el("strong", "", "피하고 싶은 패턴"));
  dH.appendChild(el("span", "", "출처 포함"));
  dislikeSec.appendChild(dH);
  dislikeSec.appendChild(el("div", "pref-sec-d", "프로젝트 이름이 붙어 있어요. 그 앱 맥락의 피드백인지 보고 참고하세요."));
  if (prefs.dislikedPatterns.length === 0) {
    dislikeSec.appendChild(el("div", "pref-empty", "비어 있어요."));
  } else {
    prefs.dislikedPatterns.forEach((item, index) => {
      const row = el("div", "pref-item");
      const main = el("div", "");
      main.appendChild(prefTitleWithProject(item.project, item.text));
      if (item.date) main.appendChild(el("div", "pmeta", item.date));
      main.style.cursor = "pointer";
      main.onclick = () => {
        const edited = prompt("패턴 수정", item.text || "");
        if (edited === null) return;
        const project = askProjectSource(item.project || "");
        if (project === null) return;
        const value = edited.trim().slice(0, 120);
        if (!value) return;
        const next = prefsState();
        next.dislikedPatterns[index] = {
          ...item,
          text: value,
          project: project || item.project || "",
        };
        savePrefs(next, "패턴을 수정했어요");
      };
      const del = el("button", "pref-x", "×");
      del.type = "button";
      del.onclick = () => {
        const next = prefsState();
        next.dislikedPatterns.splice(index, 1);
        savePrefs(next, "패턴을 지웠어요");
      };
      row.appendChild(main);
      row.appendChild(del);
      dislikeSec.appendChild(row);
    });
  }
  const dAdd = el("div", "pref-add col");
  const dInput = document.createElement("input");
  dInput.placeholder = "예: 가짜 데이터 몇 개로 끝내는 앱";
  const dRow = el("div", "pref-add-row");
  const dBtn = el("button", "btn ghost", "추가");
  dBtn.type = "button";
  dBtn.onclick = () => {
    const value = dInput.value.trim().slice(0, 120);
    if (!value) return;
    const project = askProjectSource("");
    if (project === null) return;
    const next = prefsState();
    next.dislikedPatterns.unshift({
      id: `dp-ui-${Date.now()}`,
      text: value,
      project: project || "수동",
      date: new Date().toISOString().slice(0, 10),
    });
    dInput.value = "";
    savePrefs(next, "패턴을 추가했어요");
  };
  dRow.appendChild(dInput);
  dRow.appendChild(dBtn);
  dAdd.appendChild(dRow);
  dislikeSec.appendChild(dAdd);
  body.appendChild(dislikeSec);

  // ── 원하는 방향 ──
  const wantSec = el("section", "pref-sec want");
  const wH = el("div", "pref-sec-h");
  wH.appendChild(el("strong", "", "원하는 방향 · 칭찬"));
  wH.appendChild(el("span", "", "출처 프로젝트 표시"));
  wantSec.appendChild(wH);
  wantSec.appendChild(el(
    "div",
    "pref-sec-d",
    "「dragon-quest에서 용·퀘스트 원함」처럼 출처가 보여요. 다른 앱을 만들 때는 그 프로젝트 맥락으로만 참고하세요.",
  ));
  if (prefs.wants.length === 0) {
    wantSec.appendChild(el("div", "pref-empty", "비어 있어요. 좋아하는 방향을 추가해 보세요."));
  } else {
    prefs.wants.forEach((item, index) => {
      const row = el("div", "pref-item");
      const main = el("div", "");
      main.appendChild(prefTitleWithProject(item.project, item.text));
      if (item.date) main.appendChild(el("div", "pmeta", item.date));
      main.style.cursor = "pointer";
      main.onclick = () => {
        const edited = prompt("원하는 방향 수정", item.text || "");
        if (edited === null) return;
        const project = askProjectSource(item.project || "");
        if (project === null) return;
        const value = edited.trim().slice(0, 120);
        if (!value) return;
        const next = prefsState();
        next.wants[index] = {
          ...item,
          text: value,
          project: project || item.project || "",
        };
        savePrefs(next, "원하는 방향을 수정했어요");
      };
      const del = el("button", "pref-x", "×");
      del.type = "button";
      del.onclick = () => {
        const next = prefsState();
        next.wants.splice(index, 1);
        savePrefs(next, "항목을 지웠어요");
      };
      row.appendChild(main);
      row.appendChild(del);
      wantSec.appendChild(row);
    });
  }
  const wAdd = el("div", "pref-add col");
  const wInput = document.createElement("input");
  wInput.placeholder = "예: 홈에서 오늘 진행이 바로 보이게";
  const wRow = el("div", "pref-add-row");
  const wBtn = el("button", "btn ghost", "추가");
  wBtn.type = "button";
  wBtn.onclick = () => {
    const value = wInput.value.trim().slice(0, 120);
    if (!value) return;
    const project = askProjectSource("");
    if (project === null) return;
    const next = prefsState();
    next.wants.unshift({
      id: `w-ui-${Date.now()}`,
      text: value,
      project: project || "수동",
      date: new Date().toISOString().slice(0, 10),
    });
    wInput.value = "";
    savePrefs(next, "원하는 방향을 추가했어요");
  };
  wRow.appendChild(wInput);
  wRow.appendChild(wBtn);
  wAdd.appendChild(wRow);
  wantSec.appendChild(wAdd);
  body.appendChild(wantSec);
}

$("openPrefs").onclick = () => {
  send({ type: "preferences_get" });
  store.screen = { name: "prefs" };
  render();
};
$("prefsBack").onclick = () => { store.screen = { name: "home" }; render(); };

$("openSettings").onclick = () => {
  send({ type: "settings_get" });
  store.screen = { name: "settings" };
  render();
};
$("setBack").onclick = () => { store.screen = { name: "home" }; render(); };
$("tplEditBack").onclick = () => { store.screen = { name: "templates" }; render(); };

$("tplAddStep").onclick = () => {
  const t = tplById(tplEditId);
  if (!t) return;
  const label = prompt("새 스텝 이름 (예: 경쟁사 분석)");
  if (!label) return;
  sendSteps(t, t.steps.concat([{ id: undefined, label: label.trim(), kind: "custom" }]));
};

// ---------- 프롬프트 편집 오버레이 ----------
function renderPromptEditor() {
  const open = !!promptCtx;
  $("promptEditor").hidden = !open;
  if (!open) return;
  const t = tplById(promptCtx.id);
  const step = t && t.steps.find((s) => s.id === promptCtx.stepId);
  $("promptTitle").textContent = (step ? step.label : promptCtx.stepId) + " 프롬프트";
  const p = store.tplPrompt;
  const loaded = p && p.id === promptCtx.id && p.stepId === promptCtx.stepId;
  const ta = $("promptBody");
  // 사용자가 입력을 시작한 뒤에는 서버 응답으로 덮어쓰지 않는다
  if (loaded && !ta.dataset.dirty) ta.value = p.body;
  ta.readOnly = !!promptCtx.readonly;
  $("promptSave").hidden = !!promptCtx.readonly;
  $("promptSave").disabled = !loaded;
  $("promptReset").hidden =
    !!promptCtx.readonly || !promptCtx.hasDefault || !(loaded && p.overridden);
}

$("promptBody").addEventListener("input", () => { $("promptBody").dataset.dirty = "1"; });
$("promptClose").onclick = () => { promptCtx = null; delete $("promptBody").dataset.dirty; render(); };
$("promptSave").onclick = () => {
  if (!promptCtx) return;
  send({ type: "tpl_prompt_set", id: promptCtx.id, stepId: promptCtx.stepId, body: $("promptBody").value });
  delete $("promptBody").dataset.dirty;
  toast("저장했어요");
};
$("promptReset").onclick = () => {
  if (!promptCtx) return;
  if (confirm("이 스텝 프롬프트를 기본값으로 되돌릴까요?")) {
    send({ type: "tpl_prompt_reset", id: promptCtx.id, stepId: promptCtx.stepId });
    delete $("promptBody").dataset.dirty;
  }
};

// ---------- 홈: 새 프로젝트 ----------

$("newProject").onclick = () => {
  if (!ws) return;
  openNewProjectSheet();
};
$("newProjectBackdrop").onclick = closeNewProjectSheet;
$("newProjectCancel").onclick = closeNewProjectSheet;
$("modeIdeaLab").onclick = startIdeaLab;
$("modeDevelop").onclick = () => {
  closeNewProjectSheet();
  openIdeaPicker();
};
$("modeDirectDevelop").onclick = () => {
  templateProjectMode = "direct";
  renderNewProjectSheet();
  $("templateProjectName").focus();
};
$("modeTemplate").onclick = () => {
  templateProjectMode = "templates";
  renderNewProjectSheet();
  $("templateProjectName").focus();
};
$("templateProjectBack").onclick = () => {
  templateProjectMode = false;
  renderNewProjectSheet();
};
$("ideaPickerClose").onclick = closeIdeaPicker;
$("openIdeaVault").onclick = () => openIdeaPicker();

$("archToggle").onclick = () => {
  archOpen = !archOpen;
  render();
};

$("ideaTabChat").onclick = () => {
  setIdeaViewMode("chat");
  const cur = currentProject();
  if (cur) renderIdeaProposed(cur);
};

$("ideaTabList").onclick = () => {
  setIdeaViewMode("ideas");
  const cur = currentProject();
  if (cur) renderIdeaProposed(cur);
};

// ---------- 프로젝트 화면: 뒤로/입력 ----------

$("back").onclick = () => {
  pendingImages = [];
  renderAttachments();
  store.screen = { name: "home" };
  ideaViewMode = "chat";
  ideaViewAutoOpened = false;
  setIdeaViewMode("chat");
  send({ type: "ideas_library_get" });
  render();
};

// 입력창(textarea) 자동 높이: 내용에 맞춰 아래로 늘어난다(최대 높이는 CSS max-height가 제한)
function autosizeCmd() {
  const ta = $("cmd");
  ta.style.height = "auto";
  const max = 128; // CSS max-height와 일치
  ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
}

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_COUNT = 3;

function renderAttachments() {
  const tray = $("attachmentTray");
  tray.textContent = "";
  tray.hidden = pendingImages.length === 0;
  pendingImages.forEach((image, index) => {
    const item = el("div", "attachment");
    const preview = document.createElement("img");
    preview.src = image.preview;
    preview.alt = image.name;
    item.appendChild(preview);
    const remove = el("button", "", "×");
    remove.type = "button";
    remove.title = `${image.name} 제거`;
    remove.onclick = () => {
      pendingImages.splice(index, 1);
      renderAttachments();
    };
    item.appendChild(remove);
    tray.appendChild(item);
  });
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const preview = String(reader.result || "");
      const comma = preview.indexOf(",");
      if (comma === -1) {
        reject(new Error("이미지를 읽지 못했어요"));
        return;
      }
      resolve({ name: file.name, mime: file.type, base64: preview.slice(comma + 1), preview });
    };
    reader.onerror = () => reject(new Error("이미지를 읽지 못했어요"));
    reader.readAsDataURL(file);
  });
}

$("attachBtn").onclick = () => $("imageInput").click();
$("imageInput").addEventListener("change", async (event) => {
  const input = event.target;
  const files = Array.from(input.files || []);
  input.value = "";
  if (pendingImages.length + files.length > MAX_IMAGE_COUNT) {
    toast(`이미지는 한 번에 ${MAX_IMAGE_COUNT}개까지 첨부할 수 있어요`);
    return;
  }
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      toast("PNG, JPG, WebP, GIF 이미지만 첨부할 수 있어요");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast("이미지 한 장은 4MB 이하여야 해요");
      return;
    }
  }
  try {
    const images = await Promise.all(files.map(readImage));
    pendingImages.push(...images);
    renderAttachments();
  } catch (e) {
    toast(e instanceof Error ? e.message : "이미지를 읽지 못했어요");
  }
});

function sendCommand() {
  const name = currentProject();
  const text = $("cmd").value.trim();
  if ((!text && pendingImages.length === 0) || !ws || !name) return;
  const attachments = pendingImages.map(({ name: fileName, mime, base64 }) => ({
    name: fileName, mime, base64,
  }));
  const displayText = text || `📎 이미지 ${attachments.length}개`;
  applyMessage(store, { type: "local_user", project: name, text: displayText }, Date.now());
  send({ type: "command", project: name, text, attachments });
  $("cmd").value = "";
  pendingImages = [];
  renderAttachments();
  autosizeCmd(); // 전송 후 1줄 높이로 복귀
  render();
}
$("send").onclick = sendCommand;
$("cmd").addEventListener("input", autosizeCmd);
$("cmd").addEventListener("keydown", (e) => {
  if (e.isComposing) return; // 한글 등 IME 조합 중 Enter는 조합 확정으로 취급(전송 안 함)
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); // textarea 기본 줄바꿈 대신 전송(Shift+Enter는 줄바꿈)
    sendCommand();
  }
});

// confirm 무응답 감시: 8초(§4 ack 계약) 초과 시 [다시 전송] 노출
setInterval(() => {
  if (store.pendingConfirm && confirmTimedOut(store, Date.now()) && !confirmTimeoutShown) {
    confirmTimeoutShown = true;
    render();
  }
}, 1000);

window.addEventListener("resize", () => {
  applyFrameMode();
  applyViewerFrameMode();
});

render();
