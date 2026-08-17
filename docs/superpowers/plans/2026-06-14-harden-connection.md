# 연결 견고화 (Harden Connection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** "제품의 심장"인 폰↔PC 연결을 실제 환경에서 끊기지 않고 깨끗하게 유지한다 — 죽은 연결 자동 정리, 상대방 이탈 통지, CLI 자동 재연결, 폰 재페어링.

**Architecture:** 중계서버에 heartbeat(ping/pong)를 추가해 응답 없는 소켓을 종료(→기존 close 핸들러가 세션 정리). 호스트가 떠나면 폰에 error를 보내고 닫는다. 이미 폰이 붙은 세션의 두 번째 폰은 거부한다. CLI는 연결이 끊기면 지수 백오프로 재연결한다. 폰은 끊기면 페어링 UI로 돌아간다.

**Tech Stack:** 기존과 동일 (TypeScript/Node, ws, vitest). 순수 로직(backoff)은 단위테스트, 소켓 동작은 실제 ws 클라이언트로 테스트, 브라우저/재연결은 수동 검증.

---

## Task R1: 중계서버 — 상대 이탈 통지 + 중복 폰 거부

**Files:**
- Modify: `src/server/relay.ts`
- Test: `tests/server/relay.test.ts`

호스트가 끊기면 연결돼 있던 폰에 `{type:"error"}`를 보내고 폰 소켓을 닫는다(지금은 세션만 삭제하고 폰은 방치됨). 이미 폰이 OPEN 상태로 붙은 세션에 두 번째 폰이 코드로 들어오면 거부한다(지금은 조용히 덮어써서 첫 폰이 먹통이 됨).

- [ ] **Step 1: 실패 테스트 추가** — `tests/server/relay.test.ts`의 기존 `describe("relay pairing", ...)` 블록 안에 추가:

```ts
  it("호스트가 끊기면 폰에 에러를 보내고 연결을 닫는다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone); // paired

    const errMsg = nextMessage(phone);
    const phoneClosed = new Promise((r) => phone.once("close", r));
    host.close();

    expect((await errMsg).type).toBe("error");
    await phoneClosed; // 서버가 폰을 닫아준다
  });

  it("이미 폰이 연결된 세션에 두 번째 폰은 거부되고 첫 폰은 유지된다", async () => {
    handle = await startRelayServer(0);
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    const { code } = await nextMessage(host);
    const phone1 = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await nextMessage(phone1); // paired

    const phone2 = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    expect((await nextMessage(phone2)).type).toBe("error");

    // 첫 폰은 여전히 동작 (host→phone1 전달됨)
    const got = nextMessage(phone1);
    host.send(JSON.stringify({ type: "log", text: "still here" }));
    expect(await got).toEqual({ type: "log", text: "still here" });

    host.close();
    phone1.close();
  });
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/server/relay.test.ts` → 두 새 테스트 FAIL (호스트 close 시 폰 통지 없음 / 두 번째 폰이 첫 폰을 덮어씀).

- [ ] **Step 3: relay.ts 구현**

먼저 `send`처럼 닫힌 소켓에 안전하게 보내는 것이 필요하다. 기존 `send`는 항상 OPEN인 시점에만 쓰이지만, close 핸들러에서는 OPEN 확인이 필요하다. `forward` 헬퍼 아래에 추가:

```ts
function safeSend(target: WebSocket | undefined, msg: unknown): void {
  if (target && target.readyState === WebSocket.OPEN) {
    target.send(JSON.stringify(msg));
  }
}
```

`/phone` 분기에서 `const session = sessions.get(code);`로 세션을 찾은 직후, 없을 때 처리(기존) 다음에 "이미 폰 있음" 처리를 추가한다. 즉 기존:

```ts
      const session = sessions.get(code);
      if (!session) {
        send(ws, { type: "error", text: "유효하지 않은 코드" } satisfies ErrorMsg);
        ws.close();
        return;
      }
      session.phone = ws;
```

를 다음으로 교체:

```ts
      const session = sessions.get(code);
      if (!session) {
        send(ws, { type: "error", text: "유효하지 않은 코드" } satisfies ErrorMsg);
        ws.close();
        return;
      }
      if (session.phone && session.phone.readyState === WebSocket.OPEN) {
        send(ws, { type: "error", text: "이미 다른 기기가 연결되어 있습니다" } satisfies ErrorMsg);
        ws.close();
        return;
      }
      session.phone = ws;
```

`/host` 분기의 close 핸들러 `ws.on("close", () => sessions.delete(code));`를 다음으로 교체:

```ts
      ws.on("close", () => {
        const s = sessions.get(code);
        safeSend(s?.phone, { type: "error", text: "PC 연결이 끊겼습니다" } satisfies ErrorMsg);
        s?.phone?.close();
        sessions.delete(code);
      });
```

- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run tests/server/relay.test.ts` → 전부 PASS (기존 6 + 신규 2 = 8).

- [ ] **Step 5: Commit**

```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay notifies phone on host loss and rejects duplicate phones"
```

---

## Task R2: 중계서버 — heartbeat로 죽은 연결 정리

**Files:**
- Modify: `src/server/relay.ts`
- Test: `tests/server/relay.test.ts`

응답 없는(반쯤 죽은) 소켓을 주기적 ping/pong으로 감지해 종료한다. 종료되면 기존 close 핸들러가 세션을 정리하므로 sessions Map 무한 증가(리뷰 #3)가 방지된다. ping 주기는 옵션으로 받아 테스트에서 짧게 쓴다. 서버 close 시 타이머를 반드시 정리한다.

- [ ] **Step 1: 실패 테스트 추가** — 기존 describe 블록 안에 추가:

```ts
  it("heartbeat으로 연결된 클라이언트에 ping을 보낸다", async () => {
    handle = await startRelayServer(0, undefined, { heartbeatMs: 30 });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    await nextMessage(host); // code
    await new Promise<void>((resolve) => host.once("ping", () => resolve()));
    host.close();
  });
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/server/relay.test.ts` → 새 테스트 FAIL: `startRelayServer`가 세 번째 인자(opts)를 받지 않고 ping도 보내지 않음 → ping 이벤트가 안 와서 타임아웃.

- [ ] **Step 3: relay.ts 구현**

함수 시그니처를 옵션 인자를 받도록 변경:

```ts
export function startRelayServer(
  port: number,
  staticDir?: string,
  opts?: { heartbeatMs?: number },
): Promise<RelayHandle> {
```

`const wss = new WebSocketServer({ server: httpServer });` 다음에 heartbeat 설정을 추가:

```ts
  const heartbeatMs = opts?.heartbeatMs ?? 30000;
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const live = client as WebSocket & { isAlive?: boolean };
      if (live.isAlive === false) {
        client.terminate();
        continue;
      }
      live.isAlive = false;
      client.ping();
    }
  }, heartbeatMs);
```

`wss.on("connection", (ws, req) => {` 콜백의 **맨 처음**(`const url = ...` 위)에 liveness 초기화 추가:

```ts
    const live = ws as WebSocket & { isAlive?: boolean };
    live.isAlive = true;
    ws.on("pong", () => {
      live.isAlive = true;
    });
```

close()에서 타이머를 정리한다. 기존:

```ts
        close: () =>
          new Promise((res) => {
            wss.close(() => httpServer.close(() => res()));
          }),
```

를 다음으로 교체:

```ts
        close: () =>
          new Promise((res) => {
            clearInterval(heartbeat);
            wss.close(() => httpServer.close(() => res()));
          }),
```

- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run tests/server/relay.test.ts` → 전부 PASS (8 + 1 = 9). 스위트가 멈추지 않고 끝나면 타이머 정리도 정상.

- [ ] **Step 5: 전체 타입체크** — `npx tsc --noEmit` → 클린.

- [ ] **Step 6: Commit**

```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay heartbeat reaps dead sockets, clears timer on close"
```

---

## Task R3: CLI — 자동 재연결 (지수 백오프)

**Files:**
- Create: `src/cli/backoff.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/cli/backoff.test.ts`

연결이 끊기면 지수 백오프로 재연결을 반복한다. 백오프 계산은 순수 함수로 분리해 테스트한다. 재연결 시 새 페어링 코드를 다시 출력한다.

- [ ] **Step 1: backoff 실패 테스트 작성** — Create `tests/cli/backoff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextBackoff } from "../../src/cli/backoff.js";

describe("nextBackoff", () => {
  it("시도 횟수에 따라 지수적으로 증가한다", () => {
    expect(nextBackoff(0)).toBe(500);
    expect(nextBackoff(1)).toBe(1000);
    expect(nextBackoff(2)).toBe(2000);
  });

  it("최대값(10초)을 넘지 않는다", () => {
    expect(nextBackoff(10)).toBe(10000);
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/cli/backoff.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: backoff.ts 작성** — Create `src/cli/backoff.ts`:

```ts
// 재연결 지수 백오프(ms). attempt 0,1,2... → 500,1000,2000,... (상한 10초)
export function nextBackoff(attempt: number, baseMs = 500, maxMs = 10000): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}
```

- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run tests/cli/backoff.test.ts` → PASS (2).

- [ ] **Step 5: cli/index.ts를 재연결 구조로 변경** — `src/cli/index.ts` 전체를 다음으로 교체:

```ts
import { join } from "node:path";
import { WebSocket } from "ws";
import { handleCommand } from "./agent.js";
import { RealExecutor } from "./executor.js";
import { nextBackoff } from "./backoff.js";
import type { CommandMsg } from "../shared/protocol.js";

const relayUrl = process.env.RELAY_URL ?? "ws://localhost:8080";
const workdir = join(process.cwd(), "workspace");
const executor = new RealExecutor(workdir);

let attempt = 0;

function connect(): void {
  const ws = new WebSocket(`${relayUrl}/host`);

  ws.on("open", () => {
    attempt = 0;
    console.log(`중계서버 연결됨: ${relayUrl}`);
  });

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

  ws.on("close", () => {
    const delay = nextBackoff(attempt++);
    console.log(`중계서버 연결 종료 — ${delay}ms 후 재연결 시도`);
    setTimeout(connect, delay);
  });

  ws.on("error", () => {
    // close 이벤트가 이어서 발생하므로 여기서는 조용히 둔다
  });
}

connect();
```

- [ ] **Step 6: 수동 검증** — 백그라운드로 relay 기동(`npm run dev:server`), `npm run dev:cli` 실행 → `중계서버 연결됨` + 코드 출력 확인. 그 다음 relay를 죽였다가 다시 살리고, CLI 로그에 `재연결 시도` 후 `중계서버 연결됨` + 새 코드가 다시 뜨는지 확인. 확인 후 모든 프로세스 종료(아무것도 남기지 말 것).

- [ ] **Step 7: Commit**

```bash
git add src/cli/backoff.ts src/cli/index.ts tests/cli/backoff.test.ts
git commit -m "feat: CLI auto-reconnects to relay with exponential backoff"
```

---

## Task R4: 폰 — 연결 끊기면 재페어링 UI로 복귀

**Files:**
- Modify: `src/web/app.js`

연결이 끊기면(호스트 이탈/네트워크) 폰이 다시 페어링 코드 입력 화면으로 돌아가 재연결할 수 있게 한다. 지금은 onclose가 로그만 찍고 채팅 UI에 멈춰 있다.

- [ ] **Step 1: app.js 수정** — `src/web/app.js`에서 페어링 UI 토글을 함수로 빼고 onclose에서 호출한다.

`$("connect").onclick` 핸들러 안의 paired 처리:
```ts
    if (msg.type === "paired") {
      log("✅ 연결됨! 명령을 입력하세요.");
      $("pair").style.display = "none";
      $("chat").style.display = "flex";
    }
```
를 다음으로 교체(헬퍼 사용):
```ts
    if (msg.type === "paired") {
      log("✅ 연결됨! 명령을 입력하세요.");
      showChat();
    }
```

그리고 `ws.onclose = () => log("연결 종료됨");` 를 다음으로 교체:
```ts
  ws.onclose = () => {
    log("연결 종료됨 — 코드로 다시 연결하세요");
    showPairing();
  };
```

파일 상단(예: `function log(...)` 정의 다음)에 두 헬퍼를 추가:
```js
function showChat() {
  $("pair").style.display = "none";
  $("chat").style.display = "flex";
}
function showPairing() {
  $("pair").style.display = "flex";
  $("chat").style.display = "none";
}
```

- [ ] **Step 2: 정적 서빙 수동 확인** — relay 백그라운드 기동 후 `curl -s http://localhost:8080/app.js | grep -c showPairing` 로 헬퍼가 서빙되는지 확인(>=1), 그리고 브라우저에서 `http://localhost:8080` 가 정상 렌더되는지 확인. relay 종료.

- [ ] **Step 3: Commit**

```bash
git add src/web/app.js
git commit -m "feat: phone returns to pairing screen on disconnect"
```

---

## Task R5: README 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** README의 "MVP 상태/제약" 섹션에서 이번에 해결된 항목을 반영한다: 죽은 연결 자동 정리(heartbeat), 호스트 이탈 시 폰 통지, CLI 자동 재연결, 폰 재페어링이 추가되었음을 한두 줄로 기술. 남은 한계(인증/결제 없음, 수익화 seam 미구현)는 유지.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: note connection-hardening features in README"
```

---

## 완료 기준

- [ ] `npm test` 전부 통과 (기존 10 + R1 2 + R2 1 + R3 2 = 15)
- [ ] `npx tsc --noEmit` 클린
- [ ] 수동: relay 재시작 시 CLI가 자동 재연결하고 새 코드를 출력
- [ ] heartbeat 타이머가 서버 close 시 정리되어 테스트 스위트가 멈추지 않음
- [ ] 중계서버는 여전히 메시지 내용을 파싱하지 않고 원문 전달만 함
