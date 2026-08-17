# ID/비밀번호 로그인 + 자동 로그인 — 구현 계획 (계획 ②/④)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰 로그인을 "코드+비밀번호 2개 암기"에서 사용자가 정한 **ID+비밀번호 한 폼**으로 바꾸고, 같은 실행 안에서는 브라우저를 나갔다 와도 **자동 로그인**되게 한다.

**Architecture:** 자격증명은 `.relay-auth.json`(신규 auth-store, `.relay-password` 마이그레이션 승계). 릴레이 `/phone` 인증을 3경로로 확장 — ① 레거시 `?code&secret`(dev·기존 테스트 계약 유지) ② `?id&secret`(신규 로그인 — host 살아있는 최신 세션에 부착) ③ `?phoneToken`(자동 로그인 — 세션 수명 한정 고엔트로피 토큰, `paired`로 발급, 폰이 localStorage에 저장). 코드 개념은 사용자 눈에서 제거(공유 카드·링크는 `아이디`/`#id=`).

**Tech Stack:** 기존과 동일(TS ESM, vitest, 바닐라 JS 웹). **신규 의존성 없음.**

**Spec:** `docs/superpowers/specs/2026-07-11-login-onboarding-ux-design.md` §1·§2·§7~§9 (— §3 시작 설정 UI는 **계획 ③**으로 분리, §4~§6 폰 UX는 **계획 ④**).

## Global Constraints

- 자격증명 파일 쓰기는 원자적(tmp+renameSync) + **mode 0o600** (`.relay-password`와 동일).
- 우선순위: `RELAY_ID`/`RELAY_PASSWORD` 환경변수 > `.relay-auth.json` > (npm start 시) `.relay-password` 승계 생성(id 기본 `"admin"`). `RELAY_PASSWORD`만 있고 id가 없으면 id는 `"dev"`(기존 dev 워크플로 호환).
- 검증: ID `/^[a-z][a-z0-9]{2,19}$/`(영문 소문자 시작 3~20자), 비밀번호 4자 이상(현행 유지).
- 비밀번호를 링크·로그에 절대 넣지 않는다(`#id=`만 허용). phoneToken은 `crypto.randomBytes(32).hex` — 세션 수명 한정.
- 레거시 `?code&secret` 폰 경로와 host 인증(`?secret`)·reconnectKey 메커니즘은 **동작 불변**(기존 relay 테스트가 깨지면 안 된다).
- 주석·사용자 대면 문자열 한국어. `npm test` + `npx tsc --noEmit` 클린. 커밋은 태스크마다, 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

| 파일 | 역할 |
|---|---|
| `src/shared/auth-store.ts` (신규) | `.relay-auth.json` 읽기/쓰기/검증/마이그레이션 |
| `scripts/set-password.ts` (수정) | auth 파일의 password 필드 갱신으로 재지정 |
| `src/shared/protocol.ts` (수정) | `PairedMsg.phoneToken` |
| `src/server/relay.ts` (수정) | `/phone` 3경로 인증, `Session.phoneToken`, `getPhoneAuth` opts |
| `src/launch.ts`·`src/server/index.ts` (수정) | auth 결정·배선, 공유 카드 문구(코드 삭제→아이디) |
| `src/web/index.html`·`src/web/app.js` (수정) | 로그인 폼(id/pw·`#id=` 프리필), 자동 로그인·순단 재접속 |
| `.gitignore`·`README.md`·`docs/SETUP-customer.md`·`docs/ACCEPTANCE.md` (수정) | 문서 |

---

### Task 1: auth-store + set-password 재지정

**Files:**
- Create: `src/shared/auth-store.ts`
- Modify: `scripts/set-password.ts`
- Test: `tests/shared/auth-store.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RelayAuth { id: string; password: string }
export function authFilePath(cwd: string): string;                       // <cwd>/.relay-auth.json
export function normalizeAuthId(raw: string): string;                    // 검증 실패 시 throw(한국어)
export function normalizeAuthPassword(raw: string): string;              // 4자 미만 throw
export function readRelayAuth(cwd: string): RelayAuth | undefined;       // env > 파일 > (RELAY_PASSWORD만) id "dev" > undefined
export function writeRelayAuth(cwd: string, raw: RelayAuth): RelayAuth;  // 검증+원자적+0600
export function resolveOrCreateRelayAuth(cwd: string): { auth: RelayAuth; created: boolean }; // 없으면 .relay-password 승계(id "admin") 또는 랜덤 생성
```

- [ ] **Step 1: 실패하는 테스트** — `tests/shared/auth-store.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authFilePath, normalizeAuthId, readRelayAuth, resolveOrCreateRelayAuth, writeRelayAuth,
} from "../../src/shared/auth-store.js";

let root: string;
const ENV_KEYS = ["RELAY_ID", "RELAY_PASSWORD"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "auth-"));
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("normalizeAuthId", () => {
  it("소문자 강제·규칙 검증", () => {
    expect(normalizeAuthId(" TestUser ")).toBe("testuser");
    expect(() => normalizeAuthId("ab")).toThrow();        // 3자 미만
    expect(() => normalizeAuthId("1abc")).toThrow();      // 숫자 시작
    expect(() => normalizeAuthId("한글아이디")).toThrow();
  });
});

describe("read/write", () => {
  it("쓰기(0600) 후 재읽기 왕복", () => {
    writeRelayAuth(root, { id: "TestUser", password: " pw1234 " });
    expect(statSync(authFilePath(root)).mode & 0o777).toBe(0o600);
    expect(readRelayAuth(root)).toEqual({ id: "testuser", password: "pw1234" });
  });
  it("파일 없음 → undefined, 깨진 파일 → undefined", () => {
    expect(readRelayAuth(root)).toBeUndefined();
    writeFileSync(authFilePath(root), "{broken");
    expect(readRelayAuth(root)).toBeUndefined();
  });
  it("env 우선순위: RELAY_ID+RELAY_PASSWORD > 파일, RELAY_PASSWORD 단독은 파일 id에 pw만 덮음", () => {
    writeRelayAuth(root, { id: "fileid", password: "filepw" });
    process.env.RELAY_ID = "envid";
    process.env.RELAY_PASSWORD = "envpw";
    expect(readRelayAuth(root)).toEqual({ id: "envid", password: "envpw" });
    delete process.env.RELAY_ID;
    expect(readRelayAuth(root)).toEqual({ id: "fileid", password: "envpw" });
  });
  it("RELAY_PASSWORD만 있고 파일 없음 → id는 dev(기존 dev 워크플로)", () => {
    process.env.RELAY_PASSWORD = "devpw";
    expect(readRelayAuth(root)).toEqual({ id: "dev", password: "devpw" });
  });
});

describe("resolveOrCreateRelayAuth", () => {
  it(".relay-password가 있으면 그 비밀번호를 승계(id admin)하고 파일을 만든다", () => {
    writeFileSync(join(root, ".relay-password"), "legacy99\n");
    const { auth, created } = resolveOrCreateRelayAuth(root);
    expect(created).toBe(true);
    expect(auth).toEqual({ id: "admin", password: "legacy99" });
    expect(existsSync(authFilePath(root))).toBe(true);
    // 두 번째 호출은 기존 파일 사용
    expect(resolveOrCreateRelayAuth(root)).toEqual({ auth, created: false });
  });
  it("아무것도 없으면 랜덤 비밀번호로 생성", () => {
    const { auth, created } = resolveOrCreateRelayAuth(root);
    expect(created).toBe(true);
    expect(auth.id).toBe("admin");
    expect(auth.password.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/shared/auth-store.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** — `src/shared/auth-store.ts`:

```ts
// 폰 로그인 자격증명(.relay-auth.json): 사용자가 정한 id+password 한 쌍.
// .relay-password(비밀번호 단독)의 후속 — 기존 파일이 있으면 비밀번호를 승계한다.
// 평문 로컬 파일(0600) — .relay-password와 같은 신뢰 모델(스펙 §8).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface RelayAuth { id: string; password: string }

const FILE_NAME = ".relay-auth.json";
export const MIN_PASSWORD_LENGTH = 4; // relay-password.ts와 동일 규칙
const ID_RE = /^[a-z][a-z0-9]{2,19}$/;

export function authFilePath(cwd: string): string {
  return join(cwd, FILE_NAME);
}

export function normalizeAuthId(raw: string): string {
  const id = raw.trim().toLowerCase();
  if (!ID_RE.test(id)) {
    throw new Error("아이디는 영문 소문자로 시작하는 영문/숫자 3~20자여야 해요.");
  }
  return id;
}

export function normalizeAuthPassword(raw: string): string {
  const pw = raw.trim();
  if (pw.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`);
  }
  return pw;
}

// 우선순위: RELAY_ID+RELAY_PASSWORD(둘 다) > 파일(RELAY_PASSWORD가 있으면 pw만 덮음)
// > RELAY_PASSWORD 단독(id "dev" — 기존 dev 워크플로 호환) > undefined.
export function readRelayAuth(cwd: string): RelayAuth | undefined {
  const envId = process.env.RELAY_ID;
  const envPw = process.env.RELAY_PASSWORD;
  if (envId && envPw) {
    try {
      return { id: normalizeAuthId(envId), password: normalizeAuthPassword(envPw) };
    } catch {
      return undefined; // env 값이 규칙 위반이면 미설정 취급(조용한 절반 적용 방지)
    }
  }
  const f = authFilePath(cwd);
  if (existsSync(f)) {
    try {
      const o = JSON.parse(readFileSync(f, "utf8"));
      if (typeof o.id === "string" && o.id && typeof o.password === "string" && o.password) {
        return { id: o.id, password: envPw || o.password };
      }
    } catch { /* 깨진 파일 → 미설정 취급 */ }
  }
  if (envPw) return { id: "dev", password: envPw };
  return undefined;
}

export function writeRelayAuth(cwd: string, raw: RelayAuth): RelayAuth {
  const auth = {
    id: normalizeAuthId(raw.id),
    password: normalizeAuthPassword(raw.password),
  };
  const p = authFilePath(cwd);
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, p);
  return auth;
}

// npm start용: 없으면 만들어 저장해 다음 실행부터 고정한다.
// 마이그레이션: .relay-password가 있으면 그 비밀번호를 승계한다(id는 "admin").
export function resolveOrCreateRelayAuth(cwd: string): { auth: RelayAuth; created: boolean } {
  const existing = readRelayAuth(cwd);
  if (existing) return { auth: existing, created: false };
  let password: string | undefined;
  const legacy = join(cwd, ".relay-password");
  if (existsSync(legacy)) {
    const pw = readFileSync(legacy, "utf8").trim();
    if (pw) password = pw;
  }
  const auth = writeRelayAuth(cwd, {
    id: "admin",
    password: password ?? randomBytes(6).toString("base64url"),
  });
  return { auth, created: true };
}
```

`scripts/set-password.ts`: 기존 파일을 읽고 인터페이스(`npm run set-password -- <값>`)를 유지한 채, 본문을 auth-store 기반으로 교체한다 — 기존 auth의 id를 보존하고 password만 갱신, auth 파일이 없으면 id `"admin"`으로 생성. 기존 `.relay-password` 갱신 로직은 제거(단일 정본화). 출력 문구에 저장 위치(`.relay-auth.json`)와 아이디를 안내.

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm test` → PASS, `npx tsc --noEmit` → clean

```bash
git add src/shared/auth-store.ts scripts/set-password.ts tests/shared/auth-store.test.ts
git commit -m "feat(auth): .relay-auth.json 자격증명 저장소 + set-password 재지정"
```

---

### Task 2: 릴레이 — /phone 3경로 인증 + phoneToken

**Files:**
- Modify: `src/shared/protocol.ts` (`PairedMsg`에 `phoneToken: string` 추가)
- Modify: `src/server/relay.ts`
- Test: `tests/server/relay.test.ts`

**Interfaces:**
- Consumes: 없음(자격증명은 콜백으로 주입).
- Produces: `startRelayServer(port, staticDir, opts)`의 opts에 `getPhoneAuth?: () => { id: string; password: string } | undefined` 추가. `Session`에 `phoneToken: string`(세션 생성 시 `randomBytes(32).hex`). `paired` 메시지가 `{ type, token, phoneToken }`.

- [ ] **Step 1: 실패하는 테스트** — `tests/server/relay.test.ts`에 추가(이 파일의 기존 host/phone ws 헬퍼 패턴을 따른다 — startRelayServer에 `getPhoneAuth: () => ({ id: "testuser", password: "pw1234" })` 옵션을 주는 새 describe 블록):

```ts
describe("ID/비밀번호 로그인", () => {
  it("id+secret이 맞으면 host 살아있는 세션에 paired(phoneToken 포함)", async () => {
    // host 접속(기존 헬퍼) 후:
    const phone = await connectPhone(`/phone?id=testuser&secret=pw1234`);
    const msg = await nextMsg(phone);
    expect(msg.type).toBe("paired");
    expect(typeof msg.phoneToken).toBe("string");
    expect(msg.phoneToken.length).toBe(64);
  });
  it("비밀번호 불일치·미설정 각각 한국어 오류 후 종료", async () => {
    const bad = await connectPhone(`/phone?id=testuser&secret=wrong`);
    expect((await nextMsg(bad)).text).toContain("아이디 또는 비밀번호");
    // getPhoneAuth가 undefined를 반환하는 릴레이 인스턴스에서:
    const unset = await connectPhone(`/phone?id=a&secret=b`);
    expect((await nextMsg(unset)).text).toContain("초기 설정");
  });
  it("host 없는 상태의 id 로그인은 'PC가 아직 준비되지 않았어요'", async () => {
    // host 미접속 릴레이에서
    const phone = await connectPhone(`/phone?id=testuser&secret=pw1234`);
    expect((await nextMsg(phone)).text).toContain("PC가 아직");
  });
  it("phoneToken 재접속: paired 후 끊고 토큰만으로 다시 paired", async () => {
    const p1 = await connectPhone(`/phone?id=testuser&secret=pw1234`);
    const t = (await nextMsg(p1)).phoneToken;
    p1.close(); await waitClosed(p1);
    const p2 = await connectPhone(`/phone?phoneToken=${t}`);
    expect((await nextMsg(p2)).type).toBe("paired");
    const p3 = await connectPhone(`/phone?phoneToken=deadbeef`);
    expect((await nextMsg(p3)).text).toContain("만료");
  });
});
```

(`connectPhone`/`nextMsg`/`waitClosed`가 없으면 그 파일의 기존 접속·수신 패턴을 그대로 사용해 동등하게 작성한다. 기존 code+secret 테스트는 **수정 없이** 통과해야 한다.)

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/server/relay.test.ts` → 신규 FAIL, 기존 PASS

- [ ] **Step 3: 구현** — `src/server/relay.ts`:

1. `Session`에 `phoneToken: string;` 추가, 신규 세션 생성부(`sessions.set(code, session)` 직전 객체)에 `phoneToken: generatePhoneToken(),` 추가. 헬퍼:

```ts
// 폰 자동 로그인용 세션 토큰(paired로 폰에 전달, localStorage 저장).
// 세션 수명 한정 — 릴레이 재시작이면 무효(스펙 §8).
function generatePhoneToken(): string {
  return randomBytes(32).toString("hex");
}
```

2. opts 타입에 `getPhoneAuth?: () => { id: string; password: string } | undefined;` 추가하고 `const getPhoneAuth = opts?.getPhoneAuth;`.

3. 연결 최상단의 공통 secret 게이트(`if (password !== undefined && ...)`)를 **`/host` 분기 안으로** 이동한다(폰 인증은 경로별 — 아래).

4. `/phone` 분기 전체 교체:

```ts
    if (url.pathname === "/phone") {
      const code = url.searchParams.get("code") ?? "";
      const presentedToken = url.searchParams.get("phoneToken") ?? "";
      let session: Session | undefined;
      if (code) {
        // 레거시 경로(코드 페어링): dev·기존 계약 유지 — 공유 비밀 대조
        if (password !== undefined && url.searchParams.get("secret") !== password) {
          send(ws, { type: "error", text: "인증 실패" } satisfies ErrorMsg);
          ws.close();
          return;
        }
        session = sessions.get(code);
        if (!session) {
          send(ws, { type: "error", text: "유효하지 않은 코드" } satisfies ErrorMsg);
          ws.close();
          return;
        }
      } else if (presentedToken) {
        // 자동 로그인: 세션 저장 phoneToken 상등(고엔트로피). 세션 소멸 = 토큰 무효.
        for (const s of sessions.values()) {
          if (s.phoneToken === presentedToken) session = s;
        }
        if (!session) {
          send(ws, { type: "error", text: "세션이 만료됐어요 — 다시 로그인해 주세요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
      } else {
        // ID/비밀번호 로그인(스펙 §1): 코드 개념 없이 유일한 활성 host 세션에 붙인다.
        const auth = getPhoneAuth?.();
        if (!auth) {
          send(ws, { type: "error", text: "PC에서 초기 설정을 먼저 완료해 주세요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
        const id = url.searchParams.get("id") ?? "";
        const secret = url.searchParams.get("secret") ?? "";
        if (id !== auth.id || secret !== auth.password) {
          send(ws, { type: "error", text: "아이디 또는 비밀번호가 올바르지 않아요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
        // 재연결 유예로 세션이 2개 이상일 수 있음 — host 소켓이 살아있는 최신 세션(삽입순 마지막)
        for (const s of sessions.values()) {
          if (s.host && s.host.readyState === WebSocket.OPEN) session = s;
        }
        if (!session) {
          send(ws, { type: "error", text: "PC가 아직 준비되지 않았어요 — 잠시 후 다시 시도하세요" } satisfies ErrorMsg);
          ws.close();
          return;
        }
      }
      if (session.phone && session.phone.readyState === WebSocket.OPEN) {
        send(ws, { type: "error", text: "이미 다른 기기가 연결되어 있습니다" } satisfies ErrorMsg);
        ws.close();
        return;
      }
      const sess = session; // code 없는 경로도 있으므로 세션 객체로 캡처(호스트 스왑은 같은 객체를 공유)
      sess.phone = ws;
      send(ws, { type: "paired", token: sess.previewToken, phoneToken: sess.phoneToken } satisfies PairedMsg);
      ws.on("message", (data) => {
        forward(sess.host, data.toString());
      });
      ws.on("close", () => {
        if (sess.phone === ws) sess.phone = undefined;
      });
      return;
    }
```

(주의: 기존 `/phone` 핸들러의 `sessions.get(code)` 참조를 세션 객체 캡처로 바꾸는 것은 동작 동일 — host 재연결 시 같은 `Session` 객체의 `host` 필드가 교체되고, TTL 삭제 시 `host`/`phone`이 정리되므로 stale 전송은 기존 `forward` 가드가 막는다.)

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm test` → PASS(기존 relay 테스트 무수정 통과 필수), `npx tsc --noEmit` → clean

```bash
git add src/shared/protocol.ts src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat(relay): /phone id/비밀번호·phoneToken 인증 경로 추가"
```

---

### Task 3: launch/dev 배선 + 공유 카드 문구

**Files:**
- Modify: `src/launch.ts`, `src/server/index.ts`
- Test: 기존 스위트 회귀(launch는 수동 검증 — Task 5 스모크)

**Interfaces:**
- Consumes: Task 1 `resolveOrCreateRelayAuth`/`readRelayAuth`, Task 2 `getPhoneAuth` opts.

- [ ] **Step 1: launch.ts** — `resolveOrCreateRelayPassword` 사용을 auth로 교체:

```ts
import { readRelayAuth, resolveOrCreateRelayAuth } from "./shared/auth-store.js";

// 우선순위: RELAY_ID/RELAY_PASSWORD > .relay-auth.json > .relay-password 승계 생성.
const { auth, created: authCreated } = resolveOrCreateRelayAuth(process.cwd());
const password = auth.password; // host 게이트·레거시 경로용 공유 비밀(값은 로그인 비밀번호와 동일)
```

`startRelayServer(...)` 호출에 `getPhoneAuth: () => readRelayAuth(process.cwd()) ?? auth,` 추가(관리 페이지(계획 ③)가 파일을 바꾸면 다음 로그인부터 반영되도록 매 로그인 시 재읽기).

`printCardIfReady()`의 카드 본문 교체(코드 줄 삭제):

```ts
  console.log("\n========================================");
  console.log("✅ 준비 완료! 폰에서 아래로 접속하세요");
  console.log(`  주소:   ${tunnelUrl}`);
  console.log(`  아이디:  ${auth.id}`);
  console.log(`  비밀번호: ${auth.password}`);
  console.log(`  ── 또는 이 링크 하나만 폰에서 열기(아이디 자동 입력) ──`);
  console.log(`  링크:   ${tunnelUrl}/#id=${auth.id}`);
  console.log(
    licensed ? "  상태:   ✅ 정품" : "  상태:   🧪 체험판 (프로젝트 1개 · 구매 시 무제한)",
  );
  if (authCreated) {
    console.log("  (비밀번호 변경: npm run set-password -- <원하는값> · 아이디는 .relay-auth.json)");
  }
  console.log("========================================\n");
```

`code` 변수·`onCode`의 카드 트리거는 유지(host 준비 신호로 여전히 사용) — 카드에 코드를 **출력만 안 한다**.

- [ ] **Step 2: src/server/index.ts** — `startRelayServer` 옵션에 추가:

```ts
import { readRelayAuth } from "../shared/auth-store.js";
// ...
startRelayServer(port, staticDir, {
  password,
  previewDir: projectsRoot,
  // RELAY_PASSWORD만 설정된 dev 흐름이면 id는 "dev"가 된다(auth-store 규칙)
  getPhoneAuth: () => readRelayAuth(process.cwd()),
}).then(
```

안내 로그에 한 줄 추가: `console.log('폰 로그인: 아이디/비밀번호 (RELAY_PASSWORD만 설정 시 아이디는 "dev")');`

- [ ] **Step 3: 통과 확인 + 커밋**

Run: `npm test` → PASS, `npx tsc --noEmit` → clean

```bash
git add src/launch.ts src/server/index.ts
git commit -m "feat(launch): 공유 카드를 아이디/비밀번호 체계로 전환"
```

---

### Task 4: 폰 로그인 폼 + 자동 로그인

**Files:**
- Modify: `src/web/index.html`, `src/web/app.js`

**Interfaces:**
- Consumes: `paired.phoneToken`(Task 2), `/phone?id=&secret=` · `/phone?id=&phoneToken=` 쿼리.
- localStorage 키 `cpmc_auth` = `{"id","phoneToken"}` (origin 단위 — 터널 주소가 바뀌면 자연히 비워짐 = 재시작 후 첫 1회 로그인 필요, 스펙 §2 한계).

- [ ] **Step 1: index.html 페어링 블록 교체** — `#code` 입력을 아이디로:

```html
    <!-- ① 로그인 -->
    <div id="screen-pair" class="screen">
      <h3>📱 connect-pc-mobile-claude</h3>
      <div id="pair">
        <input id="loginId" placeholder="아이디" autocapitalize="none" autocomplete="username" />
        <input id="pw" type="password" placeholder="비밀번호" autocomplete="current-password" />
        <button id="connect">로그인</button>
      </div>
      <div id="pairStatus" hidden></div>
    </div>
```

- [ ] **Step 2: app.js 페어링 섹션 재작성** — 기존 `$("connect").onclick` 블록과 `prefillFromLink`를 다음으로 교체(웹소켓 onmessage 내부의 기존 메시지 처리 본문은 그대로 재사용):

```js
// ---------- 로그인 · 자동 로그인 ----------
// localStorage는 origin 단위 — 터널 주소가 바뀌는 재시작 후에는 첫 1회 로그인이 필요하다(스펙 §2).
const AUTH_KEY = "cpmc_auth";
function savedAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
function saveAuth(a) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch {} }
function clearAuth() { try { localStorage.removeItem(AUTH_KEY); } catch {} }

let loginId = ""; // 마지막으로 시도한 아이디(paired 시 토큰과 함께 저장)
let retryTimer = null;

function startConnection(query, silent) {
  clearTimeout(retryTimer);
  paired = false;
  previewToken = null;
  pairStatus(silent ? "🔄 자동 로그인 중…" : "⏳ 연결 중…", "info");
  if (!silent) setConnecting(true);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/phone?${query}`);

  ws.onopen = () => pairStatus("🔌 서버 연결됨 — 인증 확인 중…", "info");
  ws.onerror = () => pairStatus("❌ 연결 오류 — 주소·네트워크를 확인하세요", "err");

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "paired") {
      paired = true;
      previewToken = msg.token;
      if (msg.phoneToken && loginId) saveAuth({ id: loginId, phoneToken: msg.phoneToken });
      setConnecting(false);
      pairStatus("", "ok");
      store.screen = { name: "home" };
      send({ type: "listProjects" });
      send({ type: "pipeline_sync" });
      send({ type: "tpl_list" });
      render();
      return;
    }
    if (msg.type === "error") {
      // 인증 계열 오류면 저장 토큰을 폐기해 로그인 폼으로 유도
      if (!paired && /만료|올바르지 않|초기 설정/.test(msg.text)) clearAuth();
      if (paired) toast("❌ " + msg.text);
      else pairStatus("❌ " + msg.text, "err");
      return;
    }
    // …(기존 onmessage의 preview/applyMessage/stage_update 처리 본문 그대로)…
  };

  ws.onclose = () => {
    setConnecting(false);
    const wasPaired = paired;
    paired = false;
    previewToken = null;
    render();
    const auth = savedAuth();
    if (wasPaired && auth && auth.phoneToken) {
      // 순단 — 토큰으로 조용히 재접속(세션 만료면 위 error 처리에서 토큰이 지워져 폼으로 감)
      pairStatus("🔄 연결이 끊겨 자동 재접속 중…", "info");
      retryTimer = setTimeout(
        () => startConnection(`id=${encodeURIComponent(auth.id)}&phoneToken=${encodeURIComponent(auth.phoneToken)}`, true),
        1500,
      );
      return;
    }
    if (!wasPaired) {
      if ($("pairStatus").textContent.indexOf("❌") === -1)
        pairStatus("❌ 연결 실패 — 아이디·비밀번호를 확인하세요", "err");
    } else {
      pairStatus("🔌 연결이 끊겼어요 — 다시 로그인해 주세요", "err");
    }
  };
}

$("connect").onclick = () => {
  ensureAudioCtx();
  loginId = $("loginId").value.trim().toLowerCase();
  const pw = $("pw").value;
  if (!loginId) { pairStatus("⚠️ 아이디를 입력하세요", "err"); return; }
  startConnection(`id=${encodeURIComponent(loginId)}&secret=${encodeURIComponent(pw)}`, false);
};

// 공유 링크(#id=testuser) → 아이디 자동 입력. 비밀번호는 절대 링크에 담지 않는다.
(function prefillFromLink() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const id = hash ? new URLSearchParams(hash).get("id") : null;
  if (id) {
    $("loginId").value = id.trim().toLowerCase();
    history.replaceState(null, "", location.pathname + location.search);
    $("pw").focus();
  }
})();

// 자동 로그인: 이 origin에 저장된 토큰이 있으면 폼 없이 바로 시도
(function autoLogin() {
  const auth = savedAuth();
  if (!auth || !auth.phoneToken) {
    if (auth && auth.id && !$("loginId").value) $("loginId").value = auth.id;
    return;
  }
  loginId = auth.id;
  $("loginId").value = auth.id;
  startConnection(`id=${encodeURIComponent(auth.id)}&phoneToken=${encodeURIComponent(auth.phoneToken)}`, true);
})();

// 아이디/비밀번호 칸에서 Enter로 로그인
for (const id of ["loginId", "pw"]) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("connect").click();
  });
}
```

기존 `$("code")` 참조는 전부 제거한다(전수 grep — 남으면 로드 시 TypeError).

- [ ] **Step 3: 정적 검증** — `node --check src/web/app.js`, `npx vitest run tests/web/`(회귀), app.js `$()` 참조 ↔ index.html id 전수 대조(`code` 잔존 0건 확인).

- [ ] **Step 4: 커밋**

```bash
git add src/web/
git commit -m "feat(web): 아이디/비밀번호 로그인 + 토큰 자동 로그인·순단 재접속"
```

---

### Task 5: 문서 + gitignore + 라이브 스모크

**Files:**
- Modify: `.gitignore`(`.relay-auth.json` 추가), `README.md`, `docs/SETUP-customer.md`, `docs/ACCEPTANCE.md`

- [ ] **Step 1: .gitignore** — `.relay-password` 아래에 `.relay-auth.json` 한 줄 추가.

- [ ] **Step 2: README** — 빠른 시작 2·3단계의 카드 예시(코드 줄→아이디 줄, `#code=`→`#id=`), "비밀번호를 직접 정하고 싶다면" 블록에 `.relay-auth.json` 언급, "끄기" 문단의 "다시 켜면 새 주소·코드" → "다시 켜면 새 주소(아이디·비밀번호는 유지, 새 주소에서 첫 1회만 재로그인)", 체크리스트 표의 "주소·코드·비밀번호 오타" → "아이디·비밀번호 오타". MVP Status "Auth" 항목을 id/pw+phoneToken 체계로 갱신(자동 로그인 한계 — 재시작 시 origin 변경으로 1회 로그인 — 명시). Environment Variables 표에 `RELAY_ID` 행 추가.

- [ ] **Step 3: SETUP-customer/ACCEPTANCE** — 고객 문서의 접속 절차를 아이디/비밀번호 기준으로 갱신. ACCEPTANCE에 시나리오 추가: ① 카드의 링크로 접속 → 아이디 자동 입력 → 로그인 성공 ② 탭 닫고 재방문 → 로그인 화면 없이 홈 ③ 비밀번호 오입력 → "아이디 또는 비밀번호가 올바르지 않아요" ④ PC 재시작 후 새 주소 → 1회 재로그인(기대 동작임을 명시).

- [ ] **Step 4: 라이브 스모크(컨트롤러 수행 가능)** — 릴레이+CLI 기동 후 ws 클라이언트로: id/pw 로그인 → paired(phoneToken) → 소켓 끊고 phoneToken만으로 재접속 → paired → 틀린 pw → 오류 문구 → getPhoneAuth 미설정 인스턴스 → "초기 설정" 문구. 전부 통과해야 완료.

- [ ] **Step 5: 최종 확인 + 커밋**

Run: `npm test` → PASS

```bash
git add .gitignore README.md docs/
git commit -m "docs: 아이디/비밀번호 로그인·자동 로그인 안내"
```

---

## Self-Review 체크 결과

- **스펙 커버리지**: 스펙 B §1(1.1 로그인·1.2 저장/마이그레이션/set-password/카드·링크) → Task 1·2·3, §2(자동 로그인·순단 재접속·한계 명시) → Task 2·4·5, §7 표의 relay/protocol/web/launch 행 → Task 2~4, §8(0600·phoneToken 수명·#id=만) → Task 1·2·4, §9(자동 로그인 실패 조용히·설정 전 접속 거부) → Task 2·4. **§3 설정 UI(및 §7의 setup 관련 행, qrcode 의존성)는 계획 ③, §4~§6은 계획 ④로 분리** — 이 계획의 의도적 범위 밖.
- **타입 일관성**: `getPhoneAuth` 반환형 = auth-store `RelayAuth` 구조와 동일(순환 의존 없이 콜백 주입). `paired.phoneToken`은 Task 2 프로토콜·Task 4 소비 일치.
- **하위 호환**: 레거시 `?code&secret` 경로 보존(기존 relay 테스트 무수정 통과가 Task 2 게이트), host 인증·reconnectKey 불변, `RELAY_PASSWORD`-단독 dev 흐름은 id `"dev"`로 계속 동작.
