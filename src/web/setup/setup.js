// /setup 관리 페이지 배선. 바닐라 JS, 프레임워크/외부 의존성 없음.
// 관리키는 주소창의 ?k=에서 읽어 모든 fetch에 x-admin-key 헤더로 부착한다.
// 주소창의 ?k=는 새로고침 재인증에 필요하므로 지우지 않는다(history.replaceState 미사용).
const KEY = new URLSearchParams(location.search).get("k") || "";

const $ = (id) => document.getElementById(id);

// ---------- 공용 fetch 헬퍼 ----------
async function api(path, body) {
  const opts = { headers: { "x-admin-key": KEY } };
  if (body !== undefined) {
    opts.method = "POST";
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    toast("네트워크 오류: " + (e && e.message ? e.message : String(e)));
    return null;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    toast("응답을 해석하지 못했어요");
    return null;
  }
  if (!data || data.ok !== true) {
    toast((data && data.error) || "요청이 실패했어요");
    return null;
  }
  return data;
}

// ---------- 토스트 ----------
let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

// ---------- 탭 전환 ----------
const TABS = ["account", "tpl", "doc"];

function showTab(name) {
  document.querySelectorAll(".tabs button[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  TABS.forEach((t) => {
    $("tab-" + t).hidden = t !== name;
  });
  if (name === "account") loadAccount();
  else if (name === "tpl") loadTemplates();
  else if (name === "doc") loadDocs();
}

document.querySelectorAll(".tabs button[data-tab]").forEach((b) => {
  b.addEventListener("click", () => showTab(b.dataset.tab));
});

// ---------- 접속 정보(QR·주소) ----------
let infoPollTimer = null;

async function loadInfo() {
  const data = await api("/setup/api/info");
  if (!data) {
    // 첫 호출 실패 시에도 폴링이 시작되도록 재시도 타이머를 건다(url 수신 시 기존 로직이 clear함).
    if (!infoPollTimer) {
      infoPollTimer = setInterval(loadInfo, 2000);
    }
    return;
  }
  $("infoId").textContent = data.id;
  if (data.url) {
    $("infoUrl").hidden = true;
    $("infoLink").textContent = data.url;
    $("infoLink").href = data.link || data.url;
    if (data.qr) {
      $("qrImg").src = data.qr;
      $("qrImg").hidden = false;
    }
    if (infoPollTimer) {
      clearInterval(infoPollTimer);
      infoPollTimer = null;
    }
  } else {
    $("infoUrl").hidden = false;
    $("infoUrl").textContent = "주소 준비 중… (터널이 뜨면 자동 표시)";
    if (!infoPollTimer) {
      infoPollTimer = setInterval(loadInfo, 2000);
    }
  }
}

// ---------- 계정 ----------
async function loadAccount() {
  const data = await api("/setup/api/account");
  if (!data) return;
  $("accId").value = data.id || "";
  $("accPw").value = "";
  $("accMsg").textContent = "";
}

$("accSave").addEventListener("click", async () => {
  const id = $("accId").value.trim();
  const password = $("accPw").value;
  const data = await api("/setup/api/account", { id, password });
  if (!data) return;
  $("accPw").value = "";
  toast("저장했어요 — 다음 로그인부터 적용");
});

// ---------- 파이프라인 템플릿 ----------
let tplCache = [];
let currentTpl = null; // 편집/프롬프트 대상 템플릿 id
let currentStep = null; // 프롬프트 대상 스텝 id

function showTplView(view) {
  $("tplList").hidden = view !== "list";
  $("tplEdit").hidden = view !== "edit";
  $("tplPrompt").hidden = view !== "prompt";
}

function tplById(id) {
  return tplCache.find((t) => t.id === id) || null;
}

async function loadTemplates() {
  const data = await api("/setup/api/templates");
  if (!data) return;
  tplCache = data.templates;
  renderTplList();
  showTplView("list");
}

$("tplCreate").addEventListener("click", async () => {
  const name = prompt("새 템플릿 이름", "내 작업 템플릿");
  if (!name?.trim()) return;
  const data = await api("/setup/api/templates/create", { name: name.trim() });
  if (!data) return;
  tplCache = data.templates;
  renderTplList();
  toast("빈 템플릿을 만들었어요");
});

function renderTplList() {
  const list = $("tplList");
  list.innerHTML = "";
  tplCache.forEach((t) => {
    const card = document.createElement("div");
    card.className = "card";

    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("b");
    name.textContent = t.name + (t.readonly ? " 🔒" : "");
    row.appendChild(name);
    card.appendChild(row);

    const chain = document.createElement("div");
    chain.className = "hint";
    chain.textContent = t.steps.map((s) => s.label).join(" → ");
    card.appendChild(chain);

    const btns = document.createElement("div");
    btns.className = "row";

    const dup = document.createElement("button");
    dup.className = "btn ghost";
    dup.textContent = "복제";
    dup.addEventListener("click", async () => {
      const name2 = prompt("새 템플릿 이름", t.name + " 사본");
      if (!name2 || !name2.trim()) return;
      const data = await api("/setup/api/templates/clone", { basedOn: t.id, name: name2 });
      if (!data) return;
      tplCache = data.templates;
      renderTplList();
      toast("복제했어요");
    });
    btns.appendChild(dup);

    if (t.readonly) {
      const view = document.createElement("button");
      view.className = "btn ghost";
      view.textContent = t.promptEditable ? "프롬프트 편집" : "프롬프트 보기";
      view.addEventListener("click", () => openTplEdit(t.id));
      btns.appendChild(view);
    } else {
      const edit = document.createElement("button");
      edit.className = "btn ghost";
      edit.textContent = "스텝 편집";
      edit.addEventListener("click", () => openTplEdit(t.id));
      btns.appendChild(edit);

      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "삭제";
      del.addEventListener("click", async () => {
        if (!confirm(`'${t.name}' 템플릿을 삭제할까요?\n(이미 만든 프로젝트에는 영향 없음)`)) return;
        const data = await api("/setup/api/templates/delete", { id: t.id });
        if (!data) return;
        tplCache = data.templates;
        renderTplList();
        toast("삭제했어요");
      });
      btns.appendChild(del);
    }

    card.appendChild(btns);
    list.appendChild(card);
  });
}

function openTplEdit(id) {
  currentTpl = id;
  showTplView("edit");
  renderTplEdit();
}

function renderTplEdit() {
  const t = tplById(currentTpl);
  if (!t) {
    showTplView("list");
    return;
  }
  $("tplEditName").textContent = t.name;
  $("tplAddStep").hidden = t.readonly;
  const wrap = $("tplSteps");
  wrap.innerHTML = "";
  t.steps.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "listrow";

    const label = document.createElement("span");
    label.textContent = `${i + 1}. ${s.label}` + (s.overridden ? " ✏️" : "");
    row.appendChild(label);

    const spacer = document.createElement("span");
    spacer.className = "spacer";
    row.appendChild(spacer);

    if (!t.readonly) {
      const up = document.createElement("button");
      up.className = "btn ghost";
      up.textContent = "↑";
      up.disabled = i === 0;
      up.addEventListener("click", () => moveStep(t, i, -1));
      row.appendChild(up);

      const down = document.createElement("button");
      down.className = "btn ghost";
      down.textContent = "↓";
      down.disabled = i === t.steps.length - 1;
      down.addEventListener("click", () => moveStep(t, i, 1));
      row.appendChild(down);
    }

    const promptBtn = document.createElement("button");
    promptBtn.className = "btn ghost";
    promptBtn.textContent = "✏️ 프롬프트";
    promptBtn.addEventListener("click", () => openTplPrompt(t, s));
    row.appendChild(promptBtn);

    if (!t.readonly) {
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        if (t.steps.length <= 1) {
          toast("스텝은 1개 이상이어야 해요");
          return;
        }
        if (!confirm(`'${s.label}' 스텝을 뺄까요?`)) return;
        await saveSteps(t, t.steps.filter((x) => x.id !== s.id));
      });
      row.appendChild(del);
    }

    wrap.appendChild(row);
  });
}

async function moveStep(t, i, dir) {
  const next = t.steps.slice();
  const j = i + dir;
  [next[i], next[j]] = [next[j], next[i]];
  await saveSteps(t, next);
}

async function saveSteps(t, steps) {
  const data = await api("/setup/api/templates/steps", {
    id: t.id,
    steps: steps.map((s) => ({ id: s.id, label: s.label, kind: s.kind })),
  });
  if (!data) return;
  tplCache = data.templates;
  renderTplEdit();
  renderTplList();
}

$("tplEditBack").addEventListener("click", () => {
  renderTplList();
  showTplView("list");
});

$("tplAddStep").addEventListener("click", async () => {
  const t = tplById(currentTpl);
  if (!t) return;
  const label = prompt("새 스텝 이름 (예: 경쟁사 분석)");
  if (!label || !label.trim()) return;
  await saveSteps(t, t.steps.concat([{ label: label.trim(), kind: "custom" }]));
});

function openTplPrompt(t, s) {
  currentTpl = t.id;
  currentStep = s.id;
  $("tplPromptName").textContent = s.label;
  const ta = $("tplPromptBody");
  ta.value = ""; // 이전 스텝 내용이 잔존하지 않도록 진입 시 항상 초기화
  const promptReadonly = t.readonly && !t.promptEditable;
  ta.readOnly = promptReadonly;
  $("tplPromptSave").hidden = promptReadonly;
  $("tplPromptReset").hidden = true;
  showTplView("prompt");
  loadTplPromptBody(t.id, s.id, t.readonly || s.kind === "builtin", promptReadonly);
}

async function loadTplPromptBody(id, stepId, hasDefault, readonly) {
  const qs = new URLSearchParams({ id, stepId });
  const data = await api("/setup/api/templates/prompt?" + qs.toString());
  if (!data) return;
  if (currentTpl !== id || currentStep !== stepId) return; // 그 사이 다른 곳으로 이동했으면 무시
  $("tplPromptBody").value = data.body;
  $("tplPromptReset").hidden = readonly || !hasDefault || !data.overridden;
}

async function refreshTemplatesCache() {
  const data = await api("/setup/api/templates");
  if (data) tplCache = data.templates;
  return data;
}

$("tplPromptBack").addEventListener("click", () => {
  showTplView("edit");
  renderTplEdit();
});

$("tplPromptSave").addEventListener("click", async () => {
  if (!currentTpl || !currentStep) return;
  const data = await api("/setup/api/templates/prompt", {
    id: currentTpl,
    stepId: currentStep,
    body: $("tplPromptBody").value,
  });
  if (!data) return;
  toast("저장했어요");
  await refreshTemplatesCache();
  const t = tplById(currentTpl);
  const s = t && t.steps.find((x) => x.id === currentStep);
  if (t && s) loadTplPromptBody(
    t.id, s.id, t.readonly || s.kind === "builtin", t.readonly && !t.promptEditable,
  );
});

$("tplPromptReset").addEventListener("click", async () => {
  if (!currentTpl || !currentStep) return;
  if (!confirm("이 스텝 프롬프트를 기본값으로 되돌릴까요?")) return;
  const data = await api("/setup/api/templates/prompt-reset", {
    id: currentTpl,
    stepId: currentStep,
  });
  if (!data) return;
  toast("복원했어요");
  await refreshTemplatesCache();
  const t = tplById(currentTpl);
  const s = t && t.steps.find((x) => x.id === currentStep);
  if (t && s) loadTplPromptBody(
    t.id, s.id, t.readonly || s.kind === "builtin", t.readonly && !t.promptEditable,
  );
});

// ---------- 산출물 템플릿 ----------
let docCache = [];
let currentDoc = null;

function showDocView(view) {
  $("docList").hidden = view !== "list";
  $("docEdit").hidden = view !== "edit";
}

async function loadDocs() {
  const data = await api("/setup/api/doc-templates");
  if (!data) return;
  docCache = data.files;
  renderDocList();
  showDocView("list");
}

function renderDocList() {
  const list = $("docList");
  list.innerHTML = "";
  docCache.forEach((f) => {
    const row = document.createElement("div");
    row.className = "listrow";

    const name = document.createElement("span");
    name.textContent = f.name;
    row.appendChild(name);

    if (f.customized) {
      const badge = document.createElement("span");
      badge.className = "hint";
      badge.textContent = "수정됨";
      row.appendChild(badge);
    }

    const spacer = document.createElement("span");
    spacer.className = "spacer";
    row.appendChild(spacer);

    const edit = document.createElement("button");
    edit.className = "btn ghost";
    edit.textContent = "편집";
    edit.addEventListener("click", () => openDocEdit(f.name));
    row.appendChild(edit);

    list.appendChild(row);
  });
}

function openDocEdit(name) {
  currentDoc = name;
  $("docName").textContent = name;
  const ta = $("docBody");
  ta.value = ""; // 이전 파일 내용이 잔존하지 않도록 진입 시 항상 초기화
  $("docReset").hidden = true;
  showDocView("edit");
  loadDocBody(name);
}

async function loadDocBody(name) {
  const data = await api("/setup/api/doc-templates/get?" + new URLSearchParams({ name }).toString());
  if (!data) return;
  if (currentDoc !== name) return;
  $("docBody").value = data.content;
  const f = docCache.find((x) => x.name === name);
  $("docReset").hidden = !(f && f.customized);
}

$("docBack").addEventListener("click", () => {
  renderDocList();
  showDocView("list");
});

$("docSave").addEventListener("click", async () => {
  if (!currentDoc) return;
  const data = await api("/setup/api/doc-templates/put", {
    name: currentDoc,
    content: $("docBody").value,
  });
  if (!data) return;
  toast(data.warning || "저장했어요");
  docCache = data.files;
  renderDocList();
  const f = docCache.find((x) => x.name === currentDoc);
  $("docReset").hidden = !(f && f.customized);
});

$("docReset").addEventListener("click", async () => {
  if (!currentDoc) return;
  if (!confirm("원본으로 복원할까요?")) return;
  const data = await api("/setup/api/doc-templates/reset", { name: currentDoc });
  if (!data) return;
  toast("복원했어요");
  docCache = data.files;
  renderDocList();
  loadDocBody(currentDoc);
});

// ---------- 초기화 ----------
loadInfo();
showTab("account");
