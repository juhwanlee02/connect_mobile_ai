import { describe, it, expect } from "vitest";
import {
  nextStage, isPriorStage, validatePipelineState,
  kebabToSnake, mergeSnapshot, type PipelineState,
  DEFAULT_STEPS, RESERVED_STEP_IDS, validateSteps, stepTimeoutMs,
} from "../../src/shared/pipeline.js";

// v2 fixture: PipelineState 타입이 요구하는 template/steps를 포함(mergeSnapshot 등 강타입 호출부용)
const valid: PipelineState = {
  schemaVersion: 2, project: "habit-tracker",
  createdAt: "2026-07-04T00:00:00Z", template: "default", steps: DEFAULT_STEPS,
  stage: "mockup", stageStatus: "awaiting_confirm", artifacts: { prd: "docs/PRD.md" },
};

// v1 런타임 JSON fixture: validatePipelineState의 v1→v2 승격 경로 검증 전용(그대로 유지)
const validV1 = {
  schemaVersion: 1, project: "habit-tracker",
  createdAt: "2026-07-04T00:00:00Z",
  stage: "mockup", stageStatus: "awaiting_confirm", artifacts: { prd: "docs/PRD.md" },
};

describe("validatePipelineState", () => {
  it("유효한 v1 상태를 승격해 통과시킨다(핵심 필드 보존)", () => {
    const out = validatePipelineState(validV1)!;
    expect(out.project).toBe(validV1.project);
    expect(out.stage).toBe(validV1.stage);
    expect(out.artifacts).toEqual(validV1.artifacts);
  });
  it("stage/stageStatus enum 위반·필드 누락·비객체는 null", () => {
    expect(validatePipelineState({ ...valid, stage: "banana" })).toBeNull();
    expect(validatePipelineState({ ...valid, stageStatus: "??" })).toBeNull();
    const { artifacts: _drop, ...noArtifacts } = valid;
    expect(validatePipelineState(noArtifacts)).toBeNull();
    expect(validatePipelineState("문자열")).toBeNull();
    expect(validatePipelineState(null)).toBeNull();
  });
});

describe("kebabToSnake", () => {
  it("하이픈을 언더스코어로", () => {
    expect(kebabToSnake("habit-edit")).toBe("habit_edit");
    expect(kebabToSnake("home")).toBe("home");
  });
});

describe("mergeSnapshot", () => {
  it("state+host+queueLength를 병합하고 host error가 running을 이긴다", () => {
    const snap = mergeSnapshot(
      { ...valid, stageStatus: "running" },
      { sessionId: "s1", history: [], error: "터짐" },
      2,
    );
    expect(snap.stageStatus).toBe("error");
    expect(snap.sessionId).toBe("s1");
    expect(snap.queueLength).toBe(2);
  });
  it("host error가 없으면 스킬 stageStatus 유지", () => {
    expect(mergeSnapshot(valid, { sessionId: null, history: [], error: null }, 0)
      .stageStatus).toBe("awaiting_confirm");
  });
});

const customSteps = [
  { id: "ideation", label: "아이디어", kind: "builtin" as const, timeoutMin: 15 },
  { id: "competitor", label: "경쟁사 분석", kind: "custom" as const, timeoutMin: 30 },
  { id: "release", label: "릴리즈", kind: "builtin" as const, timeoutMin: 60 },
];

describe("DEFAULT_STEPS", () => {
  it("9종 builtin, 예약 id·타임아웃이 스펙과 일치", () => {
    expect(DEFAULT_STEPS.map((s) => s.id)).toEqual([
      "ideation", "wireframe", "business", "prd", "mockup", "estimate", "develop", "test", "release",
    ]);
    expect(RESERVED_STEP_IDS).toEqual(DEFAULT_STEPS.map((s) => s.id));
    expect(DEFAULT_STEPS.every((s) => s.kind === "builtin")).toBe(true);
    expect(DEFAULT_STEPS.find((s) => s.id === "develop")!.timeoutMin).toBe(60);
  });
});

describe("nextStage / isPriorStage / stepTimeoutMs (동적 스텝)", () => {
  it("스텝 순서대로 전진, 마지막 다음은 done, done 다음은 null", () => {
    expect(nextStage(customSteps, "ideation")).toBe("competitor");
    expect(nextStage(customSteps, "release")).toBe("done");
    expect(nextStage(customSteps, "done")).toBeNull();
    expect(nextStage(customSteps, "garbage")).toBeNull();
  });
  it("isPriorStage: 목록 내 이전 스텝만 true", () => {
    expect(isPriorStage(customSteps, "ideation", "release")).toBe(true);
    expect(isPriorStage(customSteps, "release", "release")).toBe(false);
    expect(isPriorStage(customSteps, "garbage", "release")).toBe(false);
    expect(isPriorStage(customSteps, "ideation", "done")).toBe(true);
  });
  it("stepTimeoutMs: 스텝별 분→ms, 미발견은 20분 폴백", () => {
    expect(stepTimeoutMs(customSteps, "competitor")).toBe(30 * 60_000);
    expect(stepTimeoutMs(customSteps, "garbage")).toBe(20 * 60_000);
  });
});

describe("validateSteps", () => {
  it("정상 배열 통과, 빈 배열·필드 누락·kind 위반은 null", () => {
    expect(validateSteps(customSteps)).toEqual(customSteps);
    expect(validateSteps([])).toBeNull();
    expect(validateSteps([{ id: "x", label: "y", kind: "weird", timeoutMin: 5 }])).toBeNull();
    expect(validateSteps([{ id: "x", kind: "custom", timeoutMin: 5 }])).toBeNull();
    expect(validateSteps("no")).toBeNull();
  });
});

describe("validatePipelineState v1→v2 승격", () => {
  it("v1 입력이면 DEFAULT_STEPS·template=default를 채워 돌려준다", () => {
    const out = validatePipelineState(validV1)!; // validV1은 파일 상단의 v1 런타임 fixture
    expect(out.steps).toEqual(DEFAULT_STEPS);
    expect(out.template).toBe("default");
    expect(out.stage).toBe("mockup");
  });
  it("v2는 steps를 검증해 통과시키고, steps가 비면 null", () => {
    const v2 = {
      schemaVersion: 2, project: "p", createdAt: "2026-07-11T00:00:00Z",
      template: "my-fork", steps: customSteps,
      stage: "competitor", stageStatus: "running", artifacts: {},
    };
    expect(validatePipelineState(v2)!.steps).toEqual(customSteps);
    expect(validatePipelineState({ ...v2, steps: [] })).toBeNull();
    // v2에서 stage는 steps 안이거나 done이어야 한다
    expect(validatePipelineState({ ...v2, stage: "banana" })).toBeNull();
  });
});
