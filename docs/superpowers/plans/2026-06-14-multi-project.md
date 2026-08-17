# 멀티프로젝트 + 크로스플랫폼 + 더블클릭 런처 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 한 연결로 여러 프로젝트를 폰에서 생성·전환·병렬 실행하고, `cross-spawn`으로 3개 OS를 지원하며, 비개발자용 더블클릭 런처(+license.txt)를 추가한다.

**Architecture:** `workspace/` 단일 폴더를 `projects/<이름>/public/`로 바꾼다. 프로토콜 메시지에 `project` 필드와 `createProject`/`listProjects`/`projects`를 추가(릴레이는 여전히 원문만 전달). 호스트가 프로젝트별로 `RealExecutor`를 만들어 병렬 실행하고 같은 프로젝트 중복은 막는다. 릴레이는 `/preview/<이름>/`를 `projects/<이름>/public/`로 매핑한다. 폰은 프로젝트 칩으로 전환하며 프로젝트별 로그·미리보기를 따로 유지한다.

**Tech Stack:** TypeScript/Node, ws, vitest, tsx, cross-spawn, cloudflared.

---

## File Structure
- `src/shared/protocol.ts` — 메시지 타입(project 필드 + 신규 타입) **수정**
- `src/cli/projects.ts` — 프로젝트 슬러그/목록/생성 유틸 **신규**
- `src/cli/agent.ts` — `handleCommand(project, ...)` **수정**
- `src/cli/host.ts` — 멀티프로젝트 메시지 처리 + 병렬 + busy 가드 **수정**
- `src/cli/executor.ts` — `cross-spawn` 사용 **수정**
- `src/server/relay.ts` — `/preview/<이름>/` 라우팅 **수정**
- `src/server/index.ts`, `src/cli/index.ts`, `src/launch.ts` — projectsRoot/시드/license.txt 배선 **수정**
- `launchers/시작.command`, `시작.bat`, `시작.sh` — 더블클릭 런처 **신규**
- `src/web/index.html`, `src/web/app.js` — 프로젝트 칩 UI **수정**
- `tests/cli/projects.test.ts`, `tests/cli/host.test.ts` — **신규**; 기존 relay/agent 테스트 **수정**

---

## Task 1: 프로토콜 확장

**Files:** Modify `src/shared/protocol.ts`

- [ ] **Step 1: protocol.ts 전체 교체**
```ts
// 폰 → (중계) → PC
export interface CommandMsg {
  type: "command";
  project: string;
  text: string;
}
export interface CreateProjectMsg {
  type: "createProject";
  name: string;
}
export interface ListProjectsMsg {
  type: "listProjects";
}
export type PhoneOutbound = CommandMsg | CreateProjectMsg | ListProjectsMsg;

// PC → (중계) → 폰
export interface LogMsg {
  type: "log";
  project: string;
  text: string;
}
export interface StatusMsg {
  type: "status";
  project: string;
  state: "idle" | "working" | "done" | "error";
  text?: string;
}
export interface PreviewMsg {
  type: "preview";
  project: string;
  url: string;
}
export interface ProjectsMsg {
  type: "projects";
  names: string[];
}
export type HostOutbound = LogMsg | StatusMsg | PreviewMsg | ProjectsMsg;

// 서버 → PC
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

- [ ] **Step 2: 컴파일 확인** — `npx tsc --noEmit` → 이 시점엔 agent.ts/host.ts가 옛 시그니처라 에러가 날 수 있음. 그건 다음 태스크에서 고친다. **단, protocol.ts 자체 문법 오류는 없어야 함.** (tsc 에러가 protocol.ts가 아니라 agent.ts/host.ts에서만 나는지 확인.)

- [ ] **Step 3: Commit**
```bash
git add src/shared/protocol.ts
git commit -m "feat: protocol gains project field + project list messages"
```

---

## Task 2: 프로젝트 유틸 (`src/cli/projects.ts`)

**Files:** Create `src/cli/projects.ts`, Test `tests/cli/projects.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — Create `tests/cli/projects.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  slugifyProjectName,
  listProjects,
  createProject,
  projectDir,
} from "../../src/cli/projects.js";

describe("slugifyProjectName", () => {
  it("공백/대문자를 정규화한다", () => {
    expect(slugifyProjectName("My App")).toBe("my-app");
  });
  it("특수문자를 하이픈으로", () => {
    expect(slugifyProjectName("hello_world!!")).toBe("hello-world");
  });
  it("결과가 비면 null", () => {
    expect(slugifyProjectName("   ")).toBeNull();
    expect(slugifyProjectName("한글")).toBeNull();
  });
});

describe("createProject / listProjects", () => {
  it("public/index.html을 시드하고 목록에 뜬다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    createProject(root, "demo");
    expect(existsSync(join(root, "demo", "public", "index.html"))).toBe(true);
    expect(listProjects(root)).toEqual(["demo"]);
  });
  it("기존 index.html을 덮어쓰지 않는다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "KEEP");
    createProject(root, "demo");
    const fs = require("node:fs");
    expect(fs.readFileSync(join(root, "demo", "public", "index.html"), "utf8")).toBe("KEEP");
  });
  it("projectDir은 root/name", () => {
    expect(projectDir("/a", "b")).toBe(join("/a", "b"));
  });
  it("없는 root는 빈 목록", () => {
    expect(listProjects(join(tmpdir(), "no-such-cpmc-xyz"))).toEqual([]);
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/cli/projects.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: projects.ts 작성** — Create `src/cli/projects.ts`:
```ts
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// 이름을 파일/URL 안전한 슬러그로. 결과가 비면 null.
export function slugifyProjectName(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length < 1 || s.length > 40) return null;
  return s;
}

export function projectDir(root: string, name: string): string {
  return join(root, name);
}

export function projectPublicDir(root: string, name: string): string {
  return join(root, name, "public");
}

export function listProjects(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

const SEED_HTML = `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>새 프로젝트</title>
  </head>
  <body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
    <h1>🚀 새 프로젝트</h1>
    <p>폰에서 명령을 보내면 이 페이지가 바뀝니다.</p>
  </body>
</html>
`;

// projects/<name>/public/ 생성 + 시작 index.html 시드(이미 있으면 보존).
export function createProject(root: string, name: string): void {
  const pub = projectPublicDir(root, name);
  mkdirSync(pub, { recursive: true });
  const index = join(pub, "index.html");
  if (!existsSync(index)) writeFileSync(index, SEED_HTML);
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/cli/projects.test.ts` → PASS(5). `npx tsc --noEmit`는 아직 agent/host 때문에 에러일 수 있음(정상 — 다음 태스크에서 해결).

- [ ] **Step 5: Commit**
```bash
git add src/cli/projects.ts tests/cli/projects.test.ts
git commit -m "feat: project slug/list/create utilities"
```

---

## Task 3: 릴레이 `/preview/<이름>/` 라우팅

**Files:** Modify `src/server/relay.ts`, `tests/server/relay.test.ts`

현재 `previewDir`(opts)는 단일 미리보기 폴더였다. 이제 **projects 루트**를 가리키고, `/preview/<name>/<rest>` → `<previewDir>/<name>/public/<rest>`로 매핑한다.

- [ ] **Step 1: 기존 preview 테스트 2개 교체** — `tests/server/relay.test.ts`의 `describe("relay static serving", ...)` 안에서, 기존 두 테스트("/preview 경로는 previewDir에서 서빙한다", "previewDir 미설정 시 /preview는 404")를 아래로 교체. 파일 상단 import에 다음을 추가(없으면): `import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os";` (이미 `join`은 import돼 있을 수 있음 — 없으면 `import { join } from "node:path";`도 추가).
```ts
  it("/preview/<이름>/는 projects/<이름>/public을 서빙한다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const res = await fetch(`http://localhost:${handle.port}/preview/demo/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("DEMO");
  });

  it("이름 없는 /preview/ 는 404", async () => {
    handle = await startRelayServer(0, "src/web", { previewDir: "projects" });
    const res = await fetch(`http://localhost:${handle.port}/preview/`);
    expect(res.status).toBe(404);
  });

  it("preview 경로 탈출은 거부된다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    mkdirSync(join(root, "demo", "public"), { recursive: true });
    writeFileSync(join(root, "demo", "public", "index.html"), "<h1>DEMO</h1>");
    handle = await startRelayServer(0, "src/web", { previewDir: root });
    const res = await fetch(
      `http://localhost:${handle.port}/preview/demo/%2e%2e/%2e%2e/package.json`,
    );
    expect(res.status === 403 || res.status === 404).toBe(true);
  });
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/server/relay.test.ts` → 새 `/preview/demo/` 테스트 FAIL(현재 라우팅은 `previewDir` 루트에서 바로 찾으므로 demo/public을 못 찾음).

- [ ] **Step 3: relay.ts 라우팅 교체** — `createServer` 핸들러에서 preview 분기를 교체. 현재:
```ts
    if (rawPath === "/preview" || rawPath.startsWith("/preview/")) {
      baseDir = previewDir;
      rel = rawPath.slice("/preview".length) || "/";
    } else {
      baseDir = staticDir;
      rel = rawPath;
    }
```
를 다음으로 교체:
```ts
    if (rawPath.startsWith("/preview/")) {
      // /preview/<name>/<rest> → <previewDir>/<name>/public/<rest>
      const sub = rawPath.slice("/preview/".length);
      const i = sub.indexOf("/");
      const name = i === -1 ? sub : sub.slice(0, i);
      const rest = i === -1 ? "/" : sub.slice(i);
      if (previewDir && name) {
        baseDir = join(previewDir, name, "public");
        rel = rest;
      }
    } else {
      baseDir = staticDir;
      rel = rawPath;
    }
```
(주의: `baseDir`/`rel`은 이미 `let baseDir: string | undefined; let rel: string;`로 선언돼 있다. preview인데 name이 없으면 baseDir는 undefined로 남아 아래 `if (!baseDir) 404` 처리됨.)

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/server/relay.test.ts` → 전부 PASS(기존 페어링/인증 + 새 preview 3 = 14). 경로 탈출 가드는 `filePath.startsWith(normalize(baseDir))`로 유지됨(baseDir가 이제 `<root>/<name>/public`).

- [ ] **Step 5: Commit**
```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay maps /preview/<name>/ to projects/<name>/public"
```

---

## Task 4: `handleCommand`에 project 추가

**Files:** Modify `src/cli/agent.ts`, `tests/cli/agent.test.ts`

- [ ] **Step 1: agent.test.ts 교체** — `tests/cli/agent.test.ts` 전체를 다음으로 교체:
```ts
import { describe, it, expect } from "vitest";
import { handleCommand } from "../../src/cli/agent.js";
import type { Executor } from "../../src/cli/executor.js";
import type { HostOutbound } from "../../src/shared/protocol.js";

describe("handleCommand", () => {
  it("성공 시 working→log→preview→done을 project 태그와 함께 보낸다", async () => {
    const sent: HostOutbound[] = [];
    const fake: Executor = {
      async run(_cmd, onLog) {
        onLog("생성 중");
        return { url: "ignored" };
      },
    };
    await handleCommand("my-app", "앱 만들어", fake, (m) => sent.push(m));
    expect(sent).toEqual([
      { type: "status", project: "my-app", state: "working", text: "작업 시작" },
      { type: "log", project: "my-app", text: "생성 중" },
      { type: "preview", project: "my-app", url: "/preview/my-app/" },
      { type: "status", project: "my-app", state: "done" },
    ]);
  });

  it("executor가 throw하면 project 태그로 error", async () => {
    const sent: HostOutbound[] = [];
    const fake: Executor = {
      async run() {
        throw new Error("실패함");
      },
    };
    await handleCommand("my-app", "앱", fake, (m) => sent.push(m));
    expect(sent[0]).toMatchObject({ type: "status", project: "my-app", state: "working" });
    expect(sent.at(-1)).toMatchObject({ type: "status", project: "my-app", state: "error" });
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/cli/agent.test.ts` → FAIL(현재 handleCommand는 project 인자 없음).

- [ ] **Step 3: agent.ts 교체** — `src/cli/agent.ts` 전체를 다음으로 교체:
```ts
import type { Executor } from "./executor.js";
import type { HostOutbound } from "../shared/protocol.js";

export async function handleCommand(
  project: string,
  text: string,
  executor: Executor,
  send: (msg: HostOutbound) => void,
): Promise<void> {
  send({ type: "status", project, state: "working", text: "작업 시작" });
  try {
    await executor.run(text, (line) =>
      send({ type: "log", project, text: line }),
    );
    send({ type: "preview", project, url: `/preview/${project}/` });
    send({ type: "status", project, state: "done" });
  } catch (err) {
    send({ type: "status", project, state: "error", text: String(err) });
  }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/cli/agent.test.ts` → PASS(2).

- [ ] **Step 5: Commit**
```bash
git add src/cli/agent.ts tests/cli/agent.test.ts
git commit -m "feat: handleCommand tags messages with project + builds preview path"
```

---

## Task 5: 호스트 멀티프로젝트 (병렬 + busy 가드)

**Files:** Modify `src/cli/host.ts`, Test `tests/cli/host.test.ts`

`startHost`가 projectsRoot를 받고, `listProjects`/`createProject`/`command{project}`를 처리한다. 프로젝트별 `RealExecutor`를 `createExecutor`로 만들며(테스트에서 주입 가능), 같은 프로젝트 중복 명령은 막는다.

- [ ] **Step 1: host 통합 테스트 작성** — Create `tests/cli/host.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelayServer, type RelayHandle } from "../../src/server/relay.js";
import { startHost } from "../../src/cli/host.js";
import type { Executor } from "../../src/cli/executor.js";

let handle: RelayHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (d) => resolve(JSON.parse(d.toString())));
    ws.once("error", reject);
  });
}
// 특정 type의 메시지가 올 때까지 읽는다
async function until(ws: WebSocket, type: string): Promise<any> {
  for (;;) {
    const m = await nextMessage(ws);
    if (m.type === type) return m;
  }
}

describe("startHost 멀티프로젝트", () => {
  it("createProject→projects 목록, command→project 태그 status", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);

    // 느린 가짜 executor: run이 끝나기 전 동시 명령을 시험할 수 있게 약간 지연
    const slow: Executor = {
      run: (_cmd, onLog) =>
        new Promise((resolve) => {
          onLog("작업중");
          setTimeout(() => resolve({ url: "x" }), 80);
        }),
    };

    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      createExecutor: () => slow,
      onCode: (c) => (code = c),
      log: () => {},
    });
    // 코드가 발급될 때까지 잠깐 대기
    await new Promise((r) => setTimeout(r, 50));
    expect(code).toHaveLength(6);

    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    // 프로젝트 생성
    phone.send(JSON.stringify({ type: "createProject", name: "Alpha" }));
    const projects = await until(phone, "projects");
    expect(projects.names).toContain("alpha");

    // 명령 → working(project=alpha)
    phone.send(JSON.stringify({ type: "command", project: "alpha", text: "ㄱ" }));
    const working = await until(phone, "status");
    expect(working).toMatchObject({ project: "alpha", state: "working" });

    // 같은 프로젝트 동시 명령 → error(이미 작업 중)
    phone.send(JSON.stringify({ type: "command", project: "alpha", text: "ㄴ" }));
    const busy = await until(phone, "status");
    expect(busy).toMatchObject({ project: "alpha", state: "error" });

    phone.close();
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/cli/host.test.ts` → FAIL(startHost가 projectsRoot/createExecutor/새 메시지를 모름).

- [ ] **Step 3: host.ts 교체** — `src/cli/host.ts` 전체를 다음으로 교체:
```ts
import { WebSocket } from "ws";
import { handleCommand } from "./agent.js";
import { nextBackoff } from "./backoff.js";
import { RealExecutor, type Executor } from "./executor.js";
import { listProjects, createProject, slugifyProjectName, projectDir } from "./projects.js";
import type { HostOutbound } from "../shared/protocol.js";

export interface HostOptions {
  relayUrl: string;
  password?: string;
  projectsRoot: string;
  onCode?: (code: string) => void;
  log?: (msg: string) => void;
  // 테스트 주입용. 기본은 프로젝트 폴더로 RealExecutor 생성.
  createExecutor?: (workdir: string) => Executor;
}

export function startHost(opts: HostOptions): void {
  const { relayUrl, password, projectsRoot } = opts;
  const log = opts.log ?? ((m: string) => console.log(m));
  const createExecutor =
    opts.createExecutor ?? ((wd: string) => new RealExecutor(wd));
  const busy = new Set<string>();
  let attempt = 0;

  function connect(): void {
    const hostUrl = password
      ? `${relayUrl}/host?secret=${encodeURIComponent(password)}`
      : `${relayUrl}/host`;
    const ws = new WebSocket(hostUrl);
    const send = (m: HostOutbound) => ws.send(JSON.stringify(m));
    const sendProjects = () =>
      send({ type: "projects", names: listProjects(projectsRoot) });

    let reconnectScheduled = false;
    const scheduleReconnect = () => {
      if (reconnectScheduled) return;
      reconnectScheduled = true;
      const delay = nextBackoff(attempt++);
      log(`중계서버 연결 종료 — ${delay}ms 후 재연결 시도`);
      setTimeout(connect, delay);
    };

    ws.on("open", () => {
      attempt = 0;
      log(`중계서버 연결됨: ${relayUrl}`);
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "code") {
        opts.onCode?.(msg.code);
      } else if (msg.type === "listProjects") {
        sendProjects();
      } else if (msg.type === "createProject") {
        const name = slugifyProjectName(String(msg.name ?? ""));
        if (!name) {
          send({
            type: "status",
            project: String(msg.name ?? ""),
            state: "error",
            text: "이름은 영문/숫자만 쓸 수 있어요",
          });
          return;
        }
        createProject(projectsRoot, name);
        sendProjects();
      } else if (msg.type === "command") {
        const project = String(msg.project ?? "");
        if (!project) return;
        if (busy.has(project)) {
          send({
            type: "status",
            project,
            state: "error",
            text: "이미 작업 중이에요",
          });
          return;
        }
        busy.add(project);
        const executor = createExecutor(projectDir(projectsRoot, project));
        void handleCommand(project, String(msg.text ?? ""), executor, send).finally(
          () => busy.delete(project),
        );
      } else if (msg.type === "error") {
        console.error(
          `⚠️  릴레이 오류: ${msg.text} (RELAY_PASSWORD가 서버와 일치하는지 확인하세요)`,
        );
      }
    });

    ws.on("close", scheduleReconnect);
    ws.on("error", () => {
      // error 뒤에 close가 이어지며 scheduleReconnect가 중복을 막는다
    });
  }

  connect();
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/cli/host.test.ts` → PASS(1). 그리고 `npx vitest run` 전체 통과.

- [ ] **Step 5: Commit**
```bash
git add src/cli/host.ts tests/cli/host.test.ts
git commit -m "feat: host handles multi-project create/list/command with parallel busy guard"
```

---

## Task 6: 크로스플랫폼 — cross-spawn

**Files:** Modify `package.json`, `src/cli/executor.ts`, (Task 7에서 `src/launch.ts`도)

- [ ] **Step 1: 의존성 추가** — Run:
```bash
npm install cross-spawn && npm install -D @types/cross-spawn
```
Expected: 설치 성공.

- [ ] **Step 2: executor.ts의 spawn 교체** — `src/cli/executor.ts` 상단 `import { spawn } from "node:child_process";`를 다음으로 교체:
```ts
import spawn from "cross-spawn";
```
(나머지 코드는 그대로 — `spawn(cmd, args, { cwd: this.projectDir })` 호출 시그니처가 동일하다.)

- [ ] **Step 3: 타입체크 + 테스트** — `npx tsc --noEmit` 클린. `npx vitest run` 전체 통과(executor는 spawn을 직접 단위테스트하지 않음).

- [ ] **Step 4: 수동 확인(선택)** — `npm run dev:server` + 별도 터미널에서 (Task 7 이후) 동작 확인은 통합 단계에서. 여기선 빌드/타입만 확인.

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json src/cli/executor.ts
git commit -m "feat: use cross-spawn for cross-platform, injection-safe process spawning"
```

---

## Task 7: 배선 — projectsRoot + 시드 + license.txt (서버/CLI/런처 진입점)

**Files:** Modify `src/server/index.ts`, `src/cli/index.ts`, `src/launch.ts`

- [ ] **Step 1: server/index.ts 교체** — `src/server/index.ts` 전체를 다음으로 교체:
```ts
import { join } from "node:path";
import { startRelayServer } from "./relay.js";
import { listProjects, createProject } from "../cli/projects.js";

const port = Number(process.env.PORT ?? 8080);
const staticDir = join(process.cwd(), "src", "web");
const projectsRoot = join(process.cwd(), "projects");
const password = process.env.RELAY_PASSWORD || undefined;

if (listProjects(projectsRoot).length === 0) createProject(projectsRoot, "my-app");

startRelayServer(port, staticDir, { password, previewDir: projectsRoot }).then(
  ({ port }) => {
    console.log(`중계서버 실행 중: http://localhost:${port}`);
    console.log(`폰 웹앱: http://<PC의 LAN IP 또는 터널 주소>:${port}`);
    console.log(`미리보기: projects/<이름>/public → /preview/<이름>/ 서빙`);
    if (password) {
      console.log("🔒 비밀번호 보호: 켜짐");
    } else {
      console.log("⚠️  비밀번호 미설정 — 누구나 접속 가능(로컬/테스트 전용). RELAY_PASSWORD로 설정하세요.");
    }
  },
);
```

- [ ] **Step 2: cli/index.ts 교체** — `src/cli/index.ts` 전체를 다음으로 교체:
```ts
import { join } from "node:path";
import { startHost } from "./host.js";

const relayUrl = process.env.RELAY_URL ?? "ws://localhost:8080";
const password = process.env.RELAY_PASSWORD || undefined;
const projectsRoot = join(process.cwd(), "projects");

startHost({
  relayUrl,
  password,
  projectsRoot,
  onCode: (code) =>
    console.log(`\n📱 폰에서 이 코드를 입력하세요:  ${code}\n`),
});
```

- [ ] **Step 3: launch.ts 교체** — `src/launch.ts` 전체를 다음으로 교체:
```ts
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import spawn from "cross-spawn";
import { startRelayServer } from "./server/relay.js";
import { startHost } from "./cli/host.js";
import { parseTunnelUrl } from "./tunnel.js";
import { isValidLicenseKey } from "./license.js";
import { listProjects, createProject } from "./cli/projects.js";

function resolveLicense(): string | undefined {
  if (process.env.LICENSE_KEY) return process.env.LICENSE_KEY;
  const f = join(process.cwd(), "license.txt");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  return undefined;
}

if (!isValidLicenseKey(resolveLicense())) {
  console.error(
    "❌ 유효한 라이선스가 필요합니다. 받은 키를 license.txt 에 붙여넣거나 LICENSE_KEY 환경변수로 설정하세요.",
  );
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8080);
const password =
  process.env.RELAY_PASSWORD || randomBytes(6).toString("base64url");
const staticDir = join(process.cwd(), "src", "web");
const projectsRoot = join(process.cwd(), "projects");

if (listProjects(projectsRoot).length === 0) createProject(projectsRoot, "my-app");

let code: string | undefined;
let tunnelUrl: string | undefined;
let printed = false;
function printCardIfReady(): void {
  if (printed || !code || !tunnelUrl) return;
  printed = true;
  console.log("\n========================================");
  console.log("✅ 준비 완료! 폰에서 아래로 접속하세요");
  console.log(`  주소:   ${tunnelUrl}`);
  console.log(`  코드:   ${code}`);
  console.log(`  비밀번호: ${password}`);
  console.log("========================================\n");
}

await startRelayServer(port, staticDir, { password, previewDir: projectsRoot });

startHost({
  relayUrl: `ws://localhost:${port}`,
  password,
  projectsRoot,
  onCode: (c) => {
    code = c;
    printCardIfReady();
  },
  log: () => {},
});

const cf = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`]);
const onData = (buf: Buffer) => {
  const url = parseTunnelUrl(buf.toString());
  if (url && !tunnelUrl) {
    tunnelUrl = url;
    printCardIfReady();
  }
};
cf.stdout?.on("data", onData);
cf.stderr?.on("data", onData);
cf.on("error", () => {
  console.error(
    "❌ cloudflared 실행 실패 — 설치돼 있나요? (mac: brew install cloudflared)",
  );
  process.exit(1);
});

console.log("⏳ 시작 중… 잠시 후 접속 정보가 표시됩니다.");
```

- [ ] **Step 4: 타입체크 + 테스트** — `npx tsc --noEmit` 클린. `npx vitest run` 전체 통과.

- [ ] **Step 5: 수동 검증** — 백그라운드로 `npm run dev:server` 기동 → 로그에 `미리보기: projects/<이름>...` + `projects/my-app/public/index.html` 생성 확인(`ls projects/my-app/public`). `curl -s http://localhost:8080/preview/my-app/ | grep -c "새 프로젝트"` → >=1. 서버 종료.

- [ ] **Step 6: Commit**
```bash
git add src/server/index.ts src/cli/index.ts src/launch.ts
git commit -m "feat: wire projectsRoot, seed default project, read license.txt"
```

---

## Task 8: 더블클릭 런처

**Files:** Create `launchers/시작.command`, `launchers/시작.bat`, `launchers/시작.sh`

- [ ] **Step 1: mac 런처** — Create `launchers/시작.command`:
```bash
#!/bin/bash
cd "$(dirname "$0")/.."
npm start
```

- [ ] **Step 2: linux 런처** — Create `launchers/시작.sh`:
```bash
#!/bin/bash
cd "$(dirname "$0")/.."
npm start
```

- [ ] **Step 3: windows 런처** — Create `launchers/시작.bat`:
```bat
@echo off
cd /d "%~dp0\.."
call npm start
pause
```

- [ ] **Step 4: 실행권한 부여** — Run:
```bash
chmod +x launchers/시작.command launchers/시작.sh
```

- [ ] **Step 5: 수동 확인** — `bash launchers/시작.sh` 실행 시 (license.txt 없으면) `❌ 유효한 라이선스가 필요합니다` 가 떠야 함(= 런처가 npm start를 올바른 위치에서 호출). 확인 후 중단.

- [ ] **Step 6: Commit**
```bash
git add launchers
git commit -m "feat: double-click launchers for mac/win/linux"
```

---

## Task 9: 폰 UI — 프로젝트 칩 + 전환

**Files:** Modify `src/web/index.html`, `src/web/app.js`

- [ ] **Step 1: index.html 수정** — `#pair`/`#chat` 사이(또는 위)에 프로젝트 바를 추가하고 스타일을 더한다. `<body>` 안에서 기존:
```html
    <h3>📱 connect-pc-mobile-claude</h3>
    <div id="pair" class="row">
```
를 다음으로 교체:
```html
    <h3>📱 connect-pc-mobile-claude</h3>
    <div id="projects" class="row" style="display:none; flex-wrap:wrap; align-items:center"></div>
    <div id="pair" class="row">
```
그리고 `<style>` 안에 다음 규칙 추가(아무 위치):
```css
      .chip { background:#333; color:#eee; border:1px solid #555; border-radius:16px; padding:6px 12px; font-size:14px; cursor:pointer; }
      .chip.active { background:#2a6; border-color:#2a6; }
      .chip.busy::after { content:" ●"; color:#fd0; }
```

- [ ] **Step 2: app.js 전체 교체** — `src/web/app.js` 전체를 다음으로 교체:
```js
let ws;
const $ = (id) => document.getElementById(id);
const logEl = $("log");

// 프로젝트별 상태(로그/미리보기/작업중) 보관
const projects = {}; // name -> { log: string, preview: string, busy: bool }
let active = null;

function ensure(name) {
  if (!projects[name]) projects[name] = { log: "", preview: "", busy: false };
  return projects[name];
}
function render() {
  logEl.textContent = active ? projects[active].log || "대기 중…" : "대기 중…";
  logEl.scrollTop = logEl.scrollHeight;
  $("frame").src = active ? projects[active].preview || "about:blank" : "about:blank";
  // 칩 갱신
  const bar = $("projects");
  bar.innerHTML = "";
  Object.keys(projects).forEach((name) => {
    const c = document.createElement("div");
    c.className =
      "chip" + (name === active ? " active" : "") + (projects[name].busy ? " busy" : "");
    c.textContent = name;
    c.onclick = () => {
      active = name;
      render();
    };
    bar.appendChild(c);
  });
  const add = document.createElement("div");
  add.className = "chip";
  add.textContent = "➕ 새 프로젝트";
  add.onclick = () => {
    const name = prompt("새 프로젝트 이름 (영문/숫자)");
    if (name && ws) ws.send(JSON.stringify({ type: "createProject", name }));
  };
  bar.appendChild(add);
}
function logTo(name, line) {
  ensure(name).log += "\n" + line;
  if (name === active) render();
}

$("connect").onclick = () => {
  const code = $("code").value.trim().toUpperCase();
  if (!code) return;
  const pw = $("pw").value;
  const secret = pw ? `&secret=${encodeURIComponent(pw)}` : "";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/phone?code=${code}${secret}`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "paired") {
      $("pair").style.display = "none";
      $("chat").style.display = "flex";
      $("projects").style.display = "flex";
      ws.send(JSON.stringify({ type: "listProjects" }));
    } else if (msg.type === "error") {
      logTo(active || "", "❌ " + msg.text);
    } else if (msg.type === "projects") {
      msg.names.forEach(ensure);
      if (!active && msg.names.length) active = msg.names[0];
      render();
    } else if (msg.type === "log") {
      logTo(msg.project, "· " + msg.text);
    } else if (msg.type === "status") {
      ensure(msg.project).busy = msg.state === "working";
      logTo(msg.project, `[상태] ${msg.state}${msg.text ? ": " + msg.text : ""}`);
      render();
    } else if (msg.type === "preview") {
      const base = /^https?:\/\//.test(msg.url)
        ? msg.url
        : location.origin + msg.url;
      ensure(msg.project).preview =
        base + (base.includes("?") ? "&" : "?") + "t=" + Date.now();
      logTo(msg.project, "🌐 미리보기 갱신");
      render();
    }
  };
  ws.onclose = () => {
    logTo(active || "", "연결 종료됨 — 코드로 다시 연결하세요");
    $("pair").style.display = "flex";
    $("chat").style.display = "none";
    $("projects").style.display = "none";
  };
};

$("send").onclick = () => {
  const text = $("cmd").value.trim();
  if (!text || !ws || !active) return;
  ws.send(JSON.stringify({ type: "command", project: active, text }));
  logTo(active, "> " + text);
  $("cmd").value = "";
};
```

- [ ] **Step 3: 정적 서빙 수동 확인** — `npm run dev:server` 백그라운드 → `curl -s http://localhost:8080/app.js | grep -c "listProjects"` >=1, `curl -s http://localhost:8080/ | grep -c "projects"` >=1. 서버 종료.

- [ ] **Step 4: Commit**
```bash
git add src/web/index.html src/web/app.js
git commit -m "feat: phone UI project chips, switching, per-project log/preview"
```

---

## Task 10: 문서 갱신

**Files:** Modify `README.md`, `docs/SETUP-customer.md`, `docs/PACKAGING-seller.md`

- [ ] **Step 1:** 세 문서에서 단일 `workspace/` 언급을 `projects/<이름>/public/`로 갱신하고, 멀티프로젝트 사용법(폰에서 ➕새 프로젝트, 칩으로 전환, 동시에 여러 개)과 더블클릭 런처(`launchers/`)·`license.txt` 사용을 반영한다. 명령은 `public/` 대상(예: "public/index.html을 …"). 존재하는 npm 스크립트만 언급(dev:server, dev:cli, test, start, gen-license). cloudflared/claude 로그인/Node 20+ 사전준비 유지.

- [ ] **Step 2: 최종 점검** — `npx vitest run`(전체 통과) + `npx tsc --noEmit`(클린).

- [ ] **Step 3: Commit**
```bash
git add README.md docs/SETUP-customer.md docs/PACKAGING-seller.md
git commit -m "docs: update guides for multi-project, launchers, license.txt"
```

---

## 완료 기준
- [ ] `npm test` 통과 (기존 + projects 5 + host 1 + preview 갱신; executor 제거분 반영)
- [ ] `npx tsc --noEmit` 클린
- [ ] 폰에서 ➕새 프로젝트 생성, 칩 전환, 두 프로젝트 동시 명령(병렬), 같은 프로젝트 중복은 거부
- [ ] `/preview/<이름>/`가 해당 프로젝트만 보여줌
- [ ] cross-spawn으로 윈도우 포함 동작(코드상), 셸 인젝션 없음
- [ ] 더블클릭 런처 + license.txt로 비개발자 실행
- [ ] 릴레이는 여전히 WS 내용 미파싱 + 비밀번호 게이트 유지
```
