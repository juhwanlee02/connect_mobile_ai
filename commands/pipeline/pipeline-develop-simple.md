---
description: 개발 단계 정본. 선택 아이디어 또는 대화로 합의한 DEV_BRIEF를 Flutter 온디바이스 앱으로 구현하고, 사용자 피드백·비선호를 공용 기억에 누적한다.
allowed-tools: Read, Write, Edit, Bash, Task
---

# /pipeline-develop — 개발

이 단계는 “앱 만들기”보다 먼저 **사용자의 누적 취향을 지키는 것**이 목표다.
예전에 싫어했던 방향(콘텐츠 부족, 리텐션 없음, 허전한 홈 등)을 다시 만들면 실패다.

---

## 0. 입력 파일

| 파일 | 역할 |
|---|---|
| `SELECTED_IDEA.json` | 보관함 아이디어 또는 대화형 시작 표식(선택) |
| `DEV_BRIEF.md` | 「기능 논의」에서 합의한 MVP(있으면 기능 범위 **최우선**) |
| `wireframe/index.html` | 「구조 후보」에서 확정한 정보구조(있으면 화면/내비 **최우선**) |
| `WIREFRAME_CANDIDATES.json` | 선택된 구조 메타(`chosen`) |
| `../user-preferences.json` | 취향·금지·`ui_wireframe_by_category` |
| `ARCHITECTURE_CONSTRAINTS.md` | 사용자가 별도 적용한 기술·비용 제약(있으면 우선) |
| `pipeline.json` | 단계 상태 |

`SELECTED_IDEA.json`이 없거나 `direct_input: true`이면 `DEV_BRIEF.md`를 제품 정의의 정본으로 삼는다.
이때 `DEV_BRIEF.md`까지 없으면 구현하지 말고 기능 논의부터 완료해 달라고 안내한다.
우선순위: `DEV_BRIEF`(기능) → 확정 `wireframe`(구조) → `SELECTED_IDEA` → 공용 취향.
같은 `category`의 `ui_wireframe_by_category` 기록과 확정 와이어프레임이 어긋나면 **이번 확정 와이어프레임**을 따른다.

---

## 1. 공용 기억 (모든 작업의 출발점)

경로: `../user-preferences.json`  
모든 개발 프로젝트·자유 피드백이 **같은 파일**에 append한다. 프로젝트별로 리셋하지 않는다.

### 1-1. 파일 구조

없으면 아래 골격으로 만든다.

```json
{
  "version": 1,
  "updated_at": "YYYY-MM-DD",
  "explicit": {
    "liked_categories": [],
    "disliked_categories": [],
    "liked_mechanics": [],
    "disliked_mechanics": [],
    "preferred_targets": [],
    "preferred_markets": [],
    "preferred_ui": [],
    "preferred_content_depth": [],
    "preferred_retention": [],
    "disliked_app_patterns": [],
    "liked_sparks": [],
    "required_operating_cost": 0
  },
  "never_again": [],
  "inferred": [],
  "decisions": []
}
```

`project_notes`는 쓰지 않는다 (폐지). 모든 피드백은 위 필드에 모으고 **출처 프로젝트**를 붙인다.

### 1-2. 필드 의미

- `explicit.*` / `never_again` — 취향·금지. 항목마다 출처(`project` / `source_project`) 필수
- `decisions` — 이력 로그
- `inferred` — 추론만. 하드 밴에 쓰지 말 것

`never_again` 예시:
```json
{
  "id": "na-20260719-1",
  "pattern": "콘텐츠 거의 없는 빈 홈",
  "reason": "허전하고 쓸 게 없다고 함",
  "source_project": "my-app",
  "date": "2026-07-19",
  "raw_feedback": "홈이 허전하고 콘텐츠가 없어"
}
```

원함/테마 요청 예시 (다른 앱에 드래곤을 넣지 말 것 — 출처로 구분):
```json
{
  "text": "용·퀘스트 시스템을 넣어달라고 함",
  "project": "dragon-quest",
  "date": "2026-07-19"
}
```

### 1-3. 출처 프로젝트 규칙 (필수)

저장할 때 **어느 프로젝트에서 나온 피드백인지** 반드시 적는다. 별도 `project_notes` 섹션은 없다.

| 종류 | 저장 | 예 | 다른 앱에서 |
|---|---|---|---|
| 품질/UX 비선호 | `never_again` / `disliked_*` + `source_project` | 빈 홈, 리텐션 없음 | **가드로 강제** (출처 무관) |
| 선호·테마·기능 요청 | `preferred_*` / `liked_*` / `liked_sparks` + `project` | 용·퀘스트, 특정 미니게임 | `project`≠현재면 **강제 금지**, 참고만 |

### 1-4. 긴 피드백 → 요약 후 저장

| 원문 길이 | 처리 |
|---|---|
| ~80자 | 핵심만 다듬어 저장 |
| 80자 초과 | 2~3문장 이내 요약 |
| 여러 주제 | 최대 3개로 쪼개 분류·요약 |

- `pattern`/`text` 12~40자, `reason` 한 줄, `raw_feedback` 요약 ≤120자
- 모든 항목에 현재 프로젝트명 (`project` 또는 `source_project`)

### 1-5. 쓰기 규칙

1. 피드백이 오면 **코드 수정 전에** 요약 → 출처 붙여 기억 갱신.
2. 싫은 방향 → `disliked_app_patterns` + `never_again` (`source_project`=현재).
3. 좋은 방향·테마 요청 → `preferred_*` / `liked_*` / `liked_sparks` (`project`=현재).
4. `decisions`에 요약 이력 append.
5. cwd `.tmp` → `bash .claude/atomic-mv.sh <tmp> ../user-preferences.json`

### 1-6. 시작 시 의무 체크 (구현 전)

1. `never_again` + 품질성 `disliked_*` → **금지 체크리스트** (강제)
2. `project`/`source_project`가 **현재 프로젝트와 같은** 원함 → 이번 요구로 반영
3. 출처가 **다른 프로젝트**인 테마·기능 요청 → 요구사항으로 쓰지 말고 참고 한 줄만
4. 품질 공통 패턴(빈 홈·리텐션 부재 등)만 출처와 무관하게 가드

채팅에 금지·참고 목록 전체를 덤프하지 말 것.

---

## 2. 절대 제약

1. 참고 앱의 브랜드·아이콘·문구·고유 캐릭터 복제 금지. 핵심 기능·리텐션만 현지화해 새로 만든다.
2. 기술 구조와 비용은 `DEV_BRIEF.md` 및 `ARCHITECTURE_CONSTRAINTS.md`(있을 때)에 따른다.
3. 별도 제약 파일이 없으면 서버·DB·API를 일률적으로 금지하거나 월 운영비 0원을 임의로 강제하지 않는다.

---

## 3. 앱 품질 기준 (미달 = 미완료)

### 콘텐츠

- 첫 실행 직후 빈 홈·플레이스홀더·“곧 추가”만 보이면 실패
- 시드 콘텐츠를 충분히 채운다 (앱 성격상 최소 체감 가능량; 보통 핵심 리스트 8개+)
- 핵심 화면마다 할 수 있는 행동이 2개 이상
- 하루 써도 바로 고갈되지 않을 초기 풀

### 리텐션 (코드로 존재해야 함)

`SELECTED_IDEA.json`의 `retention_loop` + 사용자 `preferred_retention`을 구현:

1. 트리거 — 다시 열 이유  
2. 행동 — 핵심 액션  
3. 보상 — 즉시 피드백  
4. 축적 — 로컬에 쌓이는 기록/스트릭/컬렉션  

홈에서 **오늘 진행**과 **어제와 다른 점**이 보여야 한다.

### 취향 준수

`never_again`에 있는 패턴이 결과물에 다시 나타나면 무조건 실패.  
표면 문구만 바꾸고 구조는 그대로 두는 것도 실패다.

---

## 4. 역할 (부정 검증 포함)

Task가 있으면 분리 실행, 없으면 내부적으로 같은 순서로 검증한다.  
긴 토론은 채팅에 올리지 말고, 지적 → 수정만 한다.

1. **Memory Loader** — 공용 기억 읽고 금지 체크리스트 확정  
2. **Builder** — 아이디어 + 취향 제약으로 앱 구현  
3. **Content Critic (−)** — 콘텐츠 빈약/가짜 데이터/고갈 위험을 공격적으로 탈락  
4. **Retention Critic (−)** — 루프 4단계·재방문 이유 부재를 탈락  
5. **Preference Guardian (−)** — `never_again` 재발 + **다른 프로젝트 출처의 테마/기능을 잘못 넣은 경우** 탈락  
6. **Judge** — 아래 게이트 전부를 통과 시에만 완료

### Judge 게이트

- [ ] `never_again` 0건 위반
- [ ] 출처가 다른 프로젝트인 테마·기능(용·퀘스트 등)을 이번 앱에 강제하지 않음
- [ ] 시드 콘텐츠 충분, 첫 화면 비어 있지 않음
- [ ] 리텐션 4단계가 위젯/저장 로직으로 존재
- [ ] 홈에 오늘 진행·축적 표시
- [ ] 오프라인 핵심 동작
- [ ] `flutter analyze` / `flutter test` 통과
- [ ] 웹 미리보기 `preview/` 갱신

---

## 5. 실행 순서

### A. 신규/일반 실행

1. `pipeline.json` 확인 → `stageStatus = "running"` (다른 필드 보존, 원자적 기록)
2. `SELECTED_IDEA.json` + `../user-preferences.json` 읽기 (기억 먼저)
3. 금지 체크리스트 확정
4. `app/` 없으면 `flutter create app`
5. Builder로 MVP 구현 (빈 껍데기 금지)
6. Critic 3종 + Preference Guardian 통과할 때까지 수정
7. `flutter analyze` / `flutter test` 수정
8. 웹 미지원 기능은 안전한 대체 동작
9. 미리보기 빌드  
   `cd app && flutter build web --release --base-href=/preview/<프로젝트명>/preview/ --pwa-strategy=none`  
   → `app/build/web/` 를 `preview/`로 복사
10. `artifacts.app = "app"`, `artifacts.preview = "preview/index.html"` 기록 (기존 artifacts 보존)
11. RTDB 랭킹 사용 시: 로컬 랭킹이 기본으로 동작해야 함. 설정·보안규칙·무료한도는 짧게 문서화
12. `stageStatus = "awaiting_confirm"`
13. 채팅 보고는 짧게:  
    - 무엇을 만들었는지 2~4줄  
    - 리텐션 한 줄  
    - 이번 앱에 적용한 금지/선호 반영 1~3개

### B. `피드백:` 호출 (가장 중요)

순서를 바꾸지 않는다.

1. 피드백을 읽고, 길면 요약 → 출처(현재 프로젝트)를 붙여 분류.
2. **즉시** `../user-preferences.json` 갱신  
   - 비선호 → `disliked_app_patterns` + `never_again` (`source_project`=현재)  
   - 선호·테마·기능 → `preferred_*` / `liked_*` / `liked_sparks` (`project`=현재)  
   - 이력 → `decisions` append
3. 그다음 앱을 수정한다.  
   “콘텐츠/리텐션/허전함”류면 시드·루프·홈 상태를 구조적으로 고친다.  
   출처가 다른 프로젝트인 테마는 자동으로 넣지 말 것.
4. Preference Guardian: `never_again` 재발 + 다른 프로젝트 출처 테마 오적용 검사
5. analyze / test / preview 재실행
6. `stageStatus = "awaiting_confirm"` (질문만이고 코드 변경 없으면 이전 상태 복원 가능)
7. 채팅 마지막 한 줄:  
   `기억 저장: [@현재프로젝트] never_again += "..."` 또는 `기억 저장: [@현재프로젝트] liked += "..."`

이미 `never_again`에 있는 패턴을 또 지적받으면:  
“이전에 금지했는데 재발함”을 한 줄로 인정하고, 문구가 아니라 **데이터/루프/정보구조**를 고친다.

---

## 6. 채팅 출력

- 장문 설계서·에이전트 토론 전문 금지
- 결과·리텐션·기억 반영만 짧게
- 사용자가 싫어한 내용을 기억에 넣었으면 반드시 한 줄로 알린다
