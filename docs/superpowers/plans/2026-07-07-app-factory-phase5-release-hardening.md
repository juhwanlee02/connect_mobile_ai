# 앱 팩토리 Phase 5 — 릴리즈 연결 + 인프라 하드닝 구현 계획 (최종 페이즈)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. 코드 태스크는 TDD, 스킬 문서는 대조 리뷰, 런타임 속성은 실 스모크.

**Goal:** 파이프라인을 "실사용 가능" 상태로 완성 — 릴리즈 단계의 보류 항목(스크린샷·privacy 발행) 활성화, 4개 페이즈에 걸쳐 이월된 인프라 하드닝(페어링 안정화·쿠키 인증·타임아웃) 마감, 런타임 승인 속성 실검증.

**참조:** 스펙 §2-7·§4(페어링 안정화·HTTP 인증)·§8(타임아웃·그룹킬)·§12.1(스모크·재도출): docs/superpowers/specs/2026-07-04-app-factory-pipeline-design.md. 레저 이월: 스크린샷 스크립트 경로 재도출, gh/git 재활성화, 단계별 대표 명령 승인 스모크, colorType=6 알파.

## Global Constraints

- 코드: TypeScript ESM `.js` imports, vitest TDD, 기존 테스트 불파괴(현재 162/162). 새 npm 의존성 금지
- 스킬/설정 수정 시 화이트리스트 정합 원칙 유지(명령↔규칙 단어 경계 접두, 스펙 §12.1 동기화)
- 실 claude 호출 태스크는 세션 한도 유의 — 재시도 최소화, 한도 에러 시 즉시 BLOCKED
- 커밋 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. git add 파일 명시
- **범위 외(명시)**: 웹 푸시(고정 도메인 필요 — 미보유), 바이너리 빌드·스토어 업로드, pipeline.config.json 커스터마이징(플랫폼화 후속)

---

### Task 1: 페어링 안정 세션 키 (relay+host, TDD)

**Files:** Modify `src/server/relay.ts`, `src/cli/host.ts`(필요시), `src/web/app.js`(재접속 문구) / Test `tests/server/relay.test.ts`, `tests/cli/host.test.ts`

- 스펙 §4: 현재 host 소켓 끊김 → 세션 삭제+새 코드(재출력도 안 됨). **수정**: 세션을 secret 기반으로 유지 — host 재연결 시 기존 세션 재획득(코드 불변, `code` 메시지로 같은 코드 재전달), 폰 소켓은 세션 유지 중이면 살려두고(끊겼다는 통지만) 같은 코드로 재접속 허용. 세션 TTL: host 부재 10분 초과 시에만 정리.
- 테스트: host 끊고 재연결 → 같은 코드 수신, 폰이 기존 코드로 재접속·pipeline_sync 성공(기존 1B 재연결 테스트가 "새 코드 재페어링" 전제라면 새 동작 기준으로 갱신 — assert 의미는 "재연결 후 동작 복원"으로 동일). 다중 host 세션 충돌 없음.
- 커밋: `feat(relay): stable pairing session across host reconnects`

### Task 2: HTTP 쿠키 인증 (relay, TDD)

**Files:** Modify `src/server/relay.ts`, `src/cli/pipeline-manager.ts`(또는 host — 산출물 URL에 토큰), `src/web/app.js`(뷰어/프리뷰 URL 처리) / Test `tests/server/relay.test.ts`

- 스펙 §4·§12.2: `/preview/**` HTTP 무인증 → 세션별 서명 토큰(relay가 페어링 시 생성, `paired`·host `code` 메시지에 포함) → 진입 URL `?t=<token>` 1회 검증 후 **HttpOnly 쿠키 발급**(Set-Cookie, Path=/preview), 이후 서브리소스는 쿠키로. 토큰·쿠키 없으면 403. 공개 예외 없음.
- 폰: preview/뷰어 URL 조립 시 토큰 부착(store의 URL 순수성 유지 — app.js 레이어에서 부착, 1B-4 계약 연장). host→폰으로 토큰 전달 경로: `paired` 메시지 확장.
- 테스트: 무토큰 403, 유효 토큰→200+쿠키, 쿠키만으로 서브리소스 200, 타 세션 토큰 거부.
- 커밋: `feat(relay): signed-token + cookie auth for preview serving`

### Task 3: 단계 타임아웃 (manager, TDD)

**Files:** Modify `src/cli/pipeline-manager.ts`, `src/shared/pipeline.ts`(단계별 상한 상수표) / Test `tests/cli/pipeline-manager.test.ts`

- 스펙 §8 표: ideation/prd/estimate 15분, mockup 20분, test 30분, develop 60분, release 60분. `STAGE_TIMEOUTS_MS` 상수. runStage에서 setTimeout — 초과 시 `handle.cancel()`(그룹킬) + host error("단계 시간 초과") 기록 + 타이머는 완료 시 clear·stop()에서 정리(기존 timers Set 재사용).
- 테스트: fake timer(vi.useFakeTimers)로 초과 시 cancel 호출·error 기록, 정상 완료 시 미발화, stop 정리.
- 커밋: `feat(manager): per-stage timeouts with group-kill`

### Task 4: 런타임 승인 스모크 (실 claude, 스크래치)

- §12.1 이월: 문서 대조로 증명 불가한 런타임 속성 검증. 스크래치 파이프라인 프로젝트에서 실 `claude -p` **1회**로 대표 명령 묶음 실행 지시: `cd app && flutter --version; cd ..`(복합·cd 자동허용 — app 디렉터리는 flutter create 없이 mkdir로 대체 가능? flutter --version은 디렉터리 무관 — `mkdir -p app` 후), `.claude/atomic-mv.sh` 왕복, `../ideas-index.json.tmp` Write(cwd 밖 Write 승인 여부 — **핵심 미지수**), mkdir 리터럴, render-icon.mjs(Chromium). 프롬프트는 "다음 명령들을 순서대로 실행하고 각 결과를 보고하라" 형식.
- 실패 항목 발견 시: 원인 분석 → 스킬 문서/설정 수정(예: ideas-index Write가 거부되면 계약을 "프로젝트 내 tmp 작성 후 atomic-mv로 ../ 이동"으로 변경 — atomic-mv.sh는 이미 ../ideas-index.json 허용) → 재스모크.
- 커밋(수정 발생 시): `fix(skills): runtime approval smoke findings`
- 리포트에 항목별 승인/거부 표 필수.

### Task 5: release 스킬 활성화 — 스크린샷 연결 + 경로 재도출

**Files:** Modify `commands/pipeline/pipeline-release.md`, `templates/flutter-starter/overlay/.claude/settings.json`, 스펙 §12.1

- "보류" 중 스크린샷 란 활성화: macOS+시뮬레이터 가용 시 `.claude/commands/app-store-screenshots/SKILL.md` 절차 수행(매니페스트는 PRD §4 스샷 열+RELEASE §6 슬라이드 번호 기준, 출력을 `release/screenshots/`로), 불가 환경(비macOS·시뮬레이터 없음)이면 기존 "보류+사유" 유지. 정리 규칙(시뮬레이터 종료·시드 원복) 포함.
- 화이트리스트 재도출: `Bash(bash .claude/commands/app-store-screenshots/scripts/ios-boot.sh:*)` 등 실경로 4종 + `Bash(idb ui:*)` + 스크린샷 스킬이 요구하는 나머지(xcrun simctl은 기존) — settings.json+스펙 동기화. compose.mjs 실행 경로도 실경로로.
- 커밋: `feat(skills): activate screenshot capture in release stage`

### Task 6: privacy GitHub Pages 발행 활성화

**Files:** Modify `commands/pipeline/pipeline-release.md`, settings.json(+스펙): `Bash(gh:*)` 재추가(근거: 이 단계에서만 사용, §12.2 잔여 리스크 기재), 필요시 `Bash(git:*)` 서브커맨드

- 절차: ① `gh auth status` 확인(미인증 → 해당 란 "보류: gh 로그인 필요" + 사용자 안내) ② 방침 HTML 생성(RELEASE.md §4 내용 기반, 개인 정보 미포함 통제) ③ 발행 대상: 사용자 GitHub의 `app-factory-pages` 리포(없으면 `gh repo create` — public, Pages 활성화) `docs/<project>/privacy.html` 커밋·푸시 ④ 발행 URL을 RELEASE.md §4에 기록. 실패 시 각 단계 보류+사유(정직 처리).
- 커밋: `feat(skills): activate privacy policy publishing via GitHub Pages`

### Task 7: 파이널 검증 — develop 라이브 스모크 + 사용자 인수 가이드

- 스크래치 프로젝트에 PRD·목업·ESTIMATE fixture(로컬 앱·화면 2개짜리 초미니)를 심고 실 `claude -p "/pipeline-develop 피드백: 구현 시작"` **1회** — flutter create+apply+화면 구현+게이트까지 완주하는지(최대 30분 타임아웃). 검증: pipeline.json 전이·app/ 존재·analyze 게이트 로그·appRoutes 대조 수행 흔적.
- `docs/ACCEPTANCE.md` 작성: 사용자가 폰으로 풀사이클(ideation→release)을 직접 돌려보는 체크리스트(단계별 기대 화면·컨펌 포인트·문제 시 재시도/롤백 방법) — 최종 인수는 사용자 실기기 몫.
- 커밋: `test: develop live smoke + user acceptance guide`

---

완료 후 whole-branch 리뷰 → main 머지. 이후: 사용자 실기기 인수 테스트(ACCEPTANCE.md), 패키징 문서 갱신(SETUP-customer.md — Flutter SDK 전제 등)은 인수 결과 반영 후.
