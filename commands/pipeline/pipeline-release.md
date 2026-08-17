---
description: 파이프라인 7단계 — 릴리즈 패키지 뼈대. RELEASE.template.md 전 블록(메타+§1~§8)을 채워 release/RELEASE.md 생성 — 스토어 텍스트 영어(app_release_info 방법론, 글자수 하드 리밋), 심사 설문 도출 규칙, §7 차별점은 ../ideas-index.json 과거 채택작 대조, §8 고정 체크리스트. 아이콘 512/1024+피처 그래픽은 SVG→headless Chromium 직접 렌더(sips 금지, 불가 시 스타터 플레이스홀더 폴백+체크리스트 표기). 스크린샷 캡처는 두 트랙(iOS=macOS+Xcode 시뮬레이터 / Android=에뮬레이터, 비macOS·Windows 가능) 중 가용한 것만 실행(불가 트랙은 보류+사유). 개인정보처리방침은 GitHub Pages로 발행(Task 6에서 활성화 — gh CLI 미인증·공개용 문의 이메일 미확정·API 실패 시 각각 보류+사유, 터널 URL 대체 금지). artifacts.release 등록.
allowed-tools: Read, Write, Edit, Bash
---

# /pipeline-release — 7단계: 릴리즈 패키지 (리스팅 뼈대)

## 공통 계약 (요약 — 정본은 `.claude/commands/_CONTRACT.md`, 충돌 시 정본 우선)

1. 시작: `pipeline.json` 읽기 → `stage`가 `"release"`인지 확인(아니면 쓰지 말고 보고 후 종료) →
   `stageStatus: "running"` 기록. 쓰는 필드는 `stage`/`stageStatus`/`artifacts`만, 나머지는 보존,
   항상 ① Write 도구로 `<대상>.tmp` 작성 ② `bash .claude/atomic-mv.sh <대상>.tmp <대상>`으로
   교체(원자적). `stage` 값은 바꾸지 않는다 — **사용자가 컨펌하면 host가 파이프라인을 `done`으로
   처리한다. 이 스킬이 `done`을 쓰는 일은 없다.**
2. 산출물 = `release/`(RELEASE.md + 아이콘 등 동반 자산) — `RELEASE.md`는
   `templates/RELEASE.template.md`의 고정 블록(메타 + §1~§8, 총 9개)의 제목·순서를 그대로
   유지한다(추가·삭제 금지, 해당 없으면 "해당 없음"을 이유와 함께 명시). 완료 시 `artifacts`에
   등록.
3. 종료 시 `stageStatus`는 `"awaiting_confirm"` 또는 `"awaiting_feedback"` — **`running`인 채 종료
   금지**(그대로 종료하면 host가 `error`로 강등해 사용자에게 실패로 보인다).
4. `피드백:` 접두 호출 = 기존 릴리즈 패키지 수정 모드(아래 "피드백 처리"). "그냥 질문"이면
   순변경 없이 답만 하고 실행 전 상태를 복원.
5. 스토어 문구·아이콘 디자인·설문 답변·릴리즈 노트 수정은 이 단계 범위 **안**이다. 앱 코드를
   건드리는 **작은 기능 추가·변경**은 계약 5항대로 바로 반영하되(`docs/PRD.md` §3·§4 함께 갱신)
   빌드 산출물(AAB·스크린샷)이 낡지 않게 해당 부분을 재생성한다. **큰 방향 전환**만 산출물을
   바꾸지 말고 되돌리기(롤백)를 권한다(계약 5항).
6. 보안: 이 단계는 웹 도구를 쓰지 않는다(신뢰불가 웹 입력 해당 없음) · 자격증명·API 키
   하드코딩·노출 금지 · 프로젝트 디렉터리 밖 파일 생성 금지 — `../ideas-index.json`은 이 단계에선
   **Read 전용**이다(§7 대조용 읽기만, 쓰기는 아이디에이션·PRD 스킬의 권한). **터널 URL(ngrok 등)·
   localhost·사설 IP를 RELEASE.md 어디에도 기록하지 않는다**(스토어는 심사·출시 후에도 상시 접근
   가능한 URL을 요구 — 스펙 §2-7). 개인정보처리방침 본문에 앱 이름 외의 개인 식별 정보를 넣지
   않는다(공개 게시 문서 — 스펙 §12.2).

`artifacts`에는 이 단계 소유 키 **`release`만** 추가·갱신하고 기존 키(`ideas`/`prd`/`mockup`/
`estimate`/`app`/`guardrails`/`preview` 등)는 전부 보존한다.

**원자적 쓰기의 적용 범위**: `.tmp` + `atomic-mv.sh` 절차는 host가 감시·서빙하는 계약 산출물
(`pipeline.json`, `release/RELEASE.md`)에 적용한다 — `release/RELEASE.md.tmp` →
`release/RELEASE.md`는 프로젝트 내부 상대 경로라 atomic-mv.sh 경계(절대경로·`../` 차단)를
통과한다. 아이콘·피처 그래픽 PNG는 렌더 스크립트/`cp`가 생성하는 바이너리라 이 절차 대상이
아니다.

**스크린샷 캡처 (환경 조건부 — 두 트랙 독립)**: **iOS**(App Store)는 macOS + Xcode 시뮬레이터,
**Android**(Play)는 에뮬레이터(`adb` + AVD — 비macOS·Windows에서도 가능)가 가용한 트랙만 실제로
캡처한다(판정 방법·절차는 아래 ④). 어느 트랙도 불가하거나 특정 트랙만 불가하면, 그 플랫폼의 란
(§1 행5·§2 행6·§6 스크린샷 행)에 **"보류 — <구체 사유>"**로 표기한다(예: "보류 — 비macOS
환경(uname: <값>)이라 iOS 캡처 불가", "보류 — 실행 가능한 AVD 없음").

**개인정보처리방침 GitHub Pages 발행 (Task 6에서 활성화 — gh CLI 조건부, 아래 ⑤)**: 사용자
GitHub 계정의 고정 리포 `app-factory-pages`에 `docs/<project>/privacy.html`로 커밋해 GitHub Pages로
발행한다 — `gh` 미인증, 공개용 문의 이메일 미확정(§4 자리표시자 미해결), API 호출 실패 중 하나라도
있으면 그 단계에서 멈추고 RELEASE.md §4에 **"보류(사유: <구체 사유>)"**만 기록한다(릴리즈 전체를
중단하지 않는다 — 나머지 산출물은 그대로 진행). **어떤 경우에도 터널(ngrok 등)·localhost URL로
대체 기록하지 않는다.**

## 절차 (①~⑧ 번호 순서 강제 — 건너뛰기 금지)

**쉘 작업 디렉터리는 호출 간 유지된다.** `app/` 내부 명령이 필요해지면 **반드시 두 번의 개별
Bash 호출**로 나눠 실행한다 — ① `cd app && <명령>` ② 완료 후 별도 호출로 `cd ..` 복귀. **한 호출
안에 `cd`를 두 번 이상 넣거나(`cd app && <명령>; cd ..`처럼) 괄호 서브셸(`(cd app && <명령>)`)로
묶지 말 것** — 런타임 승인 정책이 "한 명령 안의 다중 디렉터리 변경"과 "셸 연산자(괄호 등)"를
범주적으로 차단해 headless(`acceptEdits`) 실행에서 거부된다(Phase 5 Task 4 실측 —
`.superpowers/sdd/task-4-report.md`). 그 외 명령은 전부 프로젝트 루트 기준이다 — 이 단계에서 `app/`
내부 명령은 ④의 백그라운드 `flutter run` 한 곳뿐이며, 그 경우는 위 `cd app && <명령>` 결합 패턴을
쓰지 않고 **cd와 백그라운드 실행을 분리**한 별도 절차를 쓴다(이유·절차는 ④ 참조). 그 외 `app/`
파일은 Read로만 읽는다.

### ① 입력 확인

- `docs/PRD.md`(artifacts.prd)와 `app/pubspec.yaml`(artifacts.app — 5단계 산출물)이 존재하는지
  확인한다. **하나라도 없으면** 아무 산출물도 만들지 않고 채팅으로 "`<누락 파일>`이 없습니다 —
  이전 단계를 먼저 컨펌해주세요"라고 보고한 뒤 `stageStatus: "awaiting_feedback"` 기록 후
  종료한다.
- 읽어 둘 것: PRD §1 문제 정의·§2 타겟(스토어 설명의 소구점), §3 Must(계정삭제 기능 포함 여부),
  §4 화면 목록(화면 ID·"스토어 스샷" 열 — §6 매니페스트의 초안), §6 수익화(광고·로그인 채택
  여부), §8 applicationId·표시명·지원 기기. `ESTIMATE.md`(artifacts.estimate) §1 백엔드 최종
  판정·§2 기능→서비스 매핑(§3 설문과 메타 "앱 구성 요약"의 입력) — ESTIMATE.md가 없으면 PRD
  §6·§8만으로 판정하고 그 사실을 메타에 명시한다.
- **앱 분석(app_release_info Step 1 방법론)**: `app/lib/` 구조(화면·서비스)와 `app/pubspec.yaml`
  (의존성 — 광고 SDK 등)을 Read로 훑어 실제 구현된 기능을 파악하고, **핵심 기능만 필터**한다 —
  다크/라이트 모드·다국어·오프라인·온보딩·알림 설정 같은 범용 부가 기능은 스토어 텍스트에서
  제외(앱의 고유 가치·설치 이유가 되는 기능만 담는다).
- `../ideas-index.json`을 Read한다(§7의 입력): `adopted`가 null이 아닌 항목(과거 채택작) 중 현
  프로젝트(`pipeline.json`의 `project`)를 제외한 목록을 만들어 둔다. 파일이 없거나 배열이 비어
  있으면 "과거 채택작 없음"으로 §7에 그 사실을 명시한다.

### ② `release/` 디렉터리 준비

실행: `mkdir -p release` — 화이트리스트에 리터럴로 허용된 명령이므로 **정확히 이 형태로**
실행한다(다른 인자와 묶지 않는다).

### ③ 앱 아이콘 + 피처 그래픽 (SVG → headless Chromium 직접 렌더)

`sips` 등 특정 OS 전용 도구는 쓰지 않는다(스펙 §2-7 — 전 OS 동일 경로). 렌더 메커니즘은
`/app-store-screenshots`의 compose.mjs와 동일(headless Chromium 스크린샷)하되, compose.mjs는
매니페스트(슬라이드 세트) 기반이라 아이콘엔 부적합하므로 단일 HTML을 정확한 픽셀 크기로 찍는
전용 스크립트 `render-icon.mjs`를 쓴다.

1. `mkdir -p release/icons` 실행, 이어서 `mkdir -p release/graphics` 실행(각각 리터럴 허용
   명령 — 정확히 이 형태로, 한 명령으로 묶지 않는다).
2. **아이콘 디자인(SVG)**: 앱 컨셉의 색·심볼 기반으로 단순하고 독자적인 아이콘을 SVG로
   디자인한다.
   - **배경은 불투명**(단색/그라데이션으로 캔버스 전체를 채움 — iOS 1024는 "알파 없음" 규격).
   - **§12.3 준수: 원본(벤치마크) 앱의 아이콘·브랜드 그래픽·고유 시각 요소를 모방하지 않는다** —
     기능·컨셉 참고는 가능해도 그래픽 모방은 금지다.
   - 텍스트는 넣지 않거나 앱 이니셜 1~2자 정도만(작은 크기에서 읽히지 않는 문구 금지).
3. Write 도구로 `release/icons/icon.html` 작성 — 뷰포트를 꽉 채우는 인라인 SVG 래퍼:
   `<style>html,body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style>`
   \+ `<svg viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid slice">…</svg>`(정사각 viewBox —
   같은 파일로 512·1024를 렌더).
4. 렌더 실행(각 명령의 출력이 `OK <크기> colorType=<n> <경로>`인지 **텍스트로 확인** — §8의 근거):
   - `node .claude/commands/skills/app-store-screenshots/scripts/render-icon.mjs release/icons/icon.html release/icons/play-512.png 512`
   - `node .claude/commands/skills/app-store-screenshots/scripts/render-icon.mjs release/icons/icon.html release/icons/ios-1024.png 1024`
5. **피처 그래픽(Play 필수 자산, 1024×500)**: Write로 `release/graphics/feature-graphic.html`
   작성(1024×500 레이아웃 — 앱 표시명 + 한 줄 훅, 아이콘과 같은 팔레트, 불투명 배경) →
   `node .claude/commands/skills/app-store-screenshots/scripts/render-icon.mjs release/graphics/feature-graphic.html release/graphics/feature-graphic.png 1024 500`
6. **colorType 해석**: 2 = RGB(알파 채널 없음 — iOS 규격 통과), 6 = RGBA(알파 채널 존재 — 배경이
   불투명해도 채널은 남을 수 있다). `ios-1024.png`가 6이면 §8 해당 항목을 체크하지 말고 "픽셀은
   불투명이나 PNG에 알파 채널 존재 — App Store Connect가 거부하면 JPEG 재저장 필요"라고 적는다.
   Play 512는 알파 허용(32-bit PNG)이므로 6이어도 통과다.
7. **폴백(Chromium 불가)**: 렌더 명령이 실패하면(`NO_CHROMIUM` 출력·종료코드 2, 또는 node 부재
   등) 렌더를 포기하고 스타터 플레이스홀더(flutter 기본 아이콘)로 대체한다:
   - `cp app/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png release/icons/ios-1024.png`
   - `cp app/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png release/icons/play-512.png`
   - `play-512.png`는 실제로는 1024×1024라 규격 미충족인 **임시 파일**이다 — §8 아이콘 두 항목을
     체크하지 말고 각각 "아이콘 임시(스타터 플레이스홀더) — 교체 필요"라고 적는다. 피처 그래픽은
     만들지 않고 §6 행에 "미생성 — Chromium 필요(피드백으로 재시도 가능)"라고 적는다.
   - 소스 아이콘 파일 자체가 없으면 `cp`도 생략하고 §6·§8에 "미생성"으로 정직하게 기록한다.

### ④ 스크린샷 캡처 (환경 조건부 — iOS는 macOS+Xcode 시뮬레이터, Android는 에뮬레이터)

**환경 판정(캡처 시도 전에 판정 결과를 채팅으로 한 줄 보고). 두 트랙을 독립적으로 확인한다:**

- **iOS 트랙(App Store용)**: `uname`이 정확히 `Darwin`이고 `xcrun simctl list devices`가 종료코드
  0이면 가용.
- **Android 트랙(Play용)**: `adb version`이 종료코드 0이고, 에뮬레이터가 있으면 가용 —
  `emulator -list-avds` 출력이 비어있지 않거나 이미 `adb devices`에 `emulator-*`가 떠 있으면 된다.
  **비macOS(Windows 포함)에서도 가능하다**(Android Studio로 AVD를 만들어 두면 됨).

**가용한 트랙만** 캡처한다. 어느 쪽도 불가하면 캡처를 생략하고 §1 행5·§2 행6·§6 스크린샷 각 행에
"보류 — <구체 사유>"로 표기한 채 ⑤로 진행한다. **한쪽만 가용하면**(예: Windows라 Android만):
가용한 플랫폼은 실제로 캡처하고, 불가한 플랫폼 행에만 "보류 — <사유>"를 남긴다(예: "보류 — 비macOS
환경(uname: <값>)이라 iOS 캡처 불가, Mac에서 재캡처 필요"). AVD가 없어서 Android가 불가하면
"보류 — 실행 중인 AVD 없음(`emulator -list-avds` 비어있음) — Android Studio > Device Manager에서
생성 후 `/pipeline-release 피드백: 안드로이드 스크린샷 재캡처`"로 안내한다.

**절차 (`.claude/commands/skills/app-store-screenshots/SKILL.md` Phase 1~5를 이 프로젝트 맥락에 맞게 —
실경로 스크립트로 실행)**:

1. **매니페스트 도출(SKILL.md Phase 1 상당)**: PRD §4 화면 목록에서 "스토어 스샷" 열이 대상인
   화면만 추린다. 각 화면의 진입 경로는 딥링크(`app/lib/router.dart`의 라우트 — 스타터의 `ROUTE`
   dart-define 또는 GoRoute 경로)로 확인해 둔다. 슬라이드 번호를 01부터 이 순서대로 부여한다 —
   **이 순서가 §6 "슬라이드 번호" 열의 정본이므로 ⑥에서 그대로 옮긴다.** iPad 포함 여부는
   `app/ios/Runner.xcodeproj`의 `TARGETED_DEVICE_FAMILY`를 Read로 확인(`1,2`면 포함, `1`이면
   iPhone만). Write 도구로 `release/screenshots/manifest.json` 작성 —
   `.claude/commands/skills/app-store-screenshots/reference/manifest.example.json`의 형태(`ios`/`ipad`/
   `android` 블록)를 따르되 `out` 경로를 `release/screenshots/{ios,ipad,android}`로 맞춘다(SKILL.md
   원문의 `deploy/screenshots/`가 아니라 `release/screenshots/`가 이 프로젝트의 정본 경로다).
   앱 컨셉의 팔레트·폰트는 `app/lib/theme/` 또는 `ColorScheme`/`seedColor` grep으로 도출해
   `palette`/`font`에 반영한다. 각 슬라이드 헤드라인은 PRD §2 타겟 소구점 기준 한 줄 카피.
2. **캡처 — 가용한 트랙별로 수행**. 앱 실행(`flutter run`)은 iOS·Android 공통으로 아래 "cd 분리"
   규칙을 따르며, 여기서 `<device>`는 iOS면 시뮬레이터 UDID, Android면 `emulator-5554`다. 각 트랙의
   부팅·화면 이동·캡처 명령은 이 규칙 아래 "iOS 트랙 / Android 트랙" 소절에 있다.
   - **앱 실행 — cd와 백그라운드 실행을 분리한다(cwd 모호성 제거)**: `run_in_background: true`로
     `cd app && flutter run -d <udid>`를 한 호출에 묶으면, 그 `cd`는 백그라운드 서브셸 안에서만
     일어나 도구가 호출 간 추적하는 **포그라운드 cwd에는 반영되지 않을 수 있다** — Task 4 실측은
     *포그라운드* 단일 `cd app`이 다음 호출의 cwd에 반영됨만 확인했고(`.superpowers/sdd/
     task-4-report.md` §1 T1/T2), 백그라운드 서브셸의 `cd`가 동일하게 반영되는지는 검증된 바
     없다(Task 5 리포트 "잔여 리스크" 항목). 반영되지 않는다면 포그라운드 cwd는 여전히 프로젝트
     루트인 채로 남고, 이후 "완료 후 별도 호출로 `cd ..` 복귀"를 실행하면 **프로젝트 루트 밖으로
     잘못 이동**해 뒤따르는 모든 상대경로 명령(캡처·컴포즈·검증 등)이 오작동한다. 아래처럼 `cd`와
     백그라운드 실행을 3개의 개별 호출로 나눠 이 모호성을 원천 차단한다:
     1. 별도 **포그라운드** Bash 호출: `cd app` 하나만 실행한다(다른 명령과 묶지 않는다). 이 호출은
        즉시 반환되고, 이 호출로 이후 호출들의 cwd가 `app/`로 확정된다(Task 4 실측 근거).
     2. 별도 **백그라운드**(`run_in_background: true`) Bash 호출: `flutter run -d <device>`만
        실행한다(`cd` 없음 — 위 1에서 이미 cwd가 `app/`로 확정돼 있다). 이 명령은 화이트리스트의
        `Bash(flutter:*)` 접두 매칭으로 승인되며 `run_in_background`는 실행 모드일 뿐 명령 문자열에
        영향을 주지 않는다. flutter 프로세스는 백그라운드로 계속 실행된다.
     3. 곧바로 별도 **포그라운드** Bash 호출: `cd ..` 하나만 실행한다. 이후 절차(화면 이동·
        `shot.sh` 캡처·`compose.mjs`·`validate.sh`·정리)는 전부 프로젝트 루트 기준 상대경로이므로,
        앱을 띄운 직후 지체 없이 루트로 복귀한다 — 정리 단계까지 기다렸다 복귀하지 않는다.
     **빈 화면 방지 — SEED 플래그**: 위 2단계의 `flutter run`에 `--dart-define=SEED=true`를 붙여
     develop이 채운 `seedDemoData()`(`lib/seed.dart`)로 데모 데이터를 켠다(예:
     `flutter run -d <device> --dart-define=SEED=true`). 특정 화면으로 바로 진입하려면
     `--dart-define=ROUTE=/<경로>`도 함께(스타터 `main.dart`의 `_routeOverride`). 이 방식은 소스를
     건드리지 않으므로 원복할 게 없다 — `lib/`를 직접 편집하지 않는다. (시드가 스텁이라 여전히 비면
     그 화면은 데모 없이 캡처하고 §6에 한 줄 남긴다.)
   **iOS 트랙(iOS 트랙 가용 시)** — `<device>` = ios-boot.sh가 출력한 UDID:
   - 부팅: `bash .claude/commands/skills/app-store-screenshots/scripts/ios-boot.sh "iPhone 17 Pro Max"`
     (출력 마지막 줄이 UDID). iPad 포함 시 별도로
     `bash .claude/commands/skills/app-store-screenshots/scripts/ios-boot.sh "iPad Pro 13-inch (M4)"`.
   - 화면 이동(우선순위): ① 딥링크 `xcrun simctl openurl <udid> "<scheme>://<path>"`
     ② `idb ui tap <x> <y>`(idb 설치돼 있으면 — 직전 `shot.sh` 캡처로 탭 좌표 확인) ③ 둘 다 불가하면
     해당 화면 캡처를 생략하고 §6 해당 행에 "미캡처 — 네비게이션 수단 없음"이라고 정직하게 기록.
   - 캡처: `bash .claude/commands/skills/app-store-screenshots/scripts/shot.sh ios release/screenshots/raw/ios/<화면ID>.png <iphone-udid>`
     (iPad는 `raw/ipad/<화면ID>.png`에 iPad UDID로 별도 캡처).

   **Android 트랙(Android 트랙 가용 시)** — `<device>` = `emulator-5554`:
   - 부팅: `bash .claude/commands/skills/app-store-screenshots/scripts/android-boot.sh`
     (첫 AVD를 자동 선택해 부팅하고 준비되면 `emulator-5554`가 뜬다 — 이미 떠 있으면 그대로 재사용.
     특정 AVD를 쓰려면 이름을 인자로 넘긴다). 부팅 실패(AVD 없음)면 위 환경 판정의 Android 보류
     문구로 남기고 이 트랙을 건너뛴다.
   - 화면 이동(우선순위): ① 딥링크
     `adb shell am start -a android.intent.action.VIEW -d "<scheme>://<path>" <applicationId>`
     (`<applicationId>` = PRD §8 값) ② `adb shell input tap <x> <y>`(직전 `shot.sh` 캡처로 탭 좌표
     확인) ③ 둘 다 불가하면 캡처 생략 + §6 해당 행에 "미캡처 — 네비게이션 수단 없음" 기록.
   - 캡처: `bash .claude/commands/skills/app-store-screenshots/scripts/shot.sh android release/screenshots/raw/android/<화면ID>.png`
     (Android는 `booted` 인자 불필요 — 실행 중 에뮬레이터를 자동 대상으로 한다).
3. **합성(SKILL.md Phase 3 상당)**:
   `node .claude/commands/skills/app-store-screenshots/scripts/compose.mjs release/screenshots/manifest.json`
   → `release/screenshots/{ios,ipad,android}/*.png` 생성(feature graphic은 ③에서 이미 생성했으므로
   매니페스트의 android 블록에 `featureGraphic`을 중복 지정하지 않는다).
4. **검증(SKILL.md Phase 4 상당 — 실제로 캡처한 플랫폼만)**:
   - iOS 캡처 시: `bash .claude/commands/skills/app-store-screenshots/scripts/validate.sh release/screenshots/ios 1320 2868`
     (+ iPad 포함 시 `release/screenshots/ipad 2064 2752`).
   - Android 캡처 시: `bash .claude/commands/skills/app-store-screenshots/scripts/validate.sh release/screenshots/android 1080 1920`.
   출력의 `PASS`/`FAIL`을 §6 근거로 남긴다.
5. **정리(SKILL.md Phase 5 상당 — 성공·실패 무관하게 항상 수행)**:
   - 백그라운드로 띄운 `flutter run`(트랙별로 하나씩)을 중지: 2단계에서 그 Bash 호출이 반환한
     백그라운드 작업 ID로 `TaskStop` 도구를 호출해 정지한다(작업 ID를 2단계 호출 직후 기록해 둔다).
   - 부팅한 기기 종료: iOS는 `xcrun simctl shutdown all`, Android는 `adb -s emulator-5554 emu kill`
     (그 트랙을 실제로 띄웠을 때만 — 실패해도 무시하고 진행).
   - 데모 데이터는 `--dart-define=SEED=true` 플래그로만 켰으므로 원복할 소스 변경이 없다(정상 경로).
     만약 예외적으로 `lib/`를 직접 편집했다면 Edit으로 전부 원복해 앱 소스가 캡처 전 상태로 돌아가게
     한다(Read로 diff 없음 확인).
   - 상태바 오버라이드(iOS `xcrun simctl status_bar <udid> override ...`)를 썼다면
     `xcrun simctl status_bar <udid> clear`로 원복.

캡처가 끝나면(성공이든 부분 실패든) §6 각 스크린샷 행을 실제 결과(경로 또는 "미캡처 — 사유")로,
§1 행5·§2 행6을 "§6 참조"로 채운다 — 이 기록은 ⑥에서 수행한다.

### ⑤ 개인정보처리방침 GitHub Pages 발행 (Task 6에서 활성화 — gh CLI 조건부)

`release/RELEASE.md`를 쓰기 전에 방침 본문·발행 결과를 먼저 확정해 ⑥에서 한 번에 기록한다(③·④와
같은 순서 원칙 — 결과를 먼저 만들고 ⑥에서 옮겨 적는다). 아래 단계 중 하나라도 실패하면 **그
단계에서 멈추고** 이후 단계는 건너뛴 채 ⑥으로 진행한다(릴리즈 자체는 중단하지 않음). 실패 사유는
그대로 §4에 옮길 수 있게 문구를 준비해 둔다. **터널(ngrok 등)·localhost·사설 IP URL은 어떤 경우에도
기록하지 않는다.**

1. **본문 요약 구성**: 수집 데이터 종류(§3 최종 답변과 1:1 일치)·수집 목적·제3자 제공(광고 SDK명
   명시)·보유·파기 기준·문의처(이메일)·시행일을 지금 실제로 작성한다. **앱 이름 외의 실제 개인
   식별 정보(사용자 이름·전화번호·실제 주소 등)는 절대 넣지 않는다**(§12.2 — 공개 게시 문서).
2. **인증 확인**: `gh auth status` 실행. 종료코드 0(인증됨)이면 3으로 진행. 비0(미인증)이면 3~8을
   건너뛰고 §4에 기록할 값을 준비: 호스팅 URL = "(없음)", 발행 상태 = **"보류: `gh auth login`으로
   GitHub CLI 인증 필요 — 인증 후 `/pipeline-release 피드백: 개인정보처리방침 재발행`으로 재시도"**.
3. **문의처 확정 확인**: 1의 문의처가 아직 자리표시자 `{{contact_email}}` 그대로인지 확인한다(실제
   이메일로 채워진 적이 없다는 뜻). 그대로면 4~8을 건너뛰고 §4에 기록할 값을 준비: 발행 상태 =
   **"보류 — 공개용 문의 이메일 미확정. `/pipeline-release 피드백: 문의 이메일은 <실제 이메일>
   입니다`로 제공 후 재시도"**. 사용자가 과거 피드백으로 실제 이메일을 이미 제공했다면 그 값으로
   4로 진행한다.
4. **방침 HTML 생성**: 1의 요약을 최소 정적 HTML로 렌더한다(제목 `Privacy Policy - {{app_title}}`,
   본문은 1의 항목을 그대로 문단/목록으로). Write 도구로 `release/privacy.html.tmp` 작성 →
   `bash .claude/atomic-mv.sh release/privacy.html.tmp release/privacy.html`.
5. **발행 대상 리포 확인/생성**(사용자 GitHub 계정의 고정 리포 `app-factory-pages` — 프로젝트별
   폴더로 격리, 하나의 리포를 여러 프로젝트가 공유):
   - 계정명: `gh api user --jq .login` → 출력을 `<gh-user>`로 이하 명령에 리터럴 사용.
   - 존재 확인: `gh repo view <gh-user>/app-factory-pages --json name` — 성공하면 존재. 실패
     (Not Found)면 생성: `gh repo create <gh-user>/app-factory-pages --public --description
     "App Factory hosted pages (privacy policies)"`.
   - 기본 브랜치 확인: `gh repo view <gh-user>/app-factory-pages --json defaultBranchRef --jq
     .defaultBranchRef.name` → 값이 있으면 `<branch>`로 사용, 비어 있으면(방금 생성한 빈 리포)
     `<branch>` = `main`.
   - 이 중 하나라도 실패하면(권한 부족·API 오류 등) 6~8을 건너뛰고 §4에 기록할 값을 준비:
     발행 상태 = **"보류(발행 실패 — 사유: <gh 오류 메시지 그대로>)"**.
6. **기존 파일 확인(갱신 대비)**: `gh api repos/<gh-user>/app-factory-pages/contents/docs/
   <project>/privacy.html --jq .sha` — 성공하면 `<sha>`를 캡처해 8에서 갱신에 사용(`<project>` =
   `pipeline.json`의 `project`, RELEASE.md 메타의 slug와 동일). 실패(404)면 신규 파일 취급(8에서
   `sha` 필드 생략).
7. **base64 인코딩**: `node .claude/commands/skills/app-store-screenshots/scripts/b64.mjs
   release/privacy.html release/privacy.b64`(셸 리다이렉션(`<`/`>`) 대신 Node 스크립트로 인코딩 —
   셸 연산자는 화이트리스트 대조 이전에 범주적으로 거부될 수 있다, Phase 5 Task 4 실측 —
   `.superpowers/sdd/task-4-report.md`). 출력이 `OK <바이트수> release/privacy.b64`인지 확인한다.
   실패하면(파일 없음 등) 8~9를 건너뛰고 §4에 기록할 값을 준비: 발행 상태 = **"보류(발행 실패 —
   사유: <오류 메시지 그대로>)"**.
8. **커밋(업로드)**: `gh api repos/<gh-user>/app-factory-pages/contents/docs/<project>/privacy.html
   -X PUT -f message="Add/update privacy policy: <project>" -F content=@release/privacy.b64 -f
   branch=<branch>`(6에서 `<sha>`를 얻었으면 `-f sha=<sha>` 추가). 실패하면 §4에 기록할 값을 준비:
   발행 상태 = **"보류(발행 실패 — 사유: <gh 오류 메시지 그대로>)"**.
9. **Pages 활성화 확인**: `gh api repos/<gh-user>/app-factory-pages/pages` — 200이면 이미 활성화(다음
   단계로). 404면 활성화: `gh api repos/<gh-user>/app-factory-pages/pages -X POST -f
   build_type=legacy -f "source[branch]=<branch>" -f "source[path]=/docs"`. 이 단계가 실패해도 8이
   성공했으면 콘텐츠는 이미 커밋된 것이므로 §4에 기록할 값을 준비: 발행 상태 = **"발행 부분 완료 —
   콘텐츠 커밋 성공, Pages 활성화 실패(사유: <오류 메시지>) — 사용자가 GitHub 리포 Settings→Pages
   에서 수동 활성화 필요"**.
10. **URL 확정(8·9 모두 성공 시)**: 호스팅 URL = `https://<gh-user>.github.io/app-factory-pages/
    <project>/privacy.html`(경로에 `docs/`는 포함하지 않는다 — Pages 소스 경로가 `/docs`이므로 그
    하위가 사이트 루트). §4에 기록할 값: 발행 상태 = **"발행 완료(GitHub Pages — 콘텐츠 커밋+Pages
    설정 성공) — Pages 빌드 반영에 수 분 소요, 지금 열면 일시적으로 404일 수 있음"**.

### ⑥ `release/RELEASE.md` 작성 (템플릿 전 블록 — ③·④·⑤의 결과를 §4·§6·§8에 기록한다)

Read로 `templates/RELEASE.template.md`를 읽고 메타 + §1~§8 9개 블록의 제목·순서를 그대로 유지한
채 채운다. 블록별 규칙:

- **메타**: slug = `pipeline.json`의 `project`(여기서 slug = pipeline.json의 project — PRD의 아이디어
  slug와는 다른 값이다), 버전 v1.0(초도 릴리즈), 상태 "컨펌 대기", 기준
  PRD·ESTIMATE 버전, 앱 구성 요약(광고/로그인/백엔드 — ①에서 판정한 값. §3·§7의 입력이다).
- **§1·§2 스토어 텍스트(영어 — app_release_info 방법론)**: 표의 행 순서는 콘솔 입력 순서와
  1:1이므로 **재배열 금지**(사용자가 위에서 아래로 그대로 복붙). 제목 형식 `{앱이름} - {검색
  키워드 설명}`, 특수문자 금지, ASO 키워드 반영. 전체 설명 구조: 핵심가치 문단 → bullet 주요
  기능(①의 핵심 기능 필터 통과분만) → 사용 시나리오 → CTA. iOS 키워드는 쉼표 구분, 앱 이름에
  이미 포함된 단어는 제외.
- **글자수 하드 리밋(절대값)**: Play 이름 30 · 짧은 설명 80 · 전체 설명 4000 / iOS 이름 30 ·
  부제 30 · 설명 4000 · 키워드 100. 각 칸에 `(실제수/제한)`을 기입하되 **실제로 문자를 세어
  확인**하고(공백 포함), 초과면 그 자리에서 줄인 뒤 다시 센다 — 초과 상태로 다음 절차 진행 금지.
- §1 행 5(스크린샷 목록)·§2 행 6(스크린샷 목록)은 ④의 캡처 결과에 따라 "§6 참조"(캡처 성공 —
  §6에 실제 경로가 있음) 또는 "보류(Phase 5에서 활성화 — 사유: <④의 판정 사유>) — §6 참조"(환경
  불가로 캡처를 못 한 경우)로 채운다. §1 행 6·7과 §2 행 7(피처 그래픽·아이콘)은 ③의 결과 경로(또는
  미생성 표기)로 채운다.
- **§3 심사 설문 — 도출 규칙**: 메타의 앱 구성(광고 = PRD §6, 로그인 = PRD §3·§6, 백엔드 =
  ESTIMATE §1)으로 3-1·3-2 표에서 일치하는 행을 인용하고, 정확히 일치하는 행이 없으면 템플릿의
  "속성별 도출 규칙"으로 조합해 "이 프로젝트의 실제 구성 기준 최종 답변"을 확정한다. **광고 채택
  시 "광고 ID 수집"/추적 항목은 반드시 "예" 방향** — 임의로 "아니요"로 적지 않는다(템플릿 규칙).
  **로그인 채택 시 계정삭제는 "예" + 실제 앱 내 화면 경로 기입**(비워두기 금지) — PRD §3 Must에
  계정삭제가 없는데 로그인이 있으면 PRD 결함이므로 보고 후 `awaiting_feedback`. IARC 콘텐츠
  등급은 일반 유틸리티 원칙(전 항목 "아니요", 인앱 광고 있으면 그 항목만 "예") + 이탈 시 근거
  명시.
- **§4 개인정보처리방침**: 본문 초안은 ⑤-1에서 이미 작성했으므로 그대로 옮긴다(수집 데이터 종류가
  §3 최종 답변과 1:1로 일치해야 함, 광고 SDK명 명시). 문의처는 사용자가 실제 이메일을 제공한 적이
  있으면 그 값, 없으면 자리표시(`{{contact_email}}` 그대로) — 개인 이메일을 임의로 만들어 넣지
  않는다. **호스팅 URL·발행 상태 = ⑤에서 준비한 값을 그대로 옮긴다**(⑤-10 발행 완료 / ⑤-2·3·5·8
  각 단계의 보류·실패 문구 중 실제로 도달한 단계의 것 하나). `gh` 발행 결과와 무관하게 터널·
  localhost URL을 절대 적지 않는다.
- **§5 릴리즈 노트**: 영어, 특수문자 최소화, v1.0 초도 릴리즈 항목(핵심 기능 요약). 추가 로케일은
  앱의 지원 언어(스타터는 en/ko) 기준으로 채우거나 "해당 없음"을 이유와 함께 명시.
- **§6 자산 매니페스트**: 아이콘·피처 그래픽 행은 ③의 결과로. 스크린샷 행은 PRD §4 "스토어 스샷"
  열이 대상인 화면만 포함하고 **슬라이드 번호를 01부터 순서대로 부여한다(이 번호가 스토어 업로드
  순서의 정본 — ④에서 정한 순서를 그대로 옮긴다)**. 경로는
  `release/screenshots/android|ios|ipad/<화면ID>.png`. ④가 가용 트랙에서 실행돼 해당 화면이 실제로
  캡처됐으면 그 경로를 그대로 기입, ④ 안에서 개별 화면만 네비게이션 실패로 못 찍었으면 "미캡처 —
  네비게이션 수단 없음", 그 플랫폼 트랙 자체가 환경 불가로 보류됐으면 각 행에
  "보류 — <④의 판정 사유>"를 표기한다(Android는 캡처됐지만 iOS만 보류일 수 있으니 플랫폼별로 구분해
  적는다). "PRD §4 화면 ID 대응" 열은
  PRD와 동일한 화면 ID(관통 키)여야 한다.
- **§7 이전 출시 앱과의 차별점(§12.3)**: ①의 `../ideas-index.json` 과거 채택작 목록과 대조 —
  카테고리·핵심 기능·타겟을 비교해 실질적 차별점을 적는다. 템플릿의 경고 블록은 그대로 유지하고,
  **차별점이 빈약하면(카테고리·핵심기능이 거의 동일) "차별점 미흡" 판정을 그대로 노출한다 —
  문구 순화 금지**. 과거 채택작이 없으면 "해당 없음 — 이 카테고리 최초 출시"(인덱스 부재/빈 배열
  근거 포함).
- **§8 최종 체크리스트**: 템플릿의 고정 문항 8개를 그대로 두고 항목별 "확인 결과"에 실제 확인
  근거를 기입한다:
  - 광고 실 ID 교체: 광고 채택 시 `app/` 소스의 유닛 ID 상수와 `TODO(release)` 주석을 Read로
    확인 — 테스트 ID 상태면 **미체크** + "사용자가 릴리즈 직전 실제 AdMob 유닛 ID로 교체해야 함".
    미채택이면 "해당 없음"으로 체크.
  - 계정삭제(로그인 채택 시): 해당 화면이 `app/lib/router.dart`의 라우트로 존재하는지 확인.
    미채택이면 "해당 없음"으로 체크.
  - 차별점: §7 판정 인용.
  - 아이콘 512 / 1024: ③ 렌더 출력 `OK <크기>`가 근거(폴백이면 미체크 + "아이콘 임시 — 교체
    필요"). 1024는 colorType(알파) 결과 포함.
  - 글자수: §1·§2 전 칸 재확인 결과.
  - 개인정보처리방침 URL: ⑤-10 발행 완료면 **체크** + URL·"Pages 빌드 반영 대기" 문구, 그 외(⑤-2·
    3·5·8에서 멈춘 보류·실패)면 **미체크** + ⑤에서 준비한 해당 사유 그대로.
  - §3↔§4↔실제 구성 모순 없음 확인 결과.
  - 미체크 항목은 사유 필수 — **체크리스트를 통과시키려고 사실과 다르게 체크하지 않는다.**
- 저장: Write 도구로 `release/RELEASE.md.tmp` 작성 →
  `bash .claude/atomic-mv.sh release/RELEASE.md.tmp release/RELEASE.md`.

### ⑦ 진행 보고 (폰 로그 스트리밍용)

①~⑥ **각 절차를 마친 시점마다** 채팅으로 한 줄씩 보고한다(모아서 마지막에 한 번 하지 않는다).
형식 예: "① 입력 확인 완료 — 광고 채택·로그인 없음·백엔드 없음, 과거 채택작 2건" / "③ 아이콘
렌더 완료 — 512/1024 OK(colorType=6), 피처 그래픽 OK" / "④ 스크린샷 캡처 완료 — Android 화면 5개
캡처·validate PASS(iOS는 비macOS라 보류)"(어느 트랙도 불가면 "④ 스크린샷 캡처 보류 — 사유") / "⑤
개인정보처리방침 발행 완료 — URL: https://<gh-user>.github.io/app-factory-pages/<project>/
privacy.html(Pages 빌드 반영 대기)"(미인증/미확정/실패면 "⑤ 개인정보처리방침 발행 보류 — <사유>")
/ "⑥ RELEASE.md 작성 완료 — §8 미체크 2항목(광고 실 ID, privacy URL 보류)".

### ⑧ 완료 기록

1. `pipeline.json`에 원자적으로 기록: `artifacts.release = "release/"`(디렉터리 전체 — RELEASE.md
   + 아이콘·그래픽·스크린샷·개인정보처리방침 사본 동반 파일. 기존 키 전부 보존),
   `stageStatus: "awaiting_confirm"`.
2. 채팅 최종 보고: 스토어 제목(글자수 포함), 아이콘 생성 방식(Chromium 렌더/플레이스홀더 폴백),
   §7 차별점 판정, **§8 미체크 항목 전체 목록 + 사유**, ④ 스크린샷 캡처 결과(트랙별 — 캡처한
   플랫폼의 화면 수·validate 결과 / 보류한 플랫폼의 사유), ⑤ 개인정보처리방침 발행
   결과(발행 URL 또는 보류 사유 그대로), 그리고 다음 행동 안내: **"컨펌하면 host가 파이프라인을
   완료(done)로 처리합니다. 이후 RELEASE.md의 §1·§2를 Play Console / App Store Connect에 위에서
   아래로 복붙하고 §6 자산을 업로드하면 됩니다 — 단, §8의 미체크 항목을 먼저 해결해야 실제 스토어
   제출이 가능합니다."** 보고는 비개발자 눈높이로 쓴다 — 전문용어는 풀어 쓰고, 표의 숫자에는
   뜻을 한 줄로 덧붙인다(계약 7항).

## 피드백 처리 (`/pipeline-release 피드백: <텍스트>`)

- **스토어 문구·설명·키워드·설문 답변·릴리즈 노트 수정**: RELEASE.md의 해당 블록만 고쳐 전체를
  다시 원자적으로 저장(Write `.tmp` → atomic-mv)하고, 글자수 칸을 재확인한 뒤
  `awaiting_confirm`을 기록한다.
- **아이콘/피처 그래픽 재디자인**: `icon.html`(·`feature-graphic.html`)을 수정하고 ③의 렌더를
  재실행 → §6·§8 관련 기재를 갱신 → `awaiting_confirm`.
- **스크린샷 헤드라인/화면 구성 수정**(캡처 자체는 ④에서 이미 성공한 경우): `release/screenshots/
  manifest.json`의 헤드라인·서브캡션·슬라이드 구성을 고치고 ④의 3단계(compose)·4단계(validate)만
  재실행(재캡처 불필요 — 원본 raw 스크린샷은 그대로 재사용) → §6 기재 갱신 → `awaiting_confirm`.
  화면 자체를 다시 찍어야 하는 수정(예: 앱 화면이 바뀜)이면 ④ 전체(부팅→캡처→합성→검증→정리)를
  재실행한다.
- **개인정보처리방침 재발행/수정**(문의 이메일 제공·`gh auth login` 완료 후 재시도, 또는 본문 문구
  수정 요청): ⑤-1의 본문 요약을 필요 시 갱신하고 ⑤ 전체(2~10)를 재실행 — 6에서 얻은 `<sha>`가
  있으면 8의 `-f sha=<sha>`로 기존 파일을 덮어쓴다(신규 커밋이 아니라 갱신). §4·§8 기재를 갱신 →
  `awaiting_confirm`. 여전히 실패하면 그 사유로 §4를 갱신(터널 URL 대체 금지는 동일하게 적용).
- **작은 기능 추가·변경**(기존 화면 안 요소·동작 수준 — 계약 5항 기준): 바로 반영한다 —
  `app/` 수정 → `docs/PRD.md` §3·§4 함께 갱신(원자적 쓰기) → 영향받는 릴리즈 산출물 재생성
  (코드가 바뀌었으면 ② AAB 재빌드, 화면이 바뀌었으면 ④ 재캡처) → `awaiting_confirm`.
- **큰 방향 전환**(새 화면 여러 개, 수익모델·백엔드 변경, 화면 구조 개편): 산출물을 바꾸지 말고
  "큰 변경이라 PRD부터 다시 정리하는 게 안전해요 — 되돌리기(롤백)를 권합니다"라고 안내한다.
- **그냥 질문**(설명 요청·상담): 채팅으로 답만 하고 산출물·상태는 순변경 없이 실행 전
  상태(보통 `awaiting_confirm`)를 복원한다.
