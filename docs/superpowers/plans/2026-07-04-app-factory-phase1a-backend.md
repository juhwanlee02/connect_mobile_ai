# 앱 팩토리 Phase 1A — 백엔드 뼈대 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파이프라인 상태 원장(pipeline.json)·상태머신·프로토콜·실행기 개편까지, 폰 UI 없이도 테스트로 완전히 검증되는 백엔드 뼈대를 만든다.

**Architecture:** 스킬(Claude)이 쓰는 `pipeline.json`과 host가 쓰는 `pipeline.host.json`을 분리하고(이중 작성자 제거), host가 디렉터리 watch → 검증 → `stage_update` 발신을 전담한다. 릴레이는 forward만 유지. executor는 취소 핸들·세션ID·비용을 반환하도록 개편한다.

**Tech Stack:** TypeScript(ESM, import 경로 `.js` 확장자 필수), Node 20, vitest, `ws`, `cross-spawn`. **새 의존성 추가 금지**(watch는 `node:fs`의 `fs.watch` 디렉터리 단위).

**스펙:** `docs/superpowers/specs/2026-07-04-app-factory-pipeline-design.md` — 이 계획은 스펙 §10의 MVP 1번(뼈대)만 다룬다. 폰 UI(Phase 1B), 문서 템플릿 5종(Phase 2), Flutter 템플릿(Phase 3), 단계 스킬 7종(Phase 4), 릴리즈 연결·쿠키 인증·페어링 안정화(Phase 5)는 후속 계획.

## Global Constraints

- 단계 순서 고정: `ideation → prd → mockup → estimate → develop → test → release → done`
- stageStatus 값: `pending | starting | running | awaiting_feedback | awaiting_confirm | error`
- 필드 소유권: 스킬은 `pipeline.json`(stage/stageStatus/artifacts)만, host는 `pipeline.host.json`(sessionId/history/error)만. 예외: **스킬 프로세스 비실행 중의 모든 전이는 host가 pipeline.json에 쓴다**
- 모든 JSON 쓰기는 temp 파일 + `renameSync` (원자적)
- 동시성: 프로젝트 간 병렬, 같은 프로젝트 내 동시 1개 + 큐. confirm은 큐 우회, stage 전환 시 잔여 큐 flush
- 완료 감지: 프로세스 exit는 2차 신호 — exit 0인데 stageStatus가 starting/running이면 error로 강등
- 파이프라인 프로젝트에는 `targetSystemPrompt` 주입 금지
- 기존 웹앱 모드(비파이프라인 프로젝트)의 동작·테스트는 깨지 않는다
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 파이프라인 도메인 모듈 (`src/shared/pipeline.ts`)

**Files:**
- Create: `src/shared/pipeline.ts`
- Test: `tests/shared/pipeline.test.ts`

**Interfaces:**
- Consumes: 없음 (최하층)
- Produces: `STAGES`, `Stage`, `StageStatus`, `PipelineState`, `PipelineHostState`, `HistoryEntry`, `PipelineSnapshot`, `nextStage(stage: Stage): Stage | null`, `isPriorStage(target: Stage, current: Stage): boolean`, `validatePipelineState(v: unknown): PipelineState | null`, `kebabToSnake(id: string): string`, `mergeSnapshot(state, host, queueLength): PipelineSnapshot`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/shared/pipeline.test.ts
import { describe, it, expect } from "vitest";
import {
  STAGES, nextStage, isPriorStage, validatePipelineState,
  kebabToSnake, mergeSnapshot, type PipelineState,
} from "../../src/shared/pipeline.js";

const valid: PipelineState = {
  schemaVersion: 1, project: "habit-tracker",
  createdAt: "2026-07-04T00:00:00Z",
  stage: "mockup", stageStatus: "awaiting_confirm", artifacts: { prd: "docs/PRD.md" },
};

describe("nextStage", () => {
  it("단계를 순서대로 전진하고 release 다음은 done, done 다음은 null", () => {
    expect(nextStage("ideation")).toBe("prd");
    expect(nextStage("release")).toBe("done");
    expect(nextStage("done")).toBeNull();
  });
});

describe("isPriorStage", () => {
  it("이전 단계만 true (자기 자신·이후는 false)", () => {
    expect(isPriorStage("prd", "develop")).toBe(true);
    expect(isPriorStage("develop", "develop")).toBe(false);
    expect(isPriorStage("test", "develop")).toBe(false);
  });
});

describe("validatePipelineState", () => {
  it("유효한 상태를 통과시킨다", () => {
    expect(validatePipelineState(valid)).toEqual(valid);
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
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/shared/pipeline.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/pipeline.js'`

- [ ] **Step 3: 구현**

```ts
// src/shared/pipeline.ts
// 파이프라인 도메인: 단계 순서·상태 enum·검증·병합. I/O 없음(순수 함수만).
export const STAGES = [
  "ideation", "prd", "mockup", "estimate", "develop", "test", "release",
] as const;
export type PipelineStage = (typeof STAGES)[number];
export type Stage = PipelineStage | "done";

export const STAGE_STATUSES = [
  "pending", "starting", "running", "awaiting_feedback", "awaiting_confirm", "error",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

// 스킬(Claude)이 쓰는 파일: projects/<name>/pipeline.json
export interface PipelineState {
  schemaVersion: 1;
  project: string;
  createdAt: string;
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
}

export function nextStage(stage: Stage): Stage | null {
  if (stage === "done") return null;
  const i = STAGES.indexOf(stage as PipelineStage);
  return i === STAGES.length - 1 ? "done" : STAGES[i + 1];
}

export function isPriorStage(target: Stage, current: Stage): boolean {
  if (target === "done" || current === "done") return current === "done" && target !== "done";
  return STAGES.indexOf(target as PipelineStage) < STAGES.indexOf(current as PipelineStage);
}

export function validatePipelineState(v: unknown): PipelineState | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  if (typeof o.project !== "string" || typeof o.createdAt !== "string") return null;
  const stageOk = o.stage === "done" || STAGES.includes(o.stage as PipelineStage);
  if (!stageOk) return null;
  if (!STAGE_STATUSES.includes(o.stageStatus as StageStatus)) return null;
  if (typeof o.artifacts !== "object" || o.artifacts === null) return null;
  for (const val of Object.values(o.artifacts as object)) {
    if (typeof val !== "string") return null;
  }
  return {
    schemaVersion: 1,
    project: o.project,
    createdAt: o.createdAt,
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
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/shared/pipeline.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add src/shared/pipeline.ts tests/shared/pipeline.test.ts
git commit -m "feat: pipeline domain module (stages, validation, snapshot merge)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 원자적 상태 저장소 (`src/cli/pipeline-store.ts`)

**Files:**
- Create: `src/cli/pipeline-store.ts`
- Test: `tests/cli/pipeline-store.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PipelineState`, `PipelineHostState`, `validatePipelineState`
- Produces: `pipelineStatePath(dir: string): string`, `hasPipeline(dir: string): boolean`, `seedPipelineState(dir: string, project: string, nowIso: string): PipelineState`, `readPipelineState(dir: string): PipelineState | null`, `writePipelineState(dir: string, s: PipelineState): void`, `readPipelineHostState(dir: string): PipelineHostState`, `writePipelineHostState(dir: string, h: PipelineHostState): void`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/cli/pipeline-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  seedPipelineState, readPipelineState, writePipelineState,
  readPipelineHostState, writePipelineHostState, hasPipeline, pipelineStatePath,
} from "../../src/cli/pipeline-store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pipe-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("seed/read", () => {
  it("시드는 ideation/pending으로 생성되고 다시 읽힌다", () => {
    const s = seedPipelineState(dir, "habit-tracker", "2026-07-04T00:00:00Z");
    expect(s.stage).toBe("ideation");
    expect(s.stageStatus).toBe("pending");
    expect(hasPipeline(dir)).toBe(true);
    expect(readPipelineState(dir)).toEqual(s);
  });
  it("파일 없음·깨진 JSON·스키마 위반은 null", () => {
    expect(readPipelineState(dir)).toBeNull();
    writeFileSync(pipelineStatePath(dir), "{잘림");
    expect(readPipelineState(dir)).toBeNull();
    writeFileSync(pipelineStatePath(dir), JSON.stringify({ schemaVersion: 1 }));
    expect(readPipelineState(dir)).toBeNull();
  });
});

describe("원자적 쓰기", () => {
  it("쓰기 후 temp 파일이 남지 않는다", () => {
    const s = seedPipelineState(dir, "p", "2026-07-04T00:00:00Z");
    writePipelineState(dir, { ...s, stageStatus: "starting" });
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(readPipelineState(dir)?.stageStatus).toBe("starting");
  });
});

describe("host state", () => {
  it("없으면 기본값, 쓰면 읽힌다", () => {
    expect(readPipelineHostState(dir)).toEqual({ sessionId: null, history: [], error: null });
    writePipelineHostState(dir, { sessionId: "s1", history: [{ stage: "ideation", confirmedAt: "t" }], error: null });
    expect(readPipelineHostState(dir).sessionId).toBe("s1");
    expect(readPipelineHostState(dir).history).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/cli/pipeline-store.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// src/cli/pipeline-store.ts
// pipeline.json(스킬 소유) / pipeline.host.json(host 소유) 읽기·원자적 쓰기.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  validatePipelineState,
  type PipelineHostState, type PipelineState,
} from "../shared/pipeline.js";

export function pipelineStatePath(dir: string): string {
  return join(dir, "pipeline.json");
}
export function pipelineHostStatePath(dir: string): string {
  return join(dir, "pipeline.host.json");
}
export function hasPipeline(dir: string): boolean {
  return existsSync(pipelineStatePath(dir));
}

// 원자적 쓰기: 같은 디렉터리에 temp를 만들고 rename (cross-device 회피)
function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, path);
}

export function seedPipelineState(
  dir: string, project: string, nowIso: string,
): PipelineState {
  const state: PipelineState = {
    schemaVersion: 1, project, createdAt: nowIso,
    stage: "ideation", stageStatus: "pending", artifacts: {},
  };
  atomicWriteJson(pipelineStatePath(dir), state);
  return state;
}

export function readPipelineState(dir: string): PipelineState | null {
  try {
    return validatePipelineState(JSON.parse(readFileSync(pipelineStatePath(dir), "utf8")));
  } catch {
    return null;
  }
}

export function writePipelineState(dir: string, s: PipelineState): void {
  atomicWriteJson(pipelineStatePath(dir), s);
}

export function readPipelineHostState(dir: string): PipelineHostState {
  try {
    const o = JSON.parse(readFileSync(pipelineHostStatePath(dir), "utf8"));
    return {
      sessionId: typeof o.sessionId === "string" ? o.sessionId : null,
      history: Array.isArray(o.history) ? o.history : [],
      error: typeof o.error === "string" ? o.error : null,
    };
  } catch {
    return { sessionId: null, history: [], error: null };
  }
}

export function writePipelineHostState(dir: string, h: PipelineHostState): void {
  atomicWriteJson(pipelineHostStatePath(dir), h);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/cli/pipeline-store.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/cli/pipeline-store.ts tests/cli/pipeline-store.test.ts
git commit -m "feat: atomic pipeline state store (skill/host file split)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: stream-json에서 세션ID·비용 추출

**Files:**
- Modify: `src/cli/stream-json.ts` (전체 25줄 — 아래로 교체)
- Test: `tests/cli/stream-json.test.ts` (기존 파일에 테스트 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `AgentEvent`가 유니언으로 확장 — `{ role: "assistant" | "log"; text: string } | { role: "session"; sessionId: string } | { role: "result"; costUsd: number }`. 기존 소비자(agent.ts)는 Task 4에서 새 role을 무시하도록 수정.

- [ ] **Step 1: 실패하는 테스트 추가** (기존 `tests/cli/stream-json.test.ts` 맨 아래에)

```ts
describe("session/result 추출", () => {
  it("system.init 줄에서 session_id 이벤트를 낸다", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "abc-123" });
    expect(parseStreamJsonLine(line)).toEqual([{ role: "session", sessionId: "abc-123" }]);
  });
  it("result 줄에서 total_cost_usd 이벤트를 낸다", () => {
    const line = JSON.stringify({ type: "result", total_cost_usd: 1.84 });
    expect(parseStreamJsonLine(line)).toEqual([{ role: "result", costUsd: 1.84 }]);
  });
  it("cost 없는 result·session_id 없는 init은 빈 배열", () => {
    expect(parseStreamJsonLine(JSON.stringify({ type: "result" }))).toEqual([]);
    expect(parseStreamJsonLine(JSON.stringify({ type: "system", subtype: "init" }))).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/cli/stream-json.test.ts`
Expected: 새 3개 케이스 FAIL, 기존 케이스 PASS

- [ ] **Step 3: 구현** (`src/cli/stream-json.ts` 전체 교체)

```ts
export type AgentEvent =
  | { role: "assistant" | "log"; text: string }
  | { role: "session"; sessionId: string }
  | { role: "result"; costUsd: number };

// Claude Code의 stream-json 출력 한 줄을 이벤트로 변환(파싱 실패/무관 줄은 빈 배열).
export function parseStreamJsonLine(line: string): AgentEvent[] {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }
  if (obj?.type === "system" && obj.subtype === "init" && typeof obj.session_id === "string") {
    return [{ role: "session", sessionId: obj.session_id }];
  }
  if (obj?.type === "result" && typeof obj.total_cost_usd === "number") {
    return [{ role: "result", costUsd: obj.total_cost_usd }];
  }
  if (obj?.type !== "assistant" || !Array.isArray(obj.message?.content)) return [];
  const out: AgentEvent[] = [];
  for (const block of obj.message.content) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      out.push({ role: "assistant", text: block.text.trim() });
    } else if (block?.type === "tool_use" && block.name) {
      out.push({ role: "log", text: `🔧 ${block.name}` });
    }
  }
  return out;
}
```

- [ ] **Step 4: 전체 테스트 통과 확인** (기존 소비자 회귀 포함)

Run: `npx vitest run`
Expected: 전부 PASS — agent.ts는 `e.role === "assistant"` 분기라 session/result가 log로 새는 문제는 Task 4에서 처리하지만, 현 시점에서는 타입 오류가 없어야 함. 만약 `tsc` 오류가 나면 agent.ts의 분기를 `e.role === "assistant" ? ... : e.role === "log" ? ... : null` 식으로 좁히는 대신 Task 4를 먼저 확인하지 말고, agent.ts에 임시로 `if (e.role !== "assistant" && e.role !== "log") return;` 가드를 추가한다(Task 4에서 정식 교체됨).

- [ ] **Step 5: 커밋**

```bash
git add src/cli/stream-json.ts tests/cli/stream-json.test.ts src/cli/agent.ts
git commit -m "feat: extract session_id and cost from stream-json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Executor 개편 — 취소 핸들 · `--resume` · 결과 반환

**Files:**
- Modify: `src/cli/executor.ts` (전체 교체)
- Modify: `src/cli/agent.ts` (호출부 — `.done` 사용, 새 role 무시)
- Test: `tests/cli/executor.test.ts` (신규), `tests/cli/agent.test.ts`·`tests/cli/host.test.ts`의 Fake executor 시그니처 갱신

**Interfaces:**
- Consumes: Task 3의 `AgentEvent`
- Produces:
  ```ts
  export interface RunOpts {
    continueSession: boolean;      // 레거시 웹앱 모드용
    resumeSessionId?: string;      // 파이프라인 모드: --resume <id>
    onEvent: (e: AgentEvent) => void;
    systemPrompt?: string;
  }
  export interface RunResult { sessionId?: string; costUsd?: number }
  export interface RunHandle { done: Promise<RunResult>; cancel: () => void }
  export interface Executor { run(command: string, opts: RunOpts): RunHandle }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/cli/executor.test.ts
import { describe, it, expect } from "vitest";
import { RealExecutor } from "../../src/cli/executor.js";

// RealExecutor의 명령 조립만 검증한다(claude 실제 실행 없이).
// exec를 오버라이드해 args를 캡처하는 서브클래스 패턴.
class CaptureExecutor extends RealExecutor {
  captured: string[][] = [];
  protected override exec(_cmd: string, args: string[]): { done: Promise<void>; cancel: () => void } {
    this.captured.push(args);
    return { done: Promise.resolve(), cancel: () => {} };
  }
}

describe("RealExecutor 인자 조립", () => {
  it("resumeSessionId가 있으면 --resume <id>, --continue는 붙지 않는다", async () => {
    const ex = new CaptureExecutor("/tmp");
    await ex.run("cmd", { continueSession: true, resumeSessionId: "sid-1", onEvent: () => {} }).done;
    const args = ex.captured[0];
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sid-1");
    expect(args).not.toContain("--continue");
  });
  it("resumeSessionId 없이 continueSession이면 --continue", async () => {
    const ex = new CaptureExecutor("/tmp");
    await ex.run("cmd", { continueSession: true, onEvent: () => {} }).done;
    expect(ex.captured[0]).toContain("--continue");
  });
  it("run 결과에 이벤트로 받은 sessionId/costUsd가 담긴다", async () => {
    class EventExecutor extends CaptureExecutor {
      protected override exec(_c: string, _a: string[], onLine?: (l: string) => void) {
        onLine?.(JSON.stringify({ type: "system", subtype: "init", session_id: "sid-9" }));
        onLine?.(JSON.stringify({ type: "result", total_cost_usd: 0.5 }));
        return { done: Promise.resolve(), cancel: () => {} };
      }
    }
    const ex = new EventExecutor("/tmp");
    const result = await ex.run("cmd", { continueSession: false, onEvent: () => {} }).done;
    expect(result.sessionId).toBe("sid-9");
    expect(result.costUsd).toBe(0.5);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/cli/executor.test.ts`
Expected: FAIL — `exec` 시그니처·`RunHandle` 미존재

- [ ] **Step 3: 구현** (`src/cli/executor.ts` 전체 교체)

```ts
import spawn from "cross-spawn";
import { parseStreamJsonLine, type AgentEvent } from "./stream-json.js";

export interface RunOpts {
  continueSession: boolean;
  resumeSessionId?: string;
  onEvent: (e: AgentEvent) => void;
  systemPrompt?: string;
}
export interface RunResult { sessionId?: string; costUsd?: number }
export interface RunHandle { done: Promise<RunResult>; cancel: () => void }
export interface Executor { run(command: string, opts: RunOpts): RunHandle }

export class RealExecutor implements Executor {
  constructor(private projectDir: string) {}

  run(command: string, opts: RunOpts): RunHandle {
    const args = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits",
    ];
    if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
    else if (opts.continueSession) args.push("--continue");
    if (opts.systemPrompt) args.push("--append-system-prompt", opts.systemPrompt);
    args.push(command);

    const result: RunResult = {};
    const onLine = (line: string) => {
      for (const e of parseStreamJsonLine(line)) {
        if (e.role === "session") result.sessionId = e.sessionId;
        else if (e.role === "result") result.costUsd = e.costUsd;
        else opts.onEvent(e);
      }
    };
    const inner = this.exec("claude", args, onLine);
    return { done: inner.done.then(() => result), cancel: inner.cancel };
  }

  // 테스트에서 오버라이드하는 seam. 실제 구현은 프로세스 그룹으로 spawn하고
  // cancel 시 그룹째 종료한다(flutter/gradle 고아 방지 — 스펙 §8).
  protected exec(
    cmd: string, args: string[], onLine?: (line: string) => void,
  ): { done: Promise<void>; cancel: () => void } {
    const child = spawn(cmd, args, { cwd: this.projectDir, detached: true });
    let buf = "";
    const flush = (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) onLine?.(line);
      }
    };
    child.stdout!.on("data", (b: Buffer) => flush(b.toString()));
    const done = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (buf.trim()) onLine?.(buf);
        if (code === 0) resolve();
        else reject(new Error(`claude 종료 코드 ${code}`));
      });
    });
    const cancel = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM"); // 프로세스 그룹 킬
      } catch {
        child.kill("SIGTERM");
      }
    };
    return { done, cancel };
  }
}
```

- [ ] **Step 4: agent.ts 호출부 수정** (`src/cli/agent.ts` 전체 교체)

```ts
import type { Executor } from "./executor.js";
import type { HostOutbound } from "../shared/protocol.js";

export async function handleCommand(
  project: string,
  text: string,
  executor: Executor,
  send: (msg: HostOutbound) => void,
  continueSession: boolean,
  systemPrompt?: string,
): Promise<void> {
  send({ type: "status", project, state: "working", text: "작업 시작" });
  try {
    await executor.run(text, {
      continueSession,
      systemPrompt,
      onEvent: (e) => {
        if (e.role === "assistant") send({ type: "assistant", project, text: e.text });
        else if (e.role === "log") send({ type: "log", project, text: e.text });
        // session/result 이벤트는 RealExecutor가 흡수하므로 여기 오지 않지만,
        // Fake executor가 흘려도 무해하게 무시한다.
      },
    }).done;
    send({ type: "preview", project, url: `/preview/${project}/` });
    send({ type: "status", project, state: "done" });
  } catch (err) {
    send({ type: "status", project, state: "error", text: String(err) });
  }
}
```

- [ ] **Step 5: 기존 Fake executor 갱신**

`tests/cli/agent.test.ts`·`tests/cli/host.test.ts`의 fake는 `run(): Promise<void>` 형태다. `RunHandle`을 반환하도록 기계적으로 교체한다 — 각 fake의 `run` 본문을 감싼다:

```ts
// 변경 전 패턴: run: async (cmd, opts) => { ...기존 본문... }
// 변경 후 패턴:
run: (cmd, opts) => ({
  done: (async () => { /* ...기존 본문 그대로... */ return {}; })(),
  cancel: () => {},
}),
```

- [ ] **Step 6: 전체 테스트 통과 확인**

Run: `npx vitest run`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/cli/executor.ts src/cli/agent.ts tests/cli/
git commit -m "feat: executor cancel handle, --resume, run result (session/cost)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 프로토콜 확장 + PipelineManager 코어 (큐·전이·confirm)

**Files:**
- Modify: `src/shared/protocol.ts` (타입 추가)
- Create: `src/cli/pipeline-manager.ts`
- Test: `tests/cli/pipeline-manager.test.ts`

**Interfaces:**
- Consumes: Task 1 도메인, Task 2 store, Task 4 `Executor`/`RunHandle`
- Produces:
  - protocol: `ConfirmMsg {type:"confirm"; project; stage}`, `StageRollbackMsg {type:"stage_rollback"; project; toStage}`, `StageCancelMsg {type:"stage_cancel"; project}`, `PipelineSyncMsg {type:"pipeline_sync"}`, `ArtifactGetMsg {type:"artifact_get"; project; key}` → `PhoneOutbound`에 합류. `StageUpdateMsg {type:"stage_update"; project; pipeline: PipelineSnapshot}`, `ArtifactMsg {type:"artifact"; project; key; content}` → `HostOutbound`에 합류
  - manager: `new PipelineManager(opts: { projectsRoot: string; send: (m: HostOutbound) => void; createExecutor: (wd: string) => Executor; now?: () => Date })`, 메서드 `handleMessage(msg: PhoneOutbound): boolean`(파이프라인 메시지면 소비 후 true), `handleFeedback(project: string, text: string): void`, `emitUpdate(project: string): void`, `attachWatcher(project: string): void`(Task 6), `stop(): void`

- [ ] **Step 1: protocol.ts에 타입 추가** — `src/shared/protocol.ts`에 아래를 추가하고 유니언을 갱신

```ts
import type { PipelineSnapshot } from "./pipeline.js";

// ── 파이프라인: 폰 → PC ──
export interface ConfirmMsg { type: "confirm"; project: string; stage: string }
export interface StageRollbackMsg { type: "stage_rollback"; project: string; toStage: string }
export interface StageCancelMsg { type: "stage_cancel"; project: string }
export interface PipelineSyncMsg { type: "pipeline_sync" }
export interface ArtifactGetMsg { type: "artifact_get"; project: string; key: string }

// ── 파이프라인: PC → 폰 ──
export interface StageUpdateMsg { type: "stage_update"; project: string; pipeline: PipelineSnapshot }
export interface ArtifactMsg { type: "artifact"; project: string; key: string; content: string }
```

기존 유니언 두 줄을 다음으로 교체:

```ts
export type PhoneOutbound =
  | CommandMsg | CreateProjectMsg | ListProjectsMsg
  | ConfirmMsg | StageRollbackMsg | StageCancelMsg | PipelineSyncMsg | ArtifactGetMsg;

export type HostOutbound =
  | LogMsg | StatusMsg | PreviewMsg | ProjectsMsg | AssistantMsg
  | StageUpdateMsg | ArtifactMsg;
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// tests/cli/pipeline-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineManager } from "../../src/cli/pipeline-manager.js";
import { seedPipelineState, readPipelineState, writePipelineState, readPipelineHostState } from "../../src/cli/pipeline-store.js";
import type { Executor, RunOpts, RunHandle } from "../../src/cli/executor.js";
import type { HostOutbound } from "../../src/shared/protocol.js";

// 수동 완료 제어형 Fake: run 호출을 기록하고, 테스트가 finish()로 종료시킨다.
class ManualExecutor implements Executor {
  runs: { command: string; opts: RunOpts; finish: (fail?: boolean) => void }[] = [];
  run(command: string, opts: RunOpts): RunHandle {
    let resolve!: () => void, reject!: (e: Error) => void;
    const done = new Promise<{ sessionId?: string }>((res, rej) => {
      resolve = () => res({ sessionId: "sid-test" });
      reject = rej;
    });
    this.runs.push({ command, opts, finish: (fail) => (fail ? reject(new Error("x")) : resolve()) });
    return { done, cancel: () => {} };
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
afterEach(() => { mgr.stop(); rmSync(root, { recursive: true, force: true }); });

const updates = () => sent.filter((m) => m.type === "stage_update") as any[];
const flush = () => new Promise((r) => setTimeout(r, 20)); // done 마이크로태스크 소화

describe("confirm", () => {
  it("awaiting_confirm에서 stage 일치 confirm → 다음 단계 starting 기록 후 스킬 실행", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "ideation", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "ideation" });
    expect(ex.runs).toHaveLength(1);
    expect(ex.runs[0].command).toBe("/pipeline-prd");
    const s = readPipelineState(dir("habit"))!;
    expect(s.stage).toBe("prd");
    // confirm 이력이 host state에 남는다
    expect(readPipelineHostState(dir("habit")).history[0]).toMatchObject({ stage: "ideation" });
  });
  it("stage 불일치 confirm은 무시(멱등성)", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "ideation" });
    expect(ex.runs).toHaveLength(0);
  });
  it("running 중 confirm은 거부하고 실행하지 않는다(in-flight 선점 금지)", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    mgr.handleFeedback("habit", "고쳐줘");        // running 진입
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "prd" });
    expect(ex.runs).toHaveLength(1);              // 피드백 1건만
  });
});

describe("피드백 큐", () => {
  it("실행 중 피드백은 큐에 쌓이고 완료 후 순서대로 실행, 큐 길이가 stage_update에 실린다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
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
  it("confirm으로 stage가 바뀌면 잔여 큐를 flush한다", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "prd", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "작업중");
    mgr.handleFeedback("habit", "이건 버려져야 함");
    // 실행 종료 후 awaiting_confirm 상태를 스킬이 썼다고 가정
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
    });
    ex.runs[0].finish(); await flush();
    // 종료 시점에 awaiting_confirm이므로 큐 소비 대신 유지되지만,
    // confirm이 오면 flush되고 다음 단계로 간다
    mgr.handleMessage({ type: "confirm", project: "habit", stage: "prd" });
    const cmds = ex.runs.map((r) => r.command);
    expect(cmds).toContain("/pipeline-mockup");
    expect(cmds.some((c) => c.includes("이건 버려져야"))).toBe(false);
  });
});

describe("exit-0 강등", () => {
  it("프로세스가 끝났는데 stageStatus가 running이면 error로 강등", async () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "develop", stageStatus: "awaiting_feedback", artifacts: {},
    });
    mgr.handleFeedback("habit", "만들어");
    // 스킬이 pipeline.json을 갱신하지 않은 채(running) 종료
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "develop", stageStatus: "running", artifacts: {},
    });
    ex.runs[0].finish(); await flush();
    expect(readPipelineState(dir("habit"))!.stageStatus).toBe("error");
  });
});

describe("rollback / cancel / sync / artifact", () => {
  it("rollback은 이전 단계만 허용, sessionId를 비운다(새 세션)", () => {
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
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
  it("pipeline_sync는 파이프라인 프로젝트 전체 스냅샷을 보낸다", () => {
    mgr.handleMessage({ type: "pipeline_sync" });
    expect(updates().some((u) => u.project === "habit")).toBe(true);
  });
  it("artifact_get은 등록된 .md 산출물만 읽어 보낸다", () => {
    mkdirSync(join(dir("habit"), "docs"), { recursive: true });
    writeFileSync(join(dir("habit"), "docs", "PRD.md"), "# PRD");
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "prd", stageStatus: "awaiting_confirm", artifacts: { prd: "docs/PRD.md" },
    });
    mgr.handleMessage({ type: "artifact_get", project: "habit", key: "prd" });
    const art = sent.find((m) => m.type === "artifact") as any;
    expect(art.content).toBe("# PRD");
    // 미등록 키는 무시
    mgr.handleMessage({ type: "artifact_get", project: "habit", key: "../etc" });
    expect(sent.filter((m) => m.type === "artifact")).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/cli/pipeline-manager.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현**

```ts
// src/cli/pipeline-manager.ts
// 파이프라인 상태머신: 큐·confirm/rollback/cancel/sync·exit0 강등.
// 규칙(스펙 §3·§6·§8): 스킬 비실행 중 전이는 host가 pipeline.json에 쓴다.
import { readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import {
  isPriorStage, mergeSnapshot, nextStage,
  type PipelineStage, type Stage,
} from "../shared/pipeline.js";
import {
  hasPipeline, readPipelineHostState, readPipelineState,
  writePipelineHostState, writePipelineState,
} from "./pipeline-store.js";
import { listProjects, projectDir } from "./projects.js";
import type { Executor, RunHandle } from "./executor.js";
import type { HostOutbound, PhoneOutbound } from "../shared/protocol.js";

export interface PipelineManagerOpts {
  projectsRoot: string;
  send: (m: HostOutbound) => void;
  createExecutor: (workdir: string) => Executor;
  now?: () => Date;
}

interface Running { handle: RunHandle; startedAt: number }

export class PipelineManager {
  private queues = new Map<string, string[]>();      // project → 대기 피드백
  private running = new Map<string, Running>();
  private watchers: { close: () => void }[] = [];    // Task 6에서 사용
  private now: () => Date;

  constructor(private opts: PipelineManagerOpts) {
    this.now = opts.now ?? (() => new Date());
  }

  private dir(project: string): string {
    return projectDir(this.opts.projectsRoot, project);
  }

  emitUpdate(project: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state) return;
    const host = readPipelineHostState(d);
    const q = this.queues.get(project)?.length ?? 0;
    this.opts.send({ type: "stage_update", project, pipeline: mergeSnapshot(state, host, q) });
  }

  // 파이프라인 메시지면 처리하고 true. 아니면 false(호출자가 레거시 경로로).
  handleMessage(msg: PhoneOutbound): boolean {
    switch (msg.type) {
      case "confirm": this.confirm(msg.project, msg.stage); return true;
      case "stage_rollback": this.rollback(msg.project, msg.toStage as Stage); return true;
      case "stage_cancel": this.cancel(msg.project); return true;
      case "pipeline_sync": this.sync(); return true;
      case "artifact_get": this.artifact(msg.project, msg.key); return true;
      default: return false;
    }
  }

  handleFeedback(project: string, text: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state || state.stage === "done") return;
    if (this.running.has(project)) {
      const q = this.queues.get(project) ?? [];
      q.push(text);
      this.queues.set(project, q);
      this.emitUpdate(project);
      return;
    }
    this.runStage(project, state.stage as PipelineStage, `피드백: ${text}`);
  }

  private confirm(project: string, stage: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    // 멱등성: 현재 stage·awaiting_confirm과 일치할 때만 1회 처리
    if (!state || state.stage !== stage || state.stageStatus !== "awaiting_confirm") return;
    // in-flight 선점 금지: 실행 중이면 무시(폰 UI는 running 중 버튼 비활성)
    if (this.running.has(project)) return;
    this.queues.delete(project); // stage 전환 → 잔여 큐 flush
    const next = nextStage(state.stage);
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
    this.runStage(project, next as PipelineStage);
  }

  private rollback(project: string, toStage: Stage): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state || this.running.has(project)) return;
    if (!isPriorStage(toStage, state.stage)) return;
    this.queues.delete(project);
    const host = readPipelineHostState(d);
    host.sessionId = null; // 롤백은 새 세션(스펙 §8: 재수화)
    host.error = null;
    writePipelineHostState(d, host);
    writePipelineState(d, { ...state, stage: toStage, stageStatus: "starting" });
    this.emitUpdate(project);
    this.runStage(project, toStage as PipelineStage);
  }

  private cancel(project: string): void {
    const r = this.running.get(project);
    if (!r) return;
    r.handle.cancel();
    // 종료 처리(에러 기록·강등)는 runStage의 done 체인이 수행
  }

  private sync(): void {
    for (const name of listProjects(this.opts.projectsRoot)) {
      if (hasPipeline(this.dir(name))) this.emitUpdate(name);
    }
  }

  private artifact(project: string, key: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    const rel = state?.artifacts[key];
    if (!rel || !rel.endsWith(".md")) return;
    const path = normalize(join(d, rel));
    if (!path.startsWith(normalize(d))) return; // 경로 탈출 방지
    try {
      this.opts.send({ type: "artifact", project, key, content: readFileSync(path, "utf8") });
    } catch { /* 파일 없음 → 무시 */ }
  }

  private runStage(project: string, stage: PipelineStage, suffix?: string): void {
    const d = this.dir(project);
    const host = readPipelineHostState(d);
    const executor = this.opts.createExecutor(d);
    const command = suffix ? `/pipeline-${stage} ${suffix}` : `/pipeline-${stage}`;
    const handle = executor.run(command, {
      continueSession: false,
      resumeSessionId: host.sessionId ?? undefined,
      onEvent: (e) => {
        if (e.role === "assistant") this.opts.send({ type: "assistant", project, text: e.text });
        else if (e.role === "log") this.opts.send({ type: "log", project, text: e.text });
      },
    });
    this.running.set(project, { handle, startedAt: Date.now() });
    handle.done
      .then((result) => {
        const h = readPipelineHostState(d);
        if (result.sessionId) h.sessionId = result.sessionId;
        writePipelineHostState(d, h);
        // exit-0 강등(스펙 §8): 스킬이 상태 갱신을 깜빡한 채 종료
        const s = readPipelineState(d);
        if (s && (s.stageStatus === "running" || s.stageStatus === "starting")) {
          writePipelineState(d, { ...s, stageStatus: "error" });
        }
      })
      .catch((err) => {
        const h = readPipelineHostState(d);
        h.error = String(err);
        writePipelineHostState(d, h);
      })
      .finally(() => {
        this.running.delete(project);
        this.emitUpdate(project);
        this.drainQueue(project);
      });
  }

  private drainQueue(project: string): void {
    const q = this.queues.get(project);
    if (!q || q.length === 0) return;
    const state = readPipelineState(this.dir(project));
    if (!state || state.stage === "done") { this.queues.delete(project); return; }
    // awaiting_confirm이면 큐를 유지한 채 대기(사용자가 confirm하면 flush됨).
    if (state.stageStatus === "awaiting_confirm") return;
    const text = q.shift()!;
    if (q.length === 0) this.queues.delete(project);
    this.runStage(project, state.stage as PipelineStage, `피드백: ${text}`);
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    for (const [, r] of this.running) r.handle.cancel();
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/cli/pipeline-manager.test.ts`
Expected: PASS. 이어서 `npx vitest run` 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/shared/protocol.ts src/cli/pipeline-manager.ts tests/cli/pipeline-manager.test.ts
git commit -m "feat: pipeline manager (queue, confirm/rollback/cancel/sync, exit-0 demotion)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 디렉터리 watch → stage_update 발신

**Files:**
- Modify: `src/cli/pipeline-manager.ts` (`attachWatcher` 구현)
- Test: `tests/cli/pipeline-manager.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: Task 5 manager
- Produces: `attachWatcher(project: string): void` — 프로젝트 **디렉터리 단위** `fs.watch`(rename 후 inode 문제 회피, 스펙 §3), `pipeline.json` 변경 시 150ms 디바운스 후 재읽기(파싱 실패 시 100ms 간격 3회 재시도), 마지막 발신 내용과 다르면 `stage_update` 발신

- [ ] **Step 1: 실패하는 테스트 추가** (pipeline-manager.test.ts 맨 아래)

```ts
describe("watcher", () => {
  it("pipeline.json이 외부(스킬)에서 바뀌면 stage_update가 발신된다", async () => {
    mgr.attachWatcher("habit");
    sent.length = 0;
    writePipelineState(dir("habit"), {
      schemaVersion: 1, project: "habit", createdAt: "t",
      stage: "ideation", stageStatus: "awaiting_confirm", artifacts: { ideas: "IDEAS.md" },
    });
    await new Promise((r) => setTimeout(r, 400)); // 디바운스 대기
    const u = updates();
    expect(u.length).toBeGreaterThanOrEqual(1);
    expect(u.at(-1).pipeline.stageStatus).toBe("awaiting_confirm");
  });
  it("같은 내용 재기록은 중복 발신하지 않는다", async () => {
    mgr.attachWatcher("habit");
    const s = readPipelineState(dir("habit"))!;
    writePipelineState(dir("habit"), s);
    await new Promise((r) => setTimeout(r, 400));
    const count = updates().length;
    writePipelineState(dir("habit"), s);
    await new Promise((r) => setTimeout(r, 400));
    expect(updates().length).toBe(count);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/cli/pipeline-manager.test.ts`
Expected: 새 케이스 FAIL — `attachWatcher` 미존재

- [ ] **Step 3: 구현** — pipeline-manager.ts에 추가

import에 `watch`를 추가(`node:fs`), 클래스 필드에 `private lastEmitted = new Map<string, string>();` 추가. `emitUpdate`를 아래로 교체하고 `attachWatcher`를 추가:

```ts
  emitUpdate(project: string): void {
    const d = this.dir(project);
    const state = readPipelineState(d);
    if (!state) return;
    const host = readPipelineHostState(d);
    const q = this.queues.get(project)?.length ?? 0;
    const snap = mergeSnapshot(state, host, q);
    const key = JSON.stringify(snap);
    if (this.lastEmitted.get(project) === key) return; // 중복·에코 억제
    this.lastEmitted.set(project, key);
    this.opts.send({ type: "stage_update", project, pipeline: snap });
  }

  // 디렉터리 단위 watch: rename(원자적 쓰기) 후에도 이벤트가 계속 온다(스펙 §3).
  attachWatcher(project: string): void {
    const d = this.dir(project);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const watcher = watch(d, (_event, filename) => {
      if (filename !== "pipeline.json" && filename !== "pipeline.host.json") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this.readAndEmit(project, 3), 150); // 디바운스
    });
    this.watchers.push({ close: () => watcher.close() });
  }

  // 파싱 실패 시 재시도(쓰기 도중 부분 파일을 error로 오판하지 않기 — 스펙 §3)
  private readAndEmit(project: string, retries: number): void {
    const state = readPipelineState(this.dir(project));
    if (!state) {
      if (retries > 0) setTimeout(() => this.readAndEmit(project, retries - 1), 100);
      return;
    }
    this.emitUpdate(project);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/cli/pipeline-manager.test.ts`
Expected: PASS (기존 케이스 포함 — `emitUpdate` 중복 억제로 깨지는 기존 케이스가 있으면 해당 테스트의 `sent.length = 0` 초기화 위치를 확인)

- [ ] **Step 5: 커밋**

```bash
git add src/cli/pipeline-manager.ts tests/cli/pipeline-manager.test.ts
git commit -m "feat: directory-level pipeline.json watcher with debounce and dedupe

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: host 배선 — 파이프라인 프로젝트 생성·메시지 라우팅

**Files:**
- Modify: `src/cli/projects.ts` (파이프라인 프로젝트 생성·판별)
- Modify: `src/cli/host.ts` (manager 통합, 라우팅)
- Modify: `src/launch.ts` (자동 시드 제거 — `ensureSeedProject(projectsRoot)` 호출 줄 삭제)
- Test: `tests/cli/host.test.ts` (테스트 추가), `tests/cli/projects.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: Task 2 store, Task 5·6 manager
- Produces:
  - `createPipelineProject(root: string, name: string): void` — `projects/<name>/` 생성 + `meta.json`에 `{ "pipeline": true }` + `seedPipelineState` (public/ 시드 없음)
  - `isPipelineProject(root: string, name: string): boolean` — meta.json의 `pipeline === true`
  - `CreateProjectMsg`에 `pipeline?: boolean` 필드 추가 (protocol.ts)
  - host 라우팅 규칙: ① `confirm/stage_rollback/stage_cancel/pipeline_sync/artifact_get` → `manager.handleMessage` ② `command` + 파이프라인 프로젝트 → `manager.handleFeedback` (targetSystemPrompt 미주입) ③ `command` + 레거시 프로젝트 → 기존 `handleCommand` 경로 유지

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/cli/projects.test.ts`에 추가

```ts
import { createPipelineProject, isPipelineProject } from "../../src/cli/projects.js";
import { hasPipeline } from "../../src/cli/pipeline-store.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

describe("createPipelineProject", () => {
  it("pipeline.json을 시드하고 public/은 만들지 않으며 meta에 pipeline:true", () => {
    createPipelineProject(root, "habit");                       // root는 이 파일의 기존 픽스처
    expect(hasPipeline(join(root, "habit"))).toBe(true);
    expect(existsSync(join(root, "habit", "public"))).toBe(false);
    expect(isPipelineProject(root, "habit")).toBe(true);
  });
  it("레거시 프로젝트는 isPipelineProject false", () => {
    createProject(root, "legacy", "ios");
    expect(isPipelineProject(root, "legacy")).toBe(false);
  });
});
```

`tests/cli/host.test.ts`에 추가(이 파일의 기존 WS 헬퍼 `startHostWith`/`nextMessage`/`until` 패턴을 그대로 사용):

```ts
describe("파이프라인 라우팅", () => {
  it("createProject{pipeline:true} → 파이프라인 프로젝트 생성 + stage_update 수신", async () => {
    const { phone } = await pair();                              // 기존 헬퍼
    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    const update = await until(phone, (m) => m.type === "stage_update");
    expect(update.project).toBe("habit");
    expect(update.pipeline.stage).toBe("ideation");
    expect(update.pipeline.stageStatus).toBe("pending");
  });
  it("파이프라인 프로젝트로 온 command는 /pipeline-<stage> 재호출로 래핑된다", async () => {
    const { phone } = await pair();
    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    await until(phone, (m) => m.type === "stage_update");
    phone.send(JSON.stringify({ type: "command", project: "habit", text: "카피앱 아이디어 줘" }));
    await until(phone, (m) => m.type === "stage_update" && m.pipeline.queueLength >= 0);
    // FakeExecutor가 받은 명령을 검증
    expect(receivedCommands[0]).toBe("/pipeline-ideation 피드백: 카피앱 아이디어 줘");
    // 파이프라인 프로젝트에는 targetSystemPrompt가 주입되지 않는다
    expect(receivedOpts[0].systemPrompt).toBeUndefined();
  });
  it("pipeline_sync에 전 파이프라인 프로젝트 스냅샷이 온다", async () => {
    const { phone } = await pair();
    phone.send(JSON.stringify({ type: "createProject", name: "habit", pipeline: true }));
    await until(phone, (m) => m.type === "stage_update");
    phone.send(JSON.stringify({ type: "pipeline_sync" }));
    const update = await until(phone, (m) => m.type === "stage_update" && m.project === "habit");
    expect(update.pipeline.stage).toBe("ideation");
  });
});
```

(참고: `receivedCommands`/`receivedOpts`는 이 테스트 파일의 FakeExecutor가 이미 캡처하는 배열 — 없으면 fake에 `commands.push(cmd); optsList.push(opts)` 캡처를 추가한다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/cli/projects.test.ts tests/cli/host.test.ts`
Expected: 새 케이스 FAIL

- [ ] **Step 3: projects.ts에 추가**

```ts
import { seedPipelineState } from "./pipeline-store.js";

// 파이프라인 프로젝트: public/ 시드 없음, pipeline.json이 상태 원장.
export function createPipelineProject(root: string, name: string): void {
  const dir = projectDir(root, name);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(metaPath(root, name)))
    writeFileSync(metaPath(root, name), JSON.stringify({ pipeline: true }));
  seedPipelineState(dir, name, new Date().toISOString());
}

export function isPipelineProject(root: string, name: string): boolean {
  try {
    return JSON.parse(readFileSync(metaPath(root, name), "utf8"))?.pipeline === true;
  } catch {
    return false;
  }
}
```

`protocol.ts`의 `CreateProjectMsg`에 필드 추가:

```ts
export interface CreateProjectMsg {
  type: "createProject";
  name: string;
  target?: ProjectTarget;
  pipeline?: boolean;
}
```

- [ ] **Step 4: host.ts 배선**

`startHost` 안, `connect()` 위에 manager 생성(연결과 무관하게 1회):

```ts
import { PipelineManager } from "./pipeline-manager.js";
import { createPipelineProject, isPipelineProject } from "./projects.js";
import { hasPipeline } from "./pipeline-store.js";
```

`connect()` 내부에서 `send`가 정의된 직후:

```ts
    const manager = new PipelineManager({
      projectsRoot,
      send: (m) => { send(m); mirrorToTerminal(log, m as HostOutbound); },
      createExecutor,
    });
    for (const name of listProjects(projectsRoot)) {
      if (hasPipeline(projectDir(projectsRoot, name))) manager.attachWatcher(name);
    }
```

`ws.on("message", ...)` 핸들러를 다음 규칙으로 수정:

```ts
      // ① 파이프라인 전용 메시지 우선 라우팅
      if (manager.handleMessage(msg)) return;

      if (msg.type === "createProject") {
        const name = slugifyProjectName(String(msg.name ?? ""));
        if (!name) { /* 기존 오류 응답 그대로 */ return; }
        if (!licensed && listProjects(projectsRoot).length >= 1) { /* 기존 체험판 응답 그대로 */ return; }
        if (msg.pipeline === true) {
          createPipelineProject(projectsRoot, name);
          manager.attachWatcher(name);
          manager.emitUpdate(name);
          sendProjects();
          return;
        }
        // 기존 레거시 생성 경로 그대로
        ...
      } else if (msg.type === "command") {
        // 기존 슬러그·실존 검증 그대로 유지한 뒤:
        if (isPipelineProject(projectsRoot, project)) {
          manager.handleFeedback(project, String(msg.text ?? ""));  // 스킬 재호출 래핑·큐잉은 manager가
          return;
        }
        // 레거시 경로(busy/started/targetSystemPrompt)는 기존 코드 그대로
        ...
      }
```

`src/launch.ts`에서 `ensureSeedProject(...)` 호출 줄을 삭제한다(스펙 §12.6 — 자동 시드가 체험판 슬롯을 소진시키는 충돌).

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run`
Expected: 전부 PASS — 특히 기존 레거시 케이스(중복 명령 거부, `--continue`, 병렬 실행, 체험판 제한)가 그대로 PASS여야 한다. `ensureSeedProject` 자체 테스트가 launch 경유라면 함수는 남기고 호출만 제거했으므로 영향 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/cli/projects.ts src/cli/host.ts src/shared/protocol.ts src/launch.ts tests/cli/
git commit -m "feat: wire pipeline manager into host, pipeline project creation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: relay 서빙 확장 — 디렉터리 화이트리스트 + MIME

**Files:**
- Modify: `src/server/relay.ts:20-29` (MIME 맵), `src/server/relay.ts:69-85` (경로 해석)
- Test: `tests/server/relay.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: 없음
- Produces: URL 규칙 — `/preview/<name>/<rest>`에서 `<rest>`의 첫 세그먼트가 `mockup|preview|release`면 `<previewDir>/<name>/<그 세그먼트>/...`에서 서빙, 아니면 기존대로 `<previewDir>/<name>/public/...`. MIME에 `.wasm .otf .ttf .woff2 .jpg .jpeg .webp` 추가.

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/server/relay.test.ts`에 (이 파일의 기존 정적 서빙 픽스처 패턴 사용)

```ts
describe("파이프라인 서빙 확장", () => {
  it("/preview/<name>/mockup/home.html 은 mockup/ 디렉터리에서 서빙", async () => {
    mkdirSync(join(previewRoot, "habit", "mockup"), { recursive: true });
    writeFileSync(join(previewRoot, "habit", "mockup", "home.html"), "<h1>목업</h1>");
    const res = await fetch(`http://localhost:${port}/preview/habit/mockup/home.html`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("목업");
  });
  it("화이트리스트 밖 디렉터리는 public/ 기준으로 해석되어 404", async () => {
    mkdirSync(join(previewRoot, "habit", "secret"), { recursive: true });
    writeFileSync(join(previewRoot, "habit", "secret", "x.txt"), "비밀");
    const res = await fetch(`http://localhost:${port}/preview/habit/secret/x.txt`);
    expect(res.status).toBe(404);
  });
  it(".wasm은 application/wasm으로 서빙", async () => {
    mkdirSync(join(previewRoot, "habit", "preview"), { recursive: true });
    writeFileSync(join(previewRoot, "habit", "preview", "a.wasm"), "AGFzbQ");
    const res = await fetch(`http://localhost:${port}/preview/habit/preview/a.wasm`);
    expect(res.headers.get("content-type")).toBe("application/wasm");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/server/relay.test.ts`
Expected: 새 케이스 FAIL

- [ ] **Step 3: 구현**

MIME 맵에 추가:

```ts
  ".wasm": "application/wasm",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
```

경로 해석 블록(relay.ts 72-81의 `if (rawPath.startsWith("/preview/"))` 내부)을 교체:

```ts
      const SERVE_DIRS = new Set(["mockup", "preview", "release"]);
      const sub = rawPath.slice("/preview/".length);
      const i = sub.indexOf("/");
      const name = i === -1 ? sub : sub.slice(0, i);
      const rest = i === -1 ? "/" : sub.slice(i);
      if (previewDir && name) {
        const seg = rest.split("/").filter(Boolean)[0];
        if (seg && SERVE_DIRS.has(seg)) {
          baseDir = join(previewDir, name, seg);
          rel = rest.slice(seg.length + 1) || "/";
        } else {
          baseDir = join(previewDir, name, "public");
          rel = rest;
        }
      }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/server/relay.test.ts` → PASS, 이어서 `npx vitest run` 전체 PASS (기존 path traversal·public 서빙 케이스 회귀 확인)

- [ ] **Step 5: 커밋**

```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay serving whitelist (mockup/preview/release) + flutter web MIME types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 이 계획에서 의도적으로 제외한 것 (후속 Phase)

- **Phase 1B**: 폰 웹앱 다화면(홈 카드·스텝퍼·컨펌 버튼·마크다운 뷰어·기기 프레임 프리셋 — 확정 목업 `docs/superpowers/specs/assets/pipeline-ux-mockup.html` 기준), confirm ack(재전송 버튼), 채팅 히스토리 영속화, project_archive/delete
- **Phase 2**: 문서 템플릿 5종(IDEAS/PRD/ESTIMATE/COST-GUARDRAILS/RELEASE — PRD는 `assets/prd-template-detail.html` 기준)
- **Phase 3**: 공용 Flutter 템플릿(딥링크·SEED·settings.json 화이트리스트 시드 포함)
- **Phase 4**: 단계 스킬 7종 + `.claude/commands/` 시드(보조 스킬 8종 + app-store-screenshots 포함)
- **Phase 5**: 릴리즈 연결(스크린샷·privacy GitHub Pages·아이콘), 페어링 안정 세션 키, HTTP 쿠키 인증, 단계 타임아웃, 웹서치 권한
