---
description: 제약 없이 앱·게임·서비스 아이디어를 자유롭게 발산하고 최종 후보 20개를 제안한다.
allowed-tools: Read, Write, Bash, WebSearch, WebFetch, Task
---

# /pipeline-ideation — 아이디어 연구소

## 목표

특정 장르, 국가, 기술, 비용, 수익화, 플랫폼, 시장 검증 방식에 아이디어를 가두지 않고
자유롭게 발산한다. 최종 결과는 서로 다른 후보 20개다.

## 자유 발상 원칙

- 앱, 게임, 도구, 콘텐츠, 커뮤니티, 실험적 경험 등 어떤 형식도 가능하다.
- 기존 앱에서 출발해도 되고, 완전히 새로운 발상이어도 된다.
- 해외 사례, 현지화, AI, 온디바이스, 서버, 유료 API, 하드웨어 기능은 모두 선택 사항이다.
- 운영비 0원, 특정 수익모델, 리텐션, 첫 30초 경험, 특정 카테고리를 필수로 요구하지 않는다.
- 구현 난이도가 높거나 시장성이 불확실하다는 이유만으로 자동 탈락시키지 않는다.
- `user-preferences.json`과 과거 피드백은 아이디어를 넓히는 참고 자료일 뿐, 후보를 막는 강제 필터가 아니다.
- `never_again`, `disliked_*`, 기존 보관 아이디어와 비슷해도 자동 탈락시키지 않는다. 관련성이 있으면 상세에 참고 메모만 남긴다.
- 레퍼런스 앱이나 조사 근거는 있으면 적고, 없다고 후보를 탈락시키지 않는다.
- 기술 구조·운영비·수익화·리텐션은 아이디어에 중요할 때만 제안한다.
- 사용자가 이번 호출에서 직접 지정한 조건이 있으면 그 조건만 우선한다.
- 타인의 브랜드·캐릭터·저작물을 그대로 복제하라는 제안은 하지 않는다.

## 진행

1. `pipeline.json`의 현재 단계가 `ideation`인지 확인하고 `stageStatus`를 `running`으로 둔다.
2. `../ideas-index.json`, `../user-preferences.json`, 기존 `PROPOSED_IDEAS.json`이 있으면 참고용으로 읽는다.
3. 제한 없이 충분히 발산한다. 내부 초안 수나 점수표에 상한·하한을 두지 않는다.
4. 소재나 이름만 다른 사실상 동일한 항목은 합치고, 사용자에게 고를 가치가 있는 후보 20개를 만든다.
5. 조사하면 도움이 되는 후보만 WebSearch/WebFetch를 사용한다. 모든 후보에 조사를 강제하지 않는다.
6. 결과를 `PROPOSED_IDEAS.json`과 `IDEAS.md`에 원자적으로 저장한다.
7. `pipeline.json`을 `awaiting_feedback`으로 갱신한다.
8. 모바일 채팅에는 후보 20개의 번호와 한 줄 소개를 출력한다.

## `PROPOSED_IDEAS.json`

모바일 후보 탭이 읽는 정본이다.

```json
{
  "version": 2,
  "round_at": "YYYY-MM-DD",
  "candidates": [
    {
      "slug": "example-idea",
      "one_liner": "한 줄 아이디어 소개",
      "detail": "사용자가 눌러 볼 상세 설명",
      "category": "자유 분류",
      "adopted": null,
      "source_app": null,
      "inspiration_basis": [],
      "target_user": "",
      "monetization": "",
      "retention_loop": "",
      "operating_cost": null,
      "on_device_ai": null
    }
  ]
}
```

### 필수 필드

- `slug`: 영문 소문자 시작 kebab-case, 이번 후보 목록에서 고유
- `one_liner`: 모바일 목록에서 바로 이해할 수 있는 소개
- `detail`: 핵심 경험을 설명하는 상세 내용
- `category`: 자유 문자열. 기존 카테고리 목록에 맞출 필요 없음
- `adopted`: 새 후보는 `null`

나머지 필드는 선택 정보다. 알 수 없거나 중요하지 않으면 `null`, 빈 문자열, 빈 배열을 사용할 수 있다.
`source_app`이 없거나, 서버가 필요하거나, 리텐션이 없거나, 운영비가 발생한다는 이유로 후보를 제거하지 않는다.

후보는 정확히 20개를 저장한다.

## `IDEAS.md`

다음을 간단히 기록한다.

- 자유 발상 과정의 주요 방향
- 최종 후보 20개
- 조사한 경우에만 조사 근거
- 합치거나 제외한 거의 동일한 아이디어
- 사용자 피드백과 선택 결과

내부 장황한 추론은 기록하지 않는다.

## 원자적 쓰기

JSON과 Markdown은 같은 디렉터리의 임시 파일에 먼저 작성한 뒤 검증하고 이동한다.

```bash
bash .claude/atomic-mv.sh <tmp-path> <target-path>
```

`PROPOSED_IDEAS.json`은 JSON 파싱 성공, 후보 수 20개, 각 후보의 필수 필드를 확인한 뒤 교체한다.

## 선택·보관 피드백

폰의 「보관」 또는 `<slug> 선택: <이유>` 입력이 오면:

1. 선택 이유가 있으면 `liked_sparks`에 짧게 요약해 저장한다.
2. `IDEAS.md`에 선택 결과를 표시한다.
3. 공용 `ideas-index.json` 갱신은 host가 담당하므로 직접 append하지 않는다.
4. 미선택 후보를 자동 보관하지 않는다.

거절·수정·칭찬 피드백은 `user-preferences.json`에 출처 프로젝트와 함께 기록할 수 있지만,
다음 회의에서 후보를 금지하는 절대 규칙으로 사용하지 않는다.

## `pipeline.json`

기존 필드를 보존하며 다음을 갱신한다.

```json
{
  "artifacts": {
    "ideas": "IDEAS.md",
    "proposed": "PROPOSED_IDEAS.json"
  },
  "stageStatus": "awaiting_feedback"
}
```

아이디어 제안 직후 `awaiting_confirm` 또는 `done`으로 바꾸지 않는다.

## 모바일 채팅 출력

후보 20개를 모두 번호와 한 줄 소개로 출력한다.

```text
1. 한 줄 대표 소개
2. 한 줄 대표 소개
...
20. 한 줄 대표 소개

후보를 눌러 상세를 보고, 마음에 드는 것만 「보관」하세요.
```

설명이나 레퍼런스가 길면 채팅에 모두 넣지 말고 `PROPOSED_IDEAS.json`의 상세에 둔다.
