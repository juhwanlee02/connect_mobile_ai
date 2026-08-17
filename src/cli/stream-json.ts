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

// Codex `exec --json`의 JSONL 이벤트를 공통 AgentEvent로 변환한다.
export function parseCodexJsonLine(line: string): AgentEvent[] {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }
  if (obj?.type === "thread.started" && typeof obj.thread_id === "string") {
    return [{ role: "session", sessionId: `codex:${obj.thread_id}` }];
  }
  if (obj?.type === "item.completed" && obj.item?.type === "agent_message") {
    const text = obj.item.text;
    return typeof text === "string" && text.trim()
      ? [{ role: "assistant", text: text.trim() }]
      : [];
  }
  if (obj?.type === "item.started" && obj.item?.type === "command_execution") {
    const command = typeof obj.item.command === "string" ? obj.item.command : "명령 실행";
    return [{ role: "log", text: `🔧 ${command}` }];
  }
  if (obj?.type === "item.completed" && obj.item?.type === "file_change") {
    return [{ role: "log", text: "📝 파일 변경" }];
  }
  if (obj?.type === "error") {
    const text = obj.message ?? obj.error?.message;
    return typeof text === "string" && text.trim()
      ? [{ role: "log", text: `⚠️ ${text.trim()}` }]
      : [];
  }
  return [];
}

// Cursor Agent CLI `--print --output-format stream-json` NDJSON 이벤트.
export function parseCursorJsonLine(line: string): AgentEvent[] {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }
  if (obj?.type === "system" && obj.subtype === "init" && typeof obj.session_id === "string") {
    return [{ role: "session", sessionId: `cursor:${obj.session_id}` }];
  }
  if (obj?.type === "result" && typeof obj.session_id === "string") {
    return [{ role: "session", sessionId: `cursor:${obj.session_id}` }];
  }
  if (obj?.type === "assistant" && Array.isArray(obj.message?.content)) {
    // --stream-partial-output 사용 시 중복 flush는 건너뛴다(우리는 기본 stream-json만 씀).
    if (obj.model_call_id) return [];
    const out: AgentEvent[] = [];
    for (const block of obj.message.content) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        out.push({ role: "assistant", text: block.text.trim() });
      }
    }
    return out;
  }
  if (obj?.type === "tool_call" && obj.subtype === "started") {
    const tc = obj.tool_call && typeof obj.tool_call === "object" ? obj.tool_call : {};
    const key = Object.keys(tc)[0] || "";
    const name = key.replace(/ToolCall$/i, "") || "tool";
    return [{ role: "log", text: `🔧 ${name}` }];
  }
  if (obj?.type === "error") {
    const text = obj.message ?? obj.error?.message;
    return typeof text === "string" && text.trim()
      ? [{ role: "log", text: `⚠️ ${text.trim()}` }]
      : [];
  }
  return [];
}
