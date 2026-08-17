<!--
이 템플릿을 채우는 스킬(Phase 4 `/pipeline-prd`)을 위한 규칙

- 섹션 고정: 아래 "메타" 전문(前文) + §1~§8(문제 정의 / 타겟 사용자 / 기능 목록·MoSCoW /
  화면 목록 / 데이터 모델 / 수익화 계획 / 성공 지표 / 앱 메타) + §9 가정 + §10 네이티브 필요 요건,
  총 11개 블록의 제목·순서를 추가·삭제하지 않는다. 해당 내용이 없어도 섹션 자체를 지우지 말고
  "해당 없음"이라고 명시적으로 적는다(예: 백엔드 미채택이면 §10에 "해당 없음 — 전체 기능이
  Flutter 표준 플러그인으로 구현 가능"처럼 이유까지 적을 것).
- 각 섹션 제목 옆의 "*(소비: ...)*"는 이 내용을 파이프라인의 어느 단계가 읽어 쓰는지 알려주는
  고정 주석이다. 실제로 소비하는 단계 이름이 아니라 이 문구 자체를 그대로 둔다 — 스킬이 지울 항목이
  아니라 다음 단계 스킬과 리뷰어를 위한 안내문이다.
- §4 화면 목록의 화면 ID는 소문자 kebab-case, 영문 시작(`home`, `stats-detail`). 이 ID는
  `mockup/<화면ID>.html` → Flutter 라우트 → 7단계 스크린샷 매니페스트까지 그대로 이어지는 관통 키다.
  Dart 산출물(파일명·클래스명·패키지명)은 kebab→snake 기계 변환(하이픈→언더스코어, 클래스는
  PascalCase)을 거치되, 라우트 경로 자체와 이 표의 ID 표기는 kebab을 유지한다. 개발 완료 게이트는
  "이 표 ↔ 실제 라우트 테이블 1:1"을 이 변환 이후 값으로 대조한다.
- §3 기능 목록의 WON'T 행에는 반드시 "왜 안 하는지" 이유를 적는다(빈칸·"—"만 적는 것 금지).
- §8 앱 메타의 applicationId/bundleId는 `com.example.*` 금지 — 프로젝트명 기반으로 여기서 확정하며
  이후 임의 변경 불가급으로 취급한다. 표시 이름은 벤치마크 원본 앱과 자모 단위 유사성이 없는지
  확인한 뒤 채운다(§12.3 카피 정책).
- 메타의 "구현 대상 디렉토리"는 아이디어 slug가 아니라 **현재 프로젝트 디렉터리명**(=
  `pipeline.json`의 `project` 값)을 적는다 — 이 문서 하단의 `projects/{{slug}}/` 표기는 리터럴
  경로가 아니라 그 자리에 현재 프로젝트 디렉터리명을 채우라는 자리표시자다.
- §9 가정: 입력 모드 B(아이디어 직접 입력)에서 스킬이 사용자에게 되묻는 질문은 **최대 2~3개**로
  제한한다. 그 이상의 세부값은 스킬이 합리적 기본값으로 채우고 반드시 이 섹션에 "가정"으로 명시한다
  (질문 폭주로 사용자 피로를 유발하지 않기 위함). 입력 모드 A(제안서 기반)에서는 원본 제안서에
  이미 있는 값이므로 이 섹션이 비어도 되지만, 그 경우에도 "해당 없음(모드 A, 질문 없음)"이라고 적는다.
- estimate(4단계) 재조정 규칙: 4단계에서 기능이 가감되면 이 문서의 §3·§4가 자동 갱신되고,
  estimate 컨펌 카드에 이번 조정으로 바뀐 **PRD diff 요약**이 표시되어 사용자가 재승인해야 한다
  (무통지 변경 금지 — estimate 컨펌 = 갱신된 PRD 재승인으로 정의). 이 문서를 갱신하는 스킬은
  diff를 남길 것.
- 완료 시 pipeline.json 등록: 이 파일의 프로젝트 내 상대 경로(`docs/PRD.md`)를 `artifacts.prd` 키로
  기록한다.
- 원자적 쓰기: 임시 파일에 쓴 뒤 rename으로 교체한다. 쓰는 도중의 부분 파일 상태를 그대로 남기지 않는다.
-->

# PRD — {{app_title}}

> 2단계 산출물(`docs/PRD.md`). 이 문서만으로 3단계(목업)·4단계(산정)·5단계(개발)가 판단할 수 있을
> 만큼 구체적으로 쓴다. 폰에서는 요약 카드 → [전문 보기]로 이 문서 전체를 마크다운 뷰어로 읽고,
> 채팅 피드백으로 몇 번이든 고친 뒤 컨펌하면 3단계가 열린다.

## 메타

- **slug**: {{slug}}
- **버전**: {{version}} <!-- 예: v1.0. 피드백 반영마다 올리지 않아도 되며, 컨펌 시점 버전만 갱신 -->
- **상태**: {{status}} <!-- 초안 | 피드백 반영 중 | 컨펌 대기 | 컨펌됨 -->
- **입력 모드**: {{mode}} <!-- A: 아이디어 카드 기반(IDEAS.md 카드 #{{idea_card_no}}, zero-padded 2자리(NN) 형식, 원본: {{benchmark_app}}) | B: 사용자 직접 입력 -->
- **입력 출처**: {{source}} <!-- 모드 A = ideas/{{idea_card_no}}-{{slug}}.html 경로 / 모드 B = 사용자가 채팅으로 준 원문 요약 -->
- **구현 대상 디렉토리**: `projects/{{project_dir}}/` <!-- 아이디어 slug가 아니라 현재 프로젝트
  디렉터리명(= pipeline.json의 project 값) -->

## §1 문제 정의 *(소비: 전 단계의 판단 기준)*

{{problem_statement}}

<!-- 템플릿 규칙 — 3~5문장. "무엇을 안 만들 것인가"가 드러나야 한다. 여기 적힌 원칙이 이후 모든
     기능 논쟁(§3 MoSCoW 판정, 4단계 산정에서의 기능 가감)의 심판 역할을 한다. -->

## §2 타겟 사용자 *(소비: 릴리즈(스토어 문구 톤))*

<!-- 입력 출처: IDEAS.md 표의 타겟 열(한 줄 요약) + 짝 HTML 카드의 target_persona(상세)를 이어받아
     확장한다. -->

- **주 타겟 — "{{primary_persona_name}}" ({{primary_persona_age_range}})**: {{primary_persona_desc}}
- **부 타겟 — "{{secondary_persona_name}}"**: {{secondary_persona_desc}} <!-- 없으면 "해당 없음" -->

## §3 기능 목록 — MoSCoW *(소비: 산정(4단계) · 개발(5단계))*

| 우선순위 | 기능 | 설명 | 관련 화면 |
|---|---|---|---|
| MUST | {{must_feature_1}} | {{must_feature_1_desc}} | `{{must_feature_1_screens}}` |
| MUST | {{must_feature_n}} | {{must_feature_n_desc}} | `{{must_feature_n_screens}}` |
| SHOULD | {{should_feature_1}} | {{should_feature_1_desc}} | `{{should_feature_1_screens}}` |
| COULD | {{could_feature_1}} | {{could_feature_1_desc}} | `{{could_feature_1_screens}}` |
| WON'T v1 | {{wont_feature_1}} | {{wont_feature_1_reason}} <!-- 이유 필수. §1 원칙 또는 비용/범위 근거를 명시 --> | — |

<!-- 템플릿 규칙 — WON'T에는 반드시 "왜 안 하는지"를 적는다. 4단계 산정에서 기능을 가감하면 이 표가
     갱신되고 컨펌 카드에 diff가 표시된다(재승인 게이트, 위 규칙 블록 참조). -->

## §4 화면 목록 *(소비: 목업(3단계) · 개발 라우트(5단계) · 스크린샷(7단계))*

| 화면 ID | 목적 | 핵심 구성요소 | 라우트/딥링크 | 목업 파일 | 스토어 스샷 |
|---|---|---|---|---|---|
| `{{screen_id_1}}` | {{screen_1_purpose}} | {{screen_1_components}} | `{{screen_1_route}}` | `mockup/{{screen_id_1}}.html` | {{screen_1_shot_slide}} |
| `{{screen_id_n}}` | {{screen_n_purpose}} | {{screen_n_components}} | `{{screen_n_route}}` | `mockup/{{screen_id_n}}.html` | {{screen_n_shot_slide}} |

<!-- 이 표가 파이프라인의 등뼈다 — ID는 kebab-case 고정(Dart 파일·클래스는 위 규칙대로 기계 변환).
     라우트는 6단계 미리보기·7단계 스크린샷 캡처의 딥링크로 쓰이고, 개발 완료 게이트는 "이 표 ↔
     실제 라우트 테이블 1:1"을 자동 대조한다. 스토어 스샷 열은 7단계 매니페스트의 초안이다(스크린샷이
     필요 없는 화면은 "—"). -->

### 화면별 유저 스토리 · 수용 기준

<!-- 화면마다 반복. §4 표의 화면 ID와 1:1 대응해야 한다. -->

#### `{{screen_id_1}}` — {{screen_1_name}}

- **유저 스토리**: {{screen_1_as_a}}로서 {{screen_1_i_want}} 하고 싶다, 그래서 {{screen_1_so_that}}.
- **수용 기준**:
  - [ ] {{screen_1_criteria_1}}
  - [ ] {{screen_1_criteria_2}}
  - [ ] {{screen_1_criteria_3}}

#### `{{screen_id_n}}` — {{screen_n_name}}

- **유저 스토리**: {{screen_n_as_a}}로서 {{screen_n_i_want}} 하고 싶다, 그래서 {{screen_n_so_that}}.
- **수용 기준**:
  - [ ] {{screen_n_criteria_1}}
  - [ ] {{screen_n_criteria_2}}

## §5 데이터 모델 *(소비: 개발(5단계))*

| 엔티티 | 필드 | 저장 |
|---|---|---|
| `{{entity_1}}` | {{entity_1_fields}} | {{entity_1_storage}} <!-- 예: SharedPreferences(JSON 직렬화), 서버·DB 없음 / Supabase 테이블명 --> |
| `{{entity_n}}` | {{entity_n_fields}} | {{entity_n_storage}} |

<!-- 템플릿 규칙 — "파생값은 저장하지 않는다"처럼 구현 방침까지 적으면 개발 단계 스킬의 재량 폭이
     줄어 산출물이 안정된다. 백엔드 채택 시 구체적인 API 계약·인증·RLS 설계는 이 표를 입력으로
     4단계 ESTIMATE.md에서 상세화한다(스펙 §2-4단계) — 여기서는 엔티티·필드·저장 위치까지만 확정한다. -->

## §6 수익화 계획 *(소비: 산정(4단계) · 릴리즈(7단계 심사 설문))*

- {{monetization_item_1}} <!-- 예: 전면광고 — 앱 시작 스플래시 1회 (스킬: interstitial-splash-ad) -->
- {{monetization_item_2}} <!-- 예: 보상형 광고 — {{reward_unlock_target}} 잠금해제 (스킬: reward-ads) -->
- 구독·인앱결제: {{subscription_plan}} <!-- 없으면 "해당 없음(v1)" -->
- **릴리즈 전 체크(예고)**: 테스트 광고 ID → 실제 AdMob 유닛 ID 교체 필수. 광고 스킬 채택 시 Play
  데이터 안전 설문에 "광고 ID 수집" 자동 신고 예정(7단계 RELEASE.template.md에서 확정).

## §7 성공 지표 *(소비: 출시 후 v2 사이클 판단)*

- {{success_metric_1}} <!-- 예: D7 리텐션 ≥ 15% -->
- {{success_metric_2}} <!-- 예: 설치→핵심 액션 전환 ≥ 60% -->
- {{success_metric_3}} <!-- 예: 1만 MAU 기준 월 수익 추정(4단계 산정에서 검증) -->

## §8 앱 메타 (스토어 제출용) *(소비: 개발(5단계 설정) · 릴리즈(7단계 리스팅))*

| 항목 | 값 |
|---|---|
| applicationId / bundleId | `{{application_id}}` <!-- com.example 금지 — 여기서 확정, 이후 변경 불가급 --> |
| 표시 이름 | ko "{{display_name_ko}}" · en "{{display_name_en}}" — 원본 벤치마크 앱({{benchmark_app}})과 자모 유사성 없음 확인 + Play/App Store 검색으로 동일·유사 이름 존재 여부 확인 후 기록 |
| 지원 기기 | {{supported_devices}} <!-- 예: iPhone 전용(iPad 미지원 → iPad 스크린샷 생략) · Android phone --> |
| 백엔드 결정 트리 결과 | {{backend_decision}} <!-- ①로컬로 충분 → 백엔드 없음 / ②정적 번들·호스팅 / ③백엔드 채택(Supabase 기본) — 근거: {{backend_reason}} -->

## §9 가정 *(소비: 다음 피드백 라운드·리뷰의 근거)*

<!-- 입력 모드 B(직접 입력)에서 스킬이 사용자에게 되물은 질문은 최대 2~3개로 제한한다. 그 답변과,
     되묻지 않고 기본값으로 채운 나머지 항목을 아래에 "가정"으로 남긴다. -->

- **사용자에게 확인한 질문(최대 2~3개)**:
  1. {{clarifying_question_1}} → 답변: {{clarifying_answer_1}}
  2. {{clarifying_question_2}} → 답변: {{clarifying_answer_2}}

| 가정한 항목 | 가정값 | 근거/기본값 출처 |
|---|---|---|
| {{assumption_item_1}} | {{assumption_value_1}} | {{assumption_rationale_1}} |
| {{assumption_item_n}} | {{assumption_value_n}} | {{assumption_rationale_n}} |

<!-- 모드 A(제안서 기반)이거나 가정이 전혀 없으면: "해당 없음(모드 A, 질문 없음)" 한 줄만 남기고
     위 표는 행을 비운 채 유지한다(표 헤더 삭제 금지). -->

## §10 네이티브 필요 요건 *(소비: 산정(4단계) · 개발(5단계 기술 스택 결정))*

<!-- 템플릿 규칙 — "Flutter로 어려운 이유" 칸은 필수. 빈칸·"—"만 적는 것 금지. 근거 없는 네이티브 요건은 Flutter로 구현한다. -->

| 요건 | Flutter로 어려운 이유 | 대안/결정 |
|---|---|---|
| {{native_requirement_1}} | {{native_requirement_1_reason}} | {{native_requirement_1_resolution}} <!-- 예: 플러그인 채택 / 네이티브 채널 / v1 범위 제외 --> |

<!-- 해당 요건이 전혀 없으면 표 대신 다음 한 줄로 대체: "해당 없음 — 전체 기능이 Flutter 표준
     플러그인으로 구현 가능(근거: {{native_none_reason}})". 표와 이 문장을 동시에 두지 않는다. -->

---

이 문서는 `templates/PRD.template.md`의 고정 블록(메타 + §1~§10)을 채운 결과물이다. 스킬은 섹션을
추가·삭제할 수 없고(해당 없으면 "해당 없음"을 이유와 함께 명시), 컨펌 시 필수 섹션 존재가 자동
검증되어 `pipeline.json`에 기록된다. 4단계에서 기능이 가감되면 §3·§4가 갱신되고 컨펌 카드에 diff로
표시되며, 이는 갱신된 PRD에 대한 사용자 재승인을 의미한다.
