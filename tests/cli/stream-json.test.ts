import { describe, it, expect } from "vitest";
import {
  parseCodexJsonLine,
  parseCursorJsonLine,
  parseStreamJsonLine,
} from "../../src/cli/stream-json.js";

describe("parseStreamJsonLine", () => {
  it("assistant 텍스트 블록을 뽑는다", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "이렇게 만들게요" }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { role: "assistant", text: "이렇게 만들게요" },
    ]);
  });
  it("tool_use는 🔧 로그로", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ role: "log", text: "🔧 Edit" }]);
  });
  it("여러 블록을 순서대로", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [
        { type: "text", text: "수정 중" },
        { type: "tool_use", name: "Write" },
      ] },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { role: "assistant", text: "수정 중" },
      { role: "log", text: "🔧 Write" },
    ]);
  });
  it("공백 텍스트/다른 타입/깨진 줄은 무시", () => {
    expect(parseStreamJsonLine(JSON.stringify({ type: "system", subtype: "init" }))).toEqual([]);
    expect(parseStreamJsonLine(JSON.stringify({ type: "result", result: "ok" }))).toEqual([]);
    expect(parseStreamJsonLine(JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "   " }] },
    }))).toEqual([]);
    expect(parseStreamJsonLine("not json")).toEqual([]);
  });
});

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

describe("parseCodexJsonLine", () => {
  it("thread.started에서 제공자 접두사가 붙은 세션 ID를 뽑는다", () => {
    const line = JSON.stringify({ type: "thread.started", thread_id: "thread-1" });
    expect(parseCodexJsonLine(line)).toEqual([
      { role: "session", sessionId: "codex:thread-1" },
    ]);
  });

  it("완료된 agent_message를 assistant 이벤트로 바꾼다", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "수정했어요" },
    });
    expect(parseCodexJsonLine(line)).toEqual([
      { role: "assistant", text: "수정했어요" },
    ]);
  });

  it("시작한 명령을 진행 로그로 바꾼다", () => {
    const line = JSON.stringify({
      type: "item.started",
      item: { type: "command_execution", command: "npm test" },
    });
    expect(parseCodexJsonLine(line)).toEqual([
      { role: "log", text: "🔧 npm test" },
    ]);
  });
});

describe("parseCursorJsonLine", () => {
  it("system init에서 cursor: 접두사 세션 ID를 뽑는다", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-c",
    });
    expect(parseCursorJsonLine(line)).toEqual([
      { role: "session", sessionId: "cursor:sess-c" },
    ]);
  });

  it("assistant 텍스트를 이벤트로 바꾼다", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "구조 잡았어요" }],
      },
    });
    expect(parseCursorJsonLine(line)).toEqual([
      { role: "assistant", text: "구조 잡았어요" },
    ]);
  });

  it("tool_call started를 로그로 바꾼다", () => {
    const line = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      tool_call: { readToolCall: { args: { path: "a.md" } } },
    });
    expect(parseCursorJsonLine(line)).toEqual([
      { role: "log", text: "🔧 read" },
    ]);
  });
});
