---
description: 개발 전 앱 구조 와이어프레임 후보 5개를 제안하고, 사용자가 고른 구조를 카테고리별 UI 취향으로 공용 기억에 누적한다.
allowed-tools: Read, Write, Bash
---

# /pipeline-wireframe — 구조 후보 (개발 프로젝트용)

이 단계는 **기능이 정해진 뒤** UI/정보구조를 고르는 단계다.
코드·Flutter 앱은 만들지 않는다. 저해상도 골격 HTML만 만든다.

---

## 절대 금지

* `app/` 코드 작성·수정
* Flutter 빌드 / `preview/` 갱신
* 외부 CDN·원격 폰트·원격 이미지
* 후보를 1개만 내고 끝내기 (항상 **서로 다른 구조 5개**)

---

## 입력

| 파일 | 역할 |
| --- | --- |
| `SELECTED_IDEA.json` | 아이디어 + **`category`**(필수) |
| `DEV_BRIEF.md` | 직전 기능 논의에서 합의한 MVP·넣음/뺌 |
| `../user-preferences.json` | `explicit.ui_wireframe_by_category` 등 |
| `wireframe/index.html` | 이전 후보(있으면 수정 모드) |

`SELECTED_IDEA.json`이 없거나 `category`가 비면 산출물 없이 묻고 `awaiting_feedback`로 종료한다.
`DEV_BRIEF.md`가 있으면 화면/기능 범위는 브리프를 우선한다.

---

## 카테고리 ↔ 취향 기억

`category`는 아이디어 연구소가 붙인 값을 그대로 쓴다(임의로 바꾸지 않음).

시작 시 `../user-preferences.json`의 다음을 읽는다.

* `explicit.ui_wireframe_by_category[]` — 과거에 그 카테고리(또는 유사)에서 고른 구조
* `explicit.disliked_wireframe_patterns[]` — 싫어한 구조
* `explicit.preferred_ui` — 공통 UI 선호

각 항목 예:

```json
{
  "id": "uw-…",
  "category": "puzzle",
  "pattern": "단일 포커스 플레이 + 하단 도감/기록",
  "nav": "play | book | settings",
  "reason": "한 화면에 핵심 행동만 두고 싶다고 함",
  "project": "black-box-foundry",
  "date": "YYYY-MM-DD"
}
```

### 반영 규칙

1. **같은 `category`** 기록 → 강하게 참고해 후보 중 1~2개에 반영한다.
2. **유사 카테고리**(예: puzzle↔education, idle-growth↔creative) → 약하게 참고.
3. **다른 카테고리**의 구체 레이아웃은 강제하지 않는다.
4. `disliked_wireframe_patterns`와 같은 핵심 구조는 후보에 넣지 않는다.
5. 취향이 없어도 5개 다양성은 유지한다(취향 복붙 5개 금지).

---

## 새 실행 — 후보 5개

1. `stage`가 `"wireframe"`인지 확인 → `stageStatus = "running"`.
2. 입력·취향을 읽는다.
3. **구조적으로 서로 다른** 후보 5개를 설계한다. 색·카피가 아니라 **내비게이션·화면 수·정보 계층**이 달라야 한다.

추천 분화 축(중복 없이 섞기):

| 후보 성격 예 | 구조 힌트 |
| --- | --- |
| A 단일 포커스 | 홈=플레이 1화면, 부가는 시트/버튼 |
| B 하단 탭 3~4 | 전형적인 멀티 탭 |
| C 허브+디테일 | 카드 그리드 → 상세 |
| D 타임라인/피드 | 세로 스크롤 중심 |
| E 모드 전환 | 상단 세그먼트·맵·세션형 |

4. `wireframe/index.html` **한 파일**에 5후보를 모두 담는다.

### HTML 구성

* 상단: 앱 한 줄 + `category` + “마음에 드는 구조를 고르세요”
* 같은 category 과거 취향이 있으면 한 줄 힌트: `이전 puzzle에서 고른 패턴: …`
* 후보 1~5: 각각
  * 이름(짧은 라벨)
  * 한 줄 컨셉(왜 이 구조인지)
  * 주요 화면 박스 골격(회색 박스)
  * 내비(탭/스택) 스케치
  * 핵심 기능 → 화면 매핑 3줄 이내
* 외부 자산 금지. 인라인 CSS/SVG만. 폭 ~420px.
* 후보 간 이동: 같은 파일 안 앵커 또는 간단한 탭 버튼(순수 JS).

5. `WIREFRAME_CANDIDATES.json`도 원자적으로 저장한다(정본 메타):

```json
{
  "version": 1,
  "category": "puzzle",
  "chosen": null,
  "candidates": [
    {
      "id": "A",
      "name": "단일 포커스",
      "pattern": "…",
      "nav": "…",
      "screens": ["…"],
      "why": "…"
    }
  ]
}
```

6. `artifacts.wireframe = "wireframe/index.html"`
7. `artifacts.wireframeCandidates = "WIREFRAME_CANDIDATES.json"` (선택)
8. `stageStatus = "awaiting_feedback"`
9. 채팅(짧게):

```text
구조 후보 5개를 만들어 두었어요. 「구조」를 열어보고
「A 선택할래」처럼 알려 주세요.
(category: puzzle · 이전 취향: … / 없음)
```

---

## 피드백 — 선택·수정

### 후보 선택

예: `A 선택`, `3번`, `허브+디테일로`.

1. 선택 id를 `WIREFRAME_CANDIDATES.json`의 `chosen`에 기록.
2. `wireframe/index.html`을 **선택된 구조 1개 상세 골격**으로 재생성(다른 후보는 접거나 제거).
3. 공용 기억에 append (같은 category+pattern 의미 중복이면 skip):

`explicit.ui_wireframe_by_category`:

```json
{
  "id": "uw-<timestamp>",
  "category": "<SELECTED_IDEA.category>",
  "pattern": "<선택한 pattern>",
  "nav": "<nav>",
  "reason": "<사용자 한 줄 또는 구조적 요약>",
  "project": "<현재 프로젝트명>",
  "date": "YYYY-MM-DD"
}
```

`decisions`에 `type: "wireframe_choice"` 기록.

4. 채팅: `기억 저장: [category] pattern — 다음 같은 장르에 참고할게요`
5. `stageStatus = "awaiting_confirm"`
6. 안내: 컨펌하면 이 구조로 개발 단계로 갑니다.

### 싫다 / 이런 구조 싫어

해당 패턴을 `explicit.disliked_wireframe_patterns`에
`{ pattern, category, reason, source_project, date }`로 저장하고,
나머지 후보를 조정하거나 새 후보로 일부 교체한 뒤 `awaiting_feedback`.

### 구조 수정 요청

선택 전/후 모두 반영해 HTML·JSON을 갱신. 선택 전이면 5후보 유지, 선택 후면 확정본만.

### 그냥 질문

답만 하고 상태 복원.

---

## 원자적 쓰기

1. `<파일>.tmp` 작성  
2. `bash .claude/atomic-mv.sh <파일>.tmp <파일>`

`pipeline.json`은 `stage`/`stageStatus`/`artifacts`만 갱신, 나머지 보존.
선택 전 종료는 `awaiting_feedback`, 선택 후는 `awaiting_confirm`.
`running`인 채 종료 금지.

---

## 완료 조건

* 5후보가 구조적으로 구분됨
* 사용자 선택 후 확정 골격 1장
* 같은 category 취향이 `ui_wireframe_by_category`에 누적됨(또는 중복으로 skip)
* 컨펌 대기
