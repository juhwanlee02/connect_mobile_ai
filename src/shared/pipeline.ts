// 파이프라인 도메인: 단계 순서·상태 enum·검증·병합. I/O 없음(순수 함수만).
export const STAGES = [
  "ideation", "wireframe", "business", "prd", "mockup", "estimate", "develop", "test", "release",
] as const;
export type PipelineStage = (typeof STAGES)[number];
export type Stage = string; // 동적 스텝 id 또는 "done"

// 스텝 정의(v2): 파이프라인은 이제 프로젝트별 steps 배열이 정본이다.
// DEFAULT_STEPS는 기본 템플릿의 정의이자 v1 pipeline.json 승격 소스.
export interface StepDef {
  id: string;
  label: string;
  kind: "builtin" | "custom";
  timeoutMin: number;
}

// 단계별 상한(분) — 스펙 §8: 초과 시 프로세스 그룹 킬 + error(host)
export const DEFAULT_STEPS: StepDef[] = STAGES.map((id) => ({
  id,
  label: (
    {
      ideation: "아이디어", wireframe: "구조", business: "비즈니스 모델", prd: "PRD",
      mockup: "목업", estimate: "산정", develop: "개발", test: "테스트", release: "릴리즈",
    } as Record<string, string>
  )[id],
  kind: "builtin",
  timeoutMin: (
    { ideation: 15, wireframe: 10, business: 10, prd: 15, mockup: 20, estimate: 15, develop: 60, test: 30, release: 60 } as Record<string, number>
  )[id],
}));

// custom 스텝이 쓸 수 없는 예약 id(빌트인 프롬프트와의 충돌 방지)
export const RESERVED_STEP_IDS: string[] = DEFAULT_STEPS.map((s) => s.id);

export function validateSteps(v: unknown): StepDef[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: StepDef[] = [];
  for (const s of v) {
    if (typeof s !== "object" || s === null) return null;
    const o = s as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.label !== "string") return null;
    if (o.kind !== "builtin" && o.kind !== "custom") return null;
    if (typeof o.timeoutMin !== "number" || !(o.timeoutMin > 0)) return null;
    out.push({ id: o.id, label: o.label, kind: o.kind, timeoutMin: o.timeoutMin });
  }
  return out;
}

// steps 기반 전이 함수들(구 STAGES 기반 시그니처를 대체)
export function nextStage(steps: StepDef[], stage: string): string | null {
  if (stage === "done") return null;
  const i = steps.findIndex((s) => s.id === stage);
  if (i === -1) return null;
  return i === steps.length - 1 ? "done" : steps[i + 1].id;
}

export function isPriorStage(steps: StepDef[], target: string, current: string): boolean {
  const ti = steps.findIndex((s) => s.id === target);
  if (ti === -1) return false;
  if (current === "done") return true;
  const ci = steps.findIndex((s) => s.id === current);
  return ci !== -1 && ti < ci;
}

export function stepTimeoutMs(steps: StepDef[], stage: string): number {
  const s = steps.find((x) => x.id === stage);
  return (s ? s.timeoutMin : 20) * 60_000;
}

export const STAGE_STATUSES = [
  "pending", "starting", "running", "awaiting_feedback", "awaiting_confirm", "error",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

// 스킬(Claude)이 쓰는 파일: projects/<name>/pipeline.json
// v2: template/steps 추가. v1 파일은 validatePipelineState가 읽기 시 승격한다.
export interface PipelineState {
  schemaVersion: 1 | 2;
  project: string;
  createdAt: string;
  template: string;
  steps: StepDef[];
  stage: Stage;
  stageStatus: StageStatus;
  artifacts: Record<string, string>;
}

export interface HistoryEntry {
  stage: string;
  confirmedAt: string;
  durationMs?: number;
  costUsd?: number;
}

// host가 쓰는 파일: projects/<name>/pipeline.host.json (이중 작성자 방지용 분리)
export interface PipelineHostState {
  sessionId: string | null;
  history: HistoryEntry[];
  error: string | null;
}

// 폰으로 보내는 병합 뷰
export interface PipelineSnapshot extends PipelineState {
  sessionId: string | null;
  history: HistoryEntry[];
  error: string | null;
  queueLength: number;
  // 투명성(실사용 피드백: "뭐가 돌고 있고 뭐가 대기 중인지 안 보인다"):
  // 지금 실행 중인 명령의 요약 한 줄과, 대기 큐에 쌓인 메시지 미리보기 목록.
  runningText?: string | null;
  queued?: string[];
}

export function validatePipelineState(v: unknown): PipelineState | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== 1 && o.schemaVersion !== 2) return null;
  if (typeof o.project !== "string" || typeof o.createdAt !== "string") return null;
  if (!STAGE_STATUSES.includes(o.stageStatus as StageStatus)) return null;
  if (typeof o.artifacts !== "object" || o.artifacts === null) return null;
  for (const val of Object.values(o.artifacts as object)) {
    if (typeof val !== "string") return null;
  }
  // v1: 기본 7종으로 승격(파일은 그대로 — 다음 쓰기 때 자연히 v2가 됨)
  const steps = o.schemaVersion === 1 ? DEFAULT_STEPS : validateSteps(o.steps);
  if (!steps) return null;
  const stageOk =
    o.stage === "done" || steps.some((s) => s.id === o.stage);
  if (!stageOk) return null;
  return {
    schemaVersion: o.schemaVersion,
    project: o.project,
    createdAt: o.createdAt,
    template: typeof o.template === "string" ? o.template : "default",
    steps,
    stage: o.stage as Stage,
    stageStatus: o.stageStatus as StageStatus,
    artifacts: o.artifacts as Record<string, string>,
  };
}

// 화면 ID(kebab, 정본) → Dart 파일/식별자(snake) 기계적 변환
export function kebabToSnake(id: string): string {
  return id.replace(/-/g, "_");
}

// 병합 규칙(스펙 §3): host error가 스킬 stageStatus보다 우선
export function mergeSnapshot(
  state: PipelineState,
  host: PipelineHostState,
  queueLength: number,
): PipelineSnapshot {
  return {
    ...state,
    stageStatus: host.error !== null ? "error" : state.stageStatus,
    sessionId: host.sessionId,
    history: host.history,
    error: host.error,
    queueLength,
  };
}
