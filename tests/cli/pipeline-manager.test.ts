import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineManager } from "../../src/cli/pipeline-manager.js";
import { seedPipelineState, readPipelineState, writePipelineState, readPipelineHostState } from "../../src/cli/pipeline-store.js";
import { DEFAULT_STEPS } from "../../src/shared/pipeline.js";
import type { Executor, RunOpts, RunHandle } from "../../src/cli/executor.js";
import type { HostOutbound } from "../../src/shared/protocol.js";

// 수동 완료 제어형 Fake: run 호출을 기록하고, 테스트가 finish()로 종료시킨다.
class ManualExecutor implements Executor {
  runs: { command: string; opts: RunOpts; finish: (fail?: boolean) => void; cancelled: boolean }[] = [];
  run(command: string, opts: RunOpts): RunHandle {
    let resolve!: () => void, reject!: (e: Error) => void;
    const done = new Promise<{ sessionId?: string }>((res, rej) => {
      resolve = () => res({ sessionId: "sid-test" });
      reject = rej;
    });
    const entry = {
      command, opts,
      finish: (fail?: boolean) => (fail ? reject(new Error("x")) : resolve()),
      cancelled: false,
    };
    this.runs.push(entry);
    return { done, cancel: () => { entry.cancelled = true; reject(new Error("cancelled")); } };
  }
}

let root: string, sent: HostOutbound[], ex: ManualExecutor, mgr: PipelineManager;
const dir = (p: string) => join(root, p);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mgr-"));
  mkdirSync(dir("habit"), { recursive: true });
  seedPipelineState(dir("habit"), "habit", "2026-07-04T00:00:00Z");
  sent = [];
  ex = new ManualExecutor();
  mgr = new PipelineManager({
    projectsRoot: root,
    send: (m) => sent.push(m),
    createExecutor: () => ex,
    now: () => new Date("2026-07-04T12:00:00Z"),
  });
});
afterEach(async () => {
  mgr.stop();
  // pending promise rejection 처리 대기
  await flush();
  rmSync(root, { recursive: true, force: true });
});

const updates = () => sent.filter((m) => m.type === "stage_update") as any[];
const flush = () => new Promise((r) => setTimeout(r, 20)); // done 마이크로태스크 소화

describe("confirm", () => {
  it("awaiting_confirm에서 stage 일치 confirm → 다음 단계 starting 기록 후 스킬 실행", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "ideation", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "ideation" });
    expect(ex.runs).toHaveLength(1);
    expect(ex.runs[0].command).toBe("/pipeline-wireframe");
    const s = readPipelineState(dir("habit"))!;
    expect(s.stage).toBe("wireframe");
    // confirm 이력이 host state에 남는다
    expect(readPipelineHostState(dir("habit")).history[0]).toMatchObject({ stage: "ideation" });
    // 실행 시작 즉시 안내 로그(첫 응답까지의 공백에 멈춘 것처럼 보이지 않게)
    const startLog = sent.find((m) => m.type === "log" && (m as any).text.includes("시작했어요"));
    expect(startLog).toBeTruthy();
  });
  it("stage 불일치 confirm은 무시(멱등성)", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "ideation" });
    expect(ex.runs).toHaveLength(0);
  });
  it("running 중 confirm은 거부하고 실행하지 않는다(in-flight 선점 금지)", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleFeedback("habit", "고쳐줘");        // running 진입
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "prd" });
    expect(ex.runs).toHaveLength(1);              // 피드백 1건만
  });
  it("커스텀 스텝 목록으로도 confirm이 다음 스텝으로 전진한다", () => {
    // 준비: steps = [ideation, competitor] 2개짜리 v2 상태, ideation awaiting_confirm
    const steps = [
      { id: "ideation", label: "아이디어", kind: "builtin" as const, timeoutMin: 15 },
      { id: "competitor", label: "경쟁사 분석", kind: "custom" as const, timeoutMin: 30 },
    ];
    writeFileSync(join(dir("habit"), "pipeline.json"), JSON.stringify({
      schemaVersion: 2, project: "habit", createdAt: "2026-07-11T00:00:00Z",
      template: "t", steps, stage: "ideation", stageStatus: "awaiting_confirm", artifacts: {},
    }));
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "ideation" });
    const after = JSON.parse(readFileSync(join(dir("habit"), "pipeline.json"), "utf8"));
    expect(after.stage).toBe("competitor");
    expect(after.stageStatus).toBe("starting");
    // 커스텀 스텝도 /pipeline-<id> 커맨드로 실행기를 호출한다
    expect(ex.runs.at(-1)!.command).toBe("/pipeline-competitor");
  });
});

describe("피드백 큐", () => {
  it("실행 중 피드백은 큐에 쌓이고 완료 후 순서대로 실행, 큐 길이가 stage_update에 실린다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "mockup", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "첫번째");
    mgr.handleFeedback("habit", "두번째");
    expect(ex.runs).toHaveLength(1);
    expect(ex.runs[0].command).toBe("/pipeline-mockup 피드백: 첫번째");
    expect(updates().at(-1).pipeline.queueLength).toBe(1);
    ex.runs[0].finish(); await flush();
    expect(ex.runs).toHaveLength(2);
    expect(ex.runs[1].command).toBe("/pipeline-mockup 피드백: 두번째");
  });
  it("실행이 awaiting_confirm으로 끝나도 대기 큐를 순서대로 이어서 실행한다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "작업중");
    mgr.handleFeedback("habit", "대기1");
    mgr.handleFeedback("habit", "대기2");
    // 실행 종료 후 awaiting_confirm 상태를 스킬이 썼다고 가정
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    ex.runs[0].finish(); await flush();
    // 보류·폐기 없이 큐가 순서대로 이어진다(미리 보낸 지시가 사라지지 않는다)
    expect(ex.runs[1].command).toBe("/pipeline-prd 피드백: 대기1");
    ex.runs[1].finish(); await flush();
    expect(ex.runs[2].command).toBe("/pipeline-prd 피드백: 대기2");
  });
  it("큐 소진으로 실행 중일 때 confirm은 무시된다(in-flight 선점 금지)", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "작업중");
    mgr.handleFeedback("habit", "대기1");
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    ex.runs[0].finish(); await flush();
    expect(ex.runs).toHaveLength(2); // 대기1이 이어받아 실행 중
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "prd" });
    expect(ex.runs.map((r) => r.command)).not.toContain("/pipeline-mockup");
  });
});

describe("실행/큐 투명성", () => {
  it("실행 중 스냅샷에 runningText, 큐에 쌓인 내용이 queued로 실린다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "mockup", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "버튼 색을 바꿔줘");
    mgr.handleFeedback("habit", "글자를 키워줘");
    const last = updates().at(-1).pipeline;
    expect(last.runningText).toContain("버튼 색을 바꿔줘");
    expect(last.queued).toEqual(["글자를 키워줘"]);
    ex.runs[0].finish(); await flush();
    const after = updates().at(-1).pipeline;
    expect(after.runningText).toContain("글자를 키워줘");
    expect(after.queued).toEqual([]);
  });
});

describe("보조 스킬 목록", () => {
  it("skills_get은 시드된 스킬 디렉터리를 카탈로그 라벨과 함께 보낸다", () => {
    const skillsDir = join(dir("habit"), ".claude", "commands", "skills");
    mkdirSync(join(skillsDir, "overflow-fix"), { recursive: true });
    mkdirSync(join(skillsDir, "my-custom-skill"), { recursive: true });
    mgr.handleMessage({ type: "skills_get", project: "habit" });
    const msg = sent.find((m) => m.type === "skills") as any;
    expect(msg).toBeTruthy();
    expect(msg.items).toEqual([
      { id: "overflow-fix", label: "화면 깨짐(오버플로) 수정", desc: expect.any(String) },
      { id: "my-custom-skill", label: "my-custom-skill", desc: "" }, // 카탈로그 밖 → id 그대로
    ]);
  });
  it("스킬 미시드 프로젝트는 빈 목록을 보낸다", () => {
    mgr.handleMessage({ type: "skills_get", project: "habit" });
    const msg = sent.find((m) => m.type === "skills") as any;
    expect(msg.items).toEqual([]);
  });
});

describe("done 이후 유지보수 모드", () => {
  const doneState = () => ({
    schemaVersion: 2 as const, project: "habit", createdAt: "t", template: "default",
    steps: DEFAULT_STEPS, stage: "done", stageStatus: "pending" as const, artifacts: {},
  });
  it("done 상태의 채팅 피드백은 버려지지 않고 유지보수 실행으로 이어진다", () => {
    writePipelineState(dir("habit"), doneState());
    mgr.handleFeedback("habit", "홈 화면 문구를 바꿔줘");
    expect(ex.runs).toHaveLength(1);
    const cmd = ex.runs[0].command;
    expect(cmd).not.toMatch(/^\/pipeline-/);        // 단계 스킬 호출이 아니다
    expect(cmd).toContain("유지보수 모드");
    expect(cmd).toContain("홈 화면 문구를 바꿔줘");
    expect(cmd).toContain("/preview/habit/preview/"); // 미리보기 재빌드 지시 포함
  });
  it("유지보수 실행 중 쌓인 큐도 done 상태에서 순서대로 이어진다", async () => {
    writePipelineState(dir("habit"), doneState());
    mgr.handleFeedback("habit", "첫 수정");
    mgr.handleFeedback("habit", "둘째 수정");
    expect(ex.runs).toHaveLength(1);
    ex.runs[0].finish(); await flush();
    expect(ex.runs).toHaveLength(2);
    expect(ex.runs[1].command).toContain("둘째 수정");
  });
});

describe("exit-0 강등", () => {
  it("프로세스가 끝났는데 stageStatus가 running이면 error로 강등", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "만들어");
    // 스킬이 pipeline.json을 갱신하지 않은 채(running) 종료
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "running", artifacts: {},
    });
    ex.runs[0].finish(); await flush();
    expect(readPipelineState(dir("habit"))!.stageStatus).toBe("error");
  });
  it("취소(reject)로 끝났는데 stageStatus가 running이면 error로 강등(Finding 3)", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "만들어");
    // 실행 도중 running으로 갱신된 채 사용자 취소(reject) — 취소는 자동 재시도 대상이 아니라 error가 유지된다
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "running", artifacts: {},
    });
    mgr.handleMessage({ type: "stage_cancel", project: "habit" });
    await flush();
    expect(readPipelineState(dir("habit"))!.stageStatus).toBe("error");
  });
  it("자동 재시도가 성공하면 host.error가 클리어되어 stage_update가 error로 남지 않는다(Fix 3)", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "awaiting_feedback", artifacts: {},
    });
    // 1차 시도 실패 → 자동 재시도(run 2)가 시작된다
    mgr.handleFeedback("habit", "만들어");
    ex.runs[0].finish(true); await flush();
    expect(ex.runs).toHaveLength(2);

    // 스킬이 정상 종료 상태를 써 둔 것을 흉내낸 뒤 자동 재시도를 성공시킨다
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "awaiting_feedback", artifacts: {},
    });
    ex.runs[1].finish(); await flush();

    expect(readPipelineHostState(dir("habit")).error).toBeNull();
    expect(updates().at(-1)!.pipeline.stageStatus).not.toBe("error");
  });
  it("실패로 끝나면 자동 재시도가 시작돼 error가 아니라 진행 중(starting)으로 보인다(Fix)", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "running", artifacts: {},
    });
    mgr.handleFeedback("habit", "만들어");
    ex.runs[0].finish(true); await flush(); // 실패 → demote(error) → 자동 재시도 run 2
    expect(ex.runs).toHaveLength(2);
    // 자동 재시도가 시작되며 host.error를 지우고 진행 표시로 전이한다
    expect(readPipelineHostState(dir("habit")).error).toBeNull();
    const last = updates().at(-1)!;
    expect(last.pipeline.stageStatus).not.toBe("error");
    expect(last.pipeline.stageStatus).toBe("starting");
  });
});

describe("자동 재시도(오류로 끝나면 이어서 계속)", () => {
  const seedFeedback = () => writePipelineState(dir("habit"), {
    schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
    stage: "develop", stageStatus: "awaiting_feedback", artifacts: {},
  });
  const autoLog = () => sent.find((m) => m.type === "log" && (m as any).text.includes("자동으로 이어서"));

  it("오류로 끝나면 자동으로 같은 단계를 이어서 재시도한다", async () => {
    seedFeedback();
    mgr.handleFeedback("habit", "만들어");   // run 1
    ex.runs[0].finish(true); await flush();  // 실패 → 자동 재시도
    expect(ex.runs).toHaveLength(2);
    expect(ex.runs[1].command).toContain("/pipeline-develop 피드백:");
    expect(autoLog()).toBeTruthy();
  });

  it("연속 상한(AUTO_RETRY_MAX=2)을 넘기면 멈추고 안내한다", async () => {
    seedFeedback();
    mgr.handleFeedback("habit", "만들어");   // run 1
    ex.runs[0].finish(true); await flush();  // → run 2 (자동 1/2)
    ex.runs[1].finish(true); await flush();  // → run 3 (자동 2/2)
    expect(ex.runs).toHaveLength(3);
    ex.runs[2].finish(true); await flush();  // 상한 초과 → 더는 재시도 없음
    expect(ex.runs).toHaveLength(3);
    expect(sent.some((m) => m.type === "log" && (m as any).text.includes("멈췄어요"))).toBe(true);
  });

  it("성공으로 끝나면 자동 재시도하지 않는다", async () => {
    seedFeedback();
    mgr.handleFeedback("habit", "만들어");
    ex.runs[0].finish(); await flush();      // 성공 종료
    expect(ex.runs).toHaveLength(1);
    expect(autoLog()).toBeFalsy();
  });

  it("사용자가 중단하면 자동 재시도하지 않는다", async () => {
    seedFeedback();
    mgr.handleFeedback("habit", "만들어");
    mgr.handleMessage({ type: "stage_cancel", project: "habit" }); // reject(cancelled)
    await flush();
    expect(ex.runs).toHaveLength(1);
    expect(autoLog()).toBeFalsy();
  });
});

describe("rollback / cancel / sync / artifact", () => {
  it("rollback은 이전 단계만 허용, sessionId를 비운다(새 세션)", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleMessage({ type: "stage_rollback", project: "habit", toStage: "prd" });
    expect(readPipelineState(dir("habit"))!.stage).toBe("prd");
    expect(readPipelineHostState(dir("habit")).sessionId).toBeNull();
    expect(ex.runs.at(-1)!.command).toBe("/pipeline-prd");
    // 이후 단계로의 "rollback"은 무시
    mgr.handleMessage({ type: "stage_rollback", project: "habit", toStage: "release" });
    expect(readPipelineState(dir("habit"))!.stage).toBe("prd");
  });
  it("STAGES에 없는 임의 문자열 toStage는 거부하고 stage·실행 모두 변경하지 않는다(Finding 1)", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "awaiting_confirm", artifacts: {},
    });
    const before = readPipelineState(dir("habit"));
    mgr.handleMessage({ type: "stage_rollback", project: "habit", toStage: "garbage" as any });
    expect(readPipelineState(dir("habit"))).toEqual(before);
    expect(ex.runs).toHaveLength(0);
  });
  it("pipeline_sync는 파이프라인 프로젝트 전체 스냅샷을 보낸다", () => {
    mgr.handleMessage({ type: "pipeline_sync" });
    expect(updates().some((u) => u.project === "habit")).toBe(true);
  });
  it("pipeline_sync는 상태 변경 없이도 재접속마다 재전송한다(force emit, Finding 1)", () => {
    mgr.handleMessage({ type: "pipeline_sync" });
    mgr.handleMessage({ type: "pipeline_sync" });
    const habitUpdates = updates().filter((u) => u.project === "habit");
    expect(habitUpdates).toHaveLength(2);
  });
  it("artifact_get은 등록된 .md 산출물만 읽어 보낸다", () => {
    mkdirSync(join(dir("habit"), "docs"), { recursive: true });
    writeFileSync(join(dir("habit"), "docs", "PRD.md"), "# PRD");
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: { prd: "docs/PRD.md" },
    });
    mgr.handleMessage({ type: "artifact_get", project: "habit", key: "prd" });
    const art = sent.find((m) => m.type === "artifact") as any;
    expect(art.content).toBe("# PRD");
    // 미등록 키는 무시
    mgr.handleMessage({ type: "artifact_get", project: "habit", key: "../etc" });
    expect(sent.filter((m) => m.type === "artifact")).toHaveLength(1);
  });
  it("접두사 우회(형제 디렉터리)는 차단한다(Finding 2)", () => {
    // "habit2"는 "habit"과 접두사가 같지만 형제 디렉터리 — 문자열 startsWith만으로는 통과해버림
    mkdirSync(dir("habit2"), { recursive: true });
    writeFileSync(join(dir("habit2"), "secret.md"), "# 비밀");
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: { leak: "../habit2/secret.md" },
    });
    mgr.handleMessage({ type: "artifact_get", project: "habit", key: "leak" });
    expect(sent.filter((m) => m.type === "artifact")).toHaveLength(0);
  });
});

describe("artifact_set", () => {
  it("정상 저장 후 log + artifact 회신, 파일 내용도 갱신된다", () => {
    mkdirSync(join(dir("habit"), "docs"), { recursive: true });
    writeFileSync(join(dir("habit"), "docs", "PRD.md"), "# 원본");
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: { prd: "docs/PRD.md" },
    });
    mgr.handleMessage({ type: "artifact_set", project: "habit", key: "prd", content: "# 수정본" });
    expect(readFileSync(join(dir("habit"), "docs", "PRD.md"), "utf8")).toBe("# 수정본");
    const log = sent.find((m) => m.type === "log") as any;
    expect(log.text).toContain("직접 수정");
    const art = sent.find((m) => m.type === "artifact") as any;
    expect(art.content).toBe("# 수정본");
    expect(art.key).toBe("prd");
  });
  it("실행 중이면 거부하고 파일을 건드리지 않는다", () => {
    mkdirSync(join(dir("habit"), "docs"), { recursive: true });
    writeFileSync(join(dir("habit"), "docs", "PRD.md"), "# 원본");
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "mockup", stageStatus: "awaiting_feedback", artifacts: { prd: "docs/PRD.md" },
    });
    mgr.handleFeedback("habit", "만들어"); // running 진입
    mgr.handleMessage({ type: "artifact_set", project: "habit", key: "prd", content: "# 수정본" });
    expect(readFileSync(join(dir("habit"), "docs", "PRD.md"), "utf8")).toBe("# 원본");
    const log = sent.find((m) => m.type === "log" && (m as any).text.includes("끝난 뒤")) as any;
    expect(log).toBeTruthy();
    expect(sent.filter((m) => m.type === "artifact")).toHaveLength(0);
  });
  it("미등록 키·비md 키는 무시한다", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: { html: "public/index.html" },
    });
    mgr.handleMessage({ type: "artifact_set", project: "habit", key: "missing", content: "x" });
    mgr.handleMessage({ type: "artifact_set", project: "habit", key: "html", content: "x" });
    expect(sent.filter((m) => m.type === "artifact")).toHaveLength(0);
    expect(sent.filter((m) => m.type === "log")).toHaveLength(0);
  });
  it("경로 탈출(접두사 우회 포함)은 무시한다", () => {
    mkdirSync(dir("habit2"), { recursive: true });
    writeFileSync(join(dir("habit2"), "secret.md"), "# 비밀");
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: { leak: "../habit2/secret.md" },
    });
    mgr.handleMessage({ type: "artifact_set", project: "habit", key: "leak", content: "해킹" });
    expect(readFileSync(join(dir("habit2"), "secret.md"), "utf8")).toBe("# 비밀");
    expect(sent.filter((m) => m.type === "artifact")).toHaveLength(0);
  });
});

describe("설문 폼(form_get / form_submit)", () => {
  it("form_get: businessForm(json) 아티팩트를 읽어 form 메시지로 보낸다", () => {
    mkdirSync(join(dir("habit"), "business"), { recursive: true });
    writeFileSync(join(dir("habit"), "business", "form.json"), JSON.stringify({
      title: "비즈니스 모델",
      questions: [{ id: "monetization", label: "수익화", options: [{ value: "banner", label: "배너" }] }],
    }));
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "business", stageStatus: "awaiting_feedback", artifacts: { businessForm: "business/form.json" },
    });
    mgr.handleMessage({ type: "form_get", project: "habit" });
    const form = sent.find((m) => m.type === "form") as any;
    expect(form).toBeTruthy();
    expect(form.schema.questions[0].id).toBe("monetization");
  });

  it("form_submit: answers를 business/answers.json에 저장하고 스킬을 피드백으로 재호출한다", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "business", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleMessage({ type: "form_submit", project: "habit", answers: { monetization: "banner", backend: "local" } });
    const saved = JSON.parse(readFileSync(join(dir("habit"), "business", "answers.json"), "utf8"));
    expect(saved).toEqual({ monetization: "banner", backend: "local" });
    expect(ex.runs).toHaveLength(1);
    expect(ex.runs[0].command).toContain("/pipeline-business 피드백:");
  });

  it("form_submit: business 단계가 아니면 무시한다", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleMessage({ type: "form_submit", project: "habit", answers: { x: "y" } });
    expect(ex.runs).toHaveLength(0);
  });
});

describe("watcher", () => {
  it("pipeline.json이 외부(스킬)에서 바뀌면 stage_update가 발신된다", async () => {
    mgr.attachWatcher("habit");
    await new Promise((r) => setTimeout(r, 50));
    sent.length = 0;
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "ideation", stageStatus: "awaiting_confirm", artifacts: { ideas: "IDEAS.md" },
    });
    await new Promise((r) => setTimeout(r, 400)); // 디바운스 대기
    const u = updates();
    expect(u.length).toBeGreaterThanOrEqual(1);
    expect(u.at(-1).pipeline.stageStatus).toBe("awaiting_confirm");
  });
  it("같은 내용 재기록은 중복 발신하지 않는다", async () => {
    mgr.attachWatcher("habit");
    await new Promise((r) => setTimeout(r, 50));
    const s = readPipelineState(dir("habit"))!;
    writePipelineState(dir("habit"), s);
    await new Promise((r) => setTimeout(r, 400));
    const count = updates().length;
    writePipelineState(dir("habit"), s);
    await new Promise((r) => setTimeout(r, 400));
    expect(updates().length).toBe(count);
  });
  it("recoverStaleRuns: 실행 핸들 없이 running이면 error로 강등한다", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "running", artifacts: {},
    });
    mgr.recoverStaleRuns();
    expect(readPipelineState(dir("habit"))?.stageStatus).toBe("error");
    expect(readPipelineHostState(dir("habit")).error).toMatch(/끊겼/);
    const log = sent.find((m) => m.type === "log" && String((m as { text?: string }).text).includes("끊긴"));
    expect(log).toBeTruthy();
  });

  it("startIfPending: pending이면 첫 단계를 시작한다", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "development", steps: DEFAULT_STEPS,
      stage: "develop", stageStatus: "pending", artifacts: {},
    });
    mgr.startIfPending("habit", "피드백: 시작");
    expect(ex.runs).toHaveLength(1);
    expect(ex.runs[0].command).toContain("/pipeline-develop");
    expect(readPipelineState(dir("habit"))?.stageStatus).toBe("starting");
  });

  it("같은 프로젝트에 attachWatcher를 2번 호출해도 워처가 중복 등록되지 않는다(멱등)", async () => {
    mgr.attachWatcher("habit");
    mgr.attachWatcher("habit");
    // 내부 워처 목록(project→watcher Map) 자체가 1개여야 한다(emitUpdate의 내용 기반 dedup에 가려지지 않는 직접 증거).
    expect((mgr as any).watchers.size).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    sent.length = 0;
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "ideation", stageStatus: "awaiting_confirm", artifacts: { ideas: "IDEAS.md" },
    });
    await new Promise((r) => setTimeout(r, 400)); // 디바운스 대기
    expect(updates()).toHaveLength(1); // 워처가 중복이면 stage_update도 2건 이상 발신됨
  });
  it("watch 이벤트 직후 stop()하면 디바운스/재시도 타이머가 발화하지 않는다(Finding 2)", async () => {
    mgr.attachWatcher("habit");
    await new Promise((r) => setTimeout(r, 50));
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "ideation", stageStatus: "awaiting_confirm", artifacts: { ideas: "IDEAS.md" },
    });
    mgr.stop(); // 디바운스(150ms) 발화 전에 정지 — 남은 타이머가 닫힌 소켓에 send하면 안 됨
    const countAtStop = sent.length;
    await new Promise((r) => setTimeout(r, 500));
    expect(sent.length).toBe(countAtStop);
  });
  it("detachWatcher 후 지연 타이머 실행을 방지한다(Fix 2)", async () => {
    mgr.attachWatcher("habit");
    await new Promise((r) => setTimeout(r, 50));
    // 파일 write로 디바운스 타이머 예약 (150ms 타임아웃)
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "ideation", stageStatus: "awaiting_confirm", artifacts: { ideas: "IDEAS.md" },
    });
    // 디바운스 발화 전(150ms) 즉시 detach — readAndEmit의 !this.watched.has(project) 가드를 시험한다
    mgr.detachWatcher("habit");
    sent.length = 0;
    // 디바운스 타이머 발화 대기 (400ms > 150ms 디바운스)
    await new Promise((r) => setTimeout(r, 400));
    // 가드가 없으면 stage_update가 발신되어 이 assert가 실패한다
    expect(updates()).toHaveLength(0);
  });
});

describe("isRunning / detachWatcher", () => {
  it("실행 중이면 true, 완료 후 false", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "mockup", stageStatus: "awaiting_feedback", artifacts: {},
    });
    expect(mgr.isRunning("habit")).toBe(false);
    mgr.handleFeedback("habit", "만들어");
    expect(mgr.isRunning("habit")).toBe(true);
    ex.runs[0].finish(); await flush();
    expect(mgr.isRunning("habit")).toBe(false);
  });
});

describe("단계 타임아웃(스펙 §8)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("상한(mockup=20분)을 초과하면 handle.cancel()을 호출하고 host error를 기록한다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "mockup", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "만들어");
    expect(ex.runs[0].cancelled).toBe(false);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(ex.runs[0].cancelled).toBe(true);
    // done 거부 후 catch·finally 블록 실행 대기 (fake timer와 마이크로태스크 소화)
    await vi.advanceTimersByTimeAsync(0);
    // 타임아웃 후 정리 경로 검증
    expect(mgr.isRunning("habit")).toBe(false);
    expect(readPipelineHostState(dir("habit")).error).toBe("mockup 단계가 제한 시간을 초과했어요");
    // stage_update가 타임아웃 에러와 함께 발신됨
    expect(updates().some((u) => u.project === "habit")).toBe(true);
  });

  it("상한 이전에 정상 완료되면 타임아웃이 발화하지 않고 error가 남지 않는다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "mockup", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "만들어");
    ex.runs[0].finish();
    await vi.advanceTimersByTimeAsync(0); // done 체인(finally의 clearTimeout 포함) 소화
    expect(readPipelineHostState(dir("habit")).error).toBeNull();
    // 상한을 훨씬 지나도(타이머가 이미 clear됨) 취소되지 않는다
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(ex.runs[0].cancelled).toBe(false);
    expect(readPipelineHostState(dir("habit")).error).toBeNull();
  });

  it("stop() 호출 시 타임아웃 타이머가 정리되어(clear) 이후 시간이 지나도 발화하지 않는다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 2, project: "habit", createdAt: "t", template: "default", steps: DEFAULT_STEPS,
      stage: "mockup", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "만들어");
    mgr.stop(); // running 정리는 stop()이 직접 handle.cancel()도 호출하지만, 타이머 자체는 clear되어야 함
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    // 타임아웃 타이머가 살아있었다면 이 문구가 host error로 남는다 — 없어야 정리됐다는 증거
    expect(readPipelineHostState(dir("habit")).error).not.toBe("mockup 단계가 제한 시간을 초과했어요");
  });
});
