# 체험판 → 구매 + 최적화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 라이선스 없이도 체험판(프로젝트 1개)으로 실행되고, 일회성 키로 멀티프로젝트+병렬이 해제된다. 곁들여 Executor 반환값/시드 중복을 정리한다.

**Architecture:** 잠금은 호스트의 `createProject` 처리에서 프로젝트 개수로 건다(`licensed` false면 1개 제한). 런처는 키 없을 때 종료하지 않고 체험판으로 실행한다. 폰은 `projects` 메시지의 `trial` 플래그로 배너를 띄운다.

**Tech Stack:** TypeScript/Node, ws, vitest.

---

## Task T1: protocol.trial + ensureSeedProject + 시드 중복 제거

**Files:** Modify `src/shared/protocol.ts`, `src/cli/projects.ts`, `src/server/index.ts`; Test `tests/cli/projects.test.ts`

- [ ] **Step 1: protocol ProjectsMsg에 trial 추가** — `src/shared/protocol.ts`에서:
```ts
export interface ProjectsMsg {
  type: "projects";
  names: string[];
}
```
를 다음으로 교체:
```ts
export interface ProjectsMsg {
  type: "projects";
  names: string[];
  trial?: boolean;
}
```

- [ ] **Step 2: ensureSeedProject 테스트 추가** — `tests/cli/projects.test.ts`의 `describe("createProject / listProjects", ...)` 안에 추가:
```ts
  it("ensureSeedProject는 비었을 때만 my-app을 만든다", () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-"));
    ensureSeedProject(root);
    expect(listProjects(root)).toEqual(["my-app"]);
    ensureSeedProject(root); // 두 번째 호출은 무시
    expect(listProjects(root)).toEqual(["my-app"]);
  });
```
그리고 파일 상단 import에 `ensureSeedProject`를 추가: `import { slugifyProjectName, listProjects, createProject, projectDir, ensureSeedProject } from "../../src/cli/projects.js";`

- [ ] **Step 3: 실행해 실패 확인** — `npx vitest run tests/cli/projects.test.ts` → 새 테스트 FAIL(ensureSeedProject 없음).

- [ ] **Step 4: projects.ts에 ensureSeedProject 추가** — `src/cli/projects.ts` 끝에 추가:
```ts
// 프로젝트가 하나도 없으면 기본 프로젝트(my-app)를 시드한다.
export function ensureSeedProject(root: string): void {
  if (listProjects(root).length === 0) createProject(root, "my-app");
}
```

- [ ] **Step 5: server/index.ts에서 중복 시드 교체** — `src/server/index.ts`에서:
```ts
import { listProjects, createProject } from "../cli/projects.js";
```
를
```ts
import { ensureSeedProject } from "../cli/projects.js";
```
로, 그리고
```ts
if (listProjects(projectsRoot).length === 0) createProject(projectsRoot, "my-app");
```
를
```ts
ensureSeedProject(projectsRoot);
```
로 교체.

- [ ] **Step 6: 통과 확인** — `npx vitest run tests/cli/projects.test.ts` → PASS. `npx tsc --noEmit` 클린(또는 launch.ts가 아직 옛 import면 그건 T4에서 — 단 server/index.ts는 정상이어야).

- [ ] **Step 7: Commit**
```bash
git add src/shared/protocol.ts src/cli/projects.ts src/server/index.ts tests/cli/projects.test.ts
git commit -m "feat: ProjectsMsg.trial + ensureSeedProject helper (dedupe seed)"
```

---

## Task T2: 최적화 — Executor.run 반환값 제거

**Files:** Modify `src/cli/executor.ts`, `src/cli/agent.ts`, `tests/cli/agent.test.ts`, `tests/cli/host.test.ts`

`Executor.run`의 `{url}` 반환은 아무도 안 쓴다(handleCommand가 경로 직접 구성). `Promise<void>`로 정리.

- [ ] **Step 1: executor.ts 인터페이스/구현 정리** — `src/cli/executor.ts`에서 인터페이스:
```ts
export interface Executor {
  run(command: string, onLog: (line: string) => void): Promise<{ url: string }>;
}
```
를
```ts
export interface Executor {
  run(command: string, onLog: (line: string) => void): Promise<void>;
}
```
로. 그리고 `RealExecutor.run`의 반환 타입을 `Promise<void>`로 바꾸고 마지막 줄
```ts
    onLog("생성 완료 — 미리보기 갱신");
    return { url: "/preview/" };
```
에서 `return { url: "/preview/" };`를 제거(주석은 남겨도 됨):
```ts
    onLog("생성 완료 — 미리보기 갱신");
```

- [ ] **Step 2: agent.test.ts의 가짜 executor 갱신** — `tests/cli/agent.test.ts`에서 두 fake의 `async run`이 `{url}`을 반환하던 부분을 void로:
  - 성공 fake: `async run(_cmd, onLog) { onLog("생성 중"); }` (return 제거)
  - 실패 fake: 그대로 throw (반환 없음)

- [ ] **Step 3: host.test.ts의 가짜 executor 갱신** — `tests/cli/host.test.ts`의 fake executor들에서 `resolve({ url: "x" })` → `resolve()`로, 반환 타입 맞춤. 구체적으로 `new Promise((resolve) => { ...; setTimeout(() => resolve({ url: "x" }), 80); })` → `new Promise<void>((resolve) => { ...; setTimeout(() => resolve(), 80); })`, 그리고 `run: async () => { ran = true; return { url: "x" }; }` → `run: async () => { ran = true; }`. (파일 내 모든 `{ url: "x" }` 반환 제거.)

- [ ] **Step 4: 확인** — `npx vitest run` 전체 통과. `npx tsc --noEmit`는 launch.ts(옛 import/exit)·cli index 때문에 에러일 수 있음(T1/T4 범위) — 단 executor/agent/host 관련은 클린이어야.

- [ ] **Step 5: Commit**
```bash
git add src/cli/executor.ts src/cli/agent.ts tests/cli/agent.test.ts tests/cli/host.test.ts
git commit -m "refactor: Executor.run returns void (preview URL built by handleCommand)"
```

---

## Task T3: 호스트 체험판 제한 (licensed)

**Files:** Modify `src/cli/host.ts`, Test `tests/cli/host.test.ts`

- [ ] **Step 1: host.test.ts에 체험 제한 테스트 추가** — `tests/cli/host.test.ts`의 describe 안에 추가:
```ts
  it("체험판은 프로젝트 1개로 제한되고 trial 플래그가 켜진다", async () => {
    const root = mkdtempSync(join(tmpdir(), "cpmc-host-"));
    handle = await startRelayServer(0);
    const exec: Executor = { run: async () => {} };
    let code = "";
    startHost({
      relayUrl: `ws://localhost:${handle.port}`,
      projectsRoot: root,
      licensed: false,
      createExecutor: () => exec,
      onCode: (c) => (code = c),
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const phone = new WebSocket(`ws://localhost:${handle.port}/phone?code=${code}`);
    await until(phone, "paired");

    phone.send(JSON.stringify({ type: "createProject", name: "one" }));
    const p1 = await until(phone, "projects");
    expect(p1.names).toEqual(["one"]);
    expect(p1.trial).toBe(true);

    phone.send(JSON.stringify({ type: "createProject", name: "two" }));
    const st = await until(phone, "status");
    expect(st.state).toBe("error");
    phone.close();
  });
```
(이 테스트가 쓰는 fake `exec`는 T2에서 void 반환으로 통일된 형태다.)

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/cli/host.test.ts` → 새 테스트 FAIL(licensed 미지원; 2번째도 생성됨; trial 없음).

- [ ] **Step 3: host.ts 수정** — `HostOptions`에 필드 추가:
```ts
  licensed?: boolean;
```
(`interface HostOptions { ... }` 안, 예: `createExecutor?` 위/아래 아무 곳.)

`startHost` 본문 상단 구조분해에 추가/처리:
```ts
  const licensed = opts.licensed ?? true;
```
(예: `const createExecutor = ...` 줄 근처.)

`sendProjects`를 trial 포함하도록 교체:
```ts
    const sendProjects = () =>
      send({
        type: "projects",
        names: listProjects(projectsRoot),
        trial: !licensed,
      });
```

`createProject` 분기에서, 슬러그 검증 통과 직후·`createProject(...)` 호출 전에 체험 제한을 추가:
```ts
        if (!licensed && listProjects(projectsRoot).length >= 1) {
          send({
            type: "status",
            project: name,
            state: "error",
            text: "체험판은 프로젝트 1개까지예요. 구매하면 무제한!",
          });
          return;
        }
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/cli/host.test.ts` → 전부 PASS(기존 멀티 + 체험 제한). `npx vitest run` 전체도 통과.

- [ ] **Step 5: Commit**
```bash
git add src/cli/host.ts tests/cli/host.test.ts
git commit -m "feat: trial mode limits to 1 project; projects msg carries trial flag"
```

---

## Task T4: 배선 — 라이선스 없으면 체험판으로 실행

**Files:** Modify `src/launch.ts`, `src/cli/index.ts`

- [ ] **Step 1: launch.ts — 종료 대신 체험판** — `src/launch.ts`에서 라이선스 게이트:
```ts
if (!isValidLicenseKey(resolveLicense())) {
  console.error(
    "❌ 유효한 라이선스가 필요합니다. 받은 키를 license.txt 에 붙여넣거나 LICENSE_KEY 환경변수로 설정하세요.",
  );
  process.exit(1);
}
```
를 다음으로 교체:
```ts
const licensed = isValidLicenseKey(resolveLicense());
```
그리고 시드를 `ensureSeedProject`로(있다면 유지, 없으면 추가). import 정리:
```ts
import { listProjects, createProject } from "./cli/projects.js";
...
if (listProjects(projectsRoot).length === 0) createProject(projectsRoot, "my-app");
```
를
```ts
import { ensureSeedProject } from "./cli/projects.js";
...
ensureSeedProject(projectsRoot);
```
로 교체. `startHost(...)` 호출에 `licensed` 전달:
```ts
startHost({
  relayUrl: `ws://localhost:${port}`,
  password,
  projectsRoot,
  licensed,
  onCode: (c) => { code = c; printCardIfReady(); },
  log: () => {},
});
```
카드 출력에 상태 한 줄 추가 — `printCardIfReady()` 안 `console.log("===...")` 블록에 다음 줄을 비밀번호 다음에 추가:
```ts
  console.log(
    licensed ? "  상태:   ✅ 정품" : "  상태:   🧪 체험판 (프로젝트 1개 · 구매 시 무제한)",
  );
```

- [ ] **Step 2: cli/index.ts — licensed 전달** — `src/cli/index.ts`를 다음으로 교체:
```ts
import { join } from "node:path";
import { startHost } from "./host.js";
import { isValidLicenseKey } from "./license.js";

const relayUrl = process.env.RELAY_URL ?? "ws://localhost:8080";
const password = process.env.RELAY_PASSWORD || undefined;
const projectsRoot = join(process.cwd(), "projects");
const licensed = isValidLicenseKey(process.env.LICENSE_KEY);

startHost({
  relayUrl,
  password,
  projectsRoot,
  licensed,
  onCode: (code) =>
    console.log(`\n📱 폰에서 이 코드를 입력하세요:  ${code}\n`),
});
```

- [ ] **Step 3: 확인** — `npx tsc --noEmit` 완전 클린. `npx vitest run` 전체 통과.

- [ ] **Step 4: 수동 검증** — license.txt/LICENSE_KEY 없이 `npm start`(백그라운드) → 종료되지 않고 카드에 `🧪 체험판` 표시되는지 확인. `curl -s <카드 주소>` 대신 로컬: `curl -s http://localhost:8080/ | grep -c connect` >=1. 프로세스 종료(cloudflared 포함, 남기지 말 것). (cloudflared 없으면 이 수동단계는 생략하고 "체험판으로 시작됨" 로그만 확인.)

- [ ] **Step 5: Commit**
```bash
git add src/launch.ts src/cli/index.ts
git commit -m "feat: run as trial when unlicensed (no more hard exit)"
```

---

## Task T5: 폰 UI — 체험판 배너

**Files:** Modify `src/web/index.html`, `src/web/app.js`

- [ ] **Step 1: index.html에 배너 영역 추가** — `<div id="projects" ...></div>` 바로 위에 추가:
```html
    <div id="trial" style="display:none; background:#5a4500; color:#ffd; padding:8px; border-radius:8px; font-size:13px; margin-bottom:8px;">
      🧪 체험판 — 프로젝트 1개까지. 구매하면 여러 개를 동시에! (구매 안내는 판매처 참고)
    </div>
```

- [ ] **Step 2: app.js에서 trial 처리** — `projects` 메시지 처리부:
```js
    } else if (msg.type === "projects") {
      msg.names.forEach(ensure);
      if (!active && msg.names.length) active = msg.names[0];
      render();
    }
```
를 다음으로 교체:
```js
    } else if (msg.type === "projects") {
      msg.names.forEach(ensure);
      if (!active && msg.names.length) active = msg.names[0];
      $("trial").style.display = msg.trial ? "block" : "none";
      render();
    }
```

- [ ] **Step 3: 정적 서빙 확인** — `npm run dev:server` 백그라운드 → `curl -s http://localhost:8080/ | grep -c "체험판"` >=1, `curl -s http://localhost:8080/app.js | grep -c "trial"` >=1. 서버 종료.

- [ ] **Step 4: Commit**
```bash
git add src/web/index.html src/web/app.js
git commit -m "feat: phone shows trial banner when unlicensed"
```

---

## Task T6: 문서 갱신

**Files:** Modify `README.md`, `docs/SETUP-customer.md`, `docs/PACKAGING-seller.md`

- [ ] **Step 1:** 세 문서에 체험판 흐름 반영: 라이선스 없이 실행하면 **체험판(프로젝트 1개)**, 구매 키를 `license.txt`에 넣으면 **멀티프로젝트+병렬 해제**. 판매자 문서엔 "무료 체험으로 깔때기 → 일회성 키 판매" 흐름과 오프라인 체험의 한계(우회 가능, 강한 보호는 서버검증) 한 줄. 실존 스크립트만 언급.

- [ ] **Step 2: 최종 점검 + Commit** — `npx vitest run`(통과)·`npx tsc --noEmit`(클린) 후:
```bash
git add README.md docs/SETUP-customer.md docs/PACKAGING-seller.md
git commit -m "docs: document trial mode and purchase unlock"
```

---

## 완료 기준
- [ ] `npm test` 통과 (체험 제한 + ensureSeedProject 테스트 포함)
- [ ] `npx tsc --noEmit` 클린
- [ ] 라이선스 없이 `npm start` → 체험판 실행(종료 안 함), 카드에 🧪 표시
- [ ] 체험판: 2번째 프로젝트 생성 거부; 폰에 체험 배너
- [ ] 키 있으면 멀티프로젝트+병렬 정상
- [ ] Executor.run 반환값 제거, 시드 중복 제거
