# 중계서버 비밀번호 인증 (Relay Password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 공개 터널로 노출돼도 비밀번호를 모르면 연결(명령 전송)을 못 하도록, 중계서버에 공유 시크릿(비밀번호) 인증을 추가한다.

**Architecture:** 중계서버를 `RELAY_PASSWORD`로 시작하면, WebSocket 연결(`/host`, `/phone`) 시 쿼리 `secret`이 일치해야 한다. 불일치/누락 시 `error` 후 close. PWA 정적 파일(HTML/JS) 로드는 비번 불필요(화면은 떠야 비번을 입력하니까) — 명령을 나르는 WS 연결만 보호한다. 비번 미설정 시 기존과 동일하게 동작(하위호환). 페어링 코드는 그대로(세션 식별), 비밀번호는 인증.

**Tech Stack:** 기존과 동일 (TypeScript/Node, ws, vitest). 시크릿 비교는 단순 `===`(MVP; 상수시간 비교/rate-limit은 후속).

---

## Task P1: 중계서버 — secret 인증

**Files:**
- Modify: `src/server/relay.ts`
- Test: `tests/server/relay.test.ts`

`startRelayServer`의 opts에 `password`를 추가한다. password가 있으면 `/host`·`/phone` 연결 시 `?secret=<password>`가 일치해야 한다.

- [ ] **Step 1: 실패 테스트 추가** — `tests/server/relay.test.ts` 파일 끝(마지막 describe 블록들 뒤)에 새 describe 추가:

```ts
describe("relay password auth", () => {
  it("비밀번호가 설정되면 secret 없는 host 연결은 거부된다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host`);
    expect((await nextMessage(host)).type).toBe("error");
  });

  it("올바른 secret이면 host가 코드를 받는다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host?secret=pw123`);
    expect((await nextMessage(host)).type).toBe("code");
    host.close();
  });

  it("틀린 secret의 폰은 거부된다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host?secret=pw123`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}&secret=wrong`);
    expect((await nextMessage(phone)).type).toBe("error");
    host.close();
  });

  it("올바른 secret의 폰은 paired 된다", async () => {
    handle = await startRelayServer(0, undefined, { password: "pw123" });
    const host = new WebSocket(`ws://localhost:${handle.port}/host?secret=pw123`);
    const { code } = await nextMessage(host);
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}&secret=pw123`);
    expect((await nextMessage(phone)).type).toBe("paired");
    host.close();
    phone.close();
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/server/relay.test.ts` → password 미지원이라 새 테스트 FAIL(거부 기대인데 code/paired 옴).

- [ ] **Step 3: relay.ts 구현**

(a) 시그니처의 opts에 password 추가:
```ts
export function startRelayServer(
  port: number,
  staticDir?: string,
  opts?: { heartbeatMs?: number; password?: string },
): Promise<RelayHandle> {
```

(b) `const heartbeatMs = opts?.heartbeatMs ?? 30000;` 바로 아래에 추가:
```ts
  const password = opts?.password;
```

(c) `wss.on("connection", (ws, req) => {` 콜백에서 liveness 초기화와 `const url = new URL(...)` 다음, `if (url.pathname === "/host")` 분기 **앞**에 인증 게이트를 추가:
```ts
    if (password !== undefined && url.searchParams.get("secret") !== password) {
      send(ws, { type: "error", text: "인증 실패" } satisfies ErrorMsg);
      ws.close();
      return;
    }
```

- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run tests/server/relay.test.ts` → 전부 PASS (기존 9 + 신규 4 = 13). 기존 테스트(비번 미설정)도 그대로 통과해야 함(하위호환).

- [ ] **Step 5: 타입체크** — `npx tsc --noEmit` → 클린.

- [ ] **Step 6: Commit**
```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay requires shared-secret password when configured"
```

---

## Task P2: 서버·CLI·폰 배선 (secret 전달)

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/web/index.html`
- Modify: `src/web/app.js`

환경변수/입력칸으로 비밀번호를 받아 연결에 실어 보낸다.

- [ ] **Step 1: 서버 진입점** — `src/server/index.ts` 전체를 다음으로 교체:

```ts
import { join } from "node:path";
import { startRelayServer } from "./relay.js";

const port = Number(process.env.PORT ?? 8080);
const staticDir = join(process.cwd(), "src", "web");
const password = process.env.RELAY_PASSWORD;

startRelayServer(port, staticDir, { password }).then(({ port }) => {
  console.log(`중계서버 실행 중: http://localhost:${port}`);
  console.log(`폰 웹앱: http://<PC의 LAN IP 또는 터널 주소>:${port}`);
  if (password) {
    console.log("🔒 비밀번호 보호: 켜짐");
  } else {
    console.log("⚠️  비밀번호 미설정 — 누구나 접속 가능(로컬/테스트 전용). RELAY_PASSWORD로 설정하세요.");
  }
});
```

(주의: `password`가 `undefined`여도 `{ password: undefined }`를 넘기므로 relay에서 `password !== undefined` 검사로 인증이 비활성화됨 — 하위호환 유지.)

- [ ] **Step 2: CLI** — `src/cli/index.ts`의 `connect()` 함수 안 첫 줄 `const ws = new WebSocket(`${relayUrl}/host`);` 를 다음으로 교체:

```ts
  const password = process.env.RELAY_PASSWORD;
  const hostUrl = password
    ? `${relayUrl}/host?secret=${encodeURIComponent(password)}`
    : `${relayUrl}/host`;
  const ws = new WebSocket(hostUrl);
```

- [ ] **Step 3: 폰 HTML** — `src/web/index.html`의 `#pair` 행에 비밀번호 입력칸을 코드 입력칸 다음에 추가. 즉:

```html
    <div id="pair" class="row">
      <input id="code" placeholder="페어링 코드 (예: ABC123)" />
      <button id="connect">연결</button>
    </div>
```
를 다음으로 교체:
```html
    <div id="pair" class="row">
      <input id="code" placeholder="페어링 코드 (예: ABC123)" />
      <input id="pw" type="password" placeholder="비밀번호" />
      <button id="connect">연결</button>
    </div>
```

- [ ] **Step 4: 폰 app.js** — `src/web/app.js`의 연결 부분에서 secret을 URL에 포함. 즉:

```js
  const code = $("code").value.trim().toUpperCase();
  if (!code) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/phone?code=${code}`);
```
를 다음으로 교체:
```js
  const code = $("code").value.trim().toUpperCase();
  if (!code) return;
  const pw = $("pw").value;
  const secret = pw ? `&secret=${encodeURIComponent(pw)}` : "";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/phone?code=${code}${secret}`);
```

- [ ] **Step 5: 수동 검증** — 비밀번호로 보호된 한 바퀴 핸드셰이크를 확인(실제 claude/firebase 없이 연결까지만):
  - 백그라운드로 `RELAY_PASSWORD=test123 PORT=8080 npm run dev:server` 기동 → 로그에 `🔒 비밀번호 보호: 켜짐` 확인.
  - 백그라운드로 `RELAY_PASSWORD=test123 npm run dev:cli` 기동 → `중계서버 연결됨` + 페어링 코드 출력 확인(= host가 secret으로 인증 성공).
  - `curl -s http://localhost:8080/ | grep -c '비밀번호'` → 폰 HTML에 비밀번호 칸이 서빙되는지(>=1) 확인.
  - 모든 백그라운드 프로세스 종료(남기지 말 것).

- [ ] **Step 6: 타입체크 + 전체 테스트** — `npx tsc --noEmit` 클린, `npx vitest run` 전부 통과(13).

- [ ] **Step 7: Commit**
```bash
git add src/server/index.ts src/cli/index.ts src/web/index.html src/web/app.js
git commit -m "feat: pass relay password from env (server/CLI) and phone input"
```

---

## Task P3: README 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** README에 `RELAY_PASSWORD` 사용법을 추가한다(환경변수 섹션 + 보안 관련 한 줄). 핵심: 서버와 CLI를 같은 `RELAY_PASSWORD`로 실행하고, 폰에서 같은 비밀번호를 입력해야 연결됨. 비번 미설정 시 누구나 접속 가능하므로 터널/공개 노출 시 반드시 설정 권장. 기존 환경변수(PORT, RELAY_URL) 설명은 유지.

- [ ] **Step 2: Commit**
```bash
git add README.md
git commit -m "docs: document RELAY_PASSWORD usage"
```

---

## 완료 기준

- [ ] `npm test` 전부 통과 (기존 9 + 신규 4 = 13)
- [ ] `npx tsc --noEmit` 클린
- [ ] 비번 설정 시: secret 없는/틀린 연결은 거부, 맞으면 code/paired
- [ ] 비번 미설정 시: 기존과 동일 동작(하위호환)
- [ ] 폰 UI에 비밀번호 입력칸 존재, secret이 WS URL에 인코딩되어 전달
- [ ] 정적 PWA 로드는 비번 없이 가능(연결만 보호)
