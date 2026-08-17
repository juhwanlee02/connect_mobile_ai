# 대화형 Claude Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 폰에서 Claude의 말/작업을 말풍선으로 보고, 프로젝트마다 대화 맥락이 이어지게 한다.

**Architecture:** 실행기가 `claude -p --continue --output-format stream-json --verbose`로 Claude를 돌리고, 순수 파서가 stream-json 줄을 assistant/tool 이벤트로 바꾼다. 호스트는 프로젝트별 "대화 시작됨" Set으로 `--continue` 여부를 정한다. 폰은 assistant 메시지를 🤖 말풍선으로 표시한다.

**Tech Stack:** TypeScript/Node, ws, vitest, cross-spawn, Claude Code stream-json.

---

## File Structure
- `src/shared/protocol.ts` — `AssistantMsg` 추가 **수정**
- `src/cli/stream-json.ts` — stream-json 파서 **신규**(순수, 테스트)
- `src/cli/executor.ts` — run 시그니처(continueSession+onEvent) + stream-json args **수정**
- `src/cli/agent.ts` — handleCommand에 continueSession + onEvent 매핑 **수정**
- `src/cli/host.ts` — started Set + continueSession 전달 **수정**
- `src/web/app.js` — assistant 말풍선 **수정**
- tests: `tests/cli/stream-json.test.ts` 신규, `agent.test.ts`/`host.test.ts` 갱신

---

## Task 1: 프로토콜 + stream-json 파서

**Files:** Modify `src/shared/protocol.ts`; Create `src/cli/stream-json.ts`, `tests/cli/stream-json.test.ts`

- [ ] **Step 1: protocol에 AssistantMsg 추가** — `src/shared/protocol.ts`에서 `ProjectsMsg` 정의 다음(또는 HostOutbound 위)에 추가:
```ts
export interface AssistantMsg {
  type: "assistant";
  project: string;
  text: string;
}
```
그리고 HostOutbound 합집합에 추가:
```ts
export type HostOutbound = LogMsg | StatusMsg | PreviewMsg | ProjectsMsg | AssistantMsg;
```

- [ ] **Step 2: stream-json 테스트 작성** — Create `tests/cli/stream-json.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseStreamJsonLine } from "../../src/cli/stream-json.js";

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
```

- [ ] **Step 3: 실행해 실패 확인** — `npx vitest run tests/cli/stream-json.test.ts` → FAIL(모듈 없음).

- [ ] **Step 4: stream-json.ts 작성** — Create `src/cli/stream-json.ts`:
```ts
export interface AgentEvent {
  role: "assistant" | "log";
  text: string;
}

// Claude Code의 stream-json 출력 한 줄을 화면용 이벤트로 변환(파싱 실패/무관 줄은 빈 배열).
export function parseStreamJsonLine(line: string): AgentEvent[] {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
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

- [ ] **Step 5: 통과 확인** — `npx vitest run tests/cli/stream-json.test.ts` → PASS(4). 전체 `npx vitest run`도 통과(추가만 했으므로).

- [ ] **Step 6: Commit**
```bash
git add src/shared/protocol.ts src/cli/stream-json.ts tests/cli/stream-json.test.ts
git commit -m "feat: AssistantMsg + stream-json parser for Claude messages"
```

---

## Task 2: 실행기 — 대화형 stream-json 실행

**Files:** Modify `src/cli/executor.ts`

현재 `Executor.run(command, onLog): Promise<void>`를 이벤트/세션 인지형으로 바꾼다. (이후 agent.ts가 깨지는데 Task 3에서 고침 — 예상된 tsc 에러.)

- [ ] **Step 1: executor.ts 전체 교체** — `src/cli/executor.ts`를 다음으로 교체:
```ts
import spawn from "cross-spawn";
import { parseStreamJsonLine, type AgentEvent } from "./stream-json.js";

export interface RunOpts {
  continueSession: boolean;
  onEvent: (e: AgentEvent) => void;
}

export interface Executor {
  run(command: string, opts: RunOpts): Promise<void>;
}

export class RealExecutor implements Executor {
  constructor(private projectDir: string) {}

  async run(command: string, opts: RunOpts): Promise<void> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    ];
    if (opts.continueSession) args.push("--continue");
    args.push(command);
    await this.exec("claude", args, opts.onEvent);
  }

  private exec(
    cmd: string,
    args: string[],
    onEvent: (e: AgentEvent) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: this.projectDir });
      let buf = "";
      const flush = (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) for (const e of parseStreamJsonLine(line)) onEvent(e);
        }
      };
      child.stdout!.on("data", (b: Buffer) => flush(b.toString()));
      // stderr는 폰에 흘리지 않음(노이즈) — 비정상 종료만 에러로 처리
      child.on("error", reject);
      child.on("close", (code) => {
        if (buf.trim()) for (const e of parseStreamJsonLine(buf)) onEvent(e);
        if (code === 0) resolve();
        else reject(new Error(`claude 종료 코드 ${code}`));
      });
    });
  }
}
```

- [ ] **Step 2: 확인** — `npx tsc --noEmit` → agent.ts에서 에러 발생(옛 `run(text, onLog)` 호출) — 예상됨, Task 3에서 해결. stream-json/executor 자체 문법 에러는 없어야 함. `npx vitest run tests/cli/stream-json.test.ts` 여전히 통과.

- [ ] **Step 3: Commit**
```bash
git add src/cli/executor.ts
git commit -m "feat: executor runs claude in stream-json + --continue mode"
```

---

## Task 3: handleCommand — continueSession + 이벤트 매핑

**Files:** Modify `src/cli/agent.ts`, `tests/cli/agent.test.ts`

- [ ] **Step 1: agent.test.ts 전체 교체** — `tests/cli/agent.test.ts`를 다음으로 교체:
```ts
import { describe, it, expect } from "vitest";
import { handleCommand } from "../../src/cli/agent.js";
import type { Executor } from "../../src/cli/executor.js";
import type { HostOutbound } from "../../src/shared/protocol.js";

describe("handleCommand", () => {
  it("assistant/log 이벤트를 project 태그로 보내고 working→…→preview→done", async () => {
    const sent: HostOutbound[] = [];
    let gotContinue: boolean | undefined;
    const fake: Executor = {
      async run(_cmd, opts) {
        gotContinue = opts.continueSession;
        opts.onEvent({ role: "assistant", text: "이렇게 만들게요" });
        opts.onEvent({ role: "log", text: "🔧 Edit" });
      },
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
    const fake: Executor = { async run() { throw new Error("실패함"); } };
    await handleCommand("my-app", "앱", fake, (m) => sent.push(m), false);
    expect(sent[0]).toMatchObject({ type: "status", project: "my-app", state: "working" });
    expect(sent.at(-1)).toMatchObject({ type: "status", project: "my-app", state: "error" });
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/cli/agent.test.ts` → FAIL(현재 handleCommand 시그니처/이벤트 매핑 없음).

- [ ] **Step 3: agent.ts 전체 교체** — `src/cli/agent.ts`를 다음으로 교체:
```ts
import type { Executor } from "./executor.js";
import type { HostOutbound } from "../shared/protocol.js";

export async function handleCommand(
  project: string,
  text: string,
  executor: Executor,
  send: (msg: HostOutbound) => void,
  continueSession: boolean,
): Promise<void> {
  send({ type: "status", project, state: "working", text: "작업 시작" });
  try {
    await executor.run(text, {
      continueSession,
      onEvent: (e) =>
        send(
          e.role === "assistant"
            ? { type: "assistant", project, text: e.text }
            : { type: "log", project, text: e.text },
        ),
    });
    send({ type: "preview", project, url: `/preview/${project}/` });
    send({ type: "status", project, state: "done" });
  } catch (err) {
    send({ type: "status", project, state: "error", text: String(err) });
  }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/cli/agent.test.ts` → PASS(2). (이제 host.ts가 옛 4-인자 호출로 깨짐 — Task 4에서 해결.)

- [ ] **Step 5: Commit**
```bash
git add src/cli/agent.ts tests/cli/agent.test.ts
git commit -m "feat: handleCommand maps agent events + passes continueSession"
```

---

## Task 4: 호스트 — 프로젝트별 대화 이어가기

**Files:** Modify `src/cli/host.ts`, `tests/cli/host.test.ts`

- [ ] **Step 1: host.test.ts의 가짜 executor를 새 시그니처로 + 메모리 테스트 추가**

(a) `tests/cli/host.test.ts`에서 두 번째 인자를 **함수로 호출하던** fake를 고친다. 구체적으로:
- 첫 테스트의 slow fake에서 `onLog("작업중")` 호출 줄을 **삭제**한다(둘째 인자는 이제 객체 `opts`라 호출 불가). 즉
  `run: (_cmd, onLog) => new Promise<void>((resolve) => { onLog("작업중"); setTimeout(() => resolve(), 80); })`
  →
  `run: (_cmd, _opts) => new Promise<void>((resolve) => { setTimeout(() => resolve(), 80); })`
- 병렬 테스트 fake에서도 `onLog("작업중");` 줄을 **삭제**(나머지 active 카운팅 로직은 유지):
  `run: (_c, onLog) => new Promise<void>((resolve) => { active++; maxActive = Math.max(maxActive, active); onLog("작업중"); setTimeout(() => { active--; resolve(); }, 80); })`
  →
  `run: (_c, _opts) => new Promise<void>((resolve) => { active++; maxActive = Math.max(maxActive, active); setTimeout(() => { active--; resolve(); }, 80); })`
- `run: async () => {}` / `run: async () => { ran = true; }` 형태는 그대로 둬도 됨(인자 무시).

(b) 메모리(이어가기) 테스트를 describe 안에 추가:
```ts
  it("같은 프로젝트 2번째 명령은 continueSession=true로 실행된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const seen: boolean[] = [];
    const exec: Executor = {
      run: async (_c, opts) => { seen.push(opts.continueSession); },
    };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "memo" }));
    await until(phone, "projects");
    phone.send(JSON.stringify({ type: "command", project: "memo", text: "1" }));
    await until(phone, "preview");
    phone.send(JSON.stringify({ type: "command", project: "memo", text: "2" }));
    await until(phone, "preview");
    expect(seen).toEqual([false, true]);
    phone.close();
  });
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/cli/host.test.ts` → 메모리 테스트 FAIL(현재 host는 continueSession 미전달; 또한 handleCommand 5번째 인자 없어 tsc 에러).

- [ ] **Step 3: host.ts 수정**
(a) `startHost` 본문 상단(예: `const busy = new Set<string>();` 근처)에 추가:
```ts
  const started = new Set<string>();
```
(b) `command` 분기의 끝부분을 교체. 현재:
```ts
        const executor = createExecutor(projectDir(projectsRoot, project));
        busy.add(project);
        void handleCommand(project, String(msg.text ?? ""), executor, send).finally(
          () => busy.delete(project),
        );
```
를 다음으로:
```ts
        const continueSession = started.has(project);
        started.add(project);
        const executor = createExecutor(projectDir(projectsRoot, project));
        busy.add(project);
        void handleCommand(
          project,
          String(msg.text ?? ""),
          executor,
          send,
          continueSession,
        ).finally(() => busy.delete(project));
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/cli/host.test.ts` → 전부 PASS. `npx tsc --noEmit` 클린(단 src/cli/index.ts / src/launch.ts가 handleCommand를 직접 부르지 않으므로 영향 없음 — startHost만 사용). 전체 `npx vitest run` 통과.

- [ ] **Step 5: Commit**
```bash
git add src/cli/host.ts tests/cli/host.test.ts
git commit -m "feat: host continues per-project Claude conversation (memory)"
```

---

## Task 5: 폰 UI — Claude 말풍선

**Files:** Modify `src/web/app.js`

- [ ] **Step 1: assistant 메시지 처리 추가** — `src/web/app.js`의 onmessage 분기에서 `log` 처리 부근에 assistant 분기를 추가. 즉
```js
    } else if (msg.type === "log") {
      logTo(msg.project, "· " + msg.text);
    }
```
앞(또는 뒤)에 추가:
```js
    } else if (msg.type === "assistant") {
      logTo(msg.project, "🤖 " + msg.text);
    }
```

- [ ] **Step 2: 정적 서빙 확인** — `npm run dev:server` 백그라운드 → `curl -s http://localhost:8080/app.js | grep -c "assistant"` >=1. 서버 종료(남기지 말 것).

- [ ] **Step 3: Commit**
```bash
git add src/web/app.js
git commit -m "feat: phone shows Claude messages as 🤖 bubbles"
```

---

## Task 6: 문서 갱신

**Files:** Modify `README.md`, `docs/SETUP-customer.md`

- [ ] **Step 1:** 두 문서에 한 줄씩 반영: 폰에서 Claude의 답/작업이 보이고(🤖), **프로젝트마다 대화 맥락이 이어진다**("그거 빨갛게" 같은 후속 명령 가능). 같은 프로젝트면 이전 대화를 기억(호스트가 켜져 있는 동안). 실존 스크립트만 언급.

- [ ] **Step 2: 최종 점검 + Commit** — `npx vitest run`(통과)·`npx tsc --noEmit`(클린) 후:
```bash
git add README.md docs/SETUP-customer.md
git commit -m "docs: note conversational Claude (messages + per-project memory)"
```

---

## 완료 기준
- [ ] `npm test` 통과 (stream-json 4 + agent 2 + host 메모리 포함)
- [ ] `npx tsc --noEmit` 클린
- [ ] 폰에서 Claude 말풍선(🤖)이 보이고, 같은 프로젝트 후속 명령이 맥락을 이어감(`--continue`)
- [ ] 프로젝트가 다르면 대화도 분리(폴더별 세션)
- [ ] 릴레이는 여전히 WS 내용 미파싱
