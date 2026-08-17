# 앱 팩토리 파이프라인 — 설계 문서

> 작성일: 2026-07-04
> 상태: 설계 승인됨 (사용자 컨펌 완료 · 반복 점검 8회 통과 · UI 목업 확정)
> 기반: 기존 connect_pc_mobile_claude 시스템 (폰 채팅 ↔ 중계 서버 ↔ PC Claude Code)
> 확정 디자인 기준: `assets/pipeline-ux-mockup.html`(폰 5화면: 홈/컨펌/실행/기기프레임 미리보기/폐기), `assets/prd-template-detail.html`(PRD 템플릿 §1~§8 실물 예시)

## 한 줄 요약

폰에서 앱 아이디어를 시작하면 **아이디에이션 → PRD → UI/UX 목업 컨펌 → 비용·기술 산정 → Flutter 개발 → URL 테스트 → 스토어 릴리즈 패키지**까지 7단계 파이프라인이 PC에서 실행되고, 모든 확인·컨펌·피드백은 폰으로 한다. 여러 프로젝트를 폰에서 동시에 관리한다. 나중에 다른 개발자도 쓸 수 있게 단계 구성을 설정으로 분리한다(플랫폼화).

## 확정된 핵심 결정

| 결정 | 선택 | 이유 |
|------|------|------|
| 결과물 스택 | **Flutter** | 스토어 배포가 최종 목표. `/app-store-screenshots` 등 기존 릴리즈 스킬이 Flutter 기준. 개발 중 미리보기는 `flutter build web`을 URL로 서빙 |
| 오케스트레이션 | **하이브리드** | 각 단계는 Claude Code 스킬로 구현(유연함), 상태는 프로젝트별 `pipeline.json`(구조화) → 서버가 읽어 폰에 단계 UI 표시 |
| UI/UX 컨펌 | **HTML 목업 선행** | 디자인 반복은 수 초 만에 생성되는 HTML 목업으로(기존 iframe 미리보기 재활용), 컨펌된 목업이 Flutter 구현의 디자인 스펙 |
| 아이디에이션 | **웹 리서치 기반** | PC Claude가 웹서치로 해외 스토어 차트·트렌드 조사 → 카피 후보를 아이디어 카드로 제안 |
| 릴리즈 범위 | **리스팅 패키지까지** | 스크린샷 + 스토어 텍스트 + 개인정보처리방침 + 릴리즈노트를 `release/`에 정리. 바이너리(aab/ipa) 빌드·서명·업로드는 범위 외 |
| 멀티 프로젝트 | **폰 홈 = 프로젝트 목록** | 프로젝트별 완전 격리, 프로젝트 간 병렬 + 프로젝트 내 큐잉(§6) |

## 1. 전체 구조

```
[폰 앱]                              [중계 서버]              [PC: host + Claude Code]
 프로젝트 목록 (홈)                   메시지 forward만          단계별 스킬 실행
 단계 진행바(스텝퍼) + 채팅           (파싱·상태 없음)          pipeline.json 감시·검증
 산출물 뷰어(문서/목업/스샷)     ◀────────────────────────    stage_update 발신
 [컨펌 → 다음 단계] 버튼        ────────────────────────▶    confirm 수신 → 다음 단계 실행
```

- 각 단계 = PC의 Claude Code 스킬(슬래시 커맨드). Claude의 유연함 유지.
- 단계 상태 = 프로젝트별 `pipeline.json`. **폰 UI·서버·스킬 사이의 유일한 계약** — 각자 독립 교체/테스트 가능.
- 모든 컨펌 게이트는 폰 버튼으로 통과. 통과 전 다음 단계 시작 안 함.

## 2. 7단계 정의

| # | 단계 | 스킬 | 산출물 | 폰에서 보는 것 |
|---|------|------|--------|---------------|
| 1 | 아이디에이션 | `/pipeline-ideation` | `IDEAS.md` | 아이디어 카드 3~5개 (원본앱·컨셉·타겟·핵심기능·수익모델·난이도) |
| 2 | PRD | `/pipeline-prd` | `docs/PRD.md` | PRD 요약 카드 + 전문 뷰어(마크다운 렌더) |
| 3 | UI/UX 목업 | `/pipeline-mockup` | `mockup/` (HTML) | iframe으로 화면 넘겨보며 피드백 반복 |
| 4 | 비용·기술 산정 | `/pipeline-estimate` | `ESTIMATE.md` | 필요 서비스(Firebase/AdMob/RevenueCat 등) + MAU 시나리오별 예상 월 비용 + 기능 가감 조정 |
| 5 | 개발 | `/pipeline-develop` | Flutter 프로젝트 (`app/`) | 진행 로그 스트리밍 |
| 6 | 테스트 | `/pipeline-test` | `flutter build web` → `preview/` | 실제 앱을 폰 브라우저(URL)로 조작, 피드백→수정 루프 |
| 7 | 릴리즈 패키지 | `/pipeline-release` | `release/` | 스크린샷 갤러리 + 스토어 텍스트 미리보기 |

### 단계별 상세

**1. 아이디에이션** — 두 입력 모드: (a) 사용자가 폰에서 아이디어 직접 입력, (b) "제안해줘" → Claude가 웹서치로 조사해 카피 후보를 아이디어 카드로 제안. 카드 선택 or 피드백 반복 → 컨펌 시 다음 단계.

- **리서치 방법론 (flutter-dev-harness `trend-research`에서 채택)**: ① **미↔한 양방향 크로스마켓 아비트라지** — US→KR, KR→US 두 방향 모두 탐색 ② **최신성 원칙** — 실행 시점 기준 최근 3개월 급부상 우선, 최대 6개월, 근거 자료의 날짜 검증(오래된 스테디셀러는 트렌드 아님) ③ **인디·MVP 우선** — 대기업·슈퍼앱 배제, 1인/소규모 팀이 수 주 내 MVP 가능한 단일 핵심 기능, 한 문장으로 사로잡는 훅 ④ **카테고리 다양성** — 최소 5개 카테고리, 어느 것도 후보의 1/4 초과 금지 ⑤ **실제 운영 중인 앱만** + 근거 URL 필수 ⑥ 마켓별 병렬 조사(market-scout) 후 기회 분석(gap-analyst)으로 `opportunity_score` 산정. 후보 풀
  8~10개 → 상위 3~5개 카드 제안 — 다양성 원칙은 풀 기준.
- **아이디어 카드는 HTML로**: 산출물 = `IDEAS.md`(기계용 메타: slug·점수·근거) + `ideas/<NN>-<slug>.html`(사람용 카드 — 기존 iframe 뷰어로 폰에서 열람). 카드에 [이걸로 진행] 표시 → §12.5의 카드 선택 UI 요구를 HTML 카드로 충족.
- **전역 중복 방지**: projectsRoot(`projects/`) 바로 안(프로젝트 디렉터리들의 형제, 프로젝트 cwd 기준 `../ideas-index.json`)에 `ideas-index.json`(전 프로젝트 누적) — 과거 제안·진행 아이디어와 slug/시장방향/카테고리/의미 유사 중복을 컷하고 다음 순위로 보충. §12.3의 Play 반복 콘텐츠 리스크 완화와 직결(여러 앱을 계속 만드는 유스케이스의 필수 장치).

**2. PRD** — 확정 아이디어를 `docs/PRD.md`로: 문제정의, 타겟, 기능 목록(MoSCoW), 화면 목록, 데이터 모델, 수익화 계획. 폰에서 전문 열람 + 채팅 피드백으로 수정 반복 → 컨펌.

**3. UI/UX 목업** — PRD의 화면 목록 기반으로 화면 간 이동 가능한 정적 HTML 프로토타입을 `mockup/`에 생성. 기존 iframe 미리보기로 폰에서 확인. 컨펌된 목업이 5단계 Flutter 구현의 디자인 기준.

**4. 비용·기술 산정** — 이 단계의 목표는 비용 "예측"이 아니라 **"월 운영비 ≈ 0인 아키텍처를 기본값으로 선택"**하는 것.

- **백엔드 결정 트리(순서대로 적용)**: ① 이 기능이 기기 로컬 저장만으로 되는가? → 로컬(기본값) ② 서버가 필요해도 정적 데이터로 대체 가능한가? → 앱에 번들 or 정적 호스팅 ③ 진짜 사용자 간 공유·동기화가 필요한가? → 그때만 백엔드, 그리고 그 기능이 수익모델을 정당화하는지 명시
- **백엔드 채택 시 기본 스택 = Supabase** (flutter-dev-harness `backend-builder` 방법론 재사용): PRD의 데이터 엔티티 표 → SQL 마이그레이션 + RLS 정책, 인증 구성, anon/service key 분리, `.env.example`로 자격증명 분리(커밋 금지). Firebase는 특정 요건(RTDB 기반 version-check 등)일 때 대안. 비용 가드레일의 read 최소화 원칙은 스택 무관하게 동일 적용.
- **비용 리스크 표**: 서비스를 쓰기로 했다면 "어떤 사용자 행동이 비용을 만드는가"를 행동 단위로 기록 — 예: "피드 열 때마다 Firestore read 30건 × DAU 1천 × 10회/일 = 30만 read/일 → 무료 티어(5만/일) 6배 초과". 각 리스크에 완화책(아래 가드레일 참조)과 완화 후 예상치를 같이 적음
- 무료 티어 기준 + 1천/1만 MAU 시나리오별 예상 월 비용, 개발 범위 요약을 `ESTIMATE.md`로. 기능 빼기/넣기 최종 조정(조정 시 PRD 자동 갱신).
- **목업 재동기화 규칙**: 산정 조정이 화면 목록(화면 ID 추가/삭제/역할 변경)에 영향을 주면 mockup 단계로 자동 롤백 — 단, 변경된 화면만 재생성·재컨펌하고 나머지는 유지. 이 규칙이 없으면 5단계가 서로 어긋난 PRD와 목업을 동시에 기준 삼게 된다. §12.4의 화면 ID 대조는 항상 **갱신된 PRD**가 기준.
- **PRD 재승인 게이트**: "자동 갱신"이라도 무통지 변경은 금지 — estimate 컨펌 카드에 이번 조정으로 바뀐 **PRD diff 요약을 필수 표시**하고, estimate 컨펌 = 갱신된 PRD 재승인으로 정의(화면에 영향 없는 기능 가감도 사용자가 승인한 문서가 몰래 바뀌지 않게).

**5. 개발** — 공용 Flutter 템플릿에서 시작, 컨펌된 목업+PRD 기반 구현. 기존 `commands/skills/` 자산(interstitial-splash-ad, reward-ads, localization-prompt, persist_user_settings, version-check, color_theme_black_white, overflow-fix) 해당 시 자동 적용. 진행 상황을 폰에 로그 스트리밍.

- **스토어 제출 필수 설정 포함**: 고유 `applicationId`/bundleId(`com.example` 금지 — 프로젝트명 기반 자동 생성 + PRD 컨펌 시 확정), 앱 표시명, 런처 아이콘(flutter_launcher_icons) — 바이너리 빌드는 범위 외지만 이 설정들은 파이프라인이 생성하는 소스의 일부이므로 develop 책임.
- **비용 가드레일 체크리스트** (`templates/COST-GUARDRAILS.md`, 백엔드 쓰는 앱만 해당 — 개발 완료 시 스킬이 항목별 준수 여부를 확인해 pipeline.json에 기록):
  - Firestore 오프라인 persistence 활성화 (재실행 시 캐시에서 읽기, read 과금 방지)
  - 실시간 리스너는 꼭 필요한 화면·범위에만, 화면 이탈 시 해제. 목록은 `limit()` + 페이지네이션 필수
  - 카운트·통계는 문서 전체 읽기 금지 → 집계 문서(counter) 패턴
  - 원격 데이터는 로컬 캐시 + TTL(예: 24h) 우선, 네트워크는 캐시 미스·만료 시만
  - 이미지는 업로드 전 클라이언트 리사이즈, 다운로드는 캐시 라이브러리 경유
  - 설정·정적 콘텐츠는 서버 조회 대신 앱에 번들(업데이트로 갱신)

**6. 테스트** — `flutter build web --release --base-href=/preview/<이름>/preview/` → `projects/<이름>/preview/`로 서빙(기존 정적 서빙+터널 재사용) → 폰에서 실제 조작. 피드백 → 수정 → 재빌드 루프. 컨펌 시 다음.

- **서브패스 서빙 필수 조치 3가지**: ① `--base-href` 지정(없으면 자산 전부 404) ② relay MIME 맵에 `.wasm .otf .ttf` 등 Flutter web 자산 타입 추가 ③ 결과물 앱의 `flutter_service_worker` 등록 비활성화(`--pwa-strategy=none`) — 컨트롤 앱과 같은 origin이라 캐시 간섭 방지.
- **기기 크기 프레임 미리보기**: 미리보기는 브라우저 크기대로 퍼지지 않고 **기기 논리 해상도 프레임 안에 렌더** — 프리셋 토글: iPhone(390×844) / Android(360×800) / 꽉 채움. 기존 `applyFrameMode`(논리 픽셀 프레임 + `transform: scale()`) 재사용, 프리셋 전환은 iframe 크기만 변경(재빌드 불필요). 같은 URL을 PC 브라우저에서 열어도 동일 프레임으로 보임. 목업(3단계)도 같은 프레임 사용.

- **web 미리보기 한계 명시**: 광고(AdMob), 일부 네이티브 플러그인(푸시, 인앱결제 등)은 web에서 동작 안 함 → 테스트 단계 진입 시 "이 URL에서 검증 불가한 항목" 목록을 폰에 표시(해당 부분은 자리표시 UI로 대체). 실기기 검증은 릴리즈 후 스토어 내부 테스트 트랙에서.
- **피드백 분류 규칙**: 버그·문구·스타일 수정은 이 단계 안에서 반복. 기능 추가·변경 요청이면 스킬이 "PRD 변경입니다"라고 알리고 PRD 롤백을 제안 — 문서와 앱이 어긋난 채 배포되는 것 방지.

**7. 릴리즈 패키지** — `/app-store-screenshots` 실행(시뮬레이터 캡처 + 프레이밍), `app_release_info` 등으로 스토어 제목/설명/키워드(필요 시 다국어), 개인정보처리방침, 릴리즈노트 생성. 전부 `release/` 한 폴더에 정리 + 폰에서 스크린샷 갤러리·텍스트 확인. 사용자는 Play Console / App Store Connect에 복붙만 하면 되는 상태로 종료.

- **개인정보처리방침 호스팅**: 스토어는 텍스트가 아니라 **영구 접근 가능한 URL**을 요구(심사·출시 후에도 상시) → 터널·PC 종속 URL은 요건 불충족. 정본 호스팅은 **GitHub Pages로 확정** — release 스킬에 업로드 절차와 전제조건(gh CLI 인증)을 명시하고, 발행된 URL을 `release/`에 기록. 이거 없으면 "복붙만 하면 끝"이 성립 안 함.
- **심사 설문 답변 가이드 포함**: Play Console 데이터 안전 섹션·콘텐츠 등급 설문, App Store 개인정보 라벨에 대한 권장 답변을 앱 구성(광고 유무, 수집 데이터)에 맞춰 생성 — 복붙 동선의 마지막 조각.
- 로그인 기능이 있는 앱은 스토어 정책상 **계정 삭제 기능** 필수 → PRD 단계에서 로그인 채택 시 자동으로 Must 기능에 추가.
- **스토어 아이콘 산출물**: Play 512×512 + App Store 1024×1024 아이콘 파일을 `release/`에 포함(리스팅 등록 필수 — 없으면 등록 자체가 막힘). **원본 생성 수단 명시**: Claude는 래스터를 못 그리므로 아이콘은 SVG/HTML로 디자인 → headless Chromium 래스터화(compose.mjs와 같은 메커니즘)로 **512/1024 각 크기를 직접 렌더** — macOS 전용 `sips`에 의존하면 "Windows/Linux는 Play 자산 생성 가능"(§8) 약속이 깨지므로 전 OS 동일 경로로. 공용 템플릿에 플레이스홀더 아이콘 동봉(생성 실패 시에도 진행 가능).

## 2.5 산출물 템플릿 표준화

각 단계의 산출물은 **표준 템플릿**(`templates/` 폴더에 동봉)을 따른다. Claude가 매번 자유 형식으로 쓰는 게 아니라 정해진 섹션 구조를 채우는 방식 — 이래야 (a) 다음 단계 스킬이 산출물을 안정적으로 읽어 쓸 수 있고, (b) 폰 뷰어가 요약 카드를 일관되게 렌더링하고, (c) 플랫폼화 시 다른 개발자가 템플릿만 교체해 자기 스타일로 커스터마이징할 수 있다.

| 템플릿 | 파일 | 고정 섹션 |
|--------|------|-----------|
| 아이디어 카드 | `templates/IDEAS.template.md` | 카드별: 원본앱 / 한 줄 컨셉 / 타겟 / 핵심기능 3개 / 수익모델 / 개발 난이도 / 카피 리스크 |
| PRD | `templates/PRD.template.md` | 문제 정의 / 타겟 사용자 / 기능 목록(MoSCoW: Must·Should·Could·Won't) / 화면 목록(화면별 ID·목적·구성요소 + **유저 스토리·수용 기준 체크리스트**) / 데이터 모델 / 수익화 계획 / 성공 지표 / **가정**(직접 입력 아이디어에서 되묻지 않고 기본값으로 채운 항목 명시 — 질문은 최대 2~3개만) / **네이티브 필요 요건**(Flutter로 어려운 부분은 근거와 함께 명시) |
| 산정 | `templates/ESTIMATE.template.md` | 백엔드 결정 트리 결과 / 기능→서비스 매핑 표 / **비용 리스크 표(행동 단위 과금 분석 + 완화책)** / 무료 티어·1천 MAU·1만 MAU 비용 시나리오 / 개발 범위 요약 / 권장 구성 |
| 비용 가드레일 | `templates/COST-GUARDRAILS.md` | Firestore read 최소화(오프라인 persistence·리스너 범위·집계 문서·페이지네이션) / 캐싱+TTL / 이미지 최적화 / 정적 콘텐츠 번들 — 개발 단계 완료 시 체크 |
| 릴리즈 | `templates/RELEASE.template.md` | 스토어 제목·부제 / 짧은 설명·전체 설명 / 키워드 / 릴리즈노트 / 개인정보처리방침(+호스팅 URL) / 데이터 안전·콘텐츠 등급·개인정보 라벨 설문 답변 — Play·App Store 콘솔 입력란에 1:1 대응하는 순서로 (복붙 동선 최적화) |

규칙:
- 각 스킬은 자기 템플릿을 읽고 섹션 구조를 그대로 유지한 채 내용만 채운다. 섹션 추가·삭제 금지(빈 섹션은 "해당 없음" 명시).
- PRD의 **화면 목록의 화면 ID**는 3단계 목업 파일명(`mockup/<화면ID>.html`), 5단계 Flutter 화면, 7단계 스크린샷 매니페스트까지 일관되게 이어지는 키가 된다. 명명 규칙: 소문자 kebab-case, 영문 시작 (`home`, `stats-detail`).
- **Dart 명명 충돌 변환 규칙**: Dart는 패키지명·파일명에 하이픈 금지(snake_case) — 정본은 kebab이고, Dart 산출물(파일·클래스·패키지명)은 kebab→snake 기계적 변환(하이픈→언더스코어, 클래스는 PascalCase), 라우트 경로는 kebab 유지. 변환 함수는 공용 모듈 하나로 고정, §12.4의 화면 ID↔라우트 대조도 이 변환 후 비교로 정의.
- 템플릿 검증: 각 단계 완료 시 스킬이 필수 섹션 존재 여부를 체크리스트로 확인 후 `pipeline.json`에 기록.

## 3. 상태 파일 — `projects/<이름>/pipeline.json`

```json
{
  "schemaVersion": 1,
  "project": "habit-tracker",
  "createdAt": "2026-07-04T00:00:00Z",
  "stage": "mockup",
  "stageStatus": "awaiting_confirm",
  "sessionId": "claude-session-uuid",
  "artifacts": {
    "ideas": "IDEAS.md",
    "prd": "docs/PRD.md",
    "mockup": "mockup/index.html",
    "estimate": "ESTIMATE.md",
    "guardrails": "COST-GUARDRAILS.md",
    "preview": "preview/index.html",
    "release": "release/"
  },
  "history": [
    { "stage": "ideation", "confirmedAt": "..." },
    { "stage": "prd", "confirmedAt": "..." }
  ],
  "error": null
}
```

- `stage`: `ideation | prd | mockup | estimate | develop | test | release | done`
- `stageStatus`: `pending`(프로젝트 생성됨, 스킬 미실행) / `starting`(confirm 수신, 다음 스킬 기동 중) / `running`(Claude 작업 중) / `awaiting_feedback`(피드백 반복 중) / `awaiting_confirm`(컨펌 대기) / `error`(실패)
- **소유권 예외 조항(일반화)**: **스킬 프로세스가 실행 중이 아닐 때의 모든 상태 전이는 host가 쓴다** — 초기 시드(`pending`), confirm 수신 시 stage 전진+`starting`, exit0/running·타임아웃·cancel 시 `error` 강등, 마지막 release confirm 후 `stage=done` 확정. 스킬 소유권은 "스킬 실행 중"에만 배타적.
- **병합·복구 규칙**: 폰 스냅샷 병합 시 host의 error가 스킬의 stageStatus보다 우선(running+error 모순 상태 방지). 재시도 시작 시 host가 error를 클리어. `stage=done`이면 stageStatus는 무시.
- 스킬이 쓰고, **host(PC)가 감시·검증·발신**하고, 폰이 표시한다. 릴레이는 forward만 — 원격 릴레이는 PC 파일에 접근할 수 없으므로 감시를 서버에 두면 로드맵(상시 원격 릴레이)이 깨진다.
- **필드 소유권 분리(이중 작성자 충돌 방지)**: 스킬(Claude)은 `stage/stageStatus/artifacts`만 쓰고, host는 `sessionId/history/error`만 쓴다 — sessionId·usage(비용)·confirmedAt은 스킬이 알 수 없는 값이기 때문. host의 watch는 자기 쓰기를 무시(직전 기록 해시 비교)해 에코 루프 방지. stream-json 파서는 현재 session_id·usage를 버리므로 추출 확장 필요.
- **물리적 쓰기 레이스 방지(소유권 분리만으론 부족)**: ① host 소유 필드는 **별도 파일 `pipeline.host.json`**에 저장(같은 파일 이중 작성자 자체를 제거, 위 스키마는 폰 스냅샷에서 병합된 논리 뷰) ② 쓰기는 양쪽 다 temp 파일 + rename(원자적) — 스킬 프롬프트에도 이 규약 명시 ③ host는 파싱 실패 시 즉시 error가 아니라 디바운스 후 재읽기 N회 뒤 판정(쓰기 도중 부분 파일을 읽고 "복구"랍시고 정상 쓰기를 덮어쓰는 최악 방지) ④ **감시는 파일이 아니라 프로젝트 디렉터리 단위 watch(또는 폴링)** — 파일 단위 watch는 rename 교체 후 사라진 옛 inode를 바라봐 이후 이벤트가 영영 안 오고, 첫 단계 완료 후부터 폰 UI가 무음으로 멎는다. 이벤트 후 파일을 다시 열어 읽는다.
- **세션 연속성**: 단계 간 Claude 세션 이어가기는 인메모리가 아니라 pipeline.json의 `sessionId`로 판단(`--resume <sessionId>`) — host 재시작 후에도 develop 도중 컨텍스트가 조용히 리셋되지 않게.
- `schemaVersion`: 플랫폼 업그레이드 시 구버전 프로젝트 마이그레이션 판단 기준.
- **검증은 host가 최종 책임**: 스킬(Claude)이 쓴 JSON이 깨졌거나 스키마 위반이면 host가 마지막 유효 상태로 복구하고 error 표시 — Claude 출력을 그대로 신뢰하지 않는다.
- **컨펌 멱등성**: confirm 메시지는 `{project, stage}`를 함께 보내고, host는 현재 stage와 일치할 때만 1회 처리(더블탭·재전송 무해화).
- history 항목에 `durationMs`, `costUsd`(stream-json usage 파싱) 기록 → 폰에서 단계별 소요시간·비용 확인(운영 관측성).

## 4. 서버·프로토콜 변경

기존 채팅 프로토콜에 메시지 타입 추가 (모든 메시지에 `projectId` 태깅):

- `stage_update` (PC→폰): pipeline.json 변경 시 host가 발신 — 스텝퍼·상태 배지 갱신. 프로젝트 내 대기 큐 길이 필드 포함("앞에 N개 대기 중" 표시용)
- `confirm` (폰→PC): 컨펌 버튼 → host가 다음 단계 스킬 자동 실행
- `stage_rollback` (폰→PC): 특정 단계부터 재시작
- `pipeline_sync` (폰→PC): 폰이 페어링 직후 요청 → host가 전체 프로젝트 최신 스냅샷 응답(기존 `listProjects` 패턴과 동일)
- `artifact_get` (폰→PC) / `artifact` (PC→폰): 마크다운 산출물(IDEAS/PRD/ESTIMATE/RELEASE 텍스트)은 **WS 메시지 본문으로 전달** — 원격 릴레이로 가도 생존하는 경로. 대용량(스크린샷 이미지·프리뷰·목업)은 로컬 릴레이의 HTTP 서빙 한정이며, 상시 원격 릴레이 도입 시 host 업로드 방식이 필요함을 로드맵에 명시
- `stage_cancel` (폰→PC): 실행 중인 Claude 프로세스 중단(60분짜리 develop을 잘못 시켰을 때 타임아웃까지 기다리지 않게)
- `project_list` / `project_create` / `project_archive` / `project_delete` (폰↔서버↔PC)

서버(릴레이)는 여전히 **forward만** — 상태의 원본은 PC의 `pipeline.json`, 감시·발신·스냅샷 응답은 전부 host 책임.

- **페어링 세션 안정화(전제 수정)**: 현재 릴레이는 host 소켓이 끊기면 세션 삭제 + 새 코드 발급(새 코드는 화면에 재출력도 안 됨) — 재연결·재동기화 설계 전체의 전제가 깨지는 구조. 페어링 코드를 접속 1회용이 아닌 **안정 세션 키로 승격**: host가 재연결하면 host 전용 `reconnectKey`(페어링 secret과는 별개로 `crypto.randomBytes`로 발급되며 폰에는 절대 노출되지 않음)를 제시해 기존 세션을 재획득(코드 불변), 폰은 같은 코드로 재접속 후 `pipeline_sync`. `/preview/**` HTTP 서빙은 별도의 세션별 `previewToken`(고엔트로피 랜덤)을 쿼리로 1회 제시 → 검증 통과 시 릴레이가 HttpOnly 쿠키를 발급해 이후 서브리소스 요청까지 인증한다. 장기 실행(60분 develop)과 상시 원격 릴레이 로드맵의 필수 조건.
- **폰→PC 전달 보장(무음 유실 봉쇄)**: 현재 릴레이는 상대 소켓이 닫혀 있으면 메시지를 조용히 버림 — host 부재 시 릴레이가 폰에 **즉시 오류 응답**을 반환한다. confirm의 ack는 별도 메시지가 아니라 "N초 내 stage_update 수신"으로 정의, 미수신 시 폰이 재전송 버튼 노출. host 재시작으로 인메모리 큐가 유실되면 폰에 통지.
- **HTTP 서빙 인증**: WS만 secret 검사하고 `/preview/...` 등 HTTP는 무인증 — 터널 URL만 알면 미출시 앱·산출물 전체 열람 가능. 방식: 산출물 진입 URL의 서명 토큰을 릴레이가 1회 검증 후 **HttpOnly 세션 쿠키 발급** — 목업·Flutter web의 서브리소스(css/js/wasm/폰트 수십 건)는 상대경로 요청이라 쿼리 토큰이 전파되지 않으므로(전부 403 함정), 같은 origin인 iframe에도 적용되는 쿠키로 통과시킨다. 공개 예외 없음(개인정보처리방침은 외부 고정 호스트로 이관, §2-7단계).

- **재접속 재동기화**: 폰은 재연결 시 `pipeline_sync`로 최신 스냅샷을 받아 통째로 덮어쓴다 — 끊겨 있는 동안의 stage_update 유실 무해화. 개별 업데이트를 누적 적용하지 않는다.
- **피드백 실행 단위**: `awaiting_feedback`/`awaiting_confirm` 상태에서 온 폰 채팅은 host가 **현재 단계 스킬 재호출로 래핑**해 실행(예: `/pipeline-mockup 피드백: <텍스트>`) — 생 텍스트로 실행하면 템플릿 유지·pipeline.json 갱신·피드백 분류 같은 스킬 책임을 아무도 보장하지 않기 때문. "그냥 질문"(§12.5)도 스킬이 받아서 산출물 변경 없이 답한다.

## 5. 폰 웹앱 변경

- **홈 화면(신규) = 프로젝트 목록**: 카드(이름, 현재 단계, 상태 배지 — "컨펌 대기"가 눈에 띄게, 마지막 활동 시각), [+ 새 프로젝트]. 카드 탭 → 프로젝트 파이프라인 화면
- **파이프라인 화면**: 상단 7단계 스텝퍼 + 현재 단계 카드(산출물 열기 버튼, 컨펌 버튼, 에러 시 재시도 버튼) + 기존 채팅
- **산출물 뷰어 3종**: 마크다운 렌더러(PRD/산정/릴리즈 텍스트), iframe(목업·테스트 URL — 기존 재사용), 이미지 갤러리(스크린샷)
- 이전 단계로 되돌리기: 스텝퍼에서 지난 단계 탭 → 확인 후 해당 단계부터 재시작
- **컨펌 차례 알림**: 사용자가 앱을 계속 보고 있지 않아도 "컨펌할 차례"를 놓치지 않는 것이 회전 속도의 핵심. 단, **웹 푸시·PWA 설치는 origin이 고정돼야 성립**하는데 현재는 실행마다 새 trycloudflare URL이므로(§launch) MVP에서는 푸시 불가 — MVP는 열려 있는 탭의 인앱 배지·알림음 + 재접속 스냅샷으로 대체하고, 웹 푸시는 고정 도메인(named tunnel 또는 상시 원격 릴레이) 도입을 전제조건으로 MVP 이후에

## 6. 멀티 프로젝트

- `projects/<이름>/`마다 자체 `pipeline.json` + 자체 채팅 히스토리 + 자체 산출물. 완전 격리.
- **실행 정책(MVP, 코드 대조 후 수정)**: **프로젝트 간 병렬 허용** — 기존 코드가 이미 프로젝트별 독립 실행을 지원·테스트하고 있어 그대로 유지. **같은 프로젝트 안에서는 동시 1개 + 큐잉** — 현재는 작업 중일 때 새 명령을 즉시 거부하는데, 이를 큐 대기("앞에 N개 대기 중" 표시)로 바꾼다. 컨펌 대기/문서 열람/미리보기는 항상 즉시 가능.
- **큐와 confirm/rollback의 상호작용**: confirm은 큐를 우회해 즉시 처리하고, confirm·rollback으로 stage가 전환되면 **해당 프로젝트의 잔여 큐를 flush**(버림) — 이전 단계용 수정 지시가 다음 단계 산출물을 오염시키지 않게. flush된 메시지는 폰에 "단계가 바뀌어 취소됨"으로 통지.
- **실행 중(in-flight) 작업과의 선점 규칙**: `running` 중 도착한 confirm/rollback은 현재 프로세스가 끝난 뒤(또는 stage_cancel로 종료 후) 처리 — 이전 단계 스킬이 파일을 쓰는 중에 다음 단계가 시작되는 오염 방지. 폰 UI는 running 중 컨펌 버튼 비활성화.
- 아카이브(목록에서 접힘) / 삭제(폰에서 확인 후).
- **업데이트 사이클(v2+)**: `done` 프로젝트에서 [업데이트 시작] → PRD 단계로 재진입하되 기존 PRD에 변경분(diff)만 추가하는 모드. 목업·개발·테스트는 변경된 화면만 다루고, 릴리즈는 릴리즈노트+변경 스크린샷만 갱신. 출시가 끝이 아니라 반복 운영이 기본 흐름.

## 7. 플랫폼화

- 단계 목록·순서·게이트 여부·단계별 스킬 이름을 `pipeline.config.json`으로 분리 → 다른 개발자는 설정 변경 + 스킬 교체만으로 자기 파이프라인 구성
- 단계 스킬은 `commands/` 형태 그대로 배포 패키지에 포함
- 산출물 템플릿(`templates/`)도 배포 패키지에 포함 — 다른 개발자는 템플릿 교체만으로 산출물 형식 커스터마이징
- 전제조건 추가: 사용자 PC에 Flutter SDK (+ 릴리즈 단계는 macOS/Xcode 시뮬레이터). 셋업 문서(SETUP-customer.md)에 반영

## 8. 에러·엣지 처리

- 단계 실패: `stageStatus=error` + 로그 요약 폰 표시 + [재시도] 버튼
- **프로세스 종료는 2차 신호**: claude가 exit 0으로 끝났는데 stageStatus가 여전히 `running`이면(스킬이 pipeline.json 갱신을 깜빡한 경우 — LLM 기반에서 반드시 발생) host가 error로 강등 + 재시도 노출. 타임아웃 그물을 빠져나가 폰이 영원히 "작업 중"에 매달리는 케이스 봉쇄
- 되돌리기 시 기존 산출물은 덮어쓰기 전 `history/` 보관. **롤백 시 세션은 새로 시작**(sessionId 교체) — 기존 세션을 resume하면 "이후 단계까지 완료했다"는 기억이 롤백된 파일 상태와 모순됨. 새 세션의 스킬 프롬프트에 "현재 확정 산출물(갱신된 PRD 등)만이 사실"임을 주입(재수화)
- PC 연결 끊김: 기존 재연결 로직 그대로. `pipeline.json`이 디스크에 있어 재시작 후 이어서 진행
- Flutter SDK 미설치: 개발 단계 진입 시 사전 체크, 폰에 설치 안내 표시
- Windows/Linux PC(비macOS): 릴리즈 단계의 스크린샷 캡처는 **전체 보류**한다(Android 스크린샷도 iOS 시뮬레이터로 찍은 원본을 프레임만 바꿔 재활용하는 구조라 macOS 없이는 Android/Play 자산도 만들 수 없음) — 아이콘·피처 그래픽(SVG→headless Chromium 렌더)은 OS 무관이라 그대로 생성. RELEASE.md에 "보류(Phase 5에서 활성화 — 사유: 비macOS 환경)"로 표기. 나머지 단계는 OS 무관
- **단계 타임아웃**: 단계별 상한을 `pipeline.config.json`의 단계 속성으로 정의 — 기본값: ideation/prd/estimate 15분, mockup 20분, develop 60분, test 30분(재빌드 감안), **release 60분**(시뮬레이터 부팅 + 첫 iOS 네이티브 빌드 콜드 10분+ + 2기기 캡처 루프). 초과 시 프로세스 종료 + error — 일괄 "그 외 15분"으로 하면 정상 진행 중인 릴리즈가 재현성 있게 오탐 킬된다
- **"종료"의 정의 = 프로세스 그룹 킬**: claude PID만 죽이면 그 아래 flutter build/gradle/dart 데몬이 고아로 살아남아 다음 단계 실행 중에도 파일을 쓴다(오염 방지 전제 붕괴). executor를 취소 핸들 반환 구조로 개편, `detached` spawn + 그룹 킬(`kill(-pid)`). cancel/타임아웃 후 해당 단계 작업공간은 dirty로 간주 — 재시도는 클린 상태에서
- 프로젝트 삭제는 이중 확인(이름 입력) — 폰 오터치로 프로젝트 통째 소실 방지. 삭제 전 자동 zip 백업을 `archive/`에 보관. **running 중 delete/archive는 거부**하고 stage_cancel(프로세스 그룹 킬 완료 확인)을 먼저 요구 — 빌드가 쓰는 도중 백업하면 반쪽짜리 zip + 고아 프로세스가 삭제된 경로에 계속 쓰는 사고 방지
- **디스크 관리**: Flutter `build/` 캐시는 프로젝트당 수백 MB → 완료(done)·아카이브 시 자동 `flutter clean`, 폰 프로젝트 카드에 디스크 사용량 표시

## 9. 테스트 전략

- `pipeline.json` 스키마 검증 + 상태 전이(단계 순서·게이트) 유닛 테스트
- 서버 메시지 라우팅(projectId 격리, 큐잉) 통합 테스트 — 기존 vitest 사용
- 단계 스킬은 스킬별 체크리스트(산출물 존재·형식)로 검증
- E2E: 샘플 프로젝트 1개를 7단계 전부 통과시키는 시나리오

## 10. MVP 범위와 순서

1. **뼈대**: `pipeline.json` 스키마 + 서버 watch/push + 폰 프로젝트 목록·스텝퍼·컨펌 버튼
2. **템플릿 5종** 확정 (IDEAS / PRD / ESTIMATE / COST-GUARDRAILS / RELEASE) — 스킬보다 먼저, 스킬들이 이 계약 위에서 작성됨
3. **공용 Flutter 템플릿** 확정: 테마·라우팅(화면 ID = 라우트 = 딥링크)·`--dart-define=SEED` 데모 데이터 주입 지점·로컬 저장(persist_user_settings)·JSON i18n·광고 삽입 지점(seam)·버전체크 스텁(기본 비활성)이 미리 배선된 스타터 프로젝트. 개발 단계는 여기서 시작
4. **스킬 7개** 순차 작성 (ideation → prd → mockup → estimate → develop → test → release)
5. **릴리즈 단계**: 기존 `/app-store-screenshots`, `app_release_info` 연결 위주 + 개인정보처리방침 호스팅
6. MVP 이후: Firebase 실제 연동, pipeline.config 커스터마이징, 웹 푸시 알림(고정 도메인 전제, 뼈대에 자리만 확보)

## 11. 코드 대조 결과 — 재사용 vs 신규 (2026-07-04 심층 분석)

### 재사용 (기존 자산 그대로 or 소폭 확장)

| 자산 | 위치 | 파이프라인 활용 |
|------|------|----------------|
| WebSocket 릴레이(파싱 없이 forward) | `src/server/relay.ts` | 새 메시지 타입 추가에 서버 코드 거의 불변 |
| 정적 서빙 `/preview/<이름>/` | `relay.ts` | 서빙 허용 디렉터리를 화이트리스트로 일반화 (`public/` 고정 → `mockup/ preview/ release/`) + MIME 맵에 `.wasm .otf .ttf .jpg .jpeg .webp` 추가 |
| iframe 미리보기 프레임(target별 크기 + scale) | `src/web/app.js` | 3단계 목업·6단계 테스트 그대로 |
| 프로젝트 격리 + `meta.json` 패턴 | `src/cli/projects.ts` | `pipeline.json`이 따를 선례. slugify가 화면 ID 규칙과 동일(kebab) |
| Claude headless 실행(`claude -p` + stream-json, `--permission-mode acceptEdits`) | `src/cli/executor.ts` | 각 단계 스킬을 같은 executor로 실행 |
| 프로젝트별 세션 유지 개념 | `src/cli/host.ts` | **치환 대상(그대로 재사용 금지)**: 인메모리 `started` Set + `--continue` → pipeline.json `sessionId` + `--resume`으로 교체(§3) — `--continue`는 cwd 최신 세션을 잡아 롤백의 "새 세션" 정책과 충돌 |
| 테스트 하네스(WS 큐 헬퍼) | `tests/cli/host.test.ts` | 파이프라인 메시지 통합 테스트에 재사용 |

### 신규 구축 (스펙 가정 중 현재 코드에 없는 것)

1. `pipeline.json` 스키마·상태전이 로직 — 현재 meta.json은 `{target}`뿐
2. 메시지 타입 `stage_update / confirm / stage_rollback / project_archive / project_delete` — `src/shared/protocol.ts`에 추가 (기존: command, createProject, listProjects, log, status, preview, projects, assistant)
3. 컨펌 게이트 상태머신 — 현재 host는 무상태 명령 실행뿐
4. **완료 감지 전환**: 현재 Claude 프로세스 종료(exit 0) 기반 → pipeline.json의 stageStatus 읽기 기반으로 이동
5. 같은 프로젝트 내 큐잉 — 현재는 작업 중 새 명령 즉시 거부. §6의 수정된 정책(프로젝트 간 병렬 유지 + 프로젝트 내 큐) 적용
6. 프로젝트별 채팅 히스토리 영속화 — 현재 폰 메모리에만 있어 새로고침 시 소실
7. 폰앱 다화면화 — 현재 단일 화면 바닐라 JS 186줄. 홈/파이프라인 라우팅, 스텝퍼, 마크다운 뷰어, 갤러리 신규
8. PWA 인프라(service worker, manifest, 웹 푸시) — 폰 컨트롤 앱에 전무 (projects/my-app의 sw.js는 결과물 앱의 것, 혼동 주의)
9. 웹서치 도구 활성화 확인 — 1단계 아이디에이션이 요구, 현 executor 옵션에서 미확인

### 릴리즈 스킬 통합 — 확인된 전제조건과 대응

- **`/app-store-screenshots` 전제**: macOS + Xcode 시뮬레이터(iPhone 17 Pro Max 캡처 1320×2868, iPad 2064×2752), 시뮬레이터에서 `flutter run` 가능해야 함, Node + Chromium(컴포즈), 화면 이동은 딥링크 or idb 탭. Android는 캡처 없이 iOS 캡처 재활용(1080×1920) — 에뮬레이터 불필요.
- **→ 공용 Flutter 템플릿에 미리 배선할 것**: ① 화면 ID = 라우트 = **딥링크**(스크린샷 자동 네비게이션용) ② `--dart-define=SEED` 데모 데이터 주입 지점(빈 화면 방지) ③ 이 둘이 있으면 캡처가 사람 개입 없이 자동화됨. 그 외 공통분모: SharedPreferences(persist), JSON i18n(`assets/lang/`), 라이트/다크 테마, 광고 seam(google_mobile_ads), SafeArea/overflow 규율.
- **네이티브 빌드 리스크**: 파이프라인 6단계까지는 flutter **web**만 빌드 → iOS 네이티브 빌드가 처음 도는 게 7단계(스크린샷)라 늦게 터짐. **개발 단계 완료 기준에 iOS 시뮬레이터용 디버그 빌드 스모크 체크 추가**(macOS에서).
- **`app_release_info` 커버 범위**: 스토어 제목/설명/키워드/카테고리(영어) + 스크린샷 프롬프트 생성. **개인정보처리방침·데이터 안전 설문은 미포함** → §2 릴리즈 단계 요구사항을 채우려면 이 스킬 확장 or 보조 스킬 신규. 출력 언어도 영어 고정 → 타겟 스토어 언어 설정 가능하게 확장.
- **`version-check`는 Firebase RTDB 전제** — "기본 백엔드 없음" 원칙과 충돌 → 템플릿에서 기본 비활성(스텁), 산정 단계에서 채택 시만 활성화.
- **광고 스킬(interstitial/reward)**: 테스트 광고 ID로 구현됨 → 릴리즈 단계 체크리스트에 "실제 AdMob 유닛 ID 교체" 항목 필수. 광고 유무는 데이터 안전 설문 답변에도 반영.
- **스킬 형식 정규화**: 8개 중 4개(color_theme, localization, overflow-fix, persist)는 frontmatter 없는 생 프롬프트 → 파이프라인에서 자동 호출하려면 정식 스킬 형식으로 통일.
- **스크린샷 출력 경로**: 스킬은 `deploy/screenshots/`에 쓰고 스펙은 `release/` — 릴리즈 스킬이 결과를 `release/`로 모으거나 매니페스트 out 경로를 설정으로 통일.

## 12. 추가 점검 결과 (8-렌즈 검토, 2026-07-04)

### 12.1 실행 권한 — 파이프라인 성립의 전제 (블로커)

현재 executor는 `--permission-mode acceptEdits`만으로 headless 실행(`src/cli/executor.ts:24-25`) — 파일 편집은 자동 승인되지만 **Bash 도구는 승인자가 없어 거부됨**. 지금까지는 HTML 파일 생성뿐이라 문제가 없었지만, 파이프라인은 `flutter create/build/run`, `xcrun simctl`, `node compose.mjs` 등 Bash가 필수.

**대응**: 프로젝트 디렉터리에 `.claude/settings.json`을 시드하여 **허용 명령 화이트리스트**를 배선(접두 매칭 문법은 `명령:*` — 공백+`*`는 리터럴이라 매칭 안 됨). 원칙 두 가지:

1. **좁게** — 넓은 허용은 전권 우회가 된다: `Bash(node:*)`는 `node -e '<임의코드>'`로, `Bash(git:*)`는 `-c core.fsmonitor=<cmd>`·alias·hook으로 사실상 전권. 스크립트는 고정 경로로(`Bash(node .claude/commands/app-store-screenshots/scripts/compose.mjs:*)`), git은 필요한 서브커맨드만. **개인정보처리방침 GitHub Pages 발행(Phase 5 Task 6)은 `git`을 아예 쓰지 않는다** — GitHub Contents API(`gh api ... /contents/...`)로 원격 커밋까지 끝내 로컬 clone·`cd`가 불필요해지므로, git 서브커맨드는 화이트리스트에 추가하지 않는 선택으로 이 원칙(좁게)을 유지했다. 대신 `gh` 서브커맨드를 필요한 것만 추가: `Bash(gh auth status:*)`(인증 확인), `Bash(gh repo view:*)`/`Bash(gh repo create:*)`(고정 리포 `app-factory-pages` 조회/생성), `Bash(gh api user:*)`(계정명 조회)/`Bash(gh api repos/:*)`(Contents API 커밋 + Pages 활성화 — 실제 호출이 전부 `gh api user ...` 또는 `gh api repos/... ` 형태라 넓은 `Bash(gh api:*)` 대신 이 둘로 좁혔다, Phase 5 Task 6 리뷰. 그래도 `repos/` 접두만으로는 대상 리포·HTTP 메서드까지는 제한 못 해 §12.2 잔여 리스크로 명시). Contents API 업로드는 base64 인코딩이 필수이나 셸 리다이렉션(`base64 < in > out`)은 headless 승인 시 셸 연산자로 범주적 거부될 위험이 있어(Phase 5 Task 4 실측 — 괄호 서브셸 거부 확인) `base64` 셸 유틸 대신 전용 Node 스크립트 `Bash(node .claude/commands/app-store-screenshots/scripts/b64.mjs:*)`(fs 읽기 → `.toString("base64")` → fs 쓰기, 셸 연산자 없음)를 추가했다.
2. **스킬 명령 역산으로 완전하게** — 화이트리스트는 각 단계 스킬이 실제 호출하는 명령 목록에서 도출한다. 릴리즈 스킬 기준(Phase 5 Task 5 — 시드 후 프로젝트 내 실제 경로로 재도출 완료): `Bash(bash .claude/commands/app-store-screenshots/scripts/ios-boot.sh:*)` `Bash(bash .claude/commands/app-store-screenshots/scripts/shot.sh:*)` `Bash(bash .claude/commands/app-store-screenshots/scripts/validate.sh:*)` `Bash(node .claude/commands/app-store-screenshots/scripts/compose.mjs:*)` `Bash(idb ui:*)` `Bash(xcrun simctl:*)` `Bash(xcrun swift:*)`(커서 숨김 — SKILL.md 참조) `Bash(uname:*)`(macOS 환경 판정 — `uname` 출력이 `Darwin`인지 확인) 포함(아이콘은 Chromium 직접 렌더로 sips 불필요 — 렌더는 `Bash(node .claude/commands/app-store-screenshots/scripts/render-icon.mjs:*)`: compose.mjs는 매니페스트 기반이라 아이콘엔 부적합해 단일 HTML→정확 픽셀 PNG 전용의 리포 동봉 고정 경로 스크립트를 쓴다 — `Bash(node:*)` 전권이나 스킬이 런타임에 쓴 스크립트 실행 같은 우회를 만들지 않기 위해 스크립트는 리포에서 시드된 원본만 실행), 릴리즈 산출물 디렉터리 준비에 `Bash(mkdir -p release)` `Bash(mkdir -p release/icons)` `Bash(mkdir -p release/graphics)`(리터럴 매치 — 스크린샷 출력 디렉터리 `release/screenshots/**`는 shot.sh·compose.mjs가 각각 `mkdir -p "$(dirname "$OUT")"`/`mkdirSync(..., {recursive:true})`로 스크립트 내부에서 자체 생성하므로 별도 `mkdir -p` 화이트리스트 불필요), Chromium 부재 시 플레이스홀더 아이콘 폴백에 `Bash(cp app/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png:*)`(flutter 기본 아이콘 — 소스 경로를 접두로 고정) 포함, 원자적 쓰기(§_CONTRACT.md) 집행에 `Bash(bash .claude/atomic-mv.sh:*)` 포함(모든 산출물의 tmp→최종 rename을 이 헬퍼 하나로 통일), 개인정보처리방침 발행(Phase 5 Task 6)에 `Bash(gh auth status:*)` `Bash(gh repo view:*)` `Bash(gh repo create:*)` `Bash(gh api user:*)` `Bash(gh api repos/:*)` `Bash(node .claude/commands/app-store-screenshots/scripts/b64.mjs:*)` 포함(위 원칙 1 참조 — 발행 산출물은 `release/privacy.html`·`release/privacy.b64`로 프로젝트 내부에만 쓰고, 실제 발행은 GitHub Contents API 호출로 이루어져 프로젝트/harness 디렉터리 밖에 아무 파일도 만들지 않는다), develop·test·mockup 단계 기준: `Bash(bash templates/flutter-starter/apply.sh:*)`(스타터 오버레이 적용 — 고정 경로 스크립트) `Bash(mkdir -p mockup)` `Bash(mkdir -p preview)`(산출물 디렉터리 준비 — 정확히 이 명령만 허용하는 리터럴 매치) `Bash(cp -R app/build/web/.:*)`(웹 빌드 산출물 → preview/ 복사 — 소스 경로를 접두로 고정, `mv`·`rm`은 미허용) 포함 — flutter만 검증하는 스모크로는 릴리즈 단계 차단을 못 잡으므로, **스모크 테스트는 단계별 대표 명령 1개씩** 승인되는지 확인.

`--dangerously-skip-permissions`는 쓰지 않는다(폰에서 원격으로 트리거되는 실행이므로 전권 부여 금지). 스킬 인자 주입 등 잔여 우회 경로는 §12.2에 잔여 리스크로 명시. 화이트리스트는 공용 Flutter 템플릿과 함께 배포 패키지에 포함.

**스킬·템플릿 발견 경로 (같은 메커니즘)**: executor는 `cwd=projects/<이름>`으로 `claude -p`를 실행하므로 리포 루트의 `commands/`는 보이지 않는다. **프로젝트 생성 시 시드할 것 전부**: `.claude/commands/`(단계 스킬 7종 **+ 보조 스킬 8종 + app-store-screenshots 전체 — SKILL.md·scripts/·templates/·reference/ 포함**), `templates/`, `.claude/settings.json`. 부분 시드는 develop의 광고/i18n 자동 적용과 release의 스크린샷 실행을 통째로 실패시킨다. 화이트리스트의 스크립트 경로는 시드 후 프로젝트 내 실제 경로(`.claude/commands/app-store-screenshots/scripts/...`) 기준으로 재도출 완료(Phase 5 Task 5 — 이전에는 `Bash(scripts/ios-boot.sh:*)`처럼 시드 후 실제로는 존재하지 않는 프로젝트 루트 상대 경로가 잘못 등재돼 있었다). 부수 효과: 프로젝트가 생성 시점의 스킬 버전을 고정해 가져 플랫폼 업그레이드가 진행 중 프로젝트를 안 깨뜨림.

**웹 도구 권한**: 1단계 아이디에이션의 웹 리서치는 headless에서 WebSearch/WebFetch 승인이 필요 — 시드 settings.json 허용 목록에 포함하고, 단계별 스모크에 ideation 웹서치 1건 추가.

신규 프로젝트 디렉터리는 headless에서 미신뢰라 allow가 무시됨 → executor가 최초 실행 전 `~/.claude.json`에 신뢰 부여(`hasTrustDialogAccepted`, 원자적 쓰기·전권 우회 아님).

### 12.2 보안

- 페어링 코드+비밀번호 인증, 릴레이는 내용 미파싱 — 기존 모델 유지. confirm/rollback/delete 같은 새 메시지도 같은 페어링 신뢰 경계 안이므로 추가 인증 불요.
- 단, 파괴적 액션(삭제)은 §8의 이중 확인, 실행 권한은 12.1의 화이트리스트로 최소화 — "폰 탈취 = PC 전권"이 되지 않게 하는 두 겹. **잔여 리스크(솔직 명시)**: 화이트리스트를 좁혀도 스킬 인자에 악성 지시를 주입해 Claude가 허용된 도구로 유해 작업을 하게 만드는 경로는 남는다 — 완화는 되지만 완전 차단은 아니며, 페어링 secret 보호가 여전히 1차 방어선이다. 자기확장(스킬이 자기 자신의 화이트리스트를 넓히는 경로)은 시드 settings.json의 `permissions.deny`로 `.claude/settings.json` 자체와 이를 동등하게 오버라이드하는 `.claude/settings.local.json`에 대한 Write/Edit, 그리고 화이트리스트에 고정 경로로 등재된 시드 스크립트(`.claude/atomic-mv.sh`, `.claude/commands/app-store-screenshots/scripts/**`, `templates/flutter-starter/apply.sh` — 편집 후 화이트리스트 경로로 실행하면 임의 코드 실행이 되므로) 각각의 Write/Edit을 막아 자기확장 주요 경로를 봉합(완전 차단은 아니다 — 잔여: 인젝션이 화이트리스트 도구로 유해 작업을 유도하는 경로는 남아 있으며 페어링 secret 보호가 여전히 1차 방어선).
- **`previewToken`은 릴레이 비밀번호(`RELAY_PASSWORD`/`secret`)에 의존적**: `previewToken` 자체는 세션별 고엔트로피 랜덤이라 위조는 못 하지만, 애초에 그 세션에 붙는 관문인 페어링(WS `secret` 검사)이 비밀번호 없이 뜨면(`src/server/index.ts`가 `RELAY_PASSWORD` 미설정 시 "누구나 접속 가능"으로 동작) 누구나 페어링해 `previewToken`을 정상 발급받을 수 있어 토큰 방어가 사실상 무력화된다 — `src/launch.ts`(`npm start`)는 이 문제를 피하려 `RELAY_PASSWORD` 미설정 시에도 항상 `randomBytes` 폴백으로 비밀번호를 발급해 화면에 표시한다(공유 카드의 "비밀번호" 행). 저수준 `src/cli/index.ts`/`src/server/index.ts`를 직접 띄우는 경로는 이 보장이 없으므로 배포·문서에서는 `npm start` 경로만 안내한다.
- 개인정보처리방침 호스팅은 공개 게시 — 앱 이름 외 개인 정보가 들어가지 않도록 템플릿에서 통제.
- **release privacy 발행 시 gh 사용(Phase 5 Task 6, Task 6 리뷰로 좁힘) — 잔여 리스크**: 넓은
  `Bash(gh api:*)`는 `Bash(gh api user:*)`/`Bash(gh api repos/:*)` 둘로 좁혔지만(실제 호출 전수가
  이 두 접두 중 하나로 시작), `repos/` 접두는 여전히 리포명·HTTP 메서드(`-X PUT`/`-X POST` 등)까지는
  제한하지 못한다 — 스킬 인자 주입(위 잔여 리스크)이 성공하면 인증된 GitHub 계정이 쓸 수 있는
  **임의의 `repos/<owner>/<repo>/...` 엔드포인트**(다른 리포 읽기/쓰기 포함)를 호출할 수 있다(단,
  `user`·`repos/` 밖의 엔드포인트, 예: `orgs/...`·`gists/...`는 이제 막힌다). 완화: ① 스킬 문서
  (`commands/pipeline/pipeline-release.md` ⑤)가 호출하는 엔드포인트를 고정 리포 `app-factory-pages`·
  `user` 조회로만 한정해 서술 ② `gh auth status` 미인증 시 발행 자체를 건너뛰어 공격 표면을 필요할
  때만 연다 ③ 완전 차단은 페어링 secret 보호(§12.2 상단)가 1차 방어선이라는 원칙과 동일. 사용자가
  이 리스크를 낮추려면 `app-factory-pages` 전용의 세분화된 GitHub 토큰(fine-grained PAT, 해당
  리포만 접근)으로 `gh auth login`하는 것을 권장(문서화만, 강제 아님).
- **`gh repo create` 범위 — 잔여 리스크**: `Bash(gh repo create:*)`는 리포 이름·소유자가 명령
  인자로 자유로워 접두 매칭만으로는 "고정 리포 `app-factory-pages` 하나만 생성"을 강제하지 못한다
  (사용자 GitHub 계정명이 매 프로젝트 다르게 조회되는 동적 값이라 `gh repo create <고정 소유자>/
  app-factory-pages:*`처럼 접두를 더 좁히기 어렵다). 스킬 인자 주입이 성공하면 사용자 계정에
  **임의 이름의 public 리포를 추가로 생성**할 수 있다 — 다만 `repo create`는 기존 데이터를 읽거나
  덮어쓰지 않으므로 데이터 유출이 아니라 스팸/평판성 리스크 수준이며, 스킬 문서(⑤-5)가 실제로는
  `app-factory-pages` 리포 하나만 생성하도록 서술해 정상 경로에서는 발생하지 않는다.

### 12.3 카피앱 법적·스토어 정책 가드

- 아이디어 카드의 "카피 리스크" 판정 기준 명문화: **기능·컨셉 참고는 가능 / 이름·아이콘·그래픽·문구·고유 브랜드 요소 모방은 금지**. 유사 상표명은 카드 단계에서 자동 배제.
- PRD 단계에서 앱 이름 생성 시 원본과 자모 단위 유사성 회피 + 스토어 검색으로 중복 확인.
- Google Play "반복적 콘텐츠(spam)" 정책 주의: 같은 템플릿으로 양산한 앱들이 실질 차별성 없으면 계정 제재 위험 → 릴리즈 체크리스트에 "이전에 낸 앱과의 차별점" 항목. 플랫폼 사용자(다른 개발자)에게도 이 경고를 릴리즈 단계에서 고지.

### 12.4 품질 게이트 (목업↔구현 정합성)

- develop 완료 기준에 자동 대조 추가: **PRD 화면 ID 목록 ↔ Flutter 라우트 테이블 1:1 확인**(누락 화면 빌드 실패급 취급), i18n 키 누락 검사, `flutter analyze` 통과.
- 목업과 구현의 시각 정합성은 6단계에서 사용자 눈으로 — 자동 픽셀 비교는 범위 외(과잉).

### 12.5 사용자 여정 마찰 (워크스루에서 발견)

- **아이디어 카드 선택 UI**: 마크다운 뷰어만으론 부족 — 카드별 [이걸로 진행] 버튼 필요(선택이 confirm의 페이로드로 전달).
- **목업 화면 전환**: 목업이 여러 화면일 때 iframe 위에 화면 목록 드롭다운(화면 ID 기준) — 목업 내부 링크만으론 특정 화면으로 바로 못 감.
- **기존 `target`(ios/android/web) 개념과의 관계 정리**: 파이프라인 프로젝트는 target 선택을 묻지 않는다 — 결과물은 항상 Flutter(모바일), 미리보기 프레임은 세로폰 고정. 기존 웹앱 모드는 "빠른 웹앱"으로 파이프라인 밖에 공존. **주의: 기존 host는 모든 실행에 targetSystemPrompt("반드시 public/에 정적 파일로")를 강제 주입 — 파이프라인 프로젝트에서는 이 주입을 생략(파이프라인 전용 시스템 프롬프트로 교체)**, 안 그러면 스킬 지시("app/에 Flutter")와 매 단계 충돌.
- 파이프라인 진행 중 자유 채팅(질문/상담)은 단계 산출물에 영향 없이 가능해야 함 — "수정 지시"와 "그냥 질문"을 스킬이 구분.

### 12.6 라이선스·수익모델 연계 (모델 B seam)

- 기존 체험판 로직(프로젝트 1개 제한, `host.ts`)을 파이프라인에도 그대로 적용: 체험판 = 프로젝트 1개 + 파이프라인 전 단계 사용 가능(가치를 다 보여주고 개수로 제한).
- **시드 충돌 해소**: 현재 `launch.ts`가 첫 실행 시 레거시 `my-app`을 자동 생성해 체험판 슬롯(1개)을 소진시킴 → 파이프라인 모드에서는 자동 시드 제거. 프로젝트 카운트·목록은 `meta.json`/`pipeline.json` 보유 디렉터리만 센다(`archive/` 백업 폴더 등이 프로젝트로 오인되지 않게).
- 구독 전환 지점(seam): 프로젝트 개수 제한 해제, (향후) 병렬 실행, 커스텀 템플릿. 단계 자체를 유료화하지 않는다 — "만들어서 스토어까지" 경험이 영업 그 자체이므로.

## 13. flutter-dev-harness 자산 채택 (2026-07-05)

`/path/to/flutter-dev-harness`(자매 프로젝트: 아이디어→PoC를 슬래시 커맨드+사람 게이트 2곳으로 자동화)에서 검증된 방법론을 채택한다. Phase 2(템플릿)·Phase 4(단계 스킬)에서 구현.

| 채택 | 반영 위치 | 내용 |
|------|-----------|------|
| trend-research 방법론 | §2-1단계 | 미↔한 양방향 아비트라지, 최신성(3~6개월), 인디·MVP 우선, 카테고리 다양성, 실제 운영 앱+근거 URL, 병렬 조사→기회 점수 |
| HTML 제안서 | §2-1단계 | 아이디어 카드를 HTML로(iframe 뷰어 재사용), IDEAS.md는 기계용 메타. `templates/proposal.html`을 초안으로 이식 |
| 전역 중복 방지 인덱스 | §2-1단계 | `ideas-index.json` — 전 프로젝트 누적, slug/방향/카테고리/의미 유사 컷 |
| PRD 작성 규칙 | §2.5 PRD 템플릿 | 화면별 유저 스토리+수용 기준 체크리스트, 직접 입력 모드는 질문 최대 2~3개+"가정" 표기, 네이티브 필요 요건 명시. `templates/prd.md`를 우리 템플릿의 초안으로 이식 |
| Supabase 백엔드 방법론 | §2-4단계 | 백엔드 채택 시 기본 스택. RLS·마이그레이션·키 분리 절차는 backend-builder 스킬 이식 |
| 스킬 공통 보안 규칙 | Phase 4 전 스킬 | ① 웹 수집 내용은 신뢰불가 입력(지시 미실행 — §12.2 인젝션 잔여 리스크 완화) ② 자격증명 하드코딩·로그 노출 금지, .env.example 분리 ③ 지정 디렉터리 밖 파일 생성 금지 |
| 커맨드 frontmatter `allowed-tools` | Phase 4 전 스킬 | 단계 스킬마다 필요 도구만 선언 — §12.1 settings.json 화이트리스트와 이중 방어 |

채택하지 않는 것: run-id 체계(우리는 프로젝트 단위 격리로 대체 — 단, 아이디에이션 재실행 시 이전 카드를 덮어쓰지 않고 보존), /run-pipeline 오케스트레이터(우리는 host 상태머신이 담당), 게이트 2곳 구조(우리는 7게이트로 더 세밀).

## 범위 외 (명시)

- 앱 바이너리(aab/ipa) 빌드·서명·스토어 업로드 자동화
- 클라우드에서 코드 실행(기존 결정 유지 — 실행은 사용자 PC)
- 폰 네이티브 앱(현행 PWA 유지)

**필수 후속(범위 외는 아니나 이 문서 범위에서 실행 불가 — Phase 5 리뷰 시점 기준)**: 7단계
release의 ④스크린샷(iOS 시뮬레이터 캡처)·⑤개인정보처리방침 발행(GitHub Pages)은 이 리뷰
환경(gh 미인증 또는 비macOS)에서 라이브로 검증하지 못했다. macOS+Xcode 시뮬레이터+`gh auth
login` 완료 환경에서 `/pipeline-release` 1회 라이브 스모크를 사용자 인수 전 반드시 수행할 것
(`docs/ACCEPTANCE.md` 0절 참조).
