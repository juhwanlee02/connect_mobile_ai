// pipeline.json(스킬 소유) / pipeline.host.json(host 소유) 읽기·원자적 쓰기.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_STEPS, validatePipelineState,
  type PipelineHostState, type PipelineState, type StepDef,
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
  steps: StepDef[] = DEFAULT_STEPS, template = "default",
): PipelineState {
  const state: PipelineState = {
    schemaVersion: 2, project, createdAt: nowIso, template, steps,
    stage: steps[0].id, stageStatus: "pending", artifacts: {},
  };
  atomicWriteJson(pipelineStatePath(dir), state);
  return state;
}

function readJsonFile(path: string): unknown {
  // Windows 편집기/PowerShell이 붙인 UTF-8 BOM을 허용한다(없으면 파싱 실패 → 영구 대기처럼 보임).
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

export function readPipelineState(dir: string): PipelineState | null {
  try {
    return validatePipelineState(readJsonFile(pipelineStatePath(dir)));
  } catch {
    return null;
  }
}

export function writePipelineState(dir: string, s: PipelineState): void {
  atomicWriteJson(pipelineStatePath(dir), s);
}

export function readPipelineHostState(dir: string): PipelineHostState {
  try {
    const o = readJsonFile(pipelineHostStatePath(dir)) as Record<string, unknown>;
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
