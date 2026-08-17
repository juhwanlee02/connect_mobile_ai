# 로컬 터널 미리보기 (Local Tunnel Preview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** firebase 배포 없이, 중계서버가 생성된 앱(`workspace/public`)을 `/preview`로 직접 서빙해 폰이 터널 origin으로 즉시 라이브 미리보기를 하도록 한다. (브레인스토밍 설계 옵션 "(라) 로컬 서버 터널링" 채택, firebase 경로 제거)

**Architecture:** 중계서버(이미 정적 서빙 + 터널 노출됨)가 `previewDir`(=`workspace/public`)를 `/preview/*` 경로로 추가 서빙한다. 실행기는 firebase 배포를 빼고 `claude`로 코드만 생성한 뒤 상대경로 `"/preview/"`를 반환한다. PC는 자기 공개(터널) URL을 모르므로, 폰이 `preview` 메시지의 url이 상대경로이면 `location.origin`을 붙이고 캐시 무력화 쿼리를 더해 iframe을 로드한다. (절대 URL이면 그대로 — 향후 호환).

**Tech Stack:** 기존과 동일 (TypeScript/Node, ws, vitest).

---

## Task L1: 중계서버 — /preview 경로 서빙

**Files:**
- Modify: `src/server/relay.ts`
- Test: `tests/server/relay.test.ts`

`opts.previewDir`가 설정되면 `/preview` 및 `/preview/*` 요청을 그 디렉터리에서 서빙한다(경로 탈출 가드 유지). 그 외 경로는 기존처럼 `staticDir`에서 서빙.

- [ ] **Step 1: 실패 테스트 추가** — `tests/server/relay.test.ts`의 `describe("relay static serving", ...)` 블록 안에 추가:

```ts
  it("/preview 경로는 previewDir에서 서빙한다", async () => {
    // 테스트 안정성을 위해 previewDir도 커밋된 src/web을 가리킨다
    handle = await startRelayServer(0, "src/web", { previewDir: "src/web" });
    const res = await fetch(`http://localhost:${handle.port}/preview/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("connect-pc-mobile-claude");
  });

  it("previewDir 미설정 시 /preview는 404", async () => {
    handle = await startRelayServer(0, "src/web");
    const res = await fetch(`http://localhost:${handle.port}/preview/`);
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/server/relay.test.ts` → 첫 새 테스트 FAIL(/preview가 staticDir에서 찾다가 404 또는 잘못 서빙).

- [ ] **Step 3: relay.ts 구현**

(a) 시그니처 opts에 previewDir 추가:
```ts
export function startRelayServer(
  port: number,
  staticDir?: string,
  opts?: { heartbeatMs?: number; password?: string; previewDir?: string },
): Promise<RelayHandle> {
```

(b) `const password = opts?.password;` 근처에 추가:
```ts
  const previewDir = opts?.previewDir;
```

(c) `createServer(async (req, res) => { ... })` 핸들러를 다음으로 교체(기존 staticDir 로직을 baseDir 선택으로 일반화; MIME/가드 유지):
```ts
  const httpServer: Server = createServer(async (req, res) => {
    const rawPath = (req.url ?? "/").split("?")[0];

    // /preview/* → previewDir, 그 외 → staticDir
    let baseDir: string | undefined;
    let rel: string;
    if (rawPath === "/preview" || rawPath.startsWith("/preview/")) {
      baseDir = previewDir;
      rel = rawPath.slice("/preview".length) || "/";
    } else {
      baseDir = staticDir;
      rel = rawPath;
    }

    if (!baseDir) {
      res.writeHead(404);
      res.end();
      return;
    }

    const relFile = rel === "/" ? "/index.html" : rel;
    const filePath = normalize(join(baseDir, relFile));
    if (!filePath.startsWith(normalize(baseDir))) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(filePath);
      const dot = filePath.lastIndexOf(".");
      const ext = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": contentType });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
```

- [ ] **Step 4: 실행해 통과 확인** — `npx vitest run tests/server/relay.test.ts` → 전부 PASS(기존 13 + 신규 2 = 15). 기존 정적/인증/페어링 테스트 모두 유지.

- [ ] **Step 5: 타입체크** — `npx tsc --noEmit` 클린.

- [ ] **Step 6: Commit**
```bash
git add src/server/relay.ts tests/server/relay.test.ts
git commit -m "feat: relay serves generated app at /preview from previewDir"
```

---

## Task L2: 실행기·서버·폰 배선 (firebase 제거 → 로컬 미리보기)

**Files:**
- Modify: `src/cli/executor.ts`
- Delete: `tests/cli/executor.test.ts` (parseHostingUrl 제거로 불필요)
- Modify: `src/server/index.ts`
- Modify: `src/web/app.js`
- Modify: `README.md`

- [ ] **Step 1: 실행기에서 firebase 제거** — `src/cli/executor.ts` 전체를 다음으로 교체:

```ts
import { spawn } from "node:child_process";

export interface Executor {
  // command를 처리하고 진행 로그를 onLog로 흘리며, 미리보기 경로/URL을 반환한다.
  run(command: string, onLog: (line: string) => void): Promise<{ url: string }>;
}

export class RealExecutor implements Executor {
  constructor(private projectDir: string) {}

  async run(
    command: string,
    onLog: (line: string) => void,
  ): Promise<{ url: string }> {
    onLog("Claude Code로 코드 생성 중...");
    // 헤드리스(-p)에서 파일 편집을 자동 승인해야 실제로 코드를 작성함
    await this.exec(
      "claude",
      ["-p", "--permission-mode", "acceptEdits", command],
      onLog,
    );
    onLog("생성 완료 — 미리보기 갱신");
    // 중계서버가 workspace/public을 /preview로 서빙한다. PC는 자기 공개 URL을
    // 모르므로 상대경로를 반환하고, 폰이 origin을 붙여 로드한다.
    return { url: "/preview/" };
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

- [ ] **Step 2: 불필요한 테스트 삭제** — `parseHostingUrl`이 사라졌으므로 그 테스트 파일 삭제:
```bash
git rm tests/cli/executor.test.ts
```
(주의: `tests/cli/agent.test.ts`는 그대로 둔다 — `handleCommand`는 fake executor를 쓰므로 영향 없음.)

- [ ] **Step 3: 서버 진입점에 previewDir 전달** — `src/server/index.ts` 전체를 다음으로 교체:

```ts
import { join } from "node:path";
import { startRelayServer } from "./relay.js";

const port = Number(process.env.PORT ?? 8080);
const staticDir = join(process.cwd(), "src", "web");
const previewDir = join(process.cwd(), "workspace", "public");
const password = process.env.RELAY_PASSWORD || undefined;

startRelayServer(port, staticDir, { password, previewDir }).then(({ port }) => {
  console.log(`중계서버 실행 중: http://localhost:${port}`);
  console.log(`폰 웹앱: http://<PC의 LAN IP 또는 터널 주소>:${port}`);
  console.log(`미리보기: workspace/public → /preview 에서 서빙`);
  if (password) {
    console.log("🔒 비밀번호 보호: 켜짐");
  } else {
    console.log("⚠️  비밀번호 미설정 — 누구나 접속 가능(로컬/테스트 전용). RELAY_PASSWORD로 설정하세요.");
  }
});
```

- [ ] **Step 4: 폰 — 상대 미리보기 URL 처리** — `src/web/app.js`의 preview 처리:
```js
    } else if (msg.type === "preview") {
      log("🌐 미리보기: " + msg.url);
      $("frame").src = msg.url;
    }
```
를 다음으로 교체:
```js
    } else if (msg.type === "preview") {
      // 절대 URL이면 그대로, 상대경로이면 현재 origin(=터널 주소)을 붙임 + 캐시 무력화
      const base = /^https?:\/\//.test(msg.url)
        ? msg.url
        : location.origin + msg.url;
      const src = base + (base.includes("?") ? "&" : "?") + "t=" + Date.now();
      log("🌐 미리보기 갱신");
      $("frame").src = src;
    }
```

- [ ] **Step 5: README 갱신** — firebase 관련 사전준비/단계를 제거하고 로컬 미리보기로 교체한다:
  - 사전 준비에서 firebase CLI 로그인 / `firebase init` / firebase 프로젝트 요구사항 삭제.
  - 대신: 생성 결과물은 `workspace/public/`에 쓰이고 중계서버가 `/preview`로 서빙한다고 기술.
  - 실행 단계: firebase 배포 대기 없이, 명령 → 폰의 미리보기가 `/preview`로 즉시 갱신됨.
  - 명령은 `public/` 내부 파일을 대상으로 하라고 한 줄 안내(예: "public/index.html을 …").
  - 환경변수(PORT/RELAY_URL/RELAY_PASSWORD) 설명은 유지. claude CLI 로그인 요구는 유지.

- [ ] **Step 6: 수동 검증** — 실제 claude/폰 없이 서빙 경로만 확인:
  - 백그라운드로 `npm run dev:server` 기동(로그에 `미리보기: ... /preview` 확인).
  - `curl -s http://localhost:8080/preview/ | head` → `workspace/public/index.html` 내용(현재 "밖에서 됨" 또는 기본 페이지)이 나오는지 확인.
  - `curl -s http://localhost:8080/ | grep -c 'connect-pc-mobile-claude'` → 폰 PWA(>=1)도 정상 서빙 확인.
  - 서버 종료(남기지 말 것).

- [ ] **Step 7: 타입체크 + 전체 테스트** — `npx tsc --noEmit` 클린, `npx vitest run` 통과(relay 15 + agent 2 + backoff 2 = 19; executor 2 제거됨).

- [ ] **Step 8: Commit**
```bash
git add src/cli/executor.ts src/server/index.ts src/web/app.js README.md
git commit -m "feat: live /preview over tunnel, drop firebase deploy path"
```

---

## 완료 기준

- [ ] `npm test` 통과 (relay 15 + agent 2 + backoff 2 = 19)
- [ ] `npx tsc --noEmit` 클린
- [ ] `/preview`가 previewDir에서 서빙, previewDir 미설정 시 404, 경로 탈출 가드 유지
- [ ] 실행기는 firebase 없이 claude만 실행 후 `/preview/` 반환
- [ ] 폰은 상대 미리보기 경로에 origin을 붙이고 캐시 무력화해 iframe 갱신
- [ ] firebase 관련 코드/문서/테스트 제거됨
- [ ] 중계서버는 여전히 WS 메시지 내용 미파싱(프라이버시) + 비밀번호 게이트 유지
