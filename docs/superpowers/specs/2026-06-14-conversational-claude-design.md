# 대화형 Claude (프로젝트별 메모리 + 메시지 표시) — 설계 문서

> 작성일: 2026-06-14
> 상태: 설계 승인됨

## 한 줄 요약

폰에서 Claude와 **진짜 대화**하듯 쓰게 한다 — Claude가 하는 말/작업을 폰에 말풍선으로 보여주고(`stream-json`), 프로젝트마다 대화 맥락을 기억한다(`claude --continue`). 폴더가 다르면 대화도 분리되므로 프로젝트별 독립 대화가 동시에 돌아간다.

## 동기

- 지금은 `claude -p "명령"` 한 방(one-shot)이라 Claude가 되묻거나 설명하는 게 폰에 안 보이고, 후속 명령이 이전 맥락을 모름.
- 사용자: "프로젝트마다 관리면 대화도 프로젝트마다 따로여야" + "Claude가 의사소통하는 것도 보여야".
- CLI를 여러 개 띄울 필요는 없음 — Claude Code는 **작업 폴더별로 세션을 기억**하므로, 호스트 하나가 프로젝트 폴더마다 `claude`를 띄우면 프로젝트별 독립 대화가 된다.

## 핵심 결정

| 항목 | 결정 |
|---|---|
| 대화 깊이 | 말 보이기 + 프로젝트별 메모리 (작업 중 멈춰 질문 대기 = 범위 밖) |
| 메모리 | `claude -p --continue` (프로젝트 폴더별 세션) |
| 메시지 표시 | `--output-format stream-json --verbose` 파싱 → assistant/tool 이벤트 |
| 분리 단위 | 프로젝트 폴더(이미 `projects/<이름>/`) |

## 컴포넌트 변경

### `src/shared/protocol.ts`
- `AssistantMsg { type:"assistant"; project:string; text:string }` 추가.
- `HostOutbound = LogMsg | StatusMsg | PreviewMsg | ProjectsMsg | AssistantMsg`.

### `src/cli/stream-json.ts` (신규, 순수 — 테스트 대상)
- `interface AgentEvent { role:"assistant"|"log"; text:string }`
- `parseStreamJsonLine(line:string): AgentEvent[]` — Claude Code stream-json 한 줄을 파싱:
  - `type==="assistant"`의 `message.content[]`에서 `type==="text"` → `{role:"assistant", text}` (공백만이면 제외)
  - `type==="tool_use"` → `{role:"log", text:"🔧 "+name}`
  - 그 외(system/result/user/파싱실패) → `[]`

### `src/cli/executor.ts`
- `Executor.run`을 이벤트/세션 인지형으로:
  `run(command:string, opts:{ continueSession:boolean; onEvent:(e:AgentEvent)=>void }): Promise<void>`
- `RealExecutor.run`:
  - args: `["-p", "--output-format","stream-json","--verbose","--permission-mode","acceptEdits"]` + (`continueSession`이면 `"--continue"`) + `[command]`.
  - stdout를 줄 단위로 버퍼링하며 각 완성된 줄을 `parseStreamJsonLine`에 넣고 결과 이벤트를 `onEvent`로 흘림. (부분 줄 버퍼 처리)
  - 종료코드 0 아니면 reject(기존과 동일). `cross-spawn` 유지.

### `src/cli/agent.ts`
- `handleCommand(project, text, executor, send, continueSession)`:
  - `send(status working)`
  - `executor.run(text, { continueSession, onEvent })` — onEvent의 role에 따라 `{type:"assistant"|"log", project, text}` 전송
  - 성공 → `send(preview /preview/<project>/)`, `send(status done)`
  - 실패 → `send(status error)`

### `src/cli/host.ts`
- 프로젝트별 대화 시작 여부 추적: `const started = new Set<string>()`.
- command 처리에서 `const continueSession = started.has(project); started.add(project);` 후 `handleCommand(project, text, executor, send, continueSession)`.
- 나머지(슬러그/존재검증/busy/병렬, 체험 제한, licensed)는 그대로.

### 폰 UI (`src/web/app.js`)
- `assistant` 메시지 처리: 해당 프로젝트 로그에 **Claude 말풍선**으로 추가(시스템 log와 시각 구분). 현재 `logTo`는 텍스트 누적 — 말풍선 렌더를 위해 프로젝트별 메시지 목록(`msgs:[{who,text}]`) 구조로 소폭 확장하거나, 최소 변경으로 접두사(예: `🤖 `)로 구분. **MVP: 접두사 기반**(🤖 Claude / · 시스템 / > 나)으로 기존 로그 영역 재사용 → 변경 최소화.
- assistant/log/preview 모두 `msg.project`로 라우팅(기존과 동일).

## 데이터 흐름

폰 명령 → 릴레이(원문) → 호스트 → `handleCommand` → `claude -p --continue --output-format stream-json` → 줄마다 `parseStreamJsonLine` → assistant/log 이벤트 → 릴레이 → 폰 말풍선. 완료 시 preview/status.

## 에러 처리
- stream-json 파싱 실패 줄은 무시(빈 배열).
- claude 비정상 종료 → status error(기존).
- `--continue`인데 세션이 없을 가능성: 호스트가 같은 런 안에서만 `started`를 켜므로 첫 명령은 항상 `--continue` 없이 시작 → 세션 없음 에러 회피. (호스트 재시작 시 새 대화로 시작 — 한계)

## 테스트
- `parseStreamJsonLine`: assistant 텍스트 추출, tool_use→🔧, system/result/깨진 줄→[], 여러 content 블록.
- `handleCommand`: onEvent의 assistant/log가 `{type:"assistant"|"log", project}`로 전송되고 working→…→preview→done 순서.
- `host`: 같은 프로젝트 2번째 command에서 `continueSession=true`로 executor가 호출됨(주입 executor로 인자 캡처).
- 기존 테스트는 시그니처 변경에 맞춰 갱신, 통과 유지.

## 범위 밖
- 작업 중 Claude가 멈춰 질문하고 사용자의 답을 기다리는 완전 인터랙티브 Q&A(스트림 입력 모드).
- 대화 내역 영구 저장/복원 UI, 호스트 재시작 후 메모리 복구.

---

## 추가 기능: 만들 대상 선택 (모바일/웹) — 2026-06-15

### 동기
사용자: "만들려는 게 iOS/Android/웹/macOS인지 물어보고 그에 맞게 URL 화면도 구성해야겠지?"

### 기술적 제약 (핵심)
미리보기는 본질적으로 **URL로 열리는 웹**이다(릴레이가 `projects/<이름>/public/`을 `/preview/<이름>/`로 서빙 → 폰 브라우저가 엶). 따라서:
- ✅ **웹사이트**, ✅ **모바일 앱(PWA)** — 폰 브라우저 URL로 라이브 미리보기 가능.
- ❌ 네이티브 **iOS/Android/macOS** — Xcode/Android Studio 빌드·시뮬레이터가 필요해 URL 미리보기 불가.

→ 결정: **웹 기반 2종(`mobile`|`web`)만** 제공. 사용자 선택 = "모바일/웹 2개".

### 결정
| 항목 | 결정 |
|---|---|
| 대상 종류 | `ProjectTarget = "mobile" | "web"` (기본 `mobile`) |
| 저장 위치 | `projects/<이름>/meta.json` `{ "target": ... }` (최초 생성 시에만 기록, 보존) |
| Claude 전달 | `targetSystemPrompt(target)` → `claude --append-system-prompt`로 매 실행 첨부 |
| 폰 미리보기 | `mobile`=폰 너비 그대로 / `web`=데스크톱(1280) 화면을 컨테이너에 맞춰 축소 |

### 컴포넌트 변경
- `protocol.ts`: `ProjectTarget` 추가; `CreateProjectMsg.target?`; `ProjectsMsg.targets?: Record<name,target>`.
- `projects.ts`: `createProject(root,name,target=mobile)`가 `meta.json` 기록; `readProjectTarget`, `listProjectTargets`, `targetSystemPrompt`, `DEFAULT_TARGET`.
- `executor.ts`: `RunOpts.systemPrompt?` → 있으면 `--append-system-prompt <prompt>` 추가.
- `agent.ts`: `handleCommand(..., systemPrompt?)` → `run` opts로 전달.
- `host.ts`: createProject가 `msg.target` 반영; `sendProjects`에 `targets` 포함; command에서 `targetSystemPrompt(readProjectTarget(...))`를 `handleCommand`에 전달.
- `web/app.js`: 새 프로젝트 생성 시 `confirm`으로 모바일/웹 선택; 칩에 아이콘(📱/🌐); `applyFrameMode()`로 대상별 미리보기 틀.
- `web/index.html`: iframe을 `#frameWrap`으로 감싸 웹(데스크톱) 미리보기 축소를 가능하게.
