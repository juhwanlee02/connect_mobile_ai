---
description: 파이프라인 5단계 — flutter create(app/ 고정)+스타터 오버레이 적용 후 PRD §4 화면 전부 구현(컨펌된 목업이 시각 기준, i18n en/ko). 백엔드 채택 시에만 SDK+COST-GUARDRAILS.md(artifacts.guardrails), 광고 채택 시 광고 스킬 적용(테스트 ID). 완료 게이트: analyze 0·test 통과·appRoutes↔PRD §4 1:1·iOS 시뮬 스모크(macOS). 게이트 통과 후 웹 미리보기 빌드(preview/)까지 — 폰에서 즉시 실제 앱을 본다. artifacts.app·preview 등록.
allowed-tools: Read, Write, Edit, Bash
---

# /pipeline-develop — 5단계: 개발

## 공통 계약 (요약 — 정본은 `.claude/commands/_CONTRACT.md`, 충돌 시 정본 우선)

1. 시작: `pipeline.json` 읽기 → `stage`가 `"develop"`인지 확인(아니면 쓰지 말고 보고 후 종료) →
   `stageStatus: "running"` 기록. 쓰는 필드는 `stage`/`stageStatus`/`artifacts`만, 나머지는 보존,
   항상 ① Write 도구로 `<대상>.tmp` 작성 ② `bash .claude/atomic-mv.sh <대상>.tmp <대상>`으로
   교체(원자적). `stage` 값은 바꾸지 않는다.
2. 산출물 = `app/`(Flutter 프로젝트 — 스타터 오버레이 구조 유지) + 백엔드 채택 시
   `COST-GUARDRAILS.md`(`templates/COST-GUARDRAILS.md`의 4블록 구조 그대로, 추가·삭제 금지).
   완료 시 `artifacts`에 등록.
3. 종료 시 `stageStatus`는 `"awaiting_confirm"` 또는 `"awaiting_feedback"` — **`running`인 채 종료
   금지**(그대로 종료하면 host가 `error`로 강등해 사용자에게 실패로 보인다).
4. `피드백:` 접두 호출 = 기존 앱 수정 모드 — **수정 후 완료 게이트(⑦)를 전부 재실행해야 한다**.
   "그냥 질문"이면 순변경 없이 답만 하고 실행 전 상태를 복원.
5. 버그·문구·스타일·목업과의 불일치 수정은 이 단계 범위 **안**이다. **작은 기능 추가·변경**
   (기존 화면 안 요소·동작 수준)도 이 단계에서 바로 반영하되 `docs/PRD.md` §3·§4를 함께
   갱신한다(계약 5항). **큰 방향 전환**(새 화면 여러 개·수익모델·백엔드 변경)만 산출물을 바꾸지
   말고 되돌리기(롤백)를 권한다.
6. 보안: 이 단계는 웹 도구를 쓰지 않는다(신뢰불가 웹 입력 해당 없음) · 자격증명·API 키를 코드에
   하드코딩하거나 로그·산출물에 노출하지 않는다(`.env.example`로 형식만 커밋, 광고는 테스트 ID만) ·
   프로젝트 디렉터리 밖 파일 생성 금지(`app/`은 프로젝트 안이다).

`artifacts`에는 이 단계 소유 키 **`app`(항상) + `preview`(웹 빌드 성공 시) + `guardrails`(백엔드
채택 시에만)**를 추가·갱신하고 기존 키(`ideas`/`prd`/`mockup`/`estimate` 등)는 전부 보존한다.
(`preview`는 이후 테스트 단계도 재빌드로 갱신하는 공유 키다.)

**원자적 쓰기의 적용 범위**: `.tmp` + `atomic-mv.sh` 절차는 host가 감시·서빙하는 계약 산출물
(`pipeline.json`, `COST-GUARDRAILS.md`)에 적용한다. `app/` 안의 소스 코드는 host 감시 대상이
아니므로 Write/Edit 도구로 직접 수정한다.

## 절차 (①~⑨ 번호 순서 강제 — 건너뛰기 금지)

**쉘 작업 디렉터리는 호출 간 유지된다.** `app/` 내부 명령은 **반드시 두 번의 개별 Bash 호출**로
나눠 실행한다 — ① `cd app && <명령>` ② 완료 후 별도 호출로 `cd ..` 복귀. **한 호출 안에 `cd`를
두 번 이상 넣거나(`cd app && <명령>; cd ..`처럼) 괄호 서브셸(`(cd app && <명령>)`)로 묶지 말 것**
— 런타임 승인 정책이 "한 명령 안의 다중 디렉터리 변경"과 "셸 연산자(괄호 등)"를 범주적으로 차단해
headless(`acceptEdits`) 실행에서 거부된다(Phase 5 Task 4 실측 — `.superpowers/sdd/task-4-report.md`).
아래 각 항목의 `cd app && <명령>` 표기는 ①만을 가리키며, 실행 후 잊지 말고 ②로 복귀할 것(복귀를
빠뜨리면 이어지는 명령이 `app/` 안에서 실행되어 실패한다). 그 외 명령은 전부 프로젝트 루트 기준.

### ① 입력 확인

- **`docs/PRD.md`(artifacts.prd)만 필수**다 — 없으면 아무 산출물도 만들지 않고 "PRD가 없습니다 —
  PRD 단계를 먼저 컨펌해주세요"라고 보고한 뒤 `stageStatus: "awaiting_feedback"` 기록 후 종료한다
  (§4 화면 목록이 개발의 정본이므로 이것만은 대체 불가).
- **`mockup/`(artifacts.mockup)·`ESTIMATE.md`(artifacts.estimate)는 있으면 읽고, 없으면
  (사용자가 템플릿에서 그 단계를 뺀 경우) 멈추지 말고 건너뛴다** — 각각의 대체 처리:
  - 목업 없음 → PRD §4의 핵심 구성요소·유저 스토리만으로 화면을 구성한다(④의 시각 기준이 없다는
    점을 ⑨ 최종 보고에 한 줄 남긴다).
  - ESTIMATE 없음 → 백엔드 판정은 `BUSINESS.md`(있으면 §2) 또는 **로컬 기본**으로 삼고 그 근거를
    보고에 남긴다. ⑤ 비용 가드레일은 백엔드를 실제로 채택할 때만 작성한다(미채택이면 생략).
- 읽어 둘 것: PRD §4 화면 목록(화면 ID·라우트·핵심 구성요소·화면별 유저 스토리·수용 기준),
  §5 데이터 모델, §6 수익화 계획(광고 채택 여부), §8 applicationId·표시명, §10 네이티브 필요
  요건. **(있으면)** ESTIMATE §1 백엔드 최종 판정과 §6 "비용 가드레일 적용 대상" 판정(⑤의 입력).
  **(있으면)** 컨펌된 목업 `mockup/<화면ID>.html` 각각(④의 시각 기준 — 없으면 위 대체 처리).
- 있으면 `BUSINESS.md`(artifacts.business — 3단계 수익화·백엔드 결정)도 읽는다: **§3 0원 게이트가
  "유보"**(구독·서버를 나중에 연동)면 그 부분을 실제로 연동하지 말고 §4 TODO 목록대로
  `// TODO(backend)` 스텁으로 남긴 채 나머지를 완성한다(⑤ 참조). 없으면 구 프로젝트로 보고
  ESTIMATE만 따른다.

### ② Flutter 프로젝트 생성 (`app/` 고정)

- `<slug_snake>` = `pipeline.json`의 `project`(kebab-case)를 snake_case로 변환(하이픈→언더스코어.
  예: `water-reminder` → `water_reminder`).
- 실행: `flutter create app --project-name <slug_snake> --org com.appfactory`
  — 디렉터리는 항상 `app/`으로 고정하고 패키지명을 `--project-name`으로 지정한다(결과
  applicationId = `com.appfactory.<slug_snake>`). `flutter create <slug_snake>` 후 디렉터리를
  옮기는 방식은 쓰지 않는다 — 파일 조작 명령은 화이트리스트로 명시 통제한다(버전별 암묵 승인에
  기대지 않음), `--project-name`이 같은 결과를 화이트리스트 안의 한 명령으로 만든다.
- **applicationId 검증**: Read로 `app/android/app/build.gradle.kts`(없으면 `build.gradle`)의
  `applicationId`가 PRD §8 값과 **문자 그대로 일치**하는지 확인한다. 불일치하면 PRD §8이
  정본이므로 Edit으로 gradle 쪽을 PRD 값으로 고치고 재확인한다. iOS bundle identifier는 프로젝트명
  기준이므로 PRD §8과 동일 소스다 — 카멜 변환만 허용(flutter의 언더스코어→카멜케이스 변환 결과까지는
  일치로 인정)하고, 변환 후 **마지막 세그먼트의 어근이 PRD §8 값과 다르면 불일치로 처리해 error**.

### ③ 스타터 오버레이 적용

- 실행: `bash templates/flutter-starter/apply.sh app` — overlay 복사·pubspec 병합·`flutter pub get`
  까지 스크립트가 수행한다(`set -euo pipefail`로 실패 시 즉시 중단). 실패하면 오류를 요약 보고하고
  원인을 고친 뒤 재실행한다(스크립트는 멱등).
- 적용 직후 베이스라인 확인: `cd app && flutter analyze`(복귀 잊지 말 것)가 0 오류, `cd app &&
  flutter test`(복귀 잊지 말 것)가 전부 통과해야 한다 — 여기서 깨지면 화면 구현을 시작하기 전에
  먼저 해결한다.

### ④ PRD §4 화면 전부 구현

스타터 README(`templates/flutter-starter/README.md`)의 **"새 화면 추가하기" 체크리스트를 화면마다
반복**한다: (1) `lib/router.dart`의 `appRoutes`에 화면 ID 추가 + `buildRouter`에 `GoRoute` 추가
(라우트 경로는 kebab 유지) (2) `lib/screens/<snake>_screen.dart` 생성(kebab→snake 파일명,
PascalCase 클래스명) (3) `assets/lang/en.json`·`ko.json`에 동일 키셋으로 문자열 추가
(4) `cd app && flutter test`(복귀 잊지 말 것)로 `router_test.dart`의 1:1 강제 통과 확인.

- **스타터 기본 화면 처리**: `home`은 PRD §4에 반드시 있는 화면이다 — 스타터의
  `home_screen.dart`를 PRD §4 `home` 정의·목업대로 **재작성**한다(스타터 플레이스홀더를 그대로
  두지 않는다). `settings`는 PRD §4에 있으면 그 정의대로 수정하고, 없으면 스타터 기본 그대로
  유지한다(⑦ 대조에서 유일한 예외로 처리).
- **디자인 기준 = 컨펌된 목업(있으면)**: 각 화면은 `mockup/<화면ID>.html`의 레이아웃·구성요소
  배치·문구 톤을 따른다(픽셀 일치가 아니라 구조·요소·흐름 일치 — 시각 정합의 최종 확인은 6단계에서
  사용자가 한다). **목업 단계를 뺀 프로젝트라 해당 화면 파일이 없으면** PRD §4의 핵심 구성요소·
  유저 스토리를 시각 기준으로 삼는다.
- **수용 기준 충족**: PRD §4 "화면별 유저 스토리·수용 기준"의 체크리스트 **각 항목**이 실제
  동작으로 충족돼야 한다(항목별로 어느 코드가 충족하는지 스스로 점검).
- **데이터**: PRD §5 데이터 모델대로 구현 — 로컬 저장이면 스타터의 `SettingsService`
  (SharedPreferences) 패턴을 재사용하거나 같은 패턴의 엔티티 서비스를 추가한다.
- **데모 시드(`lib/seed.dart`)**: 스타터의 `seedDemoData()` 훅 본문을 이 앱 도메인의 **대표 샘플
  데이터**로 채운다 — 미리보기(6단계)·스크린샷(7단계)이 `--dart-define=SEED=true`로 빌드될 때 빈
  화면 대신 채워진 화면이 보이게 하기 위함이다(예: 목록 화면에 예시 항목 3~5개, 통계 화면에 예시
  수치, 상세 화면이 열릴 시드 레코드). 규칙: ① 시드는 `kSeed`일 때만 호출되므로 **실제 설치(SEED
  없음)는 빈 상태 그대로**다(프로덕션 오염 금지) ② `seedDemoData(SettingsService)` 시그니처는
  유지하고, 필요한 다른 서비스가 있으면 인자로 받아 `main()`의 호출부(`if (kSeed) await
  seedDemoData(...)`)도 함께 갱신한다 ③ **멱등**하게 — 이미 데이터가 있으면 중복 삽입하지 않는다
  (웹은 localStorage에 남아 새로고침마다 재실행될 수 있음). 앱에 표시할 도메인 데이터가 전혀 없는
  단순 유틸이면 스텁(테마 고정 등) 그대로 두고 그 사실을 ⑧ 보고에 한 줄 남긴다.
- **i18n**: 사용자 노출 문자열은 전부 `AppTranslations` 키로 — `en.json`/`ko.json` 동일 키셋,
  하드코딩 문자열 금지.
- 레이아웃 오버플로가 생기면 `.claude/commands/skills/overflow-fix/SKILL.md` 지침으로 고친다.

### ⑤ 백엔드 SDK + 비용 가드레일 (백엔드를 실제로 채택할 때만)

판정 근거는 `ESTIMATE.md` §1(있으면), 없으면 `BUSINESS.md` §2, 그마저 없으면 로컬 기본이다.

- **BUSINESS.md 게이트가 "유보"면**(서버·구독을 나중에 연동 — ESTIMATE §1도 "v1 보류(스텁)"일
  것이다): 실제 SDK·백엔드를 붙이지 않는다. 해당 기능을 `// TODO(backend): 나중에 연동` 스텁(예:
  잠금 해제 항상 열림, 동기화 no-op, 구독 상태 항상 미구독)으로 남기고 `BUSINESS.md` §4 TODO
  목록을 그대로 따른다. `COST-GUARDRAILS.md`는 만들지 않는다(실제 백엔드 미연동).
- **미채택**(①로컬 또는 ②정적/번들)이면 이 단계 전체를 생략한다 — `COST-GUARDRAILS.md`를 만들지
  않고 `artifacts.guardrails`도 등록하지 않는다.
- 채택 시: ESTIMATE §6 권장 구성의 스택(기본 Supabase) SDK를 `app/pubspec.yaml`에 추가하고
  `cd app && flutter pub get`(완료 후 별도 호출로 `cd ..` 복귀). 자격증명은 `.env.example`로 형식만 커밋(실제 키 하드코딩·로그 노출
  금지). ESTIMATE §3 비용 리스크 표의 완화책을 실제 코드로 구현한다.
- **가드레일 체크리스트 작성**: `templates/COST-GUARDRAILS.md`의 4블록(적용 여부 + 체크리스트
  6항목 + Supabase 대응 3항목 + 준수 기록) 구조 그대로 채운다 — 체크 항목마다 이 프로젝트에서
  **어떻게** 구현했는지 한 줄 근거, 미체크 항목은 사유(해당 없음/이월). 항목별 준수 기록은 문서
  안 "준수 기록" 표에 남긴다(계약상 `pipeline.json`에는 `stage`/`stageStatus`/`artifacts`만 쓸 수
  있으므로 문서 쪽 표가 기록 위치다). Write로 `COST-GUARDRAILS.md.tmp` 작성 →
  `bash .claude/atomic-mv.sh COST-GUARDRAILS.md.tmp COST-GUARDRAILS.md`로 저장하고, ⑨에서
  `artifacts.guardrails = "COST-GUARDRAILS.md"`를 함께 등록한다.

### ⑥ 광고 스킬 적용 (PRD §6 수익화가 광고일 때만)

- 전면(스플래시) 광고 채택 → `.claude/commands/skills/interstitial-splash-ad/SKILL.md`대로 구현해
  `main.dart`의 `ads` 주입 지점(AdSeam)을 실제 구현체로 교체한다. **⚠️ README 캐비앗: AdSeam
  교체만으로는 부족하다** — `StarterApp`을 스플래시 상태머신(로딩→광고→홈 타이밍 관리)으로
  재구성해야 한다.
- 보상형 광고 채택 → `.claude/commands/skills/reward-ads/SKILL.md`대로. **⚠️
  `showRewardedAd()`의 bool 반환**: `onUserEarnedReward` 발화 여부를 어댑터가 별도 상태로
  추적해야 한다(README seam 표).
- 광고 유닛 ID는 **반드시 Google 공식 테스트 ID**를 쓰고, ID 상수 옆에
  `// TODO(release): 실제 AdMob 유닛 ID로 교체 — 7단계 릴리즈 체크리스트 항목` 주석을 남긴다.
- version-check가 채택된 경우(ESTIMATE §1/§6에 Firebase RTDB 근거로 명시된 때만)
  `.claude/commands/skills/version-check/SKILL.md`대로 — `kVersionCheckEnabled`를 켜고 **홈 화면
  `initState`의 `addPostFrameCallback` 안에서** 호출을 배선한다(README seam 표 캐비앗).

### ⑦ 완료 게이트 (4종 전부 통과해야 awaiting_confirm 가능)

1. `cd app && flutter analyze`(복귀 잊지 말 것) → **오류 0**.
2. `cd app && flutter test`(복귀 잊지 말 것) → **전부 통과**.
3. **appRoutes ↔ PRD §4 화면 ID 1:1 대조** (스펙 §12.4) — 비교 방법:
   - A = Read로 `docs/PRD.md` §4 표의 "화면 ID" 열 전체를 추출한 목록.
   - B = Read로 `app/lib/router.dart`의 `appRoutes` 리스트.
   - 판정 규칙: A의 모든 ID가 B에 있고, B의 모든 ID가 A에 있어야 통과. **유일한 예외**:
     `settings`가 PRD §4에 없으면 B에 남겨둔 채 통과로 치되, 보고에 "`settings` = 스타터 기본
     화면(PRD 외)"라고 명시한다. `home`은 A·B 양쪽에 반드시 있어야 한다 — PRD §4에 `home`이
     없으면 PRD 결함이므로 보고 후 `awaiting_feedback`. 그 외 어떤 누락·여분도 실패다.
   - `test/router_test.dart`가 `appRoutes` ↔ `GoRoute` 1:1을 이미 강제하므로, 이 대조(PRD ↔
     appRoutes)까지 통과하면 PRD ↔ 실제 라우트 테이블이 닫힌다.
4. **iOS 네이티브 스모크** (스펙 §11 — 네이티브 빌드가 7단계에서 처음 터지는 것 방지):
   `xcrun simctl list devices`가 성공하면(macOS + Xcode 환경 판별)
   `cd app && flutter build ios --simulator --debug`(복귀 잊지 말 것)를 실행한다. `xcrun` 자체가 안 되는 환경이면
   스모크를 생략하고 최종 보고에 그 사실을 명시한다.

어느 게이트든 실패하면: 원인을 고친 뒤 **1번부터 전부 재실행**한다. 고칠 수 없는 실패(예: iOS
스모크가 환경 문제가 아닌 코드 문제로 계속 실패)는 실패 로그를 요약해 채팅으로 보고하고
`stageStatus: "awaiting_feedback"`을 기록한다 — **게이트 미통과 상태로 `awaiting_confirm`을
기록하는 것은 금지**다.

### ⑧ 진행 보고 (폰 로그 스트리밍용)

①~⑦ **각 단계를 마친 시점마다** 채팅으로 한 줄씩 보고한다(모아서 마지막에 한 번 하지 않는다).
형식 예: "① 입력 확인 완료 — PRD 화면 5개, 백엔드 미채택, 전면광고 채택" / "④ 화면 구현 완료 —
home, timer, stats, settings" / "⑦ 게이트 통과 — analyze 0, test 12/12, 대조 1:1, iOS 스모크 OK".

### ⑨ 미리보기 웹 빌드 + 완료 기록

0. **미리보기 웹 빌드** (게이트 통과 후 — 사용자가 테스트 단계를 기다리지 않고 폰에서 즉시
   실제 앱을 보게 한다):
   - `cd app && flutter build web --release --base-href=/preview/<프로젝트명>/preview/ --pwa-strategy=none --dart-define=SEED=true`
     (완료 후 별도 호출로 `cd ..` 복귀. `<프로젝트명>` = `pipeline.json`의 `project` 값 그대로.
     플래그 3종의 의미는 테스트 단계 문서와 동일 — 서브패스 서빙·SW 캐시 간섭 방지·데모 시드).
   - `mkdir -p preview` 후 `cp -R app/build/web/. preview/`.
   - 빌드가 실패하면 원인을 고쳐 재시도한다. 그래도 안 되면 **미리보기 없이 완료를 진행**하고
     (게이트 4종은 이미 통과했으므로 완료를 막지 않는다) 최종 보고에 실패 사유를 한 줄 남긴다 —
     이 경우 `artifacts.preview`를 등록하지 않는다.
1. `pipeline.json`에 원자적으로 기록: `artifacts.app = "app/"`(+ 0의 빌드가 성공했다면
   `artifacts.preview = "preview/index.html"`, ⑤를 수행했다면
   `artifacts.guardrails = "COST-GUARDRAILS.md"`), 기존 키 전부 보존,
   `stageStatus: "awaiting_confirm"`.
2. 채팅 최종 보고: 구현 화면 수·화면 ID 목록, 게이트 4종 결과(analyze/test/대조 — `settings`
   예외 여부 포함/iOS 스모크 — 생략 시 사유), 백엔드·광고 적용 여부, **"폰 하단 미리보기에서
   실제 앱을 바로 만져볼 수 있어요(예시 데이터가 채워진 상태)"**라는 미리보기 안내, 그리고
   **"테스트 단계로 넘어가려면 컨펌해주세요 — 컨펌하면 6단계(테스트)에서 검증 목록과 함께 최종
   확인합니다"**라는 다음 행동 안내.

## 피드백 처리 (`/pipeline-develop 피드백: <텍스트>`)

- **버그·문구·스타일·목업과의 불일치 수정**: `app/` 소스를 고친 뒤 **⑦ 게이트 4종을 전부
  재실행**하고(통과해야만) **⑨-0 미리보기 재빌드까지 마친 뒤** `awaiting_confirm`을 기록한다 —
  게이트 재실행 없이 종료 금지.
- **작은 기능 추가·변경**(기존 화면 안에서 요소·동작을 더하거나 바꾸는 정도 — 계약 5항의 "작은
  변경" 기준): 바로 반영한다 — `app/` 수정 → `docs/PRD.md` §3·§4의 해당 부분도 함께 갱신(원자적
  쓰기 — 문서와 앱이 어긋나지 않게) → ⑦ 게이트 재실행 → ⑨-0 재빌드 → `awaiting_confirm`.
- **큰 방향 전환**(새 화면 여러 개, 수익모델·백엔드 변경, 화면 구조 개편): 산출물을 바꾸지 말고
  "큰 변경이라 PRD부터 다시 정리하는 게 안전해요 — 되돌리기(롤백)를 권합니다"라고 안내한다.
- **그냥 질문**(설명 요청·상담): 채팅으로 답만 하고 산출물·상태는 순변경 없이 실행 전
  상태(보통 `awaiting_confirm`)를 복원한다.
