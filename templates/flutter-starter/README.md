# Flutter 스타터 템플릿 (오버레이 방식)

앱 팩토리 파이프라인의 개발 단계(5단계) 스킬이 모든 앱의 출발점으로 사용하는
공용 Flutter 스타터. `flutter create`가 만든 새 프로젝트 위에 이 템플릿의
`overlay/` 파일들을 얹는 방식으로 적용한다 — 플랫폼 디렉터리(android/, ios/
등)는 건드리지 않고 이 리포에도 커밋하지 않는다.

## 적용 절차

```bash
flutter create <slug_snake> --org <org>
bash templates/flutter-starter/apply.sh <slug_snake>
cd <slug_snake>
flutter analyze   # 0 errors
flutter test      # all pass
```

`apply.sh <target_dir>`가 하는 일 (실패 시 각 단계에서 `set -euo pipefail`로
즉시 중단):

1. target 디렉터리와 `pubspec.yaml` 존재를 검증한다(`flutter create`를 먼저
   실행하지 않으면 에러).
2. `overlay/` 전체(`lib/`, `assets/`, `test/`, **`.claude/settings.json`
   포함 — dotfile도 `cp -R .../.` 방식으로 함께 복사됨)를 target에
   복사한다. 기존 `lib/main.dart`는 스타터 버전으로 덮어써진다.
3. `flutter create` 기본 `test/widget_test.dart`를 제거한다(오버레이의
   `MyApp` 부재로 컴파일이 깨지므로 — 대신 `test/smoke_test.dart`가 그
   역할을 한다).
4. `pubspec.deps.yaml`의 `dependencies:`를 target `pubspec.yaml`의
   `dependencies:` 블록에 병합한다(이미 있는 최상위 키는 건너뜀 — 단순
   텍스트 라인 append, 진짜 YAML 파서 아님. 자세한 규칙은
   `pubspec.deps.yaml`과 `apply.sh` 상단 주석).
5. `pubspec.deps.yaml`의 `flutter.assets:` 목록을 target의 `flutter:`
   섹션에 병합한다(`assets/lang/` 등록 — JSON i18n용. `assets:` 키가 아직
   없으면 새로 삽입, 있으면 없는 항목만 append, 멱등).
6. target 디렉터리에서 `flutter pub get`을 실행한다.

## 파일 맵

```
templates/flutter-starter/
├── apply.sh                        # 적용 스크립트(위 절차 1~6 자동화)
├── pubspec.deps.yaml               # 병합 대상 의존성·assets 카탈로그
├── README.md                       # 이 파일
└── overlay/
    ├── .claude/
    │   └── settings.json           # 권한 화이트리스트(§12.1) — 아래 "권한 화이트리스트" 참조
    ├── assets/lang/
    │   ├── en.json                 # i18n 시드(en) — appName 등 최소 3키
    │   └── ko.json                 # i18n 시드(ko)
    ├── lib/
    │   ├── main.dart                # 부팅: SettingsService 로드 → seam 초기화
    │   │                             # (ads/version-check 주입 지점 주석) → SEED →
    │   │                             # StarterApp(MaterialApp.router)
    │   ├── router.dart              # appRoutes(화면 ID 목록) + buildRouter
    │   │                             # (kebab 경로 = 딥링크, §12.4 대조 대상)
    │   ├── seed.dart                 # kSeed + seedDemoData() 훅(--dart-define=SEED)
    │   ├── screens/
    │   │   ├── home_screen.dart      # 화면 ID `home` → 라우트 `/home`
    │   │   └── settings_screen.dart  # 화면 ID `settings` → 라우트 `/settings`
    │   ├── services/
    │   │   ├── settings_service.dart      # SharedPreferences 단일 영속 서비스
    │   │   ├── app_translations.dart      # JSON i18n(rootBundle 로드 + {param} 치환)
    │   │   ├── ad_seam.dart                # 광고 seam(추상 AdSeam + NoopAds) — 아래 표
    │   │   └── version_check_stub.dart     # version-check 스텁(kVersionCheckEnabled=false)
    │   └── theme/
    │       └── app_theme.dart        # 라이트/다크 ThemeData(흑백 팔레트)
    └── test/
        ├── smoke_test.dart              # 부팅 + 홈 화면 + i18n rootBundle 로드 확인
        ├── settings_test.dart           # SettingsService 저장/복원/기본값
        ├── translations_test.dart       # AppTranslations 치환·폴백(fromMap seam)
        ├── router_test.dart             # appRoutes ↔ GoRoute 1:1, ROUTE 딥링크,
        │                                  # SettingsScreen → SettingsService 변경(MaterialApp.router 직접 pump)
        └── starter_app_theme_test.dart   # StarterApp을 pump해 설정 변경 → Theme.of가
                                           # 실제로 바뀌는지 확인(StarterApp.setState 경로 자체 검증)
```

## 새 화면 추가하기

develop 단계에서 스타터에 새 화면을 추가할 때의 체크리스트다. 화면 ID는
kebab-case(예: `habit-edit`)로, 이를 기반으로 다음 파일들을 추가/수정한다:

1. **라우터에 화면 ID 등록** (`lib/router.dart`)
   - `appRoutes` 리스트에 화면 ID 추가(예: `'habit-edit'`)
   - 같은 파일의 `buildRouter` 함수에서 `GoRoute` 추가:
     ```dart
     GoRoute(
       path: '/habit-edit',
       name: 'habit-edit',
       builder: (context, state) => const HabitEditScreen(),
     ),
     ```

2. **화면 파일 생성** (`lib/screens/`)
   - 파일 이름: kebab을 snake_case로 변환 (예: `habit-edit` → `habit_edit_screen.dart`)
   - 클래스 이름: snake를 PascalCase로 변환 (예: `HabitEditScreen`)
   - 최소 예제:
     ```dart
     import 'package:flutter/material.dart';
     
     class HabitEditScreen extends StatelessWidget {
       const HabitEditScreen({Key? key}) : super(key: key);
     
       @override
       Widget build(BuildContext context) {
         return Scaffold(
           appBar: AppBar(title: const Text('Habit Edit')),
           body: const Center(child: Text('Coming soon')),
         );
       }
     }
     ```

3. **국제화 문자열 추가** (`assets/lang/en.json`, `assets/lang/ko.json`)
   - 화면 제목과 기타 UI 문자열을 키로 등록 (양쪽 파일 동일 키셋):
     ```json
     {
       "habitEditTitle": "Edit Habit",
       "habitEditSave": "Save"
     }
     ```

4. **테스트 검증**
   - `flutter test` 실행
   - `test/router_test.dart`가 `appRoutes`와 `GoRoute` 간 1:1 대응을 강제한다.
     누락이나 불일치 시 여기서 실패한다.

## Seam ↔ 스킬 대응표

스타터는 광고 SDK·Firebase 등 외부 백엔드를 전제하지 않는다("기본 백엔드
없음" 원칙 — 스펙 §11). 대신 아래 두 seam이 인터페이스만 배선해 두고,
develop 단계에서 해당 스킬이 채택되면 그 스킬이 실제 구현으로 교체한다.

| Seam 파일 | 기본 상태 | 대응 스킬 | 스킬이 하는 일 |
|---|---|---|---|
| `lib/services/ad_seam.dart` | `AdSeam` 추상 클래스 + `NoopAds`(전부 no-op/false 반환). `google_mobile_ads` import 없음, `pubspec.deps.yaml`에도 없음. | `commands/skills/interstitial-splash-ad` | 콜드스타트 스플래쉬 전면광고(`InterstitialAdService`) 구현 → `main.dart`의 `ads` 주입 지점을 이 구현체로 교체. **⚠️ AdSeam 교체만으로는 부족**: StarterApp을 스플래시 상태머신(타이밍 관리)으로 재구성 필요 |
| `lib/services/ad_seam.dart` | 〃 | `commands/skills/reward-ads` | 보상형 광고+티켓 시스템(`AdManager`/`TicketService`) 구현 → 화면 진입 로직에서 `AdSeam.showRewardedAd()` 사용. **⚠️ bool 반환값**: onUserEarnedReward 발화 여부를 어댑터가 별도 상태로 추적 |
| `lib/services/version_check_stub.dart` | `kVersionCheckEnabled = false`(호출 자체가 없음) | `commands/skills/version-check` | Firebase Realtime Database 기반 버전 비교 + 스토어 링크 다이얼로그(`VersionCheckService`) 구현 → `kVersionCheckEnabled`를 켜고 홈 화면 `initState`의 `addPostFrameCallback` 안에서 호출 배선 |

참고: 아래 스킬들은 seam이 아니라 스타터가 이미 그 패턴대로 구현되어
있어 배선이 끝난 상태다(그대로 재사용, 별도 주입 지점 없음).

| 스킬 | 스타터에서 이미 구현된 위치 |
|---|---|
| `commands/skills/color_theme_black_white` | `lib/theme/app_theme.dart` |
| `commands/skills/persist_user_settings` | `lib/services/settings_service.dart` |
| `commands/skills/localization-prompt` | `lib/services/app_translations.dart` + `assets/lang/*.json` |

## 권한 화이트리스트 (`overlay/.claude/settings.json`)

executor는 `--permission-mode acceptEdits`로만 headless 실행되어 Bash 도구는
기본적으로 거부된다(스펙 §12.1). 이 오버레이가 시드하는
`.claude/settings.json`의 `permissions.allow`는 파이프라인 각 단계 스킬이
실제로 호출하는 명령에서 역산한 화이트리스트다(문법은 `Bash(명령:*)` —
공백+`*`는 리터럴이라 매칭 안 됨에 주의):

- `Bash(flutter:*)`, `Bash(dart:*)` — 개발 단계(analyze/test/build) + 릴리즈 스킬의 `flutter run`
  (백그라운드 앱 실행, ④ 스크린샷 캡처)
- `Bash(uname:*)` — 릴리즈 스킬 ④의 환경 판정(macOS 여부)
- `Bash(xcrun simctl:*)`, `Bash(xcrun swift:*)`, `Bash(idb ui:*)` — iOS 시뮬레이터 부팅·탭·정리(릴리즈 스킬)
- `Bash(node .claude/commands/app-store-screenshots/scripts/compose.mjs:*)` — 스크린샷 컴포즈(릴리즈 스킬, 실경로)
- `Bash(bash .claude/commands/app-store-screenshots/scripts/ios-boot.sh:*)`,
  `Bash(bash .claude/commands/app-store-screenshots/scripts/shot.sh:*)`,
  `Bash(bash .claude/commands/app-store-screenshots/scripts/validate.sh:*)` — 릴리즈 스킬 스크린샷
  캡처/검증 스크립트(고정 실경로 — 프로젝트 루트 상대 경로가 아니라 스킬 디렉터리 경로)
- `Bash(node .claude/commands/app-store-screenshots/scripts/render-icon.mjs:*)` — 릴리즈 스킬 ③
  아이콘·피처 그래픽 렌더(SVG → PNG, 실경로)
- `Bash(cp app/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png:*)` —
  릴리즈 스킬 ③ Chromium 렌더 불가 시 플레이스홀더 아이콘 폴백 복사(소스 경로 접두 고정)
- `Bash(bash .claude/atomic-mv.sh:*)` — 계약 산출물(`pipeline.json`/`COST-GUARDRAILS.md`/`RELEASE.md`
  등)의 tmp→최종 원자적 교체
- `Bash(bash templates/flutter-starter/apply.sh:*)` — develop 단계의 스타터 오버레이 적용(고정 경로 스크립트)
- `Bash(mkdir -p mockup)`, `Bash(mkdir -p preview)`, `Bash(mkdir -p release)`,
  `Bash(mkdir -p release/icons)`, `Bash(mkdir -p release/graphics)` — mockup/test/release 단계
  산출물 디렉터리 준비(정확히 이 명령만 허용하는 리터럴 매치)
- `Bash(cp -R app/build/web/.:*)` — test 단계의 웹 빌드 산출물 → `preview/` 복사(소스 경로를 접두로 고정, `mv`·`rm`은 미허용)
- `Bash(gh auth status:*)`, `Bash(gh repo view:*)`, `Bash(gh repo create:*)`, `Bash(gh api user:*)`,
  `Bash(gh api repos/:*)` — 릴리즈 스킬 ⑤ 개인정보처리방침 GitHub Pages 발행(Task 6): 사용자 GitHub
  계정 인증 확인·고정 리포 `app-factory-pages` 조회/생성·Contents API 커밋·Pages 활성화. 실제 호출이
  전부 `gh api user ...` 또는 `gh api repos/... ` 형태라 넓은 `Bash(gh api:*)` 대신 이 둘로 좁혔다
  (Task 6 리뷰 — 잔여 리스크는 스펙 §12.2). `git`은 쓰지 않는다(Contents API로 커밋까지 끝나 로컬
  clone이 불필요 — 화이트리스트 표면을 넓히지 않는 선택, 스펙 §12.1 원칙 1)
- `Bash(node .claude/commands/app-store-screenshots/scripts/b64.mjs:*)` — 릴리즈 스킬 ⑤ 방침 HTML을
  `gh api` Contents API 업로드용으로 base64 인코딩(fs 읽기 → `.toString("base64")` → fs 쓰기, 실경로
  고정 스크립트). 셸 리다이렉션(`base64 < in > out`)은 headless 승인이 셸 연산자를 화이트리스트
  대조 이전에 범주적으로 거부할 위험이 있어(Phase 5 Task 4 실측) `base64` 셸 유틸 대신 이 Node
  스크립트를 쓴다.
- `WebSearch`, `WebFetch` — 아이디에이션 단계 웹 리서치

`permissions.deny`: `Write(.claude/settings.json)`, `Edit(.claude/settings.json)`,
`Write(.claude/settings.local.json)`, `Edit(.claude/settings.local.json)`(Claude Code가 동등하게
읽는 로컬 오버라이드 파일), `Write(.claude/atomic-mv.sh)`, `Edit(.claude/atomic-mv.sh)`,
`Write(.claude/commands/app-store-screenshots/scripts/**)`,
`Edit(.claude/commands/app-store-screenshots/scripts/**)`,
`Write(templates/flutter-starter/apply.sh)`, `Edit(templates/flutter-starter/apply.sh)` — 스킬이
실행 도중 자신의 화이트리스트를 스스로 넓히는 자기확장 경로(`settings.json`/`settings.local.json`
직접 수정)와, 화이트리스트에 이미 등재된 시드 스크립트를 편집해 그 고정 경로 실행 허용을 임의
코드 실행으로 바꿔치기하는 경로를 함께 차단한다(스펙 §12.2).

넓은 허용(`Bash(node:*)`, `Bash(git:*)` 등)은 쓰지 않는다 — `node -e
'<임의코드>'`처럼 사실상 전권 우회가 되기 때문(스펙 §12.1 원칙 1). 이
파일은 프로젝트 생성 시 `.claude/commands/`·`templates/`와 함께 그대로
시드되어야 한다(부분 시드는 develop/release 단계를 통째로 실패시킴).

## 검증

새 스크래치 디렉터리에서:

```bash
flutter create starter_check --org com.acme
bash templates/flutter-starter/apply.sh starter_check
cd starter_check
flutter analyze   # 0 errors
flutter test      # all pass
```

추가로 화이트리스트 파일 자체를 점검할 때:

```bash
node -e "JSON.parse(require('fs').readFileSync('starter_check/.claude/settings.json','utf8')); console.log('valid json')"
```
