---
description: 파이프라인 3단계 — 비즈니스 모델(수익화·백엔드)을 폰 설문 폼으로 확정. 첫 실행은 앱에 맞춘 설문 스키마(business/form.json)를 만들고 폼 대기(awaiting_feedback), 사용자가 폰에서 제출하면 business/answers.json을 읽어 BUSINESS.md(§1 수익화·§2 백엔드·§3 0원 게이트·§4 나중에 연동 TODO)로 확정. 서버·결제가 필요한 선택도 막지 않고 "나중에 연동"으로 남긴다. artifacts.business 등록.
allowed-tools: Read, Write, Edit, Bash
---

# /pipeline-business — 3단계: 비즈니스 모델 (설문 폼)

이 단계의 목적은 **수익화 방식과 데이터/백엔드 필요 여부를 개발 전에 확정**하는 것이다. 결과는
PRD §6(수익화)·산정 §1(백엔드)로 그대로 흐른다. 상호작용은 **폰의 설문 폼**으로 한다 — 스킬이
앱에 맞춘 폼 스키마를 만들고(1차 실행), 사용자가 폰에서 골라 제출하면 그 답으로 결정을 확정한다.

## 공통 계약 (요약 — 정본은 `.claude/commands/_CONTRACT.md`, 충돌 시 정본 우선)

1. 시작: `pipeline.json` 읽기 → `stage`가 `"business"`인지 확인(아니면 쓰지 말고 보고 후 종료) →
   `stageStatus: "running"` 기록. 쓰는 필드는 `stage`/`stageStatus`/`artifacts`만, 나머지는 보존,
   항상 ① Write 도구로 `<대상>.tmp` 작성 ② `bash .claude/atomic-mv.sh <대상>.tmp <대상>`으로
   교체(원자적). `stage` 값은 바꾸지 않는다.
2. 산출물 = `business/form.json`(설문 스키마) + `BUSINESS.md`(`templates/BUSINESS.template.md`의
   메타 + §1~§4 구조 그대로 — 추가·삭제 금지, 해당 없으면 "해당 없음"+이유). 완료 시 `artifacts`에
   등록(`businessForm`·`business`).
3. 종료 시 `stageStatus`는 `"awaiting_confirm"` 또는 `"awaiting_feedback"` — **`running`인 채 종료
   금지**(그대로 종료하면 host가 `error`로 강등해 사용자에게 실패로 보인다).
4. `피드백:` 접두 호출 처리는 아래 "실행 모드 판정" 참조. "그냥 질문"이면 순변경 없이 답만 하고
   실행 전 상태를 복원한다.
5. 이 단계는 PRD 확정 전이므로 수익화·백엔드 결정 자체가 범위 **안**이다. "지금 바로 개발해줘"처럼
   이후 단계 일은 계약 5항대로 안내만 한다.
6. 보안: 웹 도구 안 씀 · 자격증명 하드코딩/노출 금지 · 프로젝트 디렉터리 밖 파일 생성 금지
   (`business/`는 프로젝트 안이다).

`artifacts`에는 이 단계 소유 키 **`businessForm`·`business`만** 추가·갱신하고 기존 키(`ideas`/
`wireframe` 등)는 전부 보존한다.

## 실행 모드 판정

호출 텍스트를 보고 판정한다:

- **폼 제출 모드**: 텍스트에 "설문 폼을 제출했습니다"가 있다(host가 `form_submit`을 받아
  `business/answers.json`을 쓴 뒤 이 문구로 재호출한다). → 아래 **[B] 확정**으로 간다.
- **폼 재구성 요청**: 사용자가 설문 항목·선택지를 바꿔 달라고 한다(예: "구독 옵션 빼줘"). → **[A]
  폼 생성**을 요청대로 다시 수행한다.
- **그 외 첫 실행**(`/pipeline-business` 또는 일반 진입): → **[A] 폼 생성**.
- **그냥 질문**: 채팅으로 답만 하고 산출물·상태는 순변경 없이 복원한다.

## [A] 폼 생성 (설문 스키마 만들고 폼 대기)

1. **입력 읽기**: `IDEAS.md`의 대상 카드(선택 표기 또는 최신 1장)와 짝 HTML
   (`ideas/<NN>-<slug>.html` — 수익모델의 정본), 그리고 `wireframe/index.html`(있으면 화면 구성
   참고). 카드가 없으면 산출물을 만들지 말고 "아이디어가 아직 없습니다 — 앞 단계를 먼저
   컨펌해주세요"라고 보고한 뒤 `awaiting_feedback`로 종료한다.
2. **폼 스키마 작성**: `business/form.json`을 아래 형태로 만든다 — **두 질문(수익화·백엔드)은
   항상 포함**하되, `default`는 앱 성격에 맞게 정한다(카드 수익모델이 광고면 `banner`, 로컬 완결형
   앱이면 `local` 등). 앱이 본질적으로 서버가 필요해 보여도 옵션은 그대로 두고 default만 조정한다
   (판단은 사용자 몫). 선택지 문구는 아래를 기본으로 하되 앱 맥락에 맞게 다듬어도 되나 `value`는
   고정한다(확정 로직이 이 값에 의존한다):

   ```json
   {
     "title": "비즈니스 모델",
     "questions": [
       { "id": "monetization", "label": "수익화 방식", "default": "banner", "options": [
         { "value": "banner", "label": "배너 광고" },
         { "value": "interstitial", "label": "전면·보상형 광고" },
         { "value": "free", "label": "완전 무료" },
         { "value": "subscription", "label": "구독·인앱결제", "warn": "서버비" }
       ] },
       { "id": "backend", "label": "데이터 · 백엔드", "default": "local", "options": [
         { "value": "local", "label": "기기 안 로컬 저장" },
         { "value": "static", "label": "앱 번들 정적 데이터" },
         { "value": "server", "label": "서버 동기화(Firebase 등)", "warn": "서버비" }
       ] }
     ]
   }
   ```

   원자적 쓰기: `mkdir -p business` 후 Write로 `business/form.json.tmp` 작성 →
   `bash .claude/atomic-mv.sh business/form.json.tmp business/form.json`.
3. **상태 기록**: `pipeline.json`에 `artifacts.businessForm = "business/form.json"`(기존 키 보존),
   `stageStatus: "awaiting_feedback"`. **`awaiting_feedback`을 쓰기 전에 반드시 `businessForm`을
   먼저 등록**한다(폰이 이 키를 보고 폼을 불러온다).
4. **채팅 보고**: "폰에서 비즈니스 모델 설문을 골라 제출해 주세요 — 수익화 방식과 데이터 저장
   방식을 정합니다. ⚠️ 표시(구독·서버)는 서버비가 드는 선택이고, 골라도 막지 않고 나중에 연동으로
   남깁니다."라고 안내한다.

## [B] 확정 (제출값 → BUSINESS.md)

1. **답 읽기**: `business/answers.json`을 읽는다(예: `{"monetization":"banner","backend":"local"}`).
   파일이 없거나 값이 스키마의 `value` 목록 밖이면, 만들지 말고 "제출 값을 못 읽었어요 — 폼을 다시
   제출해 주세요"라고 보고한 뒤 `awaiting_feedback`로 종료한다.
2. **결정 도출**:
   - `monetization`: `banner`/`interstitial` → **광고 채택**(개발 단계에서 AdMob 테스트 ID로 배선,
     릴리즈 전 실 ID 교체). `free` → 수익화 없음. `subscription` → **구독·인앱결제 채택**(결제·권한
     서버 필요 → 0원 게이트 유보 + §4 TODO).
   - `backend`: `local` → 백엔드 없음. `static` → 정적 번들. `server` → **백엔드 필요**(기본 스택
     Supabase, 특정 실시간 요건이면 Firebase — 근거 명시. 0원 게이트 유보 + §4 TODO).
   - **0원 게이트(§3)**: `subscription` 또는 `server`가 하나라도 있으면 "유보"(서버비/결제 인프라
     필요), 아니면 "통과". **유보여도 단계를 막지 않는다** — §4에 나중에 연동할 항목을 남긴다.
3. **BUSINESS.md 작성**: `templates/BUSINESS.template.md`를 Read로 읽고 메타 + §1~§4 블록을 그대로
   채운다. §1 수익화·§2 백엔드는 2의 결정과 1:1 일치, §3은 게이트 결과, §4는 유보 선택이 있으면
   개발 단계가 스텁으로 둘 항목을 구체적으로(전부 0원이면 "해당 없음 — 지금 구성으로 완결"). 원자적
   쓰기: Write `BUSINESS.md.tmp` → `bash .claude/atomic-mv.sh BUSINESS.md.tmp BUSINESS.md`.
4. **상태 기록**: `pipeline.json`에 `artifacts.business = "BUSINESS.md"`(기존 키 보존),
   `stageStatus: "awaiting_confirm"`.
5. **채팅 보고**(비개발자 눈높이): 수익화 방식 한 줄, 백엔드 판정 한 줄, 0원 게이트 결과(유보면
   나중에 연동할 항목 요약), 그리고 "컨펌하면 이 결정을 반영해 PRD를 씁니다 — PRD의 수익화 계획과
   산정의 백엔드 판정이 이 값을 그대로 받습니다"라는 다음 행동 안내.

## 피드백 처리 (`/pipeline-business 피드백: <텍스트>`)

- **폼 제출**("설문 폼을 제출했습니다"): [B] 확정을 수행한다.
- **결정 수정 요청**(제출 후 "구독 말고 광고로 바꿔줘" 등): `business/answers.json`의 해당 값을
  요청대로 고쳐 다시 쓰고(원자적) [B]를 재수행 → `awaiting_confirm`. 또는 폼 항목 자체를 바꿔
  달라는 요청이면 [A]로 폼을 재구성한다.
- **그냥 질문**: 채팅으로 답만 하고 산출물·상태는 순변경 없이 실행 전 상태를 복원한다.
- **단계 범위 밖**(예: "개발 시작해줘"): 계약 5항대로 안내만 한다.
