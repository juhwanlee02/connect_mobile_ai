# 폰 설정 화면 — Claude 모델 선택 기능 설계

**날짜**: 2026-07-14
**상태**: 승인됨 (구현 대기)

## 목적

폰 UI에 설정 화면을 추가하고, 그 안에서 Claude 모델(opus / sonnet / fable)을
전역 기본값으로 고를 수 있게 한다. 선택한 모델은 PC가 `claude` CLI를 실행할 때
`--model <모델>`로 전달된다.

## 결정 사항

- **적용 범위**: 전역 기본값 1개. 모든 프로젝트(레거시 + 파이프라인)에 동일 적용.
- **모델 목록**: `opus`, `sonnet`, `fable` (CLI `--model`이 받는 별칭 — `claude --help`로 확인됨).
- **기본값**: `opus`.
- **UI 배치**: 홈 화면에 `⚙️ 설정` 버튼 → 신규 설정 화면에서 세그먼트 버튼으로 선택.

## 데이터 흐름 & 진실의 원천

모델 값의 진실의 원천은 **PC(host)** 다. executor가 PC에서 돌기 때문. 폰은 UI일 뿐이며
값은 PC의 파일에 영속된다(재접속·재시작 후에도 유지).

```
[폰 설정 화면]
   화면 열 때  → settings_get →  [host] → settings(현재 모델) → [폰] (현재 선택 표시)
   버튼 탭     → settings_set →  [host] 검증+저장 → settings → [폰] (확정 표시)

[명령 실행 시] host가 저장된 모델을 읽어 executor에 주입 → `claude --model <모델> …`
```

## 컴포넌트별 설계

### 1. 저장소 (PC측 신규) — `src/cli/settings-store.ts`

- `.relay-auth.json`과 동일한 방식: 리포 루트 JSON 파일, 원자적 tmp+rename 쓰기.
- 파일: `.host-settings.json` (`.gitignore`에 추가).
- 형태: `{ "model": "opus" }`. 파일이 없거나 파싱 실패 시 기본 `opus`.
- **허용 목록 검증**: `["opus","sonnet","fable"]` 밖의 값은 거부한다. 폰에서 온 값을 그대로
  CLI 인자로 넘기므로 임의 `--model` 인젝션을 막기 위한 필수 방어선.
- 공개 함수(예): `readHostSettings(): { model: string }`, `writeHostModel(model: string): boolean`
  (허용목록 밖이면 `false` 반환, 저장 안 함), `ALLOWED_MODELS` 상수.

### 2. 프로토콜 — `src/shared/protocol.ts`

- 폰 → PC:
  - `SettingsGetMsg { type: "settings_get" }`
  - `SettingsSetMsg { type: "settings_set"; model: string }`
- PC → 폰:
  - `SettingsMsg { type: "settings"; model: string }`
- `PhoneOutbound` 유니온에 `SettingsGetMsg | SettingsSetMsg` 추가.
- `HostOutbound` 유니온에 `SettingsMsg` 추가.

### 3. Host — `src/cli/host.ts`

- 인바운드 핸들러(`handleIncoming`)에 분기 추가:
  - `settings_get` → `readHostSettings()` 읽어 `{ type: "settings", model }` 전송.
  - `settings_set` → `writeHostModel(msg.model)` 시도. 성공/실패와 무관하게 저장 후 현재값을
    `settings`로 재전송(폰이 항상 실제 저장값을 반영하도록). 잘못된 값이면 저장 안 되고
    기존값이 그대로 회신된다.
- **executor 주입**: `createExecutor` 팩토리를
  `(wd) => new RealExecutor(wd, () => readHostSettings().model)` 로 변경.
  → `RunOpts`나 두 호출부(`agent.ts`, `pipeline-manager.ts`)를 건드리지 않고 모델이 자동 반영됨.
  실행 시점에 매번 저장소를 읽으므로 설정 변경이 다음 실행부터 즉시 적용된다.

### 4. Executor — `src/cli/executor.ts`

- `RealExecutor` 생성자에 두 번째 인자 `getModel?: () => string | undefined` 추가
  (기존 `constructor(private projectDir: string)` → `constructor(private projectDir: string, private getModel?: () => string | undefined)`).
- `run()`의 args 구성에서 모델 플래그 추가:
  ```ts
  const model = this.getModel?.();
  if (model) args.push("--model", model);
  ```
  (검증은 저장 시점에 이미 끝났으므로 여기서는 값이 있으면 그대로 사용.)
  플래그 위치는 `-p --output-format …` 뒤, `command` push 전.

### 5. 폰 UI — `src/web/index.html`, `src/web/app.js`

- **index.html**:
  - 홈 화면(`#screen-home`)에 `⚙️ 설정` 버튼(`#openSettings`) 추가 — `#openTemplates` 옆.
  - 신규 `#screen-settings` 마크업: 뒤로 버튼 + 제목 "Claude 모델" + opus/sonnet/fable
    세그먼트 버튼 그룹(`data-model` 속성).
- **app.js**:
  - `#openSettings` 클릭 → 설정 화면 표시 + `send({ type: "settings_get" })`.
  - `ws.onmessage`에서 `msg.type === "settings"` 처리 → 현재 모델 버튼 하이라이트.
  - 세그먼트 버튼 클릭 → `send({ type: "settings_set", model })` (낙관적으로 즉시 하이라이트,
    회신 `settings`로 확정).
  - 뒤로 버튼 → 홈 화면 복귀.

## 테스트

- **settings-store**:
  - 파일 없을 때 기본값 `opus` 반환.
  - 저장 후 읽기 왕복이 일치.
  - 허용목록 밖 값(`"gpt-4"` 등) 저장 시 `false` 반환 + 저장 안 됨.
- **executor**:
  - `getModel`이 값을 주면 spawn args에 `--model <m>` 포함.
  - `getModel`이 undefined거나 없으면 `--model` 미포함.
  - (기존 exec seam 오버라이드 방식으로 args 캡처하여 검증.)
- **host**:
  - `settings_set`에 잘못된 모델이 오면 저장소가 바뀌지 않고, `settings` 회신은 기존값.

## 비목표 (YAGNI)

- 프로젝트별 / 파이프라인 단계별 모델 지정 — 하지 않는다(전역 1개).
- PC setup 페이지(`src/web/setup`)에는 넣지 않는다 — 폰 설정 화면에만.
- 모델별 비용 표시·경고 — 하지 않는다.
