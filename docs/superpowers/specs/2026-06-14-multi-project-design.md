# 멀티프로젝트 + 크로스플랫폼 + 더블클릭 런처 — 설계 문서

> 작성일: 2026-06-14
> 상태: **설계 승인됨 (구현 계획 작성 전)**

## 한 줄 요약

한 번의 연결로 **여러 프로젝트(앱)를 폰에서 생성·전환·병렬 실행**하고, 비개발자도 쓰게 **크로스플랫폼 안전화 + OS별 더블클릭 런처**를 더한다.

## 동기

- 사용자가 동시에 앱 2~3개를 작업함 → 단일 `workspace/`로는 부족.
- 고객층이 비개발자 → 터미널/환경변수 타이핑 없이 실행돼야 함.
- mac만이면 시장이 좁음 → Node 기반이라 이미 크로스플랫폼, 윈도우 spawn만 손보면 3개 OS 지원.

## 확정된 결정

| 항목 | 결정 |
|---|---|
| 프로젝트 다루기 | 한 연결 + 폰의 프로젝트 선택기 |
| 프로젝트 생성 | 폰에서 생성·전환 (PC에 `projects/<이름>/` 자동 생성) |
| 실행 동시성 | 프로젝트 간 **병렬 실행** (같은 프로젝트 동시 명령은 거부) |
| 크로스플랫폼 | Node + `cross-spawn`으로 mac/linux/win 지원 |
| 비개발자 UX | OS별 더블클릭 런처 + `license.txt` (키 한 번 붙여넣기) |
| 데스크탑 앱(Tauri) | **이번 범위 아님** — 모델 B(SaaS) 갈 때 함께 |

## 데이터 구조

- 단일 `workspace/` 제거 → **`projects/<이름>/public/`** (프로젝트마다 독립 폴더).
- `<이름>`은 슬러그: 소문자·숫자·하이픈만, 1~40자. 검증 실패 시 거부.
- 첫 실행 시 기본 프로젝트(`my-app`) 1개 시드해 빈 화면 방지.
- "활성 프로젝트"는 **폰 쪽 개념**(어떤 칩을 골랐나). 호스트는 무상태 — 명령이 프로젝트 이름을 실어 보냄.

## 프로토콜 변경 (`src/shared/protocol.ts`)

폰 → (릴레이) → PC:
- `CommandMsg { type:"command", project:string, text:string }`  ← `project` 추가
- `CreateProjectMsg { type:"createProject", name:string }`  ← 신규
- `ListProjectsMsg { type:"listProjects" }`  ← 신규
- `PhoneOutbound = CommandMsg | CreateProjectMsg | ListProjectsMsg`

PC → (릴레이) → 폰:
- `ProjectsMsg { type:"projects", names:string[] }`  ← 신규
- `LogMsg { type:"log", project:string, text:string }`  ← `project` 추가
- `StatusMsg { type:"status", project:string, state:"idle"|"working"|"done"|"error", text? }`  ← `project` 추가
- `PreviewMsg { type:"preview", project:string, url:string }`  ← `project` 추가
- `HostOutbound = LogMsg | StatusMsg | PreviewMsg | ProjectsMsg`

릴레이는 여전히 메시지 **내용을 파싱하지 않고 원문 전달만** 한다(프라이버시 유지). 위 필드는 호스트와 폰만 해석.

## 컴포넌트

### 프로젝트 유틸 (`src/cli/projects.ts`) — 순수/IO 분리
- `slugifyProjectName(raw): string | null` — 검증·정규화(순수, 테스트 대상).
- `listProjects(root): string[]` — `projects/` 하위 디렉터리 목록.
- `createProject(root, name): void` — `projects/<name>/public/` 생성 + 시작 `index.html` 시드(이미 있으면 무시).
- `projectPublicDir(root, name): string` — 경로 헬퍼.

### 호스트 (`src/cli/host.ts` 확장)
- 연결 시 + `listProjects` 수신 시 → `ProjectsMsg` 전송.
- `createProject` 수신 → 유효성 검사 후 생성, 갱신된 `ProjectsMsg` 전송.
- `command{project,text}` 수신 → **해당 프로젝트 폴더에서 병렬 실행**. 진행 중인 프로젝트 집합(`Set<string>`)으로 **같은 프로젝트 중복 명령 거부**(`status{project,state:"error",text:"이미 작업 중"}`).
- 로그·상태·미리보기 메시지에 `project` 태깅. 미리보기 url = `/preview/<project>/`.
- `handleCommand`(agent.ts)는 `project`를 받아 메시지에 실어 보내도록 시그니처 확장.

### 실행기 (`src/cli/executor.ts`)
- 호스트가 **프로젝트마다 작업 폴더로 executor를 생성**해 실행한다: 명령 수신 시 `new RealExecutor(join(projectsRoot, project))`로 만들어 `run(text, onLog)` 호출. (현재 생성자 시그니처 그대로 유지 — 변경 없음.)
- 내부 spawn은 `cross-spawn` 사용.
- `run`은 성공만 보장하고 url은 반환하지 않아도 됨 — 미리보기 url은 호스트가 `/preview/<project>/`로 구성한다. (현행 `run`이 `{url}`을 반환하므로, 반환값은 무시하고 호스트가 경로를 만든다.)

### 릴레이 (`src/server/relay.ts`)
- 미리보기 라우팅: `/preview/<name>/<rest>` → `<previewRoot>/<name>/public/<rest||index.html>`. `previewRoot`는 `projects/`. 경로 탈출 가드는 최종 경로가 `previewRoot` 하위인지로 유지.
- `staticDir`(폰 PWA) 라우팅은 그대로.

### 크로스플랫폼 (`cross-spawn`)
- 새 의존성 `cross-spawn` 추가. `executor.ts`와 `launch.ts`(cloudflared)의 `spawn`을 교체.
- shell 미사용 → 폰에서 온 명령 텍스트가 셸로 해석되지 않음(인젝션 방지). 윈도우 `.cmd` 자동 해결.

### 비개발자 런처 (`launchers/`)
- `시작.command`(mac), `시작.bat`(win), `시작.sh`(linux): 각자 프로젝트 폴더로 이동 후 `npm start` 실행. 더블클릭 시 터미널 창이 뜨고 카드 표시.
- `src/launch.ts`: 라이선스를 `LICENSE_KEY` 환경변수 → 없으면 루트 `license.txt`(한 줄, trim) 순으로 읽음. 둘 다 없으면 안내 후 종료.

## 폰 UI (`src/web/index.html`, `app.js`)

- 상단 **프로젝트 바**: 프로젝트 칩 목록 + `➕ 새 프로젝트`(이름 prompt). 선택한 칩 = 활성 프로젝트.
- 연결 직후 `listProjects` 전송 → 받은 목록으로 칩 렌더, 첫 프로젝트 자동 선택.
- 채팅 전송 → `command{project: 활성, text}`.
- **프로젝트별 상태 분리**: 각 프로젝트의 로그 버퍼·미리보기 src를 폰 메모리에 따로 보관. 칩 전환 시 그 프로젝트의 로그/미리보기 표시. 빌드 중인 칩엔 진행 표시(점/스피너).
- `preview{project,url}`는 해당 프로젝트의 iframe src로(상대경로면 origin+캐시버스트, 기존 로직 재사용).

## 마이그레이션

- `workspace/` 의존 제거. `server/index.ts`·`launch.ts`는 `previewRoot = projects/` 전달.
- 기존 firebase 잔재(`workspace/firebase.json` 등)는 무시(이미 미사용).
- 첫 실행 시 `projects/my-app/public/index.html` 시드.

## 에러 처리

- 잘못된 프로젝트 이름 생성 시 → `status`/전용 에러로 폰에 표시.
- 같은 프로젝트 동시 명령 → "이미 작업 중" 거부.
- 존재하지 않는 프로젝트로 명령 → 에러 상태 회신.
- cloudflared/claude 미설치 → 기존처럼 안내 메시지.

## 테스트

- `slugifyProjectName`(순수): 유효/무효/정규화 케이스.
- `createProject`/`listProjects`: 임시 디렉터리로 생성·목록 검증.
- 릴레이 `/preview/<name>/`: `projects/<name>/public` 서빙 + 경로 탈출 가드.
- `handleCommand`: `project` 필드가 log/status/preview에 실리는지(가짜 executor).
- 프로토콜: 타입 컴파일.
- 호스트 라우팅/병렬/더블클릭 런처/폰 UI: 통합·수동 검증.

## 범위 밖 (다음 단계)

- 데스크탑 앱(Tauri) GUI, 계정/구독(모델 B), 프로젝트 삭제/이름변경(우선 생성·전환만).
