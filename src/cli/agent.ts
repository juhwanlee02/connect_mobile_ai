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
