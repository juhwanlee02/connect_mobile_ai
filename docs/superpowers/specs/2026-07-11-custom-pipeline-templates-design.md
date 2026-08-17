# 커스텀 파이프라인 템플릿(곁가지) + 스텝 완료 알림 — 설계

날짜: 2026-07-11 · 상태: 사용자 리뷰 대기 · 선행 스펙: `2026-07-04-app-factory-pipeline-design.md`

## 0. 목표

현재 7단계 파이프라인(아이디에이션→…→릴리즈)은 하나의 예시일 뿐이다. 이 설계는 세 가지를 연다:

1. **스텝 편집** — 최종 사용자가 폰에서 스텝을 추가·삭제·순서변경한다.
2. **곁가지(템플릿 복제)** — 기본 7단계는 읽기전용 "기본 템플릿"으로 남고, 사용자는 복제본(내 템플릿)을 만들어 스텝 목록과 각 스텝의 프롬프트를 수정한다. 새 프로젝트를 만들 때 템플릿을 고른다.
3. **스텝 완료 알림** — 각 스텝이 사용자 액션을 기다리는 상태가 되면 폰으로 푸시 알림을 보낸다. 채널은 **ntfy.sh**(완전 무료·가입 불필요).

편집 범위는 **스텝 목록 + 스텝별 프롬프트**로 한정한다. 타임아웃·산출물 키·allowed-tools 편집은 범위 밖(스텝 유형별 기본값 사용).

## 1. 개념 모델

- **파이프라인 템플릿** = 순서 있는 스텝 목록 + 스텝별 프롬프트.
- **기본 템플릿 `default`** = 리포의 `commands/pipeline/pipeline-*.md` 7종. 읽기전용 — 수정·삭제 불가, 복제만 가능.
- **곁가지 템플릿** = `<cwd>/pipelines/<템플릿id>/`에 저장되는 사용자 데이터(manifest + 프롬프트 파일). `.gitignore` 대상.
- **프로젝트 생성 시 스냅샷** = 선택한 템플릿의 스텝 정의가 프로젝트 `pipeline.json`에 박제되고, 합성된 스킬 `.md`가 `.claude/commands/`에 시드된다. 이후 템플릿을 고치거나 지워도 **진행 중 프로젝트는 영향받지 않는다.**

## 2. 데이터 모델

### 2.1 템플릿 저장 구조

```
pipelines/
  <템플릿id>/
    manifest.json
    steps/
      <스텝id>.md        # custom 스텝의 작업 지시(본문만) 또는 builtin 오버라이드 전문
```

### 2.2 manifest.json

```json
{
  "schemaVersion": 1,
  "id": "my-fork",
  "name": "내 파이프라인",
  "basedOn": "default",
  "createdAt": "2026-07-11T00:00:00.000Z",
  "steps": [
    { "id": "ideation", "label": "아이디에이션", "kind": "builtin" },
    { "id": "competitor", "label": "경쟁사 분석", "kind": "custom" }
  ]
}
```

- `id`: kebab-case, 영문 소문자 시작 — 프로젝트명과 동일한 검증 규칙(경로 탈출 방지 포함). 복제 시 `name`에서 자동 생성하고 충돌 시 숫자 접미사.
- `steps[].kind`:
  - `builtin` — 프롬프트 정본은 `commands/pipeline/pipeline-<id>.md`. `steps/<id>.md`가 존재하면 그것이 **오버라이드**(사용자 수정본, 전문).
  - `custom` — `steps/<id>.md`는 사용자의 **작업 지시 본문만** 담는다. 실행 파일은 시드 시 스켈레톤과 합성(§3).
- 스텝 `id`는 템플릿 내 유일. builtin 7종 id(`ideation`·`prd`·`mockup`·`estimate`·`develop`·`test`·`release`)는 예약어 — custom 스텝이 쓸 수 없다. custom 스텝 id는 label에서 kebab 변환으로 자동 생성(한글 등 변환 불가 문자는 `step-N` 폴백).
- 타임아웃(편집 불가, 유형별 기본값): builtin은 현행 `STAGE_TIMEOUTS_MS` 값, custom은 **30분** 고정.

### 2.3 pipeline.json 스키마 v2 (스텝 스냅샷)

`PipelineState`에 `steps` 배열이 추가된다:

```json
{
  "schemaVersion": 2,
  "project": "water-reminder",
  "createdAt": "…",
  "template": "my-fork",
  "steps": [
    { "id": "ideation", "label": "아이디에이션", "kind": "builtin", "timeoutMin": 15 },
    { "id": "competitor", "label": "경쟁사 분석", "kind": "custom", "timeoutMin": 30 }
  ],
  "stage": "ideation",
  "stageStatus": "running",
  "artifacts": {}
}
```

- **마이그레이션**: `validatePipelineState`가 v1 파일을 읽으면 기본 7종 스텝을 주입해 v2 형태로 승격한다(메모리에서만 — 파일 재기록은 다음 쓰기 때 자연히 일어남). 기존 프로젝트는 무변경으로 계속 동작.
- 스킬 계약(_CONTRACT.md)의 "스킬이 쓸 수 있는 필드는 `stage`/`stageStatus`/`artifacts`뿐" 규칙에 `steps`/`template` 보존이 자동 포함된다(기존 문구 그대로 커버됨 — 계약 문서에 v2 예시만 갱신).

## 3. 프롬프트 합성 — 계약을 사용자에게서 격리

사용자가 프롬프트를 어떻게 고치든 상태머신이 깨지지 않아야 한다. 두 갈래:

### 3.1 custom 스텝 — 스켈레톤 합성

새 파일 `commands/pipeline/_GENERIC_STEP.md`(스켈레톤)를 추가한다. 플레이스홀더 치환으로 실행 스킬을 만든다:

- 치환 변수: `{{STEP_ID}}`, `{{STEP_LABEL}}`, `{{ARTIFACT_KEY}}`(= 스텝 id), `{{USER_INSTRUCTIONS}}`(steps/<id>.md 본문).
- 스켈레톤이 담는 것: frontmatter(`allowed-tools: Read, Write, Edit, Bash, WebSearch`), 공통 계약 요약(시작 시 stage 확인·`running` 기록, 원자적 쓰기 절차, 종료 시 `awaiting_confirm`/`awaiting_feedback` 필수, `피드백:` 모드, 보안 6항), 산출물 규약("작업 결과를 파일로 남겼다면 `artifacts["{{ARTIFACT_KEY}}"]`에 상대 경로로 등록하라 — 산출물이 채팅 보고뿐이어도 상태만 기록하면 된다").
- 합성은 **시드 시점**(프로젝트 생성)에 host가 수행해 `.claude/commands/pipeline-<스텝id>.md`로 기록한다. 실행 경로(`/pipeline-<id>` 호출)는 기존과 동일 — PipelineManager 실행 코드는 스텝이 builtin인지 custom인지 모른다.

### 3.2 builtin 스텝 오버라이드 — 전문 편집

- 폰에서 builtin 스텝의 프롬프트를 열면 정본 `.md` 전문(frontmatter 제외 본문)이 보이고, 수정 저장 시 `steps/<id>.md`에 전문이 저장된다(오버라이드). "기본값 복원" 버튼이 오버라이드 파일을 지운다.
- 시드 시: 오버라이드가 있으면 frontmatter(정본 것 유지) + 수정 본문을 합쳐 시드, 없으면 정본 복사(현행과 동일).
- 사용자가 계약 요약 부분을 지워도 안전한 근거: 계약의 실질 집행은 host 쪽 방어(시작 stage 불일치 가드, exit-0 강등, 단계 타임아웃, 시드된 `settings.json`의 deny 규칙)라서 최악의 결과는 **해당 스텝이 error로 표시**되는 것이다. 상태 파일 오염이나 다른 스텝 파급은 없다.

### 3.3 신뢰 경계

프롬프트 편집은 새 권한을 열지 않는다 — 사용자는 이미 채팅으로 임의 텍스트를 Claude에 보낼 수 있다(빠른 웹앱 모드의 command가 그 자체). 시드된 `.claude/settings.json`의 deny 규칙(시드 스크립트·설정 자체 수정 금지)은 custom 스텝 실행에도 그대로 적용된다. 템플릿 id·스텝 id는 프로젝트명과 동일한 문자 검증으로 경로 탈출을 차단한다.

## 4. 코드 변경

### 4.1 `src/shared/pipeline.ts` — 동적 스텝

- `StepDef { id, label, kind: "builtin"|"custom", timeoutMin }` 타입 추가.
- `DEFAULT_STEPS: StepDef[]` — 현행 `STAGES` + `STAGE_TIMEOUTS_MS`를 스텝 정의로 재표현(기본 템플릿의 정의이자 v1 마이그레이션 소스).
- `nextStage`/`isPriorStage`/진행률 함수를 `steps` 인자를 받는 형태로 교체. `STAGES` 상수 직접 참조는 전부 제거(웹 포함).
- `PipelineState`에 `steps`·`template` 추가, `validatePipelineState`에 v1 승격 + `steps` 검증(비어있으면 null).

### 4.2 `src/shared/template-store.ts` (신규 — 위치는 짝 스펙 `2026-07-11-login-onboarding-ux-design.md` §3.4가 정정: 릴레이의 설정 페이지도 쓰므로 shared)

템플릿 CRUD 전담 모듈. 순수 파일 I/O — 목록(`default` 가상 항목 + `pipelines/` 스캔), 복제, 삭제, 스텝 목록 갱신, 프롬프트 get/set/reset, manifest 검증. 모든 쓰기는 tmp+rename 원자적 쓰기. 깨진 manifest는 목록에서 제외하고 log 경고.

### 4.3 `src/cli/seed-assets.ts`

`seedPipelineAssets(repoRoot, projectDir, template?)` — 템플릿의 스텝별로: builtin 비오버라이드는 정본 복사, builtin 오버라이드·custom은 합성해 `.claude/commands/pipeline-<id>.md` 기록. 템플릿에 없는 builtin 스텝의 .md는 시드하지 않는다. 나머지 시드(스킬·템플릿·settings)는 현행 유지.

### 4.4 `src/cli/pipeline-manager.ts`

- `STAGES`/`STAGE_TIMEOUTS_MS` 참조 → `state.steps` 기반으로 교체(confirm의 nextStage, rollback 검증, runStage 타임아웃).
- `runStage`의 명령 형식(`/pipeline-<id>`)·큐·강등 로직은 무변경.

### 4.5 `src/shared/protocol.ts` — 신규 메시지

폰→PC:

| 메시지 | 필드 | 동작 |
|---|---|---|
| `tpl_list` | — | 템플릿 목록 요청 |
| `tpl_clone` | `basedOn`, `name` | 곁가지 생성 |
| `tpl_delete` | `id` | 곁가지 삭제(`default` 거부) |
| `tpl_steps_set` | `id`, `steps: [{id?, label, kind}]` | 스텝 추가/삭제/순서/이름 일괄 저장(`default` 거부, 빈 목록 거부) |
| `tpl_prompt_get` | `id`, `stepId` | 프롬프트 본문 요청 |
| `tpl_prompt_set` | `id`, `stepId`, `body` | 프롬프트 저장(`default` 거부) |
| `tpl_prompt_reset` | `id`, `stepId` | builtin 오버라이드 제거 |
| `notify_config_get` / `notify_config_set` | `enabled` | 알림 설정 조회/토글 |
| `notify_test` | — | 테스트 알림 발송 |
| `createProject` (확장) | `template?: string` | 템플릿 선택 생성 |

PC→폰: `tpl_list { templates: [{id, name, basedOn, readonly, steps: [{id, label, kind, overridden}]}] }`, `tpl_prompt { id, stepId, body, overridden }`, `notify_config { enabled, topic, server }`. 거부·오류는 기존 `log`/`error` 채널.

### 4.6 폰 UI (`src/web/`)

- **템플릿 화면**: 홈에 "⚙️ 템플릿" 진입점. 목록(기본 + 곁가지) → 곁가지는 [스텝 편집]·[삭제], 모든 항목에 [복제]. 스텝 편집 화면: 행마다 ↑/↓(순서)·✏️(프롬프트)·✕(삭제), 하단 [＋ 스텝 추가](이름 입력 → id 자동). 프롬프트 편집: 전체화면 textarea + [저장] + (builtin) [기본값 복원]. 기본 템플릿은 프롬프트 열람만 가능.
- **프로젝트 생성**: 파이프라인 선택 시 템플릿 선택(기본값 `default`, 곁가지가 없으면 선택 UI 생략).
- **진행 표시**: `STAGES`/`STAGE_LABELS` 하드코딩 제거 → `snapshot.steps`로 스텝 바·진행률·롤백 목록 렌더. `N/M` 표기도 스냅샷 기준.

## 5. 알림 (ntfy.sh)

### 5.1 설정과 토픽

- 새 모듈 `src/cli/notify.ts`. 설정 파일 `<cwd>/.notify.json` `{ enabled, topic, server }`(`.gitignore` 대상, `.relay-password`와 같은 취급).
- 최초 활성화 시 토픽 자동 생성: `cpmc-` + 22자 영숫자 랜덤(`crypto`). **토픽명이 곧 수신 자격**이므로 고엔트로피 필수.
- 서버 기본 `https://ntfy.sh`, `NTFY_SERVER` 환경변수로 셀프호스트 교체 가능.

### 5.2 발송 시점

PipelineManager의 스냅샷 전이 감지(기존 `lastEmitted` 비교를 상태 전이 훅으로 확장)에서, 아래 상태로 **진입**할 때 1회 발송:

| 전이 | 메시지 예 |
|---|---|
| → `awaiting_confirm` | `[water-reminder] 2/7 PRD 완료 — 폰에서 컨펌해 주세요` |
| → `awaiting_feedback` | `[water-reminder] PRD 단계에서 질문이 있어요` |
| → `error` | `[water-reminder] 개발 단계 실패 — 확인 필요` |
| `stage` → `done` | `[water-reminder] 모든 단계 완료 🎉` |

- `fetch POST <server>/<topic>` + `Title`/`Priority`/`Tags` 헤더. 5초 타임아웃, fire-and-forget — 실패해도 파이프라인 진행·인앱 알림에 영향 없음(폰 로그에 1줄 경고만).
- 내용은 프로젝트명·스텝 이름·상태만 — 산출물 내용은 절대 포함하지 않는다(공용 서버 경유).

### 5.3 폰 UI

설정 영역 "🔔 완료 알림" 토글 → 켜면 host가 토픽 생성 후 `notify_config` 회신 → 화면에 ① ntfy 앱 설치 링크(App Store/Play) ② 구독 링크 `https://ntfy.sh/<topic>`(복사 버튼) ③ [테스트 알림 보내기]. 문구로 명시: "이 링크를 아는 사람은 알림을 볼 수 있어요 — 공유하지 마세요."

## 6. 에러 처리 요약

- manifest 파싱·검증 실패 → 목록 제외 + 경고. 그 템플릿으로 프로젝트 생성 시도 → 생성하지 않고 명확한 오류 회신.
- 스텝 0개 저장·`default` 수정/삭제·예약 id 충돌·중복 id → 거부 + 사유 회신.
- 템플릿 수정/삭제는 기존 프로젝트 무영향(§1 스냅샷).
- v1 `pipeline.json` → 읽기 시 기본 7종 승격(§2.3).
- ntfy 발송 실패 → 무해(§5.2).

## 7. 테스트

- **template-store**: 복제/삭제/검증, id 자동 생성·충돌, 경로 탈출 거부, 프롬프트 override·reset, 깨진 manifest 격리.
- **shared/pipeline**: v1→v2 승격, steps 기반 next/prior/진행률, `steps` 검증.
- **seed-assets**: 스켈레톤 치환 결과(스텝 id·지시 본문 포함, 플레이스홀더 잔존 없음), 오버라이드 합성.
- **pipeline-manager**: custom 스텝 confirm 전진·타임아웃(timeoutMin)·rollback, v1 프로젝트 동작 유지.
- **notify**: 전이별 발송 1회(fetch mock), 중복 억제, 실패 무해성, 토픽 생성·영속.
- **수동 인수**: `docs/ACCEPTANCE.md`에 템플릿 복제→스텝 추가→프롬프트 수정→프로젝트 생성→커스텀 스텝 완주→ntfy 수신 시나리오 추가.

## 8. 범위 밖 (명시적 미구현)

조건 분기·병렬 스텝, 템플릿 내보내기/공유, 스텝별 타임아웃·allowed-tools 편집, 웹푸시·텔레그램 등 추가 알림 채널, 빠른 웹앱(비파이프라인) 완료 알림.
