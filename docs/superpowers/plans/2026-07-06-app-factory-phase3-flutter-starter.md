# 앱 팩토리 Phase 3 — 공용 Flutter 스타터 템플릿 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 검증 = 스크래치 디렉터리에서 `flutter create` + 오버레이 적용 + `flutter analyze` + `flutter test` 전부 통과(각 태스크 필수).

**Goal:** 개발 단계(5단계) 스킬이 모든 파이프라인 앱의 출발점으로 쓰는 스타터를 `templates/flutter-starter/`에 만든다 — 화면 ID=라우트=딥링크, SEED 주입, 로컬 저장, JSON i18n, 라이트/다크 테마, 광고 seam, 버전체크 스텁, 권한 화이트리스트가 미리 배선된 상태.

**Architecture (오버레이 방식):** `flutter create <slug_snake> --org {{org}}`가 만든 프로젝트 위에 `templates/flutter-starter/overlay/`의 파일들을 복사하고 pubspec 의존성을 병합한다. 플랫폼 디렉터리는 커밋하지 않는다. 적용 절차는 `templates/flutter-starter/apply.sh`(+ README)로 고정 — Phase 4 develop 스킬은 이 스크립트만 호출한다.

**Tech:** Flutter 3.35(로컬 확인됨), Dart. 의존성 최소: `go_router`, `shared_preferences`(둘 다 오버레이 pubspec 병합 목록에). 광고·Supabase SDK는 **포함하지 않음**(seam만 — 산정 단계 채택 시 develop이 추가).

**참조:** 스펙 §10.3·§12.1(화이트리스트 문법·스킬 명령 역산)·§2.5(화면 ID kebab→snake 변환)·§11(딥링크+SEED 근거): docs/superpowers/specs/2026-07-04-app-factory-pipeline-design.md. 스킬 패턴 원본: commands/skills/{persist_user_settings,localization-prompt,color_theme_black_white,version-check}/SKILL.md

## Global Constraints

- 오버레이 파일 루트: `templates/flutter-starter/overlay/` (lib/, assets/, test/, .claude/). 메타: `templates/flutter-starter/{apply.sh,pubspec.deps.yaml,README.md}`
- 화면 ID 규약: 라우트 경로는 kebab(`/habit-edit`), Dart 파일은 snake(`habit_edit_screen.dart`), 클래스는 Pascal(`HabitEditScreen`) — 스펙 §2.5 변환 규칙
- SEED: `--dart-define=SEED=true`로 활성화되는 데모 데이터 주입 지점(`lib/seed.dart`) — 스크린샷 자동화 전제(스펙 §11)
- `.claude/settings.json` 화이트리스트: 스펙 §12.1 확정 목록(`Bash(flutter:*)`, `Bash(dart:*)`, `Bash(xcrun simctl:*)`, `Bash(xcrun swift:*)`, `Bash(node scripts/compose.mjs:*)`, `Bash(scripts/ios-boot.sh:*)`, `Bash(scripts/shot.sh:*)`, `Bash(scripts/validate.sh:*)`, `Bash(idb ui:*)`, `Bash(gh:*)`, git은 add/commit/push 서브커맨드만) + `WebSearch`, `WebFetch`
- 각 태스크의 검증(생략 금지): 스크래치(`/private/tmp/...scratchpad/flutter-e2e/`)에서 `flutter create starter_check --org com.acme` → `apply.sh` 적용 → `flutter analyze`(오류 0) → `flutter test`(전부 통과) — 명령·출력 요약을 리포트에
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. git add는 파일 명시로만

---

### Task 1: 오버레이 뼈대 + apply.sh + main/테마

**Files:** Create `templates/flutter-starter/apply.sh`, `templates/flutter-starter/pubspec.deps.yaml`, `templates/flutter-starter/README.md`, `overlay/lib/main.dart`, `overlay/lib/theme/app_theme.dart`, `overlay/test/smoke_test.dart`

- `apply.sh <target_dir>`: overlay/ 전체를 target에 복사(기존 lib/main.dart 덮어씀) + `pubspec.deps.yaml`의 dependencies를 target pubspec.yaml에 병합(중복 키 무시, 단순 append 방식이면 병합 규칙 명시) + `flutter pub get`. set -euo pipefail, target 검증(pubspec.yaml 존재).
- `main.dart`: SettingsService 로드(Task 2에서 실체화 — 이번엔 최소 스텁으로 컴파일 가능하게) → MaterialApp.router(테마 light/dark + ThemeMode 설정 연동 자리) 구조.
- `app_theme.dart`: color_theme_black_white 스킬의 다크/라이트 가이드 색상으로 ThemeData 2벌.
- `smoke_test.dart`: 앱이 pump되고 home 라우트가 뜬다.
- 검증: Global Constraints의 E2E 절차. 커밋: `feat(starter): overlay skeleton, apply script, theming`

### Task 2: 로컬 저장 + i18n

**Files:** Create `overlay/lib/services/settings_service.dart`, `overlay/lib/services/app_translations.dart`, `overlay/assets/lang/en.json`, `overlay/assets/lang/ko.json`, `overlay/test/settings_test.dart`, `overlay/test/translations_test.dart` / Modify main.dart·pubspec.deps.yaml(assets 등록 — apply.sh가 pubspec에 assets 섹션도 병합하도록 확장)

- SettingsService: persist_user_settings 패턴(SharedPreferences 단일 서비스, 기본값, themeMode/locale getter·setter). 테스트: mock initial values로 저장·복원.
- AppTranslations: localization-prompt 패턴(JSON 로드, LocalizationsDelegate, `{param}` 치환). en/ko 시드 키 최소 3개(appName 포함). 테스트: 치환·폴백.
- 검증: E2E 절차. 커밋: `feat(starter): settings persistence + json i18n`

### Task 3: 라우터(화면 ID=딥링크) + SEED

**Files:** Create `overlay/lib/router.dart`, `overlay/lib/screens/home_screen.dart`, `overlay/lib/screens/settings_screen.dart`, `overlay/lib/seed.dart`, `overlay/test/router_test.dart` / Modify main.dart

- go_router 테이블: `/home`, `/settings` (kebab 경로·snake 파일·Pascal 클래스 — 변환 규약의 실물 예시). **라우트 테이블은 `appRoutes` 상수 리스트(화면 ID 문자열)로 노출** — §12.4 "PRD 화면 ID ↔ 라우트 1:1 자동 대조"가 이 리스트를 읽는다(주석으로 명시).
- 딥링크: initialLocation을 `--dart-define=ROUTE`로 오버라이드 가능(스크린샷 자동 네비게이션용 — 스펙 §11).
- `seed.dart`: `const bool kSeed = bool.fromEnvironment('SEED')` + `seedDemoData(SettingsService)` 훅(스타터에선 no-op에 가까운 예시 1개 — 주석으로 "develop 스킬이 앱 데이터에 맞게 구현" 명시).
- settings_screen: 테마 토글·언어 선택(실제 동작 — Task 2 서비스 사용).
- router_test: appRoutes와 GoRouter 경로 1:1, ROUTE dart-define으로 settings 직행.
- 검증: E2E + `flutter run` 없이 `flutter test`로 갈음. 커밋: `feat(starter): kebab deep-link router + SEED hook + screens`

### Task 4: seam 스텁 + 권한 화이트리스트 + 최종 E2E

**Files:** Create `overlay/lib/services/ad_seam.dart`, `overlay/lib/services/version_check_stub.dart`, `overlay/.claude/settings.json` / Modify README.md(전체 절차·스킬용 안내 완성)

- ad_seam: interstitial-splash-ad·reward-ads 스킬이 꽂힐 인터페이스(추상 클래스 + NoopAds 기본 구현, main에서 주입 지점 주석). google_mobile_ads import 없음.
- version_check_stub: version-check 스킬 활성화 전 기본 비활성(스펙 §11 — Firebase 전제라 스텁) — enabled=false 상수와 스킬 적용 안내 주석.
- settings.json: Global Constraints의 화이트리스트 전체(permissions.allow 배열, §12.1 문법 `명령:*`).
- README: apply 절차, 파일 맵, 각 seam에 어떤 스킬이 꽂히는지 표(commands/skills/ 대응), 검증 명령.
- 최종 E2E: 신규 스크래치에서 전 절차 + `flutter analyze` 0 오류 + `flutter test` 전체 + **settings.json이 유효 JSON이고 스펙 §12.1 목록과 1:1인지 대조표를 리포트에**. 커밋: `feat(starter): ad/version seams, permission whitelist, docs`

---

완료 후 whole-branch 리뷰(스펙 §10.3 배선 목록 전 항목 + 신규 스크래치 E2E 재현) → main 머지. 범위 외: 실제 광고 SDK, Supabase 클라이언트, 스크린샷 스크립트 시드(Phase 4의 `.claude/commands/` 시드에서 처리).
