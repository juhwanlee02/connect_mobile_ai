# 앱 팩토리 Phase 1B — 폰 UI 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰 웹앱을 확정 목업 기준의 다화면 구조(홈 프로젝트 카드 → 파이프라인 화면)로 개편하고, Phase 1A 백엔드 프로토콜(stage_update/confirm/rollback/cancel/sync/artifact) 위에서 파이프라인을 폰으로 조작 가능하게 만든다.

**Architecture:** 폰앱을 ES 모듈 3개로 분리 — `store.js`(순수 상태 로직, vitest 테스트), `markdown.js`(의존성 0 렌더러, vitest 테스트), `app.js`(DOM 배선만, 수동 검증). host에는 폰이 필요로 하는 3가지를 추가: 프로젝트 목록의 파이프라인 구분, 채팅 히스토리 영속화, 보관/삭제 처리.

**Tech Stack:** 바닐라 JS ES modules(브라우저 `<script type="module">`), TypeScript(host, ESM `.js` imports), vitest. **새 npm 의존성 추가 금지.**

**참조:**
- 스펙: `docs/superpowers/specs/2026-07-04-app-factory-pipeline-design.md` §4·§5·§6·§8
- 확정 목업(디자인 기준): `docs/superpowers/specs/assets/pipeline-ux-mockup.html` — 다크 테마 색(배경 #12161B, 서피스 #1B2129, 라인 #2C3540, run #4C8DFF, wait #E5A83B, done #4CAF80, err #E06055), 카드/칩/스텝퍼 형태를 이 파일 기준으로
- Phase 1A 산출물: `src/shared/pipeline.ts`(STAGES, PipelineSnapshot), `src/shared/protocol.ts`(파이프라인 메시지), `src/cli/pipeline-manager.ts`

## Global Constraints

- 단계 순서: `ideation → prd → mockup → estimate → develop → test → release → done`, stageStatus: `pending|starting|running|awaiting_feedback|awaiting_confirm|error`
- 폰 단계 표시명(순서 고정): 아이디어 / PRD / 목업 / 산정 / 개발 / 테스트 / 릴리즈
- confirm ack 계약(스펙 §4): confirm 전송 후 **8초** 내 해당 프로젝트 stage_update 미수신 시 재전송 버튼 노출
- running 중 컨펌 버튼 비활성(스펙 §6), 삭제는 이름 입력 이중 확인(스펙 §8), running 중 보관/삭제 거부(스펙 §8)
- 기기 프레임 프리셋(스펙 §2-6): iPhone 390×844 / Android 360×800 / 꽉 채움 — `transform: scale()` contain 방식
- 재접속 시 폰이 `pipeline_sync` 요청(스펙 §4), 폰은 스냅샷을 통째로 덮어씀
- 레거시(비파이프라인) 프로젝트의 기존 UX(채팅+iframe 미리보기) 유지 — 깨뜨리지 않는다
- 기존 테스트 불파괴. 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 스펙 편차(승인됨): 삭제 백업은 zip 대신 **`projects/.trash/<이름>-<타임스탬프>/`로 디렉터리 이동**(의존성 0, 복원 가능 — 의도 동일)

---

### Task 1: host — 프로젝트 목록 강화 (pipelines/archived 구분 + 목록 기준 수정 + 큐 flush 통지)

**Files:**
- Modify: `src/cli/projects.ts` (listProjects 기준, meta 헬퍼)
- Modify: `src/shared/protocol.ts` (`ProjectsMsg`에 `pipelines?: string[]`, `archived?: string[]`)
- Modify: `src/cli/host.ts` (`sendProjects`가 새 필드 채움)
- Modify: `src/cli/pipeline-manager.ts` (큐 flush 시 통지)
- Test: `tests/cli/projects.test.ts`, `tests/cli/host.test.ts`, `tests/cli/pipeline-manager.test.ts`

**Interfaces:**
- Consumes: 기존 `listProjects/createProject/createPipelineProject/isPipelineProject`
- Produces:
  - `listProjects(root)`: **meta.json 또는 pipeline.json 보유 디렉터리만** 나열 (스펙 §12.6 — `.trash/` 등 오인 방지)
  - `readProjectMeta(root, name): { target?: ProjectTarget; pipeline?: boolean; archived?: boolean }`, `writeProjectMeta(root, name, patch): void` (기존 meta 병합)
  - `ProjectsMsg`: `{ type:"projects"; names; targets?; pipelines?: string[]; archived?: string[]; trial? }`
  - manager: confirm/rollback에서 큐를 flush할 때 대기 개수 n>0이면 `{type:"log", project, text:"⚠️ 단계가 바뀌어 대기 중이던 명령 " + n + "개가 취소됐어요"}` 발신 (스펙 §6)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cli/projects.test.ts`에 추가:

```ts
describe("listProjects 기준", () => {
  it("meta.json/pipeline.json 없는 디렉터리(.trash 등)는 프로젝트가 아니다", () => {
    createProject(root, "real", "ios");
    mkdirSync(join(root, ".trash", "old-1234"), { recursive: true });
    mkdirSync(join(root, "random-dir"));
    expect(listProjects(root)).toEqual(["real"]);
  });
});

describe("meta 헬퍼", () => {
  it("writeProjectMeta는 기존 필드를 보존하며 병합한다", () => {
    createPipelineProject(root, "p1");
    writeProjectMeta(root, "p1", { archived: true });
    expect(readProjectMeta(root, "p1")).toEqual({ pipeline: true, archived: true });
  });
});
```

`tests/cli/host.test.ts`에 추가 (기존 페어링 헬퍼 사용):

```ts
it("projects 메시지에 pipelines/archived 배열이 실린다", async () => {
  // 파이프라인 1개 + 레거시 1개 생성 후 listProjects 요청
  // expect(msg.pipelines).toEqual(["habit"]); expect(msg.archived).toEqual([]);
  // (기존 테스트 파일의 생성·수신 패턴을 그대로 따라 작성)
});
```

`tests/cli/pipeline-manager.test.ts`에 추가:

```ts
it("confirm으로 큐가 flush되면 취소 통지 log가 발신된다", async () => {
  writePipelineState(dir("habit"), {
    schemaVersion: 1, project: "habit", createdAt: "t",
    stage: "prd", stageStatus: "awaiting_feedback", artifacts: {},
  });
  mgr.handleFeedback("habit", "작업중");
  mgr.handleFeedback("habit", "대기1");
  mgr.handleFeedback("habit", "대기2");
  writePipelineState(dir("habit"), {
    schemaVersion: 1, project: "habit", createdAt: "t",
    stage: "prd", stageStatus: "awaiting_confirm", artifacts: {},
  });
  ex.runs[0].finish(); await flush();
  mgr.handleMessage({ type: "confirm", project: "habit", stage: "prd" });
  const notice = sent.find((m) => m.type === "log" && m.text.includes("취소"));
  expect(notice).toBeTruthy();
  expect((notice as any).text).toContain("2개");
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/cli/projects.test.ts tests/cli/pipeline-manager.test.ts` → 새 케이스 FAIL

- [ ] **Step 3: 구현**

`src/cli/projects.ts` — listProjects 교체 + 헬퍼 추가:

```ts
export function listProjects(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(
      (name) =>
        existsSync(join(root, name, "meta.json")) ||
        existsSync(join(root, name, "pipeline.json")),
    )
    .sort();
}

export interface ProjectMeta {
  target?: ProjectTarget;
  pipeline?: boolean;
  archived?: boolean;
}

export function readProjectMeta(root: string, name: string): ProjectMeta {
  try {
    const o = JSON.parse(readFileSync(metaPath(root, name), "utf8"));
    return typeof o === "object" && o !== null ? o : {};
  } catch {
    return {};
  }
}

export function writeProjectMeta(root: string, name: string, patch: Partial<ProjectMeta>): void {
  writeFileSync(metaPath(root, name), JSON.stringify({ ...readProjectMeta(root, name), ...patch }));
}
```

`src/shared/protocol.ts`의 `ProjectsMsg`에 필드 추가:

```ts
export interface ProjectsMsg {
  type: "projects";
  names: string[];
  targets?: Record<string, ProjectTarget>;
  pipelines?: string[];
  archived?: string[];
  trial?: boolean;
}
```

`src/cli/host.ts`의 `sendProjects`를 교체:

```ts
    const sendProjects = () => {
      const names = listProjects(projectsRoot);
      send({
        type: "projects",
        names,
        targets: listProjectTargets(projectsRoot),
        pipelines: names.filter((n) => isPipelineProject(projectsRoot, n)),
        archived: names.filter((n) => readProjectMeta(projectsRoot, n).archived === true),
        trial: !licensed,
      });
    };
```

(import에 `readProjectMeta` 추가)

`src/cli/pipeline-manager.ts` — confirm과 rollback의 `this.queues.delete(project)` 앞에:

```ts
    const flushed = this.queues.get(project)?.length ?? 0;
    if (flushed > 0)
      this.opts.send({
        type: "log", project,
        text: `⚠️ 단계가 바뀌어 대기 중이던 명령 ${flushed}개가 취소됐어요`,
      });
```

- [ ] **Step 4: 통과 확인** — `npx vitest run` 전체 + `npx tsc --noEmit`. 주의: listProjects 기준 변경으로 깨지는 기존 테스트가 있으면 그 테스트가 meta 없는 생 디렉터리를 만들었는지 확인하고, 실제 생성 함수(createProject 등)를 쓰도록 테스트를 정정(assert 의미 유지).

- [ ] **Step 5: 커밋** — `feat: project listing with pipeline/archived flags, queue-flush notice`

---

### Task 2: host — 채팅 히스토리 영속화

**Files:**
- Create: `src/cli/chat-log.ts`
- Modify: `src/shared/protocol.ts`, `src/cli/host.ts`
- Test: `tests/cli/chat-log.test.ts`, `tests/cli/host.test.ts`

**Interfaces:**
- Produces:
  - `appendChat(dir: string, entry: ChatEntry): void` — `projects/<name>/chat.jsonl`에 append. `ChatEntry = { ts: string; role: "user" | "assistant" | "log"; text: string }`
  - `readChat(dir: string, limit: number): ChatEntry[]` — 마지막 limit개(깨진 줄 무시)
  - protocol: `ChatHistoryGetMsg { type:"chat_history_get"; project }` (폰→PC, PhoneOutbound 합류) / `ChatHistoryMsg { type:"chat_history"; project; entries: ChatEntry[] }` (PC→폰, HostOutbound 합류)
  - host: ① `command` 수신 시 user 엔트리 기록(파이프라인·레거시 공통) ② 폰으로 나가는 `assistant`/`log` 메시지 기록(레거시 teeSend와 manager send 래퍼 공통 지점) ③ `chat_history_get` 수신 시 마지막 **200개** 응답. 검증은 Task 1A와 동일하게 슬러그+실존 확인.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/cli/chat-log.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendChat, readChat } from "../../src/cli/chat-log.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "chat-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("chat-log", () => {
  it("append한 순서대로 읽힌다", () => {
    appendChat(dir, { ts: "t1", role: "user", text: "안녕" });
    appendChat(dir, { ts: "t2", role: "assistant", text: "네" });
    expect(readChat(dir, 10)).toEqual([
      { ts: "t1", role: "user", text: "안녕" },
      { ts: "t2", role: "assistant", text: "네" },
    ]);
  });
  it("limit은 마지막 N개, 깨진 줄은 무시", () => {
    for (let i = 0; i < 5; i++) appendChat(dir, { ts: `t${i}`, role: "log", text: `${i}` });
    appendFileSync(join(dir, "chat.jsonl"), "{잘린 줄\n");
    const out = readChat(dir, 2);
    expect(out.map((e) => e.text)).toEqual(["3", "4"]);
  });
  it("파일 없으면 빈 배열", () => {
    expect(readChat(dir, 10)).toEqual([]);
  });
});
```

`tests/cli/host.test.ts`에 추가: 파이프라인 프로젝트에 command 전송 후 `chat_history_get` → `chat_history` 응답에 user 엔트리가 포함되는지(기존 헬퍼 패턴 사용).

- [ ] **Step 2: 실패 확인** — FAIL

- [ ] **Step 3: 구현**

```ts
// src/cli/chat-log.ts
// 프로젝트별 채팅 히스토리: chat.jsonl append 전용(폰 새로고침 시 소실 방지 — 스펙 §5·§6).
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ChatEntry {
  ts: string;
  role: "user" | "assistant" | "log";
  text: string;
}

export function chatLogPath(dir: string): string {
  return join(dir, "chat.jsonl");
}

export function appendChat(dir: string, entry: ChatEntry): void {
  appendFileSync(chatLogPath(dir), JSON.stringify(entry) + "\n");
}

export function readChat(dir: string, limit: number): ChatEntry[] {
  let raw: string;
  try {
    raw = readFileSync(chatLogPath(dir), "utf8");
  } catch {
    return [];
  }
  const out: ChatEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (typeof o?.text === "string" && typeof o?.role === "string") out.push(o);
    } catch { /* 깨진 줄 무시 */ }
  }
  return out.slice(-limit);
}
```

`src/cli/host.ts` 배선:
- `command` 처리부(검증 통과 직후, 파이프라인/레거시 분기 전): `appendChat(projectDir(projectsRoot, project), { ts: new Date().toISOString(), role: "user", text: String(msg.text ?? "") });`
- manager 생성부의 send 래퍼와 레거시 `teeSend`에 공통 기록 함수 적용:

```ts
    const recordOutbound = (m: HostOutbound) => {
      if ((m.type === "assistant" || m.type === "log") && "project" in m && m.project) {
        try {
          appendChat(projectDir(projectsRoot, m.project), {
            ts: new Date().toISOString(), role: m.type, text: m.text,
          });
        } catch { /* 기록 실패가 전송을 막지 않게 */ }
      }
    };
```

(manager send 래퍼와 teeSend 각각에서 `recordOutbound(m)` 호출 후 기존 send 수행)
- `chat_history_get` 라우팅(파이프라인 검증 블록과 동일한 검증 후):

```ts
      if (msg.type === "chat_history_get") {
        const p = slugifyProjectName(String(msg.project ?? ""));
        if (!p || !listProjects(projectsRoot).includes(p)) return;
        send({ type: "chat_history", project: p, entries: readChat(projectDir(projectsRoot, p), 200) });
        return;
      }
```

protocol.ts에 두 메시지 타입 추가 + 유니언 합류 (ChatEntry는 `import type { ChatEntry } from "../cli/chat-log.js"` 대신 protocol.ts에 인라인 정의 — shared가 cli에 의존하면 안 되므로 protocol.ts에 정의하고 chat-log.ts가 import).

- [ ] **Step 4: 통과 확인** — `npx vitest run` 전체 + `npx tsc --noEmit`
- [ ] **Step 5: 커밋** — `feat: per-project chat history persistence + chat_history protocol`

---

### Task 3: host — 보관/삭제 처리

**Files:**
- Modify: `src/shared/protocol.ts` (`ProjectArchiveMsg {type:"project_archive"; project; archived: boolean}`, `ProjectDeleteMsg {type:"project_delete"; project}` — PhoneOutbound 합류)
- Modify: `src/cli/host.ts`, `src/cli/pipeline-manager.ts` (`detachWatcher`, `isRunning`)
- Test: `tests/cli/host.test.ts`, `tests/cli/pipeline-manager.test.ts`

**Interfaces:**
- Produces:
  - manager: `isRunning(project: string): boolean`, `detachWatcher(project: string): void` (watcher close + watched/lastEmitted/queues에서 제거)
  - host 처리 규칙(스펙 §8): 두 메시지 모두 슬러그+실존 검증. **running이면 거부**(`status:error` "실행 중에는 보관/삭제할 수 없어요 — 먼저 중단하세요"). archive → `writeProjectMeta(root, p, { archived })` + sendProjects. delete → `projects/.trash/<이름>-<Date.now()>/`로 `renameSync` 이동(백업 겸) + `detachWatcher` + sendProjects. 이름 입력 이중 확인은 폰 UI 책임.

- [ ] **Step 1: 실패하는 테스트 작성** — host.test.ts에: ① archive 후 projects 메시지의 archived에 포함 ② delete 후 names에서 사라지고 `.trash/` 하위에 디렉터리 존재 ③ running 중 delete는 error 응답(FakeExecutor를 미완료 상태로 두고). manager 테스트에: `detachWatcher` 후 파일 변경해도 stage_update 없음, `isRunning`이 실행 중 true/완료 후 false.
- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**

`pipeline-manager.ts`에 추가:

```ts
  isRunning(project: string): boolean {
    return this.running.has(project);
  }

  detachWatcher(project: string): void {
    // 삭제/보관 시 감시·큐·중복억제 상태를 함께 정리
    this.queues.delete(project);
    this.lastEmitted.delete(project);
    if (!this.watched.has(project)) return;
    this.watched.delete(project);
    // watchers 배열은 project별 참조가 없으므로 Map으로 전환한다
  }
```

주의: 현재 `watchers`가 배열이면 project→watcher `Map<string, {close():void}>`으로 전환하고 `stop()`은 Map 값 전체 close로 변경(기존 동작 동일).

`host.ts` 라우팅(파이프라인 메시지 검증 블록에 두 타입 추가 후):

```ts
      if (msg.type === "project_archive" || msg.type === "project_delete") {
        const p = slugifyProjectName(String(msg.project ?? ""));
        if (!p || !listProjects(projectsRoot).includes(p)) return;
        if (manager.isRunning(p)) {
          send({ type: "status", project: p, state: "error",
                 text: "실행 중에는 보관/삭제할 수 없어요 — 먼저 중단하세요" });
          return;
        }
        if (msg.type === "project_archive") {
          writeProjectMeta(projectsRoot, p, { archived: msg.archived === true });
        } else {
          manager.detachWatcher(p);
          const trash = join(projectsRoot, ".trash");
          mkdirSync(trash, { recursive: true });
          renameSync(projectDir(projectsRoot, p), join(trash, `${p}-${Date.now()}`));
        }
        sendProjects();
        return;
      }
```

(node:fs `mkdirSync, renameSync`, node:path `join` import 추가)

- [ ] **Step 4: 통과 확인** — 전체 + tsc
- [ ] **Step 5: 커밋** — `feat: project archive/delete with trash backup and running guard`

---

### Task 4: web — 상태 스토어 모듈 (`src/web/store.js`)

**Files:**
- Create: `src/web/store.js` (브라우저·vitest 공용 ESM, 의존성 0)
- Test: `tests/web/store.test.js`

**Interfaces:**
- Produces (전부 순수 함수/불변 아님 — 뮤터블 스토어):
  ```js
  export const STAGES = ["ideation","prd","mockup","estimate","develop","test","release"];
  export const STAGE_LABELS = { ideation:"아이디어", prd:"PRD", mockup:"목업", estimate:"산정", develop:"개발", test:"테스트", release:"릴리즈", done:"완료" };
  export function createStore()  // { screen:{name:"home"}, projects:{}, trial:false, pendingConfirm:null }
  export function applyMessage(store, msg, now)  // → events 배열: [{type:"confirm_acked"}|{type:"attention", project}]
  export function markConfirmSent(store, project, stage, now)
  export function confirmTimedOut(store, now)     // 8000ms 초과 여부
  export function statusBadge(p)                  // → {label, cls} — 폰 배지 규칙
  export function stageProgress(snapshot)         // → 0..1 (done=1)
  export function homeProjects(store)             // → {active:[...], archived:[...]} 정렬: awaiting_confirm 우선
  ```
  프로젝트 엔트리: `{ kind:"pipeline"|"legacy", target, archived, pipeline:snapshot|null, chat:[], preview:"", busy:false }`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/web/store.test.js
import { describe, it, expect } from "vitest";
import {
  createStore, applyMessage, markConfirmSent, confirmTimedOut,
  statusBadge, stageProgress, homeProjects, STAGES,
} from "../../src/web/store.js";

const snap = (over = {}) => ({
  schemaVersion: 1, project: "habit", createdAt: "t",
  stage: "mockup", stageStatus: "awaiting_confirm", artifacts: {},
  sessionId: null, history: [], error: null, queueLength: 0, ...over,
});

describe("applyMessage", () => {
  it("projects 메시지가 pipelines/archived를 반영한다", () => {
    const s = createStore();
    applyMessage(s, { type: "projects", names: ["a", "b"], pipelines: ["a"], archived: ["b"] }, 0);
    expect(s.projects.a.kind).toBe("pipeline");
    expect(s.projects.b.kind).toBe("legacy");
    expect(s.projects.b.archived).toBe(true);
  });
  it("stage_update는 스냅샷을 통째로 덮어쓴다", () => {
    const s = createStore();
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap() }, 0);
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap({ stage: "estimate", stageStatus: "running" }) }, 0);
    expect(s.projects.habit.pipeline.stage).toBe("estimate");
  });
  it("awaiting_confirm 진입 시 attention 이벤트", () => {
    const s = createStore();
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap({ stageStatus: "running" }) }, 0);
    const ev = applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap() }, 0);
    expect(ev).toContainEqual({ type: "attention", project: "habit" });
  });
  it("chat_history는 통째 교체, assistant/log/user는 append", () => {
    const s = createStore();
    applyMessage(s, { type: "chat_history", project: "habit", entries: [{ ts: "t", role: "user", text: "하이" }] }, 0);
    applyMessage(s, { type: "assistant", project: "habit", text: "네" }, 0);
    expect(s.projects.habit.chat.map((c) => c.text)).toEqual(["하이", "네"]);
  });
});

describe("confirm ack", () => {
  it("confirm 전송 후 stage_update가 오면 acked, 8초 넘으면 timeout", () => {
    const s = createStore();
    applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap() }, 0);
    markConfirmSent(s, "habit", "mockup", 1000);
    expect(confirmTimedOut(s, 5000)).toBe(false);
    expect(confirmTimedOut(s, 9001)).toBe(true);
    const ev = applyMessage(s, { type: "stage_update", project: "habit", pipeline: snap({ stage: "estimate", stageStatus: "starting" }) }, 2000);
    expect(ev).toContainEqual({ type: "confirm_acked" });
    expect(s.pendingConfirm).toBeNull();
  });
});

describe("표시 헬퍼", () => {
  it("statusBadge 규칙", () => {
    expect(statusBadge({ kind: "pipeline", pipeline: snap() }).cls).toBe("wait");
    expect(statusBadge({ kind: "pipeline", pipeline: snap({ stageStatus: "running" }) }).cls).toBe("run");
    expect(statusBadge({ kind: "pipeline", pipeline: snap({ stageStatus: "error" }) }).cls).toBe("err");
    expect(statusBadge({ kind: "pipeline", pipeline: snap({ stage: "done" }) }).cls).toBe("done");
  });
  it("stageProgress: mockup은 3/7, done은 1", () => {
    expect(stageProgress(snap())).toBeCloseTo(3 / 7);
    expect(stageProgress(snap({ stage: "done" }))).toBe(1);
  });
  it("homeProjects: awaiting_confirm이 앞, archived는 분리", () => {
    const s = createStore();
    applyMessage(s, { type: "projects", names: ["a", "b", "c"], pipelines: ["a", "b"], archived: ["c"] }, 0);
    applyMessage(s, { type: "stage_update", project: "a", pipeline: snap({ project: "a", stageStatus: "running" }) }, 0);
    applyMessage(s, { type: "stage_update", project: "b", pipeline: snap({ project: "b" }) }, 0);
    const { active, archived } = homeProjects(s);
    expect(active[0]).toBe("b");
    expect(archived).toEqual(["c"]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/web/store.test.js` FAIL
- [ ] **Step 3: 구현** — 위 테스트를 전부 통과하는 `src/web/store.js` 작성. 핵심 규칙:
  - `applyMessage`는 기존 app.js의 메시지 처리(projects/assistant/log/status/preview)를 흡수하되 DOM 접근 금지(순수 상태만). user 채팅은 `{type:"local_user", project, text}` 유사 메시지로 처리(폰이 자체 호출).
  - attention 이벤트: 이전 stageStatus ≠ awaiting_confirm → awaiting_confirm 전이 시에만.
  - `pendingConfirm = { project, stage, sentAt }`; 해당 프로젝트 stage_update 수신 시(내용 무관) acked 처리.
  - statusBadge: error>done>awaiting_confirm(wait)>running/starting(run)>awaiting_feedback(wait 계열 label "피드백 중")>pending(pend). 레거시는 busy면 run.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat: phone state store module (pure, tested)`

---

### Task 5: web — 마크다운 미니 렌더러 (`src/web/markdown.js`)

**Files:**
- Create: `src/web/markdown.js`
- Test: `tests/web/markdown.test.js`

**Interfaces:**
- Produces: `export function renderMarkdown(md: string): string` — 지원: `#`~`###` 헤딩, `**굵게**`, `` `코드` ``, `- ` 목록, `| a | b |` 표(구분행 `|---|` 인식), 빈 줄 문단. **입력을 먼저 HTML 이스케이프**(XSS — artifact 내용은 Claude 생성물).

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/web/markdown.test.js
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/web/markdown.js";

describe("renderMarkdown", () => {
  it("헤딩/굵게/코드", () => {
    const h = renderMarkdown("## 제목\n**강조**와 `코드`");
    expect(h).toContain("<h2>제목</h2>");
    expect(h).toContain("<strong>강조</strong>");
    expect(h).toContain("<code>코드</code>");
  });
  it("목록과 표", () => {
    const h = renderMarkdown("- 하나\n- 둘\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(h).toContain("<li>하나</li>");
    expect(h).toContain("<table>");
    expect(h).toContain("<td>1</td>");
    expect(h).not.toContain("---");
  });
  it("HTML은 이스케이프된다(XSS)", () => {
    const h = renderMarkdown('<script>alert(1)</script>');
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현** — 줄 단위 파서(이스케이프 → 블록 분류 → 인라인 치환). 의존성 0, ~60줄.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat: dependency-free markdown renderer for artifact viewer`

---

### Task 6: web — 화면 개편 (홈 + 파이프라인 화면)

**Files:**
- Modify: `src/web/index.html` (전면 개편 — 확정 목업의 다크 팔레트·카드·칩·스텝퍼 스타일)
- Modify: `src/web/app.js` (전면 개편 — store.js 기반 배선)
- Test: 자동 테스트 없음(DOM 배선) — Step 4의 수동 검증 체크리스트로 대체

**Interfaces:**
- Consumes: Task 4 store.js, Task 5 markdown.js, Phase 1A 프로토콜 전부
- Produces(화면 구조 — 확정 목업 `pipeline-ux-mockup.html`의 ①② 화면 기준):
  - `#screen-pair` 기존 페어링 (유지)
  - `#screen-home`: 연결 상태 점 + "내 프로젝트" + 카드 리스트(진행바 = stageProgress, 배지 = statusBadge, 큐 칩 "명령 N개 대기", 마지막 활동) + 보관 섹션(접힘) + [＋ 새 프로젝트] (기본 파이프라인 생성 `{type:"createProject", name, pipeline:true}`, "빠른 웹앱(레거시)" 선택지는 confirm 다이얼로그로)
  - `#screen-project`: 앱바(‹ 뒤로, 이름, 상태칩) + (파이프라인이면) 7단계 스텝퍼 + 단계 카드 + 채팅 + 입력. 레거시면 기존 채팅+iframe 뷰.
  - 단계 카드 버튼 규칙: `awaiting_confirm` → [산출물 열기(있으면)] [✓ 컨펌하고 다음 단계로]; `running/starting` → 컨펌 비활성 + [■ 중단](stage_cancel) + 경과 표시; `error` → [재시도](command "이어서 다시 시도해줘") ; `pending` → [시작하기](command로 첫 지시 입력 유도)
  - 스텝퍼 지난 단계 탭 → `confirm()` 다이얼로그 후 `stage_rollback`
  - 프로젝트 진입 시 `chat_history_get` 전송, 페어링 직후 `pipeline_sync` + `listProjects` 전송
  - 재접속(onclose 후 재연결): 기존 페어링 화면 복귀 유지(안정 세션 키는 Phase 5)

- [ ] **Step 1: index.html 전면 교체** — 목업 팔레트로 스타일 정의(:root 변수 --bg:#12161B --surface:#1B2129 --surface2:#232B35 --line:#2C3540 --ink:#E8ECEF --sub:#8B94A0 --run:#4C8DFF --wait:#E5A83B --done:#4CAF80 --err:#E06055), 3개 screen div + 카드/칩/스텝퍼/버튼 클래스, `<script type="module" src="app.js">`. 기존 pair 폼 id(code/pw/connect/pairStatus)는 유지(로직 재사용).
- [ ] **Step 2: app.js 전면 교체** — 구조:

```js
import { createStore, applyMessage, markConfirmSent, confirmTimedOut, statusBadge, stageProgress, homeProjects, STAGES, STAGE_LABELS } from "./store.js";
import { renderMarkdown } from "./markdown.js";
```

- 단일 `render()`가 store.screen에 따라 화면 토글 + 해당 화면 렌더(기존 전체 재그리기 방식 유지)
- ws.onmessage: `const events = applyMessage(store, msg, Date.now()); render(); handleEvents(events);`
- 기존 페어링·재연결·미리보기 캐시버스터 로직은 이식(동작 동일)
- confirm 버튼: `ws.send(confirm)` + `markConfirmSent` + 버튼 "확인 중…" 비활성; 1초 인터벌로 `confirmTimedOut` 검사 → 타임아웃 시 [다시 전송] 버튼 노출(스펙 §4 ack 계약)
- 레거시 프로젝트 카드/화면은 기존 UX와 기능 동일(채팅+iframe, target 아이콘)

- [ ] **Step 3: 타입·전체 테스트** — `npx tsc --noEmit`(web JS는 미포함이므로 영향 없음 확인) + `npx vitest run` 전체 통과
- [ ] **Step 4: 수동 검증(필수, 결과를 리포트에 기록)** — `npm start` 없이 검증하려면: `npx tsx src/launch.ts`는 claude 실행이 필요하므로, **정적 확인**으로 대체: ① `node --input-type=module -e "import('./src/web/store.js').then(()=>console.log('ok'))"` ② `node --check` 급 문법 확인은 ESM이라 `node --input-type=module -e "import('./src/web/app.js')"`은 DOM이 없어 실패가 정상 — 대신 브라우저 없이 잡을 수 있는 참조 오류를 위해 `npx vitest run`의 store/markdown 테스트 통과로 갈음하고, **index.html이 참조하는 모든 element id가 app.js의 $() 호출과 1:1인지 grep으로 대조**해 목록을 리포트에 남긴다: `grep -o '\$("[a-zA-Z-]*")' src/web/app.js | sort -u` vs `grep -o 'id="[a-zA-Z-]*"' src/web/index.html | sort -u`
- [ ] **Step 5: 커밋** — `feat: phone multi-screen UI (home cards + pipeline screen)`

---

### Task 7: web — 산출물 뷰어 + 기기 프레임 프리셋 + confirm 재전송 마무리

**Files:**
- Modify: `src/web/index.html`, `src/web/app.js`
- Test: 뷰어 URL 조립·프리셋 계산은 store.js에 순수 함수로 추가해 테스트

**Interfaces:**
- Produces:
  - store.js에 추가(테스트 포함): `artifactButtons(snapshot)` → `[{key, label, kind:"md"|"iframe", url?}]` — 규칙: `.md`로 끝나면 md(artifact_get), `mockup`/`preview` 키는 iframe이며 url은 `/preview/<프로젝트>/<값의 디렉터리>/` (예: artifacts.mockup="mockup/index.html" → `/preview/habit/mockup/index.html`); `framePreset(name)` → `{w,h}|null` (iphone 390×844, android 360×800, full null)
  - 뷰어 오버레이 `#viewer`: md면 `renderMarkdown` 결과 표시, iframe이면 프레임 wrap + 상단 프리셋 칩 3개(탭 시 iframe 크기만 변경 — 기존 applyFrameMode 로직을 프리셋 기반으로 일반화)
  - `artifact` 메시지 수신 → 뷰어에 내용 표시 (store에 `viewer:{project,key,content}` 상태)

- [ ] **Step 1: 실패하는 테스트 작성** — tests/web/store.test.js에 artifactButtons/framePreset 케이스:

```js
it("artifactButtons: md는 md, mockup/preview는 iframe+URL", () => {
  const p = snap({ artifacts: { prd: "docs/PRD.md", mockup: "mockup/index.html", preview: "preview/index.html" } });
  const btns = artifactButtons(p);
  expect(btns.find((b) => b.key === "prd").kind).toBe("md");
  expect(btns.find((b) => b.key === "mockup")).toMatchObject({ kind: "iframe", url: "/preview/habit/mockup/index.html" });
});
it("framePreset", () => {
  expect(framePreset("iphone")).toEqual({ w: 390, h: 844 });
  expect(framePreset("full")).toBeNull();
});
```

- [ ] **Step 2: 실패 확인** → **Step 3: 구현**(store.js 함수 + app.js/index.html 뷰어·프리셋 배선) → **Step 4: 통과 확인**(전체) — Task 6과 같은 id 1:1 grep 대조 포함
- [ ] **Step 5: 커밋** — `feat: artifact viewer (markdown/iframe) with device frame presets`

---

### Task 8: web+host — 배지·알림음 + 관리 시트(보관/삭제) + 마무리 검증

**Files:**
- Modify: `src/web/app.js`, `src/web/index.html`
- Test: store.js의 attention 로직은 Task 4에서 이미 테스트됨 — 이 태스크는 배선 + 수동 검증

**Interfaces:**
- Produces:
  - attention 이벤트 시: `document.title = "● " + 원래제목`, 홈 카드 강조(목업 ①의 attn 테두리), WebAudio 짧은 비프(880Hz 0.15s ×2 — 의존성 0, 사용자 제스처 후에만 AudioContext 생성). 해당 프로젝트 화면 진입 시 배지 해제
  - 카드의 ⋯ 버튼 → 관리 시트(목업 ④): [📦 보관/복원] → `project_archive`, [✏️ 이름 바꾸기]는 Phase 2 이후(버튼 없음 — YAGNI), [🗑 삭제] → 이름 입력 `prompt()`가 프로젝트명과 정확히 일치할 때만 `project_delete` 전송, 불일치 시 중단. running이면 시트에서 비활성 표시(호스트도 거부하지만 UI에서 선제)
  - 최종 수동 검증: Task 6의 id 대조 + store/markdown/전체 스위트 + `git status`가 깨끗한지

- [ ] **Step 1: 배선 구현** → **Step 2: 전체 테스트** `npx vitest run` + `npx tsc --noEmit` → **Step 3: 커밋** — `feat: attention badge/sound + project manage sheet (archive/delete)`

---

## 이 계획에서 의도적으로 제외 (후속 Phase)

- 문서 템플릿 5종(Phase 2), Flutter 템플릿(Phase 3), 단계 스킬 7종·`.claude` 시드(Phase 4)
- 릴리즈 자산 갤러리 뷰(스크린샷) — release 단계 스킬과 함께 Phase 5
- 페어링 안정 세션 키·HTTP 쿠키 인증·웹 푸시·단계 타임아웃(Phase 5)
- 스킬 커맨드명 정합(`/pipeline-ideation` 확정 — 스펙 §2 표기를 Phase 4에서 갱신)
- history durationMs/costUsd 기록(Phase 4에서 confirm 시 기록)
