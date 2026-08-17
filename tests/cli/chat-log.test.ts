import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendChat, readChat } from "../../src/cli/chat-log.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "chat-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("chat-log", () => {
  it("append한 순서대로 읽힌다", () => {
    appendChat(dir, { ts: "t1", role: "user", text: "안녕" });
    appendChat(dir, { ts: "t2", role: "assistant", text: "네" });
    expect(readChat(dir, 10)).toEqual([
      { ts: "t1", role: "user", text: "안녕" },
      { ts: "t2", role: "assistant", text: "네" },
    ]);
  });
  it("limit은 마지막 N개, 깨진 줄은 무시", () => {
    for (let i = 0; i < 5; i++) appendChat(dir, { ts: `t${i}`, role: "log", text: `${i}` });
    appendFileSync(join(dir, "chat.jsonl"), "{잘린 줄\n");
    const out = readChat(dir, 2);
    expect(out.map((e) => e.text)).toEqual(["3", "4"]);
  });
  it("파일 없으면 빈 배열", () => {
    expect(readChat(dir, 10)).toEqual([]);
  });
});
