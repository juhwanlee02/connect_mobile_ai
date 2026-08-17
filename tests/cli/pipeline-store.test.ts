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
  it("UTF-8 BOM이 있어도 읽힌다", () => {
    const s = seedPipelineState(dir, "bom-app", "2026-07-04T00:00:00Z");
    writeFileSync(pipelineStatePath(dir), "\uFEFF" + JSON.stringify(s, null, 2));
    expect(readPipelineState(dir)?.project).toBe("bom-app");
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
