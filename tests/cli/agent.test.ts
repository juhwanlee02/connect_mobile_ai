import { describe, it, expect } from "vitest";
import { handleCommand } from "../../src/cli/agent.js";
import type { Executor } from "../../src/cli/executor.js";
import type { HostOutbound } from "../../src/shared/protocol.js";

describe("handleCommand", () => {
  it("assistant/log 이벤트를 project 태그로 보내고 working→…→preview→done", async () => {
    const sent: HostOutbound[] = [];
    let gotContinue: boolean | undefined;
    const fake: Executor = {
      run: (_cmd, opts) => ({
        done: (async () => {
          gotContinue = opts.continueSession;
          opts.onEvent({ role: "assistant", text: "이렇게 만들게요" });
          opts.onEvent({ role: "log", text: "🔧 Edit" });
          return {};
        })(),
        cancel: () => {},
      }),
    };
    await handleCommand("my-app", "앱", fake, (m) => sent.push(m), true);
    expect(gotContinue).toBe(true);
    expect(sent).toEqual([
      { type: "status", project: "my-app", state: "working", text: "작업 시작" },
      { type: "assistant", project: "my-app", text: "이렇게 만들게요" },
      { type: "log", project: "my-app", text: "🔧 Edit" },
      { type: "preview", project: "my-app", url: "/preview/my-app/" },
      { type: "status", project: "my-app", state: "done" },
    ]);
  });

  it("executor가 throw하면 error", async () => {
    const sent: HostOutbound[] = [];
    const fake: Executor = {
      run: () => ({
        done: (async () => {
          throw new Error("실패함");
        })(),
        cancel: () => {},
      }),
    };
    await handleCommand("my-app", "앱", fake, (m) => sent.push(m), false);
    expect(sent[0]).toMatchObject({ type: "status", project: "my-app", state: "working" });
    expect(sent.at(-1)).toMatchObject({ type: "status", project: "my-app", state: "error" });
  });

  it("session/result 이벤트는 폰으로 새지 않는다", async () => {
    const sent: HostOutbound[] = [];
    const fake: Executor = {
      run: (_cmd, opts) => ({
        done: (async () => {
          opts.onEvent({ role: "session", sessionId: "s" } as any);
          opts.onEvent({ role: "result", costUsd: 1 } as any);
          return {};
        })(),
        cancel: () => {},
      }),
    };
    await handleCommand("my-app", "앱", fake, (m) => sent.push(m), true);

    // log/assistant 타입 메시지는 없어야 함
    const logOrAssistant = sent.filter(m => m.type === "log" || m.type === "assistant");
    expect(logOrAssistant).toHaveLength(0);

    // status/preview는 허용됨
    const types = sent.map(m => m.type);
    expect(types).toEqual(["status", "preview", "status"]);
  });
});
