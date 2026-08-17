# connect-pc-mobile-claude MVP (최소 연결 한 바퀴) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰에서 명령 → 중계서버 → PC가 Claude Code로 만들고 Firebase에 배포 → 폰에 URL 미리보기, 이 한 바퀴를 end-to-end로 동작시킨다.

**Architecture:** 세 프로세스가 WebSocket으로 통신한다. ① 중계서버(Node+ws)는 페어링 코드로 폰·PC를 한 세션에 묶고 메시지를 **내용을 보지 않고 그대로 전달**만 한다(프라이버시). ② 로컬 CLI(Node)는 서버에 host로 붙어 명령을 받아 executor로 코드생성·배포를 실행한다. ③ 폰 웹앱(바닐라 JS PWA)은 코드로 연결해 채팅·미리보기를 한다. 비즈니스 로직(페어링/라우팅, 명령처리, URL파싱)은 순수 함수/클래스로 분리해 TDD하고, 외부 의존(실제 claude/firebase 실행, 브라우저)은 인터페이스 뒤로 숨겨 수동 테스트한다.

**Tech Stack:** TypeScript, Node 20+, `ws`(WebSocket), `tsx`(TS 실행), `vitest`(테스트). ESM (`"type":"module"`).

---

## File Structure

```
package.json                 # deps, scripts, "type":"module"
tsconfig.json
vitest.config.ts
src/
  shared/
    protocol.ts              # 모든 메시지 타입 (세 구성요소 공유)
  server/
    relay.ts                 # 페어링 + 메시지 라우팅 (테스트 대상 핵심)
    index.ts                 # 서버 실행 진입점 + 정적 PWA 서빙
  cli/
    executor.ts             # Executor 인터페이스 + parseHostingUrl + RealExecutor
    agent.ts                 # handleCommand: 명령→executor→응답 (테스트 대상 핵심)
    index.ts                 # CLI 실행 진입점 (서버에 host로 연결)
  web/
    index.html               # 폰 PWA UI
    app.js                   # 폰 WebSocket 클라이언트
tests/
  server/relay.test.ts
  cli/agent.test.ts
  cli/executor.test.ts
```

**책임 분리 원칙:** `relay.ts`는 메시지 *내용*을 파싱하지 않는다(원문 전달만). `agent.ts`는 *전송 수단*(WebSocket)을 모른다(`send` 콜백만 받음). `executor.ts`의 순수 파싱 함수만 단위테스트하고, 실제 프로세스 실행은 수동 검증한다.

---

## Task 0: 프로젝트 스캐폴딩

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore` (이미 존재 — node_modules 추가)

- [ ] **Step 1: package.json 작성**

Create `package.json`:

```json
{
  "name": "connect-pc-mobile-claude",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:server": "tsx src/server/index.ts",
    "dev:cli": "tsx src/cli/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: vitest.config.ts 작성**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: node_modules를 .gitignore에 추가**

Append `node_modules` 줄이 없으면 추가. Run:

```bash
grep -qx "node_modules" .gitignore || echo "node_modules" >> .gitignore
```

- [ ] **Step 5: 의존성 설치 및 확인**

Run: `npm install`
Expected: 에러 없이 설치 완료, `node_modules/` 생성.

Run: `npx vitest run`
Expected: `No test files found` (아직 테스트 없음) — 명령 자체는 정상 동작.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold TypeScript/Node project for MVP"
```

---

## Task 1: 공유 메시지 프로토콜

**Files:**
- Create: `src/shared/protocol.ts`

타입만 정의하므로 테스트는 없다(컴파일이 검증). 이후 모든 태스크가 이 이름들을 사용한다.

- [ ] **Step 1: protocol.ts 작성**

Create `src/shared/protocol.ts`:

```ts
// 폰 → (중계) → PC
export interface CommandMsg {
  type: "command";
  text: string;
}
export type PhoneOutbound = CommandMsg;

// PC → (중계) → 폰
export interface LogMsg {
  type: "log";
  text: string;
}
export interface StatusMsg {
  type: "status";
  state: "idle" | "working" | "done" | "error";
  text?: string;
}
export interface PreviewMsg {
  type: "preview";
  url: string;
}
export type HostOutbound = LogMsg | StatusMsg | PreviewMsg;

// 서버 → PC (페어링 코드 발급)
export interface CodeMsg {
  type: "code";
  code: string;
}

// 서버 → 폰
export interface PairedMsg {
  type: "paired";
}
export interface ErrorMsg {
  type: "error";
  text: string;
}
```

- [ ] **Step 2: 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/shared/protocol.ts
git commit -m "feat: define shared WebSocket message protocol"
```

---

## Task 2: 중계서버 — 페어링 코드 발급

**Files:**
- Create: `src/server/relay.ts`
- Test: `tests/server/relay.test.ts`

서버를 실제 포트(0=임의포트)에 띄우고 진짜 ws 클라이언트로 검증한다. `generateCode`로 host에 코드를 발급하는 것까지 이 태스크에서 만든다.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/server/relay.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { startRelayServer, type RelayHandle } from "../../src/server/relay.js";

let handle: RelayHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}

describe("relay pairing", () => {
  it("host가 연결하면 6자 페어링 코드를 받는다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const msg = await nextMessage(host);
    expect(msg.type).toBe("code");
    expect(typeof msg.code).toBe("string");
    expect(msg.code).toHaveLength(6);
    host.close();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/server/relay.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/relay.js'`.

- [ ] **Step 3: relay.ts 최소 구현**

Create `src/server/relay.ts`:

```ts
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { CodeMsg } from "../shared/protocol.js";

export interface RelayHandle {
  port: number;
  close: () => Promise<void>;
}

interface Session {
  host?: WebSocket;
  phone?: WebSocket;
}

// 수익화 seam: 나중에 plan/limit 검사를 여기에 붙인다.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

export function startRelayServer(port: number): Promise<RelayHandle> {
  const sessions = new Map<string, Session>();
  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/host") {
      const code = generateCode();
      sessions.set(code, { host: ws });
      send(ws, { type: "code", code } satisfies CodeMsg);
      ws.on("close", () => sessions.delete(code));
    } else {
      ws.close();
    }
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise((res) => {
            wss.close(() => httpServer.close(() => res()));
          }),
      });
    });
  });
}
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/server/relay.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay issues pairing code to host on connect"
```

---

## Task 3: 중계서버 — 폰 참가 + 양방향 라우팅

**Files:**
- Modify: `src/server/relay.ts`
- Test: `tests/server/relay.test.ts`

폰이 코드로 참가하면 `paired`를 받고, 이후 폰↔host 메시지가 **원문 그대로** 전달된다. 잘못된 코드는 `error`.

- [ ] **Step 1: 실패하는 테스트 추가**

Append to `tests/server/relay.test.ts` (describe 블록 안):

```ts
  it("폰이 올바른 코드로 참가하면 paired를 받고, 양방향 전달된다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);

    const phone = new WebSocket(
      `ws://localhost:${handle.port}/phone?code=${code}`,
    );
    expect((await nextMessage(phone)).type).toBe("paired");

    // 폰 → host
    const hostGot = nextMessage(host);
    phone.send(JSON.stringify({ type: "command", text: "hi" }));
    expect(await hostGot).toEqual({ type: "command", text: "hi" });

    // host → 폰
    const phoneGot = nextMessage(phone);
    host.send(JSON.stringify({ type: "log", text: "working" }));
    expect(await phoneGot).toEqual({ type: "log", text: "working" });

    host.close();
    phone.close();
  });

  it("잘못된 코드로 참가하면 error를 받는다", async () => {
    handle = await startRelayServer(0);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=ZZZZZZ`);
    expect((await nextMessage(phone)).type).toBe("error");
    phone.close();
  });
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/server/relay.test.ts`
Expected: FAIL — 폰은 `/host`가 아니므로 현재는 즉시 close됨 (paired/라우팅 없음).

- [ ] **Step 3: relay.ts에 폰 라우팅 구현**

In `src/server/relay.ts`, `wss.on("connection", ...)` 콜백을 아래로 교체:

```ts
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/host") {
      const code = generateCode();
      sessions.set(code, { host: ws });
      send(ws, { type: "code", code } satisfies CodeMsg);
      ws.on("message", (data) => {
        const session = sessions.get(code);
        session?.phone?.send(data.toString());
      });
      ws.on("close", () => sessions.delete(code));
      return;
    }

    if (url.pathname === "/phone") {
      const code = url.searchParams.get("code") ?? "";
      const session = sessions.get(code);
      if (!session) {
        send(ws, { type: "error", text: "유효하지 않은 코드" } satisfies ErrorMsg);
        ws.close();
        return;
      }
      session.phone = ws;
      send(ws, { type: "paired" } satisfies PairedMsg);
      ws.on("message", (data) => {
        sessions.get(code)?.host?.send(data.toString());
      });
      ws.on("close", () => {
        const s = sessions.get(code);
        if (s) s.phone = undefined;
      });
      return;
    }

    ws.close();
  });
```

Add to the import line at top of `src/server/relay.ts`:

```ts
import type { CodeMsg, ErrorMsg, PairedMsg } from "../shared/protocol.js";
```

(기존 `import type { CodeMsg } ...` 줄을 위 줄로 교체)

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/server/relay.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay pairs phone by code and routes messages both ways"
```

---

## Task 4: 중계서버 진입점 + 정적 PWA 서빙

**Files:**
- Modify: `src/server/relay.ts` (정적 디렉터리 옵션 추가)
- Create: `src/server/index.ts`

폰이 PWA를 로드할 수 있도록 서버가 `src/web`을 정적 서빙한다. 진입점은 환경변수 PORT(기본 8080) 사용.

- [ ] **Step 1: relay.ts에 정적 서빙 옵션 추가**

In `src/server/relay.ts`, `startRelayServer` 시그니처와 httpServer 생성부를 교체:

```ts
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
```

함수 시그니처를 변경:

```ts
export function startRelayServer(
  port: number,
  staticDir?: string,
): Promise<RelayHandle> {
```

`const httpServer: Server = createServer();` 줄을 아래로 교체:

```ts
  const httpServer: Server = createServer(async (req, res) => {
    if (!staticDir) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rawPath = (req.url ?? "/").split("?")[0];
    const rel = rawPath === "/" ? "/index.html" : rawPath;
    const filePath = normalize(join(staticDir, rel));
    if (!filePath.startsWith(normalize(staticDir))) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(filePath);
      const ext = filePath.endsWith(".js") ? "text/javascript" : "text/html";
      res.writeHead(200, { "content-type": ext });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
```

- [ ] **Step 2: 기존 relay 테스트가 여전히 통과하는지 확인**

Run: `npx vitest run tests/server/relay.test.ts`
Expected: PASS (3 tests) — staticDir 미전달 시 동작 동일.

- [ ] **Step 3: 서버 진입점 작성**

Create `src/server/index.ts`:

```ts
import { join } from "node:path";
import { startRelayServer } from "./relay.js";

const port = Number(process.env.PORT ?? 8080);
const staticDir = join(process.cwd(), "src", "web");

startRelayServer(port, staticDir).then(({ port }) => {
  console.log(`중계서버 실행 중: http://localhost:${port}`);
  console.log(`폰 웹앱: 같은 WiFi에서 http://<PC의 LAN IP>:${port}`);
});
```

- [ ] **Step 4: 진입점 수동 확인**

Run: `npm run dev:server`
Expected: `중계서버 실행 중: http://localhost:8080` 출력. (Ctrl+C로 종료)

- [ ] **Step 5: Commit**

```bash
git add src/server/relay.ts src/server/index.ts
git commit -m "feat: serve static PWA from relay + server entrypoint"
```

---

## Task 5: CLI — Executor 인터페이스 + 명령 처리 로직

**Files:**
- Create: `src/cli/executor.ts` (인터페이스 + parseHostingUrl)
- Create: `src/cli/agent.ts`
- Test: `tests/cli/agent.test.ts`
- Test: `tests/cli/executor.test.ts`

`handleCommand`는 전송수단을 모르고 `send` 콜백만 받는다 → 가짜 executor로 순서를 검증한다. `parseHostingUrl`은 순수 함수로 따로 검증한다.

- [ ] **Step 1: Executor 인터페이스 + parseHostingUrl 작성**

Create `src/cli/executor.ts`:

```ts
export interface Executor {
  // command를 처리하고 진행 로그를 onLog로 흘리며, 최종 미리보기 URL을 반환한다.
  run(command: string, onLog: (line: string) => void): Promise<{ url: string }>;
}

// `firebase deploy` 출력에서 Hosting URL을 뽑는 순수 함수.
export function parseHostingUrl(output: string): string {
  const m = output.match(/Hosting URL:\s*(\S+)/);
  if (!m) throw new Error("배포 출력에서 Hosting URL을 찾지 못함");
  return m[1];
}
```

- [ ] **Step 2: parseHostingUrl 실패 테스트 작성**

Create `tests/cli/executor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseHostingUrl } from "../../src/cli/executor.js";

describe("parseHostingUrl", () => {
  it("Hosting URL을 추출한다", () => {
    const out = "✔ Deploy complete!\nHosting URL: https://demo.web.app\n";
    expect(parseHostingUrl(out)).toBe("https://demo.web.app");
  });

  it("URL이 없으면 throw 한다", () => {
    expect(() => parseHostingUrl("no url here")).toThrow();
  });
});
```

- [ ] **Step 3: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/cli/executor.test.ts`
Expected: PASS (2 tests). (구현은 Step 1에서 이미 됨)

- [ ] **Step 4: handleCommand 실패 테스트 작성**

Create `tests/cli/agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handleCommand } from "../../src/cli/agent.js";
import type { Executor } from "../../src/cli/executor.js";
import type { HostOutbound } from "../../src/shared/protocol.js";

describe("handleCommand", () => {
  it("성공 시 working→log→preview→done 순서로 보낸다", async () => {
    const sent: HostOutbound[] = [];
    const fake: Executor = {
      async run(_cmd, onLog) {
        onLog("생성 중");
        return { url: "https://x.web.app" };
      },
    };
    await handleCommand("앱 만들어", fake, (m) => sent.push(m));
    expect(sent).toEqual([
      { type: "status", state: "working", text: "작업 시작" },
      { type: "log", text: "생성 중" },
      { type: "preview", url: "https://x.web.app" },
      { type: "status", state: "done" },
    ]);
  });

  it("executor가 throw 하면 error 상태를 보낸다", async () => {
    const sent: HostOutbound[] = [];
    const fake: Executor = {
      async run() {
        throw new Error("실패함");
      },
    };
    await handleCommand("앱 만들어", fake, (m) => sent.push(m));
    expect(sent[0]).toEqual({ type: "status", state: "working", text: "작업 시작" });
    expect(sent.at(-1)).toMatchObject({ type: "status", state: "error" });
  });
});
```

- [ ] **Step 5: 테스트 실행해 실패 확인**

Run: `npx vitest run tests/cli/agent.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/agent.js'`.

- [ ] **Step 6: agent.ts 구현**

Create `src/cli/agent.ts`:

```ts
import type { Executor } from "./executor.js";
import type { HostOutbound } from "../shared/protocol.js";

export async function handleCommand(
  text: string,
  executor: Executor,
  send: (msg: HostOutbound) => void,
): Promise<void> {
  send({ type: "status", state: "working", text: "작업 시작" });
  try {
    const { url } = await executor.run(text, (line) =>
      send({ type: "log", text: line }),
    );
    send({ type: "preview", url });
    send({ type: "status", state: "done" });
  } catch (err) {
    send({ type: "status", state: "error", text: String(err) });
  }
}
```

- [ ] **Step 7: 테스트 실행해 통과 확인**

Run: `npx vitest run tests/cli/agent.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add src/cli/executor.ts src/cli/agent.ts tests/cli/agent.test.ts tests/cli/executor.test.ts
git commit -m "feat: CLI command handler + hosting URL parser with tests"
```

---

## Task 6: CLI — 실제 Executor + 진입점

**Files:**
- Modify: `src/cli/executor.ts` (RealExecutor 추가)
- Create: `src/cli/index.ts`

실제 `claude`/`firebase` 프로세스 실행은 단위테스트 대상이 아니다(Task 8에서 수동 검증). spawn 래퍼만 추가하고 진입점에서 서버에 host로 붙인다.

- [ ] **Step 1: RealExecutor 추가**

Append to `src/cli/executor.ts`:

```ts
import { spawn } from "node:child_process";

export class RealExecutor implements Executor {
  constructor(private projectDir: string) {}

  async run(
    command: string,
    onLog: (line: string) => void,
  ): Promise<{ url: string }> {
    onLog("Claude Code로 코드 생성 중...");
    await this.exec("claude", ["-p", command], onLog);
    onLog("Firebase에 배포 중...");
    const out = await this.exec(
      "firebase",
      ["deploy", "--only", "hosting"],
      onLog,
    );
    return { url: parseHostingUrl(out) };
  }

  private exec(
    cmd: string,
    args: string[],
    onLog: (line: string) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd: this.projectDir });
      let output = "";
      const onData = (buf: Buffer) => {
        const text = buf.toString();
        output += text;
        text.split("\n").filter(Boolean).forEach(onLog);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(output)
          : reject(new Error(`${cmd} 종료 코드 ${code}`)),
      );
    });
  }
}
```

- [ ] **Step 2: 기존 executor 테스트가 깨지지 않았는지 확인**

Run: `npx vitest run tests/cli/executor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: CLI 진입점 작성**

Create `src/cli/index.ts`:

```ts
import { join } from "node:path";
import { WebSocket } from "ws";
import { handleCommand } from "./agent.js";
import { RealExecutor } from "./executor.js";
import type { CommandMsg } from "../shared/protocol.js";

const relayUrl = process.env.RELAY_URL ?? "ws://localhost:8080";
const workdir = join(process.cwd(), "workspace");
const executor = new RealExecutor(workdir);

const ws = new WebSocket(`${relayUrl}/host`);

ws.on("open", () => console.log(`중계서버 연결됨: ${relayUrl}`));

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "code") {
    console.log(`\n📱 폰에서 이 코드를 입력하세요:  ${msg.code}\n`);
  } else if (msg.type === "command") {
    const cmd = msg as CommandMsg;
    console.log(`명령 수신: ${cmd.text}`);
    handleCommand(cmd.text, executor, (m) => ws.send(JSON.stringify(m)));
  }
});

ws.on("close", () => console.log("중계서버 연결 종료"));
```

- [ ] **Step 4: 진입점이 서버에 붙어 코드를 받는지 수동 확인**

터미널 A: `npm run dev:server`
터미널 B: `npm run dev:cli`
Expected: 터미널 B에 `중계서버 연결됨` 과 `📱 폰에서 이 코드를 입력하세요: XXXXXX` 출력. (둘 다 Ctrl+C)

- [ ] **Step 5: Commit**

```bash
git add src/cli/executor.ts src/cli/index.ts
git commit -m "feat: real executor (claude+firebase) and CLI host entrypoint"
```

---

## Task 7: 폰 웹앱 (PWA)

**Files:**
- Create: `src/web/index.html`
- Create: `src/web/app.js`

브라우저 UI라 단위테스트 대신 Task 8에서 수동 검증한다. 코드 입력→연결→채팅→로그→미리보기 iframe.

- [ ] **Step 1: index.html 작성**

Create `src/web/index.html`:

```html
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>connect-pc-mobile-claude</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 12px; background: #111; color: #eee; }
      input, button { font-size: 16px; padding: 8px; border-radius: 8px; border: 1px solid #444; }
      input { background: #222; color: #eee; }
      button { background: #2a6; color: #fff; border: none; }
      #log { height: 120px; overflow: auto; background: #000; padding: 8px; border-radius: 8px; font-size: 12px; white-space: pre-wrap; }
      #frame { width: 100%; height: 50vh; border: 1px solid #444; border-radius: 8px; margin-top: 8px; background: #fff; }
      .row { display: flex; gap: 8px; margin-bottom: 8px; }
      .row input { flex: 1; }
    </style>
  </head>
  <body>
    <h3>📱 connect-pc-mobile-claude</h3>
    <div id="pair" class="row">
      <input id="code" placeholder="페어링 코드 (예: ABC123)" />
      <button id="connect">연결</button>
    </div>
    <div id="chat" class="row" style="display:none">
      <input id="cmd" placeholder="만들고 싶은 걸 입력…" />
      <button id="send">보내기</button>
    </div>
    <div id="log">대기 중…</div>
    <iframe id="frame" title="미리보기"></iframe>
    <script src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: app.js 작성**

Create `src/web/app.js`:

```js
let ws;
const $ = (id) => document.getElementById(id);
const logEl = $("log");
function log(line) {
  logEl.textContent += "\n" + line;
  logEl.scrollTop = logEl.scrollHeight;
}

$("connect").onclick = () => {
  const code = $("code").value.trim().toUpperCase();
  if (!code) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/phone?code=${code}`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "paired") {
      log("✅ 연결됨! 명령을 입력하세요.");
      $("pair").style.display = "none";
      $("chat").style.display = "flex";
    } else if (msg.type === "error") {
      log("❌ " + msg.text);
    } else if (msg.type === "log") {
      log("· " + msg.text);
    } else if (msg.type === "status") {
      log(`[상태] ${msg.state}${msg.text ? ": " + msg.text : ""}`);
    } else if (msg.type === "preview") {
      log("🌐 미리보기: " + msg.url);
      $("frame").src = msg.url;
    }
  };
  ws.onclose = () => log("연결 종료됨");
};

$("send").onclick = () => {
  const text = $("cmd").value.trim();
  if (!text || !ws) return;
  ws.send(JSON.stringify({ type: "command", text }));
  log("> " + text);
  $("cmd").value = "";
};
```

- [ ] **Step 3: 정적 서빙 수동 확인**

터미널: `npm run dev:server`
브라우저(PC)에서 `http://localhost:8080` 열기.
Expected: 페어링 코드 입력 UI가 보인다.

- [ ] **Step 4: Commit**

```bash
git add src/web/index.html src/web/app.js
git commit -m "feat: phone PWA with pairing, chat, log, and preview iframe"
```

---

## Task 8: End-to-End 한 바퀴 수동 검증

**Files:** 없음 (통합 검증 + README 메모)

세 프로세스를 모두 띄워 폰→PC→배포→미리보기 한 바퀴를 확인한다.

- [ ] **Step 1: 사전 준비 확인**

PC에 다음이 설치/로그인되어 있어야 한다:
- `claude` (Claude Code, 로그인됨) — `claude --version`
- `firebase` (Firebase CLI, 로그인됨) — `firebase projects:list`
- `workspace/` 디렉터리에 `firebase init hosting` 완료된 프로젝트 (배포 대상)

Run: `mkdir -p workspace` (없으면 생성 후 `cd workspace && firebase init hosting` 수동 진행)

- [ ] **Step 2: 세 프로세스 기동**

터미널 A: `npm run dev:server`
터미널 B: `npm run dev:cli` → 출력된 페어링 코드 확인
폰 브라우저: `http://<PC의 LAN IP>:8080` 접속 → 코드 입력 → "연결" → `✅ 연결됨` 확인

(PC LAN IP 확인: macOS `ipconfig getifaddr en0`)

- [ ] **Step 3: 명령 한 바퀴 실행**

폰에서 예: "간단한 빨간 배경에 'Hello' 띄우는 페이지 만들어" 입력 → 보내기.
Expected:
- 폰 로그에 `[상태] working` → `· Claude Code로 코드 생성 중...` → `· Firebase에 배포 중...` → `🌐 미리보기: https://...` → `[상태] done` 순서로 표시
- 폰 하단 iframe에 배포된 페이지가 렌더링됨

- [ ] **Step 4: 결과 기록**

`README.md`를 생성해 실행 방법(서버/CLI 기동, 폰 접속, 사전 준비)을 5~10줄로 적는다. Run:

```bash
git add README.md
git commit -m "docs: README with MVP run instructions"
```

---

## 완료 기준 (Definition of Done)

- [ ] `npm test` 전부 통과 (relay 3 + agent 2 + executor 2 = 7 tests)
- [ ] 폰에서 명령 → PC가 생성·배포 → 폰 iframe에 미리보기까지 한 바퀴 수동 확인됨
- [ ] 중계서버는 메시지 내용을 파싱하지 않고 전달만 함(프라이버시) — relay.ts에 코드 내용 파싱 없음 확인
- [ ] 수익화 seam(`generateCode`/세션 생성 지점)이 한 곳에 모여 있어 나중에 limit 부착 가능
```
