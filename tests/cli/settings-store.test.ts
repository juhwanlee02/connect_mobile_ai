import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readHostSettings,
  writeHostModel,
  writeHostSettings,
  ALLOWED_MODELS,
  DEFAULT_MODEL,
} from "../../src/cli/settings-store.js";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "host-settings-test-"));
}

describe("settings-store", () => {
  it("파일이 없으면 기본 모델(opus)을 반환한다", () => {
    const root = tmpRoot();
    expect(readHostSettings(root).model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("opus");
  });

  it("허용 모델을 저장하면 true를 반환하고 읽기 왕복이 일치한다", () => {
    const root = tmpRoot();
    expect(writeHostModel(root, "sonnet")).toBe(true);
    expect(readHostSettings(root).model).toBe("sonnet");
  });

  it("Codex 제공자와 모델을 함께 저장한다", () => {
    const root = tmpRoot();
    expect(writeHostSettings(root, "codex", "gpt-5.6-sol")).toBe(true);
    expect(readHostSettings(root)).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
    });
  });

  it("Cursor 제공자와 모델을 함께 저장한다", () => {
    const root = tmpRoot();
    expect(writeHostSettings(root, "cursor", "composer-2.5")).toBe(true);
    expect(readHostSettings(root)).toEqual({
      provider: "cursor",
      model: "composer-2.5",
    });
  });

  it("제공자와 맞지 않는 모델 조합은 거부한다", () => {
    const root = tmpRoot();
    expect(writeHostSettings(root, "codex", "opus")).toBe(false);
    expect(writeHostSettings(root, "claude", "gpt-5.6-sol")).toBe(false);
    expect(writeHostSettings(root, "cursor", "opus")).toBe(false);
  });

  it("허용목록 밖 모델은 false를 반환하고 저장하지 않는다", () => {
    const root = tmpRoot();
    writeHostModel(root, "fable"); // 유효 값 먼저 저장
    expect(writeHostModel(root, "gpt-4")).toBe(false);
    expect(readHostSettings(root).model).toBe("fable"); // 기존값 유지
  });

  it("파일에 허용목록 밖 값이 손상돼 들어있으면 기본값으로 폴백한다", () => {
    const root = tmpRoot();
    writeFileSync(join(root, ".host-settings.json"), JSON.stringify({ model: "evil --dangerously" }));
    expect(readHostSettings(root).model).toBe(DEFAULT_MODEL);
  });

  it("손상된 JSON이면 예외 없이 기본값을 반환한다", () => {
    const root = tmpRoot();
    writeFileSync(join(root, ".host-settings.json"), "{ not json");
    expect(() => readHostSettings(root)).not.toThrow();
    expect(readHostSettings(root).model).toBe(DEFAULT_MODEL);
  });

  it("ALLOWED_MODELS는 opus/sonnet/fable 세 개다", () => {
    expect([...ALLOWED_MODELS].sort()).toEqual(["fable", "opus", "sonnet"]);
  });

  it("저장 후 tmp 잔재 파일이 남지 않는다", () => {
    const root = tmpRoot();
    writeHostModel(root, "opus");
    expect(existsSync(join(root, ".host-settings.json"))).toBe(true);
    for (const entry of readdirSync(root)) {
      expect(entry === ".host-settings.json" || !entry.startsWith(".host-settings.json.tmp-")).toBe(true);
    }
  });
});
