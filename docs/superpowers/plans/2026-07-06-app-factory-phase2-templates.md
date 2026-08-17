# 앱 팩토리 Phase 2 — 산출물 템플릿 5종 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 콘텐츠 태스크이므로 TDD 대신 각 태스크의 "스펙 대조 체크리스트"가 검증 기준이다.

**Goal:** 파이프라인 단계 스킬(Phase 4)이 소비할 표준 템플릿 5종(`templates/`)을 스펙 §2.5·§13 계약대로 작성한다. flutter-dev-harness의 검증된 템플릿(proposal.html, prd.md)을 이식·개조한다.

**Architecture:** 템플릿은 순수 마크다운/HTML 문서 — 코드 없음. 각 템플릿 상단에 "이 템플릿을 채우는 스킬을 위한 규칙" 주석 블록을 포함(섹션 추가·삭제 금지, 빈 섹션은 "해당 없음", 원자적 쓰기 규약 등). 검증 = 리뷰어가 스펙 §2.5 표·§13 채택표·확정 예시와 1:1 대조.

**참조(각 태스크가 반드시 읽을 것):**
- 스펙 §2 단계별 상세, §2.5 템플릿 표, §12.3 카피 정책, §13 채택표: `docs/superpowers/specs/2026-07-04-app-factory-pipeline-design.md`
- PRD 확정 예시: `docs/superpowers/specs/assets/prd-template-detail.html`
- 하네스 원본: `/path/to/flutter-dev-harness/templates/proposal.html`, `.../templates/prd.md`, `.../templates/candidates.schema.json`, `.../.claude/skills/trend-research/SKILL.md`

## Global Constraints

- 위치: `templates/` (리포 루트). 파일명: `IDEAS.template.md`, `proposal.template.html`, `PRD.template.md`, `ESTIMATE.template.md`, `COST-GUARDRAILS.md`, `RELEASE.template.md`, `ideas-index.schema.json`
- 언어: 한국어(스토어 텍스트 템플릿 내 영어 예시는 허용). 플레이스홀더는 `{{이런_형식}}`
- 각 템플릿 상단에 HTML 주석으로 스킬 규칙 블록: 섹션 고정·"해당 없음" 규칙·화면 ID kebab-case·완료 시 pipeline.json artifacts 등록 키 이름
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: 아이디에이션 템플릿 (IDEAS + proposal.html + ideas-index)

**Files:** Create `templates/IDEAS.template.md`, `templates/proposal.template.html`, `templates/ideas-index.schema.json`

- `IDEAS.template.md`(기계용 메타): 실행 회차 정보(날짜·방향별 후보 수), 카드 목록 표 — slug(kebab) / 한 줄 컨셉 / 시장방향(US→KR|KR→US) / 카테고리 / opportunity_score / 원본앱+근거 URL(날짜 포함) / 개발 난이도(scope) / 카피 리스크 판정(§12.3: 기능 참고 가능·이름/아이콘/그래픽 모방 금지 명문) / HTML 카드 경로(`ideas/NN-<slug>.html`)
- `proposal.template.html`: 하네스 proposal.html을 이식하되 개조 — ① 폰 iframe 뷰어(세로) 기준 반응형 ② [이걸로 진행] 선택 안내 블록("채팅에 `<slug> 선택`이라 보내세요") ③ 카피 리스크·차별화(현지화) 섹션 필수 ④ 근거 링크 목록
- `ideas-index.schema.json`: 전역 중복 방지 인덱스(projects/ 상위 `ideas-index.json`) 스키마 — 항목: slug, 방향, 카테고리, one_liner, 제안일, 채택 여부(프로젝트명). 중복 컷 규칙 주석 포함(slug/방향+카테고리 완전일치, 의미 유사)
- **체크리스트**: 스펙 §2-1단계의 리서치 방법론 6원칙(양방향/최신성 3~6개월/인디·MVP/카테고리 다양성/실운영+근거/기회점수)이 템플릿 지시문에 전부 등장하는가. 커밋: `feat(templates): ideation card + proposal html + dedup index schema`

### Task 2: PRD 템플릿

**Files:** Create `templates/PRD.template.md`

- 확정 예시(prd-template-detail.html)의 §1~§8 구조 그대로: 문제정의 / 타겟(페르소나) / MoSCoW 기능표(WON'T엔 이유 필수) / 화면 목록 표(ID kebab·목적·구성요소·라우트/딥링크·목업 파일·스샷 슬라이드 + **화면별 유저 스토리·수용 기준 체크리스트**) / 데이터 모델 / 수익화(광고 ID 교체·심사 설문 예고) / 성공 지표 / 앱 메타(applicationId com.example 금지·표시명 원본 유사성 회피·지원 기기·백엔드 결정트리 결과)
- §13 채택분 반영: **가정 섹션**(직접 입력 모드에서 질문 최대 2~3개, 나머지 기본값을 "가정"으로 표기), **네이티브 필요 요건 섹션**(Flutter로 어려운 부분+근거), 하네스 prd.md의 좋은 구조(수용 기준 체크박스 형식) 병합
- **체크리스트**: 확정 예시의 모든 섹션·소비처 배지 관계가 템플릿 규칙 주석에 반영됐는가. estimate 조정 시 diff 재승인 규칙 언급. 커밋: `feat(templates): PRD template with acceptance criteria and assumptions`

### Task 3: 산정 + 비용 가드레일 템플릿

**Files:** Create `templates/ESTIMATE.template.md`, `templates/COST-GUARDRAILS.md`

- ESTIMATE: 백엔드 결정 트리(①로컬 ②정적/번들 ③백엔드 — 기본 Supabase, Firebase는 대안·§13) 결과 기록란 / 기능→서비스 매핑 표 / **비용 리스크 표**(사용자 행동 단위 과금 분석: 행동×빈도×DAU=일일 호출, 무료 티어 대비, 완화책, 완화 후 예상) / 무료 티어·1천·1만 MAU 월 비용 시나리오 / 개발 범위 요약 / PRD diff 요약(재승인 게이트용)
- COST-GUARDRAILS: 스펙 §2-5단계의 체크리스트 6항목(오프라인 persistence, 리스너 범위+해제+limit, 집계 문서, 캐시+TTL, 이미지 리사이즈, 정적 번들)을 체크박스 형식으로 + Supabase 대응 항목(RLS로 불필요 쿼리 차단, select 컬럼 최소화, realtime 구독 범위) + "개발 완료 시 스킬이 항목별 준수 여부를 pipeline.json에 기록" 규칙
- **체크리스트**: 스펙 §2-4·§2-5의 모든 항목 포함 여부. 커밋: `feat(templates): estimate + cost guardrails templates`

### Task 4: 릴리즈 템플릿

**Files:** Create `templates/RELEASE.template.md`

- **스토어 콘솔 입력란 1:1 순서**(복붙 동선): Play — 앱 이름(30)/짧은 설명(80)/전체 설명(4000)/카테고리·태그/스크린샷 목록/피처 그래픽/512 아이콘 | App Store — 이름(30)/부제(30)/설명(4000)/키워드(100)/카테고리/스크린샷/1024 아이콘. 글자수 제한을 각 란에 명기
- 심사 설문 답변 가이드: Play 데이터 안전(광고 ID 수집 여부 — 광고 스킬 채택 시 자동 "예")·콘텐츠 등급, App Store 개인정보 라벨 — 앱 구성(광고/로그인/백엔드 유무)별 권장 답변 표
- 개인정보처리방침: 생성 규칙 + **GitHub Pages 발행 URL 기록란**(터널 URL 금지 명시), 릴리즈노트, **체크리스트**: 테스트 AdMob ID→실제 ID 교체, 로그인 시 계정삭제 기능 확인, 이전 출시 앱과의 차별점(§12.3 반복 콘텐츠), 아이콘 파일 존재(512/1024)
- **체크리스트**: 스펙 §2-7단계·§2.5 RELEASE 행·app_release_info 스킬(commands/skills/app_release_info/SKILL.md)의 글자수 규칙과 모순 없는가. 커밋: `feat(templates): release listing template with store-console field order`

---

각 태스크: 구현자가 참조 문서를 읽고 작성 → 리뷰어가 체크리스트 기준 스펙 대조 → 승인 시 다음. 마지막에 whole-branch 리뷰(스펙 §2.5 표와 templates/ 디렉터리 최종 대조) 후 main 머지.
