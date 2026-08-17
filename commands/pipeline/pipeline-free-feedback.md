---
description: 자유 피드백 — 요청을 수행하고, 출처 프로젝트가 붙은 취향으로 공용 기억에 저장한다.
allowed-tools: Read, Write, Edit, Bash, WebSearch, WebFetch, Task
---

# /pipeline-free-feedback — 자유 피드백

정해진 산출물 순서 없이 대화·수정하는 단계다.
**공용 기억 갱신**과 **싫어한 품질 패턴 재발 금지**는 개발 단계와 동일한 계약이다.

---

## 공용 기억

경로: `../user-preferences.json`  
`project_notes`는 쓰지 않는다. 모든 피드백은 `never_again` / `disliked_*` / `preferred_*` / `liked_sparks`에
**현재 프로젝트명을 출처로 붙여** 저장한다.

```json
{ "text": "요약", "project": "현재프로젝트명", "date": "YYYY-MM-DD" }
```

다른 프로젝트 출처 항목은 이번 앱에 기능을 강제하지 말고 참고만 한다.
빈 홈·리텐션 부재 같은 품질 공통 패턴만 출처와 무관하게 가드로 적용한다.

### 피드백이 오면 코드보다 기억을 먼저

1. 길면 요약 (80자 초과 → 2~3문장, 여러 주제 → 최대 3개).
2. `../user-preferences.json` 갱신 — 항목마다 `project`(또는 `source_project`) = 현재 프로젝트.
3. cwd `.tmp` → `bash .claude/atomic-mv.sh <tmp> ../user-preferences.json`
4. 작업 수행 후 한 줄: `기억 저장: [@프로젝트] 요약`

---

## 앱 수정 가드

- `never_again` / 품질 `disliked_*` 재도입 금지
- 출처가 **다른 프로젝트**인 테마·기능 요청은 자동으로 넣지 말 것
- 빈 홈·시드·리텐션 부족이면 먼저 채운다
- 수정 후 analyze / 테스트 / `preview/` 갱신

---

## 실행 규칙

1. `pipeline.json` 확인, `stage`가 `"free-feedback"`인지 본다.
2. `stageStatus = "running"` (다른 필드 보존).
3. `피드백:` 내용을 요청으로 취급.
4. 취향 문장이 있으면 기억 먼저, 그다음 작업.
5. 모호하면 한 번에 질문.
6. 클라우드는 금지. 전 세계 랭킹용 RTDB만 Spark 조건 허용.
7. 끝나면 `stageStatus = "awaiting_feedback"`.
