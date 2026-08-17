import { describe, it, expect } from "vitest";
import {
  createStore, applyMessage, markConfirmSent, confirmTimedOut,
  statusBadge, stageProgress, homeProjects,
  artifactButtons, previewUrl, framePreset, openViewer, closeViewer, setViewerFrame,
  snapshotSteps, stepLabel, stageLineText,
} from "../../src/web/store.js";

const snap = (over = {}) => ({
  schemaVersion: 1, project: "habit", createdAt: "t",
  stage: "mockup", stageStatus: "awaiting_confirm", artifacts: {},
  sessionId: null, history: [], error: null, queueLength: 0, ...over,
});

describe("applyMessage settings", () => {
  it("초기 store.model은 기본 opus다", () => {
    const s = createStore();
    expect(s.provider).toBe("claude");
    expect(s.model).toBe("opus");
  });
  it("settings 메시지가 provider/model을 갱신한다", () => {
    const s = createStore();
    applyMessage(s, { type: "settings", provider: "codex", model: "gpt-5.6-sol" }, 0);
    expect(s.provider).toBe("codex");
    expect(s.model).toBe("gpt-5.6-sol");
  });
});

describe("applyMessage ideas library", () => {
  it("공용 아이디어 보관함을 갱신한다", () => {
    const s = createStore();
    applyMessage(s, {
      type: "ideas_library",
      items: [{ slug: "idea-a", direction: "JP→BR", oneLiner: "아이디어", category: "도구", adopted: null }],
    }, 0);
    expect(s.ideasLibrary[0].slug).toBe("idea-a");
  });
});

describe("applyMessage", () => {
  it("projects 메시지가 pipelines/archived를 반영한다", () => {
    const s = createStore();
    applyMessage(s, { type: "projects", names: ["a", "b"], pipelines: ["a"], archived: ["b"] }, 0);
    expect(s.projects.a.kind).toBe("pipeline");
    expect(s.projects.b.kind).toBe("legacy");
    expect(s.projects.b.archived).toBe(true);
  });
  it("projects 메시지에서 빠진 프로젝트(삭제됨)는 store에서 제거된다", () => {
    const s = createStore();
    applyMessage(s, { type: "projects", names: ["a", "b"], pipelines: ["a"], archived: [] }, 0);
    applyMessage(s, { type: "projects", names: ["a"], pipelines: ["a"], archived: [] }, 0);
    expect(s.projects.b).toBeUndefined();
    expect(s.projects.a).toBeDefined();
  });
  it("projects 메시지에서 빠진 프로젝트는 pruned 이벤트로 나온다", () => {
    const s = createStore();
    applyMessage(s, { type: "projects", names: ["a", "b"], pipelines: ["a"], archived: [] }, 0);
    const ev = applyMessage(s, { type: "projects", names: ["a"], pipelines: ["a"], archived: [] }, 0);
    expect(ev).toContainEqual({ type: "pruned", projects: ["b"] });
  });
  it("stage_update는 스냅샷을 통째로 덮어쓴다", () => {
    const s = createStore();
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap() }, 0);
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap({ stage: "estimate", stageStatus: "running" }) }, 0);
    expect(s.projects.habit.pipeline.stage).toBe("estimate");
  });
  it("awaiting_confirm 진입 시 attention 이벤트", () => {
    const s = createStore();
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap({ stageStatus: "running" }) }, 0);
    const ev = applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap() }, 0);
    expect(ev).toContainEqual({ type: "attention", project: "habit" });
  });
  it("chat_history는 통째 교체, assistant/log/user는 append", () => {
    const s = createStore();
    applyMessage(s, { type: "chat_history", project: "habit", entries: [{ ts: "t", role: "user", text: "하이" }] }, 0);
    applyMessage(s, { type: "assistant", project: "habit", text: "네" }, 0);
    expect(s.projects.habit.chat.map((c) => c.text)).toEqual(["하이", "네"]);
  });
  it("status:error에 text가 있으면 status_error 이벤트로 나온다", () => {
    const s = createStore();
    const ev = applyMessage(s, { type: "status", project: "habit", state: "error", text: "이름은 영문/숫자만 쓸 수 있어요" }, 0);
    expect(ev).toContainEqual({ type: "status_error", project: "habit", text: "이름은 영문/숫자만 쓸 수 있어요" });
  });
  it("status:error에 text가 없으면 status_error 이벤트가 나오지 않는다", () => {
    const s = createStore();
    const ev = applyMessage(s, { type: "status", project: "habit", state: "error" }, 0);
    expect(ev.some((e) => e.type === "status_error")).toBe(false);
  });
});

describe("confirm ack", () => {
  it("confirm 전송 후 stage_update가 오면 acked, 8초 넘으면 timeout", () => {
    const s = createStore();
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap() }, 0);
    markConfirmSent(s, "habit", "mockup", 1000);
    expect(confirmTimedOut(s, 5000)).toBe(false);
    expect(confirmTimedOut(s, 9001)).toBe(true);
    const ev = applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap({ stage: "estimate", stageStatus: "starting" }) }, 2000);
    expect(ev).toContainEqual({ type: "confirm_acked" });
    expect(s.pendingConfirm).toBeNull();
  });
});

describe("표시 헬퍼", () => {
  it("statusBadge 규칙", () => {
    expect(statusBadge({ kind: "pipeline", pipeline: snap() }).cls).toBe("wait");
    expect(statusBadge({ kind: "pipeline", pipeline: snap({ stageStatus: "running" }) }).cls).toBe("run");
    expect(statusBadge({ kind: "pipeline", pipeline: snap({ stageStatus: "error" }) }).cls).toBe("err");
    expect(statusBadge({ kind: "pipeline", pipeline: snap({ stage: "done" }) }).cls).toBe("done");
  });
  it("stageProgress: mockup은 5/9, done은 1", () => {
    expect(stageProgress(snap())).toBeCloseTo(5 / 9);
    expect(stageProgress(snap({ stage: "done" }))).toBe(1);
  });
  it("homeProjects: awaiting_confirm이 앞, archived는 분리", () => {
    const s = createStore();
    applyMessage(s, { type: "projects", names: ["a", "b", "c"], pipelines: ["a", "b"], archived: ["c"] }, 0);
    applyMessage(s, { type: "stage_update", project: "a", pipeline: snap({ project: "a", stageStatus: "running" }) }, 0);
    applyMessage(s, { type: "stage_update", project: "b", pipeline: snap({ project: "b" }) }, 0);
    const { active, archived } = homeProjects(s);
    expect(active[0]).toBe("b");
    expect(archived).toEqual(["c"]);
  });
});

describe("artifactButtons / framePreset", () => {
  it("artifactButtons: md는 md, mockup/preview는 iframe+URL", () => {
    const p = snap({ artifacts: { prd: "docs/PRD.md", mockup: "mockup/index.html", preview: "preview/index.html" } });
    const btns = artifactButtons(p);
    expect(btns.find((b) => b.key === "prd").kind).toBe("md");
    expect(btns.find((b) => b.key === "mockup")).toMatchObject({ kind: "iframe", url: "/preview/habit/mockup/index.html" });
  });
  it("artifactButtons: 공백 포함 파일명이 URL 인코딩된다", () => {
    const p = snap({ artifacts: { mockup: "mockup/화면 1.html" } });
    const btns = artifactButtons(p);
    const btn = btns.find((b) => b.key === "mockup");
    expect(btn.url).toContain("%20");
    expect(btn.url).toBe("/preview/habit/mockup/%ED%99%94%EB%A9%B4%201.html");
  });
  it("artifactButtons: .. 세그먼트는 버튼을 생성하지 않는다", () => {
    const p = snap({ artifacts: { mockup: "../evil/x.html" } });
    const btns = artifactButtons(p);
    const btn = btns.find((b) => b.key === "mockup");
    expect(btn).toBeUndefined();
  });
  it("artifactButtons: mockup/preview 외 키는 .md가 아니면 버튼을 생성하지 않는다", () => {
    const p = snap({ artifacts: { release: "release/" } });
    const btns = artifactButtons(p);
    expect(btns.length).toBe(0);
  });
  it("previewUrl: preview 산출물이 있으면 정적 URL, 없으면 null", () => {
    expect(previewUrl(snap({ artifacts: { preview: "preview/index.html" } })))
      .toBe("/preview/habit/preview/index.html");
    expect(previewUrl(snap())).toBeNull(); // artifacts 비어있음
    expect(previewUrl(snap({ artifacts: { prd: "docs/PRD.md" } }))).toBeNull(); // preview 키 없음
  });
  it("previewUrl: .. 세그먼트는 null(경로 탈출 방어)", () => {
    expect(previewUrl(snap({ artifacts: { preview: "../evil/index.html" } }))).toBeNull();
  });
  it("framePreset", () => {
    expect(framePreset("iphone")).toEqual({ w: 390, h: 844 });
    expect(framePreset("android")).toEqual({ w: 360, h: 800 });
    expect(framePreset("full")).toBeNull();
  });
});

describe("뷰어 오버레이", () => {
  it("openViewer/closeViewer가 store.viewer를 열고 닫는다", () => {
    const s = createStore();
    expect(s.viewer).toBeNull();
    openViewer(s, "habit", { key: "prd", label: "PRD", kind: "md" });
    expect(s.viewer).toMatchObject({ project: "habit", key: "prd", kind: "md", content: null });
    closeViewer(s);
    expect(s.viewer).toBeNull();
  });
  it("artifact 메시지가 열려 있는 뷰어의 content를 채운다", () => {
    const s = createStore();
    openViewer(s, "habit", { key: "prd", label: "PRD", kind: "md" });
    applyMessage(s, { type: "artifact", project: "habit", key: "prd", content: "# PRD\n내용" }, 0);
    expect(s.viewer.content).toBe("# PRD\n내용");
  });
  it("다른 프로젝트/키의 artifact 메시지는 무시한다", () => {
    const s = createStore();
    openViewer(s, "habit", { key: "prd", label: "PRD", kind: "md" });
    applyMessage(s, { type: "artifact", project: "other", key: "prd", content: "엉뚱한 내용" }, 0);
    expect(s.viewer.content).toBeNull();
  });
  it("setViewerFrame이 뷰어의 frame 프리셋을 바꾼다", () => {
    const s = createStore();
    openViewer(s, "habit", { key: "mockup", label: "목업", kind: "iframe", url: "/preview/habit/mockup/index.html" });
    setViewerFrame(s, "android");
    expect(s.viewer.frame).toBe("android");
  });
});

const twoSteps = [
  { id: "ideation", label: "아이디어", kind: "builtin", timeoutMin: 15 },
  { id: "ship", label: "출시 준비", kind: "custom", timeoutMin: 30 },
];

describe("동적 스텝 헬퍼", () => {
  it("snapshotSteps: steps 있으면 그대로, 없으면 9종 폴백", () => {
    expect(snapshotSteps({ steps: twoSteps })).toEqual(twoSteps);
    expect(snapshotSteps({}).length).toBe(9);
  });
  it("stepLabel: id→라벨, done→완료, 미지는 id 그대로", () => {
    expect(stepLabel({ steps: twoSteps }, "ship")).toBe("출시 준비");
    expect(stepLabel({ steps: twoSteps }, "done")).toBe("완료");
    expect(stepLabel({ steps: twoSteps }, "ghost")).toBe("ghost");
  });
  it("stageProgress: steps 기준 비율", () => {
    expect(stageProgress({ steps: twoSteps, stage: "ship" })).toBe(1); // 2/2
    expect(stageProgress({ steps: twoSteps, stage: "done" })).toBe(1);
    expect(stageProgress({ steps: twoSteps, stage: "ideation" })).toBe(0.5);
  });
});

describe("stageLineText", () => {
  it("진행 중: '5/9 목업 · 진행 중'", () => {
    expect(stageLineText(snap({ stageStatus: "running" }))).toBe("5/9 목업 · 진행 중");
  });
  it("awaiting_confirm: '5/9 목업 · 확인 대기'", () => {
    expect(stageLineText(snap())).toBe("5/9 목업 · 확인 대기");
  });
  it("done: '완료 🎉'", () => {
    expect(stageLineText(snap({ stage: "done" }))).toBe("완료 🎉");
  });
});

describe("템플릿 메시지", () => {
  it("tpl_list/tpl_prompt가 store에 반영된다", () => {
    const store = createStore();
    applyMessage(store, { type: "tpl_list", templates: [{ id: "default" }] }, 0);
    expect(store.templates.length).toBe(1);
    applyMessage(store, { type: "tpl_prompt", id: "f", stepId: "prd", body: "b", overridden: true }, 0);
    expect(store.tplPrompt).toEqual({ id: "f", stepId: "prd", body: "b", overridden: true });
  });
});
