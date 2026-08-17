# 시작 설정 UI(/setup 관리 페이지) — 구현 계획 (계획 ③/④)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm start` 첫 실행 시 PC 브라우저에 설정 페이지가 자동으로 열려 ① 아이디/비밀번호 생성 ② 파이프라인 템플릿(곁가지) 관리 ③ 산출물 md 템플릿 편집 ④ 알림 설정을 한 화면에서 하게 하고, 접속 카드(QR)로 폰 연결을 시작한다.

**Architecture:** 릴레이에 `admin` 옵션(실행별 랜덤 관리키 + configRoot/repoRoot + 접속정보 콜백)을 추가하고, `/setup/**`를 **loopback 전용 + 관리키 이중 게이트**의 정적 페이지·JSON API로 서빙한다(새 모듈 `src/server/setup-api.ts`). API는 기존 shared 모듈(auth-store·template-store·notify-store·notify)을 재사용한다. launch.ts가 관리키를 만들고 첫 실행이면 기본 브라우저를 자동으로 연다.

**Tech Stack:** 기존과 동일 + **신규 의존성 1개: `qrcode`**(서버사이드 data URI 생성).

**Spec:** `docs/superpowers/specs/2026-07-11-login-onboarding-ux-design.md` §3(전체)·§7의 setup 관련 행·§8·§9. (§4~§6 폰 UX는 계획 ④.)

## Global Constraints

- `/setup/**` 접근 제어: **① 요청 원격 주소가 loopback**(`127.0.0.1`/`::1`/`::ffff:127.0.0.1`) **② 관리키 일치**(초기 진입은 `?k=`, API는 `x-admin-key` 헤더) — 둘 다 필수. 관리키는 실행마다 `randomBytes(16).hex`, 터미널에만 출력. 터널을 통해서는 절대 도달 불가.
- API 응답은 `{ok:true, ...}` / `{ok:false, error:"한국어"}` JSON. 요청 본문은 JSON, **256KB 상한**(초과 시 413).
- 자격증명 변경은 다음 로그인부터 반영(릴레이 `getPhoneAuth`가 매 시도 재읽기 — 계획 ②에서 이미 구현). 비밀번호는 **어떤 GET 응답에도 포함 금지**(id만).
- 산출물 템플릿 편집 대상: `templates/` **바로 아래의** `.md`/`.html` 파일만(디렉터리·`ideas-index.schema.json` 제외). 최초 수정 전 `templates/.orig/<파일명>` 백업 — **백업 실패 시 저장 중단**(스펙 §9). 파일명 검증 `/^[A-Za-z0-9._-]+$/` + 목록 멤버십(경로 탈출 차단).
- 원자적 쓰기(tmp+rename), 한국어 문자열, `npm test`+`npx tsc --noEmit` 클린, 태스크마다 커밋(메시지 끝 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

## File Structure

| 파일 | 역할 |
|---|---|
| `src/shared/notify.ts` (이동: `src/cli/notify.ts`) | detect/format/send — 릴레이도 쓰므로 shared로 |
| `src/server/setup-api.ts` (신규) | `/setup` 게이트·정적·JSON API 전부 |
| `src/server/relay.ts` (수정) | `admin` opts + `/setup` 위임 3줄 |
| `src/web/setup/index.html`·`setup.js` (신규) | 관리 페이지(4탭+접속 카드) |
| `src/launch.ts` (수정) | 관리키·admin opts·브라우저 자동 오픈·카드 줄 |
| `package.json` (수정) | `qrcode` 의존성 |
| `.gitignore`·`README.md`·`docs/SETUP-customer.md`·`docs/ACCEPTANCE.md` (수정) | 문서 |

---

### Task 1: notify 모듈 shared 이동 + qrcode 의존성

**Files:**
- Move: `src/cli/notify.ts` → `src/shared/notify.ts`
- Modify: `src/cli/pipeline-manager.ts`, `src/cli/host.ts`, `tests/cli/notify.test.ts`(경로만), `package.json`

**Interfaces:**
- Produces: `src/shared/notify.ts`가 기존 export(`StageEvent`/`detectStageEvent`/`formatNotification`/`sendNotification`) 그대로 제공. 임포트 경로만 변경(코드 무변경 이동).

- [ ] **Step 1:** `git mv src/cli/notify.ts src/shared/notify.ts` 후 파일 내 상대 임포트 수정(`../shared/pipeline.js`→`./pipeline.js`, `../shared/notify-store.js`→`./notify-store.js`).
- [ ] **Step 2:** 소비처 임포트 갱신 — `src/cli/pipeline-manager.ts`·`src/cli/host.ts`의 `"./notify.js"`→`"../shared/notify.js"`. `tests/cli/notify.test.ts`의 임포트 경로 갱신(파일은 tests/cli에 그대로 둬도 된다).
- [ ] **Step 3:** `npm install qrcode && npm install -D @types/qrcode` (lockfile 포함 커밋).
- [ ] **Step 4:** Run: `npm test` → PASS(전 스위트), `npx tsc --noEmit` → clean.
- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "refactor(notify): shared로 이동 + qrcode 의존성 추가"
```

---

### Task 2: setup-api — 게이트·정적 서빙·info(QR)·계정

**Files:**
- Create: `src/server/setup-api.ts`
- Modify: `src/server/relay.ts`
- Test: `tests/server/setup-api.test.ts`

**Interfaces:**
- Produces:

```ts
// setup-api.ts
export interface AdminOpts {
  key: string;                      // 실행별 랜덤(런처가 생성) — 터미널에만 노출
  configRoot: string;               // .relay-auth.json·.notify.json·pipelines/ 루트
  repoRoot: string;                 // commands/·templates/ 루트
  setupDir: string;                 // 정적 페이지 디렉터리(src/web/setup)
  getInfo: () => { id: string; url: string | null }; // 접속 카드용(터널 URL은 늦게 도착)
}
// /setup 경로면 처리하고 true, 아니면 false. relay가 정적 서빙 앞에서 호출.
export function handleSetupRequest(
  req: IncomingMessage, res: ServerResponse, admin: AdminOpts,
): Promise<boolean>;
```

- `startRelayServer` opts에 `admin?: AdminOpts` 추가. 이 태스크의 API: `GET /setup`(index.html, `?k=` 검증), `GET /setup/setup.js`, `GET /setup/api/info` → `{ok, id, url, link, qr}`(link=`${url}/#id=${id}`, qr=data URI — url 없으면 둘 다 null), `GET /setup/api/account` → `{ok, id}`, `POST /setup/api/account {id, password}` → writeRelayAuth(검증 실패 시 `{ok:false, error}`).

- [ ] **Step 1: 실패하는 테스트** — `tests/server/setup-api.test.ts` 생성(릴레이를 admin 옵션과 함께 띄우고 node fetch로 호출):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelayServer, type RelayHandle } from "../../src/server/relay.js";
import { readRelayAuth } from "../../src/shared/auth-store.js";

let relay: RelayHandle;
let base: string;
let configRoot: string;
let repoRoot: string;
const KEY = "testkey123";

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "x-admin-key": KEY, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

beforeEach(async () => {
  configRoot = mkdtempSync(join(tmpdir(), "setup-cfg-"));
  repoRoot = mkdtempSync(join(tmpdir(), "setup-repo-"));
  mkdirSync(join(repoRoot, "templates"), { recursive: true });
  const setupDir = mkdtempSync(join(tmpdir(), "setup-web-"));
  writeFileSync(join(setupDir, "index.html"), "<h1>setup</h1>");
  writeFileSync(join(setupDir, "setup.js"), "// js");
  relay = await startRelayServer(0, undefined, {
    admin: {
      key: KEY, configRoot, repoRoot, setupDir,
      getInfo: () => ({ id: "testuser", url: "https://x.example" }),
    },
  });
  base = `http://127.0.0.1:${relay.port}`;
});
afterEach(async () => {
  await relay.close();
  rmSync(configRoot, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe("게이트", () => {
  it("키 없이/틀린 키는 401, ?k=로 페이지 진입 가능", async () => {
    expect((await fetch(`${base}/setup/api/info`)).status).toBe(401);
    expect((await fetch(`${base}/setup/api/info`, { headers: { "x-admin-key": "wrong" } })).status).toBe(401);
    const page = await fetch(`${base}/setup?k=${KEY}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("setup");
    expect((await fetch(`${base}/setup?k=wrong`)).status).toBe(401);
  });
});

describe("info / account", () => {
  it("info는 id·링크·QR data URI를 준다", async () => {
    const r = await (await api("/setup/api/info")).json();
    expect(r.ok).toBe(true);
    expect(r.id).toBe("testuser");
    expect(r.link).toBe("https://x.example/#id=testuser");
    expect(r.qr).toMatch(/^data:image\/png;base64,/);
  });
  it("account GET은 id만(비밀번호 금지), POST는 검증·저장", async () => {
    const before = await (await api("/setup/api/account")).json();
    expect(before.ok).toBe(true);
    expect(JSON.stringify(before)).not.toContain("password");
    const bad = await (await api("/setup/api/account", { method: "POST", body: JSON.stringify({ id: "1x", password: "pw1234" }) })).json();
    expect(bad.ok).toBe(false);
    const good = await (await api("/setup/api/account", { method: "POST", body: JSON.stringify({ id: "Newid", password: "pw1234" }) })).json();
    expect(good.ok).toBe(true);
    expect(readRelayAuth(configRoot)).toEqual({ id: "newid", password: "pw1234" });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/server/setup-api.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/server/setup-api.ts`:

```ts
// /setup 관리 페이지: loopback + 실행별 관리키 이중 게이트(스펙 §3.4).
// 터널로는 절대 도달 불가 — 원격 주소가 loopback이 아니면 무조건 404.
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { readRelayAuth, writeRelayAuth } from "../shared/auth-store.js";

export interface AdminOpts {
  key: string;
  configRoot: string;
  repoRoot: string;
  setupDir: string;
  getInfo: () => { id: string; url: string | null };
}

const MAX_BODY = 256 * 1024;

function isLoopback(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
const fail = (res: ServerResponse, error: string, status = 400) =>
  json(res, status, { ok: false, error });

function readBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(undefined); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

export async function handleSetupRequest(
  req: IncomingMessage, res: ServerResponse, admin: AdminOpts,
): Promise<boolean> {
  const [rawPath, queryStr = ""] = (req.url ?? "/").split("?");
  if (rawPath !== "/setup" && !rawPath.startsWith("/setup/")) return false;
  // 게이트 ①: loopback이 아니면 존재 자체를 숨긴다
  if (!isLoopback(req)) { res.writeHead(404); res.end(); return true; }
  // 게이트 ②: 관리키 — 페이지 진입은 ?k=, API는 x-admin-key 헤더
  const key = new URLSearchParams(queryStr).get("k") ?? String(req.headers["x-admin-key"] ?? "");
  if (key !== admin.key) { res.writeHead(401); res.end("관리키가 올바르지 않아요"); return true; }

  // 정적 페이지
  if (rawPath === "/setup" || rawPath === "/setup/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(admin.setupDir, "index.html")));
    return true;
  }
  if (rawPath === "/setup/setup.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    res.end(readFileSync(join(admin.setupDir, "setup.js")));
    return true;
  }

  // ---------- JSON API ----------
  const body = req.method === "POST" ? await readBody(req) : null;
  if (req.method === "POST" && body === undefined) { fail(res, "요청이 너무 커요", 413); return true; }
  const o = (body ?? {}) as Record<string, unknown>;

  try {
    if (rawPath === "/setup/api/info") {
      const { id, url } = admin.getInfo();
      const link = url ? `${url}/#id=${encodeURIComponent(id)}` : null;
      const qr = link ? await QRCode.toDataURL(link, { margin: 1, width: 240 }) : null;
      json(res, 200, { ok: true, id, url, link, qr });
      return true;
    }
    if (rawPath === "/setup/api/account" && req.method === "GET") {
      const auth = readRelayAuth(admin.configRoot);
      json(res, 200, { ok: true, id: auth?.id ?? null });
      return true;
    }
    if (rawPath === "/setup/api/account" && req.method === "POST") {
      try {
        const auth = writeRelayAuth(admin.configRoot, {
          id: String(o.id ?? ""), password: String(o.password ?? ""),
        });
        json(res, 200, { ok: true, id: auth.id });
      } catch (e) {
        fail(res, e instanceof Error ? e.message : String(e));
      }
      return true;
    }
    res.writeHead(404); res.end(); return true;
  } catch (e) {
    fail(res, "처리 중 오류: " + (e instanceof Error ? e.message : String(e)), 500);
    return true;
  }
}
```

`src/server/relay.ts`: opts 타입에 `admin?: AdminOpts;` 추가(`import { handleSetupRequest, type AdminOpts } from "./setup-api.js";`), HTTP 핸들러 최상단(`/preview/` 검사 **앞**)에:

```ts
    if (opts?.admin && (await handleSetupRequest(req, res, opts.admin))) return;
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npm test` → PASS, `npx tsc --noEmit` → clean

```bash
git add src/server/ tests/server/setup-api.test.ts
git commit -m "feat(setup): /setup 관리 API — 게이트·접속 정보(QR)·계정"
```

---

### Task 3: setup-api — 파이프라인 템플릿·산출물 템플릿·알림 엔드포인트

**Files:**
- Modify: `src/server/setup-api.ts`
- Test: `tests/server/setup-api.test.ts` (추가)

**Interfaces:**
- Produces (전부 관리키 게이트 뒤, 실패는 `{ok:false, error}`):
  - `GET /setup/api/templates` → `{ok, templates: TemplateInfo[]}` · `POST .../templates/clone {basedOn,name}` · `POST .../templates/delete {id}` · `POST .../templates/steps {id, steps}` · `GET .../templates/prompt?id=&stepId=` → `{ok, body, overridden}` · `POST .../templates/prompt {id,stepId,body}` · `POST .../templates/prompt-reset {id,stepId}` — 모두 `shared/template-store` 위임(`tplOpts = {repoRoot, pipelinesRoot: join(configRoot,"pipelines")}`).
  - `GET /setup/api/doc-templates` → `{ok, files:[{name, customized}]}`(templates/ 바로 아래 `.md`/`.html` 파일만; customized = `.orig/<name>` 존재) · `GET .../doc-templates/get?name=` → `{ok, content}` · `POST .../doc-templates/put {name, content}`(최초 수정 전 `templates/.orig/<name>` 백업 — **백업 실패 시 저장 중단**, 저장은 tmp+rename) · `POST .../doc-templates/reset {name}`(.orig에서 복원).
  - `GET /setup/api/notify` → `{ok, ...config}` · `POST /setup/api/notify {enabled}`(켜기 시 토픽 자동 생성 — host 라우팅과 동일 규칙) · `POST /setup/api/notify-test`(sendNotification kind "test", fire-and-forget, 즉시 `{ok:true}`).

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/server/setup-api.test.ts`의 beforeEach fixture에 `repoRoot/commands/pipeline`(7종 정본+`_CONTRACT.md`+`_GENERIC_STEP.md` — `tests/shared/template-store.test.ts`의 fixture 코드 재사용)과 `repoRoot/templates/PRD.template.md`("# PRD 원본\n")를 추가하고:

```ts
describe("파이프라인 템플릿 API", () => {
  it("목록→복제→스텝 저장→프롬프트 편집→삭제 왕복", async () => {
    let r = await (await api("/setup/api/templates")).json();
    expect(r.templates[0].id).toBe("default");
    r = await (await api("/setup/api/templates/clone", { method: "POST", body: JSON.stringify({ basedOn: "default", name: "관리자 곁가지" }) })).json();
    expect(r.ok).toBe(true);
    const tid = r.templates.find((t: { id: string }) => t.id !== "default").id;
    r = await (await api("/setup/api/templates/steps", { method: "POST", body: JSON.stringify({ id: tid, steps: [{ id: "ideation", label: "아이디어", kind: "builtin" }, { label: "market check", kind: "custom" }] }) })).json();
    expect(r.ok).toBe(true);
    r = await (await api("/setup/api/templates/prompt", { method: "POST", body: JSON.stringify({ id: tid, stepId: "market-check", body: "시장 조사\n" }) })).json();
    expect(r.ok).toBe(true);
    r = await (await api(`/setup/api/templates/prompt?id=${tid}&stepId=market-check`)).json();
    expect(r.body).toContain("시장 조사");
    r = await (await api("/setup/api/templates/delete", { method: "POST", body: JSON.stringify({ id: tid }) })).json();
    expect(r.ok).toBe(true);
  });
  it("default 수정은 거부된다", async () => {
    const r = await (await api("/setup/api/templates/steps", { method: "POST", body: JSON.stringify({ id: "default", steps: [{ label: "x", kind: "custom" }] }) })).json();
    expect(r.ok).toBe(false);
  });
});

describe("산출물 템플릿 API", () => {
  it("목록→수정(백업 생성)→복원 왕복, 경로 탈출·비대상 거부", async () => {
    let r = await (await api("/setup/api/doc-templates")).json();
    expect(r.files.some((f: { name: string }) => f.name === "PRD.template.md")).toBe(true);
    r = await (await api("/setup/api/doc-templates/put", { method: "POST", body: JSON.stringify({ name: "PRD.template.md", content: "# 수정본\n" }) })).json();
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repoRoot, "templates", ".orig", "PRD.template.md"), "utf8")).toContain("원본");
    expect(readFileSync(join(repoRoot, "templates", "PRD.template.md"), "utf8")).toContain("수정본");
    r = await (await api("/setup/api/doc-templates")).json();
    expect(r.files.find((f: { name: string }) => f.name === "PRD.template.md").customized).toBe(true);
    r = await (await api("/setup/api/doc-templates/reset", { method: "POST", body: JSON.stringify({ name: "PRD.template.md" }) })).json();
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repoRoot, "templates", "PRD.template.md"), "utf8")).toContain("원본");
    for (const name of ["../secret.md", "ideas-index.schema.json", "flutter-starter"]) {
      const bad = await (await api("/setup/api/doc-templates/get?name=" + encodeURIComponent(name))).json();
      expect(bad.ok).toBe(false);
    }
  });
});

describe("알림 API", () => {
  it("켜면 cpmc- 토픽 생성, 끄고 다시 켜도 토픽 유지", async () => {
    let r = await (await api("/setup/api/notify", { method: "POST", body: JSON.stringify({ enabled: true }) })).json();
    expect(r.enabled).toBe(true);
    expect(r.topic).toMatch(/^cpmc-/);
    const topic = r.topic;
    r = await (await api("/setup/api/notify", { method: "POST", body: JSON.stringify({ enabled: false }) })).json();
    expect(r.enabled).toBe(false);
    r = await (await api("/setup/api/notify", { method: "POST", body: JSON.stringify({ enabled: true }) })).json();
    expect(r.topic).toBe(topic);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현** — `setup-api.ts`에 추가. 템플릿 엔드포인트는 `template-store` 함수를 1:1 위임(성공 시 목록형 응답에는 `templates: listTemplates(tplOpts)`를 함께 실어 클라이언트 재조회를 줄인다). 산출물 템플릿:

```ts
// templates/ 바로 아래 .md/.html 파일만 편집 대상(스펙 §3.3). 이름 검증+멤버십으로 경로 탈출 차단.
const DOC_NAME_RE = /^[A-Za-z0-9._-]+$/;
function docTemplatesDir(admin: AdminOpts): string { return join(admin.repoRoot, "templates"); }
function listDocTemplates(admin: AdminOpts): Array<{ name: string; customized: boolean }> {
  const dir = docTemplatesDir(admin);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && DOC_NAME_RE.test(e.name) && (e.name.endsWith(".md") || e.name.endsWith(".html")))
    .map((e) => ({ name: e.name, customized: existsSync(join(dir, ".orig", e.name)) }));
}
function resolveDocTemplate(admin: AdminOpts, raw: unknown): string | null {
  const name = String(raw ?? "");
  return listDocTemplates(admin).some((f) => f.name === name) ? name : null;
}
```

put: `.orig` 백업(`mkdirSync(.orig)` + `cpSync(원본, .orig/name)` — 이미 있으면 생략, **cpSync 실패는 catch로 잡아 저장 중단·에러 회신**) → tmp+rename 저장(콘텐츠 256KB는 readBody가 이미 상한). reset: `.orig/name` 없으면 에러, 있으면 cpSync로 복원. 알림: `readNotifyConfig`/`writeNotifyConfig`/`generateTopic`(host 라우팅과 동일 로직), notify-test는 `void sendNotification(admin.configRoot, { project: "테스트", kind: "test" });`.

- [ ] **Step 4: 통과 확인 + 커밋**

```bash
git add src/server/setup-api.ts tests/server/setup-api.test.ts
git commit -m "feat(setup): 템플릿·산출물 템플릿·알림 관리 API"
```

---

### Task 4: 설정 페이지 UI (src/web/setup/)

**Files:**
- Create: `src/web/setup/index.html`, `src/web/setup/setup.js`

**Interfaces:**
- Consumes: Task 2·3의 API 전부. 관리키는 `location.search`의 `k`에서 읽어 모든 fetch에 `x-admin-key` 헤더로 부착.

- [ ] **Step 1: index.html** — 단일 페이지, 상단 탭 4개 + 접속 카드. 폰 UI와 같은 다크 팔레트(:root 변수 복사) 사용, 데스크톱 중앙 정렬(max-width 720px). 구조:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>connect-pc-mobile-claude 설정</title>
  <style>
    :root { --bg:#12161B; --surface:#1B2129; --surface2:#232B35; --line:#2C3540;
      --ink:#E8ECEF; --sub:#8B94A0; --run:#4C8DFF; --wait:#E5A83B; --done:#4CAF80;
      --err:#E06055; --accent:#3D6B5C; }
    * { box-sizing: border-box; margin: 0; }
    [hidden] { display: none !important; }
    body { background: var(--bg); color: var(--ink); font-family: "Apple SD Gothic Neo","Pretendard","Noto Sans KR",system-ui,sans-serif; font-size: 14px; line-height: 1.6; }
    main { max-width: 720px; margin: 0 auto; padding: 24px 16px 60px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .sub { color: var(--sub); font-size: 12.5px; margin-bottom: 16px; }
    .tabs { display: flex; gap: 6px; margin: 14px 0; flex-wrap: wrap; }
    .tabs button { border: 1px solid var(--line); background: var(--surface2); color: var(--sub); border-radius: 999px; padding: 8px 16px; font-weight: 700; cursor: pointer; }
    .tabs button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin: 10px 0; }
    .card h2 { font-size: 15px; margin-bottom: 8px; }
    label { display: block; color: var(--sub); font-size: 12px; margin: 10px 0 4px; }
    input[type=text], input[type=password], textarea { width: 100%; background: var(--surface2); color: var(--ink); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 14px; }
    textarea { font: 13px/1.5 ui-monospace, Menlo, monospace; min-height: 320px; resize: vertical; }
    .btn { border: 0; border-radius: 10px; padding: 10px 16px; font-weight: 700; cursor: pointer; margin-top: 10px; }
    .btn.primary { background: var(--wait); color: #1A1206; }
    .btn.ghost { background: var(--surface2); color: var(--ink); }
    .btn.danger { background: rgba(224,96,85,.15); color: var(--err); }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .spacer { flex: 1; }
    .hint { color: var(--sub); font-size: 12px; }
    .ok { color: var(--done); } .err { color: var(--err); }
    #qrImg { background: #fff; border-radius: 10px; padding: 8px; }
    .listrow { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); padding: 8px 0; }
    .listrow:last-child { border-bottom: 0; }
    #toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 20px; background: var(--surface2); border: 1px solid var(--line); color: var(--ink); padding: 10px 16px; border-radius: 10px; }
  </style>
</head>
<body>
<main>
  <h1>🛠 connect-pc-mobile-claude 설정</h1>
  <p class="sub">이 페이지는 이 PC에서만 열려요(외부 접근 불가).</p>

  <div class="card" id="connectCard">
    <h2>📱 폰 접속</h2>
    <div class="row">
      <img id="qrImg" width="160" height="160" alt="접속 QR" hidden />
      <div>
        <p>아이디: <b id="infoId">…</b></p>
        <p class="hint" id="infoUrl">주소 준비 중… (터널이 뜨면 자동 표시)</p>
        <p><a id="infoLink" target="_blank" rel="noreferrer"></a></p>
        <p class="hint">폰 카메라로 QR을 찍으면 아이디가 입력된 로그인 화면이 열려요. 비밀번호만 넣으면 끝.</p>
      </div>
    </div>
  </div>

  <div class="tabs">
    <button data-tab="account" class="active">계정</button>
    <button data-tab="tpl">파이프라인 템플릿</button>
    <button data-tab="doc">산출물 템플릿</button>
    <button data-tab="notify">알림</button>
  </div>

  <section id="tab-account" class="card">
    <h2>로그인 계정</h2>
    <label>아이디 (영문 소문자 시작, 영문/숫자 3~20자)</label>
    <input type="text" id="accId" autocomplete="off" />
    <label>새 비밀번호 (4자 이상)</label>
    <input type="password" id="accPw" autocomplete="new-password" />
    <button class="btn primary" id="accSave">저장</button>
    <p class="hint">저장하면 다음 로그인부터 적용돼요. 폰에 저장된 자동 로그인은 그대로 유지됩니다.</p>
    <p id="accMsg"></p>
  </section>

  <section id="tab-tpl" class="card" hidden>
    <h2>파이프라인 템플릿 (곁가지)</h2>
    <p class="hint">기본 템플릿을 복제해 스텝과 프롬프트를 고쳐 쓰세요. 폰의 [⚙️ 템플릿]과 같은 데이터입니다.</p>
    <div id="tplList"></div>
    <div id="tplEdit" hidden>
      <div class="row"><button class="btn ghost" id="tplEditBack">‹ 목록으로</button><b id="tplEditName"></b></div>
      <div id="tplSteps"></div>
      <button class="btn ghost" id="tplAddStep">＋ 스텝 추가</button>
    </div>
    <div id="tplPrompt" hidden>
      <div class="row"><button class="btn ghost" id="tplPromptBack">‹ 스텝으로</button><b id="tplPromptName"></b></div>
      <textarea id="tplPromptBody" spellcheck="false"></textarea>
      <div class="row">
        <button class="btn primary" id="tplPromptSave">저장</button>
        <button class="btn ghost" id="tplPromptReset" hidden>기본값 복원</button>
      </div>
    </div>
  </section>

  <section id="tab-doc" class="card" hidden>
    <h2>산출물 템플릿 (PRD·아이디어 노트 등 서식)</h2>
    <p class="hint">새로 만드는 프로젝트에 적용되는 문서 서식이에요. 이미 만든 프로젝트에는 영향이 없어요.</p>
    <div id="docList"></div>
    <div id="docEdit" hidden>
      <div class="row"><button class="btn ghost" id="docBack">‹ 목록으로</button><b id="docName"></b></div>
      <textarea id="docBody" spellcheck="false"></textarea>
      <div class="row">
        <button class="btn primary" id="docSave">저장</button>
        <button class="btn ghost" id="docReset" hidden>원본으로 복원</button>
      </div>
    </div>
  </section>

  <section id="tab-notify" class="card" hidden>
    <h2>🔔 스텝 완료 알림 (ntfy)</h2>
    <button class="btn primary" id="ntToggle">…</button>
    <div id="ntSetup" hidden>
      <p>① 폰에 <b>ntfy</b> 앱 설치 → ② 아래 토픽 구독</p>
      <p><a id="ntLink" target="_blank" rel="noreferrer"></a> <button class="btn ghost" id="ntCopy">복사</button></p>
      <p class="hint">⚠️ 이 링크를 아는 사람은 알림을 볼 수 있어요 — 공유 금지.</p>
      <button class="btn ghost" id="ntTest">테스트 알림 보내기</button>
    </div>
  </section>
</main>
<div id="toast" hidden></div>
<script type="module" src="/setup/setup.js"></script>
</body>
</html>
```

- [ ] **Step 2: setup.js** — 바닐라 JS. 핵심 규약: `const KEY = new URLSearchParams(location.search).get("k") || "";`, 공용 `api(path, body?)` 헬퍼(`x-admin-key` 헤더, POST면 JSON body, 응답 `{ok,error}` 처리 + 토스트), 탭 전환, 각 탭 로드 함수(`loadInfo`(10초 폴링 — 터널 URL 늦게 도착), `loadAccount`, `loadTemplates`(목록/편집/프롬프트 3뷰 — 폰 app.js의 renderTemplates/renderTplEdit/renderPromptEditor와 동일 데이터 흐름을 fetch 기반으로 재구현), `loadDocs`, `loadNotify`). 저장 성공 시 토스트 "저장했어요". `history.replaceState`로 주소창의 `?k=`를 지우지 **않는다**(새로고침 재인증 필요 — 키를 메모리 보관하고 주소도 유지). 완전한 코드로 작성하되 프레임워크·외부 의존성 금지.

- [ ] **Step 3: 정적 검증** — `node --check src/web/setup/setup.js`, setup.js의 `$()`/getElementById 참조와 index.html id 전수 대조(보고서 기록), `npm test` 회귀.

- [ ] **Step 4: 커밋**

```bash
git add src/web/setup/
git commit -m "feat(setup): 관리 페이지 UI — 계정·템플릿·산출물 서식·알림 4탭 + 접속 QR"
```

---

### Task 5: launch 배선 — 관리키·브라우저 자동 오픈·카드

**Files:**
- Modify: `src/launch.ts`
- Test: 기존 스위트 회귀(+ Task 6 스모크)

- [ ] **Step 1:** `src/launch.ts`에 추가:

```ts
import { randomBytes } from "node:crypto";

// /setup 관리 페이지: 실행별 관리키(터미널에만 노출 — 같은 PC의 다른 사용자 차단)
const adminKey = randomBytes(16).toString("hex");
const setupUrl = `http://localhost:${port}/setup?k=${adminKey}`;

// PC 기본 브라우저 열기(실패해도 무시 — URL은 카드에 항상 출력됨)
function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { stdio: "ignore" }); } catch { /* headless 등 — 무시 */ }
}
```

`startRelayServer` opts에 추가:

```ts
  admin: {
    key: adminKey,
    configRoot: process.cwd(),
    repoRoot: process.cwd(),
    setupDir: join(process.cwd(), "src", "web", "setup"),
    getInfo: () => ({
      id: (readRelayAuth(process.cwd()) ?? auth).id,
      url: tunnelUrl ?? null,
    }),
  },
```

`await startRelayServer(...)` 직후: `if (authCreated) { console.log(\`🛠 처음이시죠? 설정 페이지를 여는 중… ${setupUrl}\`); openInBrowser(setupUrl); }` — 카드에도 한 줄 추가: `console.log(\`  관리:   ${setupUrl}\`);` (printCardIfReady 안, 상태 줄 다음).

- [ ] **Step 2:** Run: `npm test` → PASS, `npx tsc --noEmit` → clean.

- [ ] **Step 3: 커밋**

```bash
git add src/launch.ts
git commit -m "feat(launch): 관리 페이지 자동 오픈 + 카드에 관리 URL"
```

---

### Task 6: 문서 + gitignore (+ 컨트롤러 스모크)

**Files:**
- Modify: `.gitignore`(`templates/.orig/` 추가), `README.md`, `docs/SETUP-customer.md`, `docs/ACCEPTANCE.md`

- [ ] **Step 1:** README: 빠른 시작 0~2단계 사이에 "처음 실행하면 PC 브라우저에 **설정 페이지**가 자동으로 열려요 — 아이디/비밀번호를 정하고, QR로 폰을 연결하세요. 다시 열려면 터미널 카드의 `관리:` 주소." 소절 추가. 카드 예시에 `관리:` 줄 반영. 곁가지/알림 소절에 "PC 설정 페이지에서도 같은 걸 편집할 수 있어요" 한 줄씩. 산출물 템플릿 편집(새 기능) 소절 추가(templates/.orig 복원 포함). SETUP-customer 동기화.
- [ ] **Step 2:** ACCEPTANCE에 시나리오 추가: 첫 실행 → 설정 페이지 자동 오픈 → 계정 생성 → QR 스캔 → 폰 로그인 / 산출물 템플릿 수정 → 새 프로젝트에 반영·기존 무영향 / 복원 동작 / 비-loopback·틀린 키 접근 차단.
- [ ] **Step 3 (컨트롤러 수행):** 라이브 스모크 — 릴레이를 admin 옵션과 함께 띄우고 curl로: 틀린 키 401 → info(QR data URI) → account POST → 즉시 새 자격증명으로 폰 ws 로그인 → doc-templates put/reset → notify 토글 → 페이지/setup.js 200.
- [ ] **Step 4:** Run: `npm test` → PASS. 커밋:

```bash
git add .gitignore README.md docs/
git commit -m "docs: 설정 페이지(관리 UI) 안내"
```

---

## Self-Review 체크 결과

- **스펙 §3 커버리지**: §3.1 자동 오픈·관리키·재진입(Task 5), 접속 카드+QR(Task 2·4·5 — qrcode 의존성 §3.1), §3.2 탭 4종(Task 2·3·4), §3.3 산출물 템플릿(.orig 백업·복원·검증 — Task 3), §3.4 API·loopback+키 게이트·shared 재사용·자격증명 즉시 반영(Task 2, getPhoneAuth는 계획 ②에서 선반영) — 전부 태스크에 매핑됨.
- **스펙과의 의도적 차이 1건**: §3.1은 "설정 전 폰 접속 거부·계정 만들기 전까지 차단"을 전제하나, 계획 ②가 첫 실행에 자동으로 admin 계정을 생성하므로 폰 접속은 항상 가능하다. 온보딩은 "차단"이 아니라 "자동 오픈+안내"로 달성 — 사용자 마찰이 더 적어 스펙 §0의 목표에 부합(문서에 이 흐름으로 서술).
- **타입 일관성**: `AdminOpts.getInfo` 반환 `{id, url|null}` ↔ Task 5 구현 일치. `tplOpts` 구조는 host.ts와 동일. `sendNotification(configRoot, ev)` 시그니처는 Task 1 이동 후에도 동일.
- **보안**: 게이트 이중화(loopback은 404로 존재 은닉, 키는 401), 비밀번호 GET 미노출, 파일명 멤버십 검증, body 256KB, `.orig` 백업 실패 시 중단.
