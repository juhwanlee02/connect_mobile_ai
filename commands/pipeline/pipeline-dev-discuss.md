---
description: 개발 전 기능·MVP 범위를 대화로 합의한다. UI/와이어프레임은 다음 단계에서 다룬다. 코드는 쓰지 않는다.
allowed-tools: Read, Write, Bash, WebSearch, WebFetch
---

# /pipeline-dev-discuss — 기능 논의

이 단계는 **무엇을 만들지(기능)** 를 대화로 맞춘다.
UI 레이아웃·탭 구조는 다루지 않는다 — 그건 다음 `wireframe` 단계(후보 5개)에서 한다.

---

## 절대 금지

* `app/` 코드 작성·수정
* Flutter 빌드, `preview/` 갱신
* 와이어프레임 HTML·화면 골격 제작
* “탭을 몇 개로 할지” 같은 **UI 구조 확정** (제안만 하고 결정은 wireframe으로 미룸)

허용 산출물:

* `DEV_BRIEF.md` — 기능·MVP 합의 정본
* `pipeline.json` 상태
* 짧은 조사(WebSearch/WebFetch)

---

## 입력

| 파일 | 역할 |
| --- | --- |
| `SELECTED_IDEA.json` | 보관함 아이디어 또는 대화형 시작 표식(`direct_input: true`) |
| `../user-preferences.json` | 취향·금지 |
| `DEV_BRIEF.md` | 이전 초안(있으면 이어서) |
| `ARCHITECTURE_CONSTRAINTS.md` | 사용자가 별도 적용한 기술·비용 제약(있으면 우선) |

`direct_input: true`이면 저장된 아이디어를 전제로 제안하지 않는다. 이번 채팅의 사용자 설명을
먼저 듣고, 아직 설명이 없으면 “어떤 앱을 만들고 싶은지”부터 질문한다.
파일이 없더라도 중단하지 말고 같은 대화형 시작으로 처리한다.

---

## 목표 (기능만)

1. 한 줄 제품 정의
2. 핵심 루프 (유저가 반복하는 행동)
3. 첫 30초에 하는 **행동**(화면 배치 말고 행동)
4. MVP에 **넣는 기능 / 빼는 기능**
5. 리텐션이 기능으로 어떻게 존재하는지
6. 필요한 서버·API·저장 방식과 예상 운영비를 사용자 요구에 맞춰 합의
7. `category` 확인 (UI 취향 매칭용 — 바꾸지 말고 명시만)

UI 말투 예시는 다음 단계로 넘긴다:
“탭 구조는 다음에서 후보 5개로 보여줄게요.”

---

## 새 논의

1. `stage === "dev-discuss"` → `stageStatus = "running"`
2. 입력 파일 읽기. 대화형 시작이면 사용자 답변 전에는 임의의 앱 아이디어를 확정하지 않는다.
3. 채팅 예시:

```text
「{one_liner}」(category: {category})
개발 전에 기능 범위만 맞출게요. UI 골격은 다음에 후보 5개로 고릅니다.

MVP 초안:
- 핵심 루프: …
- 첫 30초 행동: …
- 넣음: …
- 뺌: …
- 리텐션(기능): …
- 기술/운영비 조건: …

확인하고 싶은 것:
1. …
2. …

답 주시면 DEV_BRIEF에 반영할게요. 기능이 굳으면 컨펌 → 구조(와이어프레임)로 갑니다.
```

4. `DEV_BRIEF.md` 저장 (기능 중심 섹션)
5. `artifacts.devBrief = "DEV_BRIEF.md"`
6. `stageStatus = "awaiting_feedback"`

질문 2~4개. UI 레이아웃 질문은 하지 않는다.

---

## DEV_BRIEF.md 최소 섹션

```markdown
# 개발 브리프

## 한 줄
## category
## 핵심 루프
## 첫 30초 행동
## MVP에 넣음
## 이번엔 뺌
## 리텐션(기능)
## 기술 구조 / 운영비
## 피해야 할 패턴
## 합의 메모
## UI 메모 (미정)
다음 wireframe 단계에서 구조 후보 5개로 결정.
```

---

## 피드백

1. 코드·와이어프레임 HTML 금지
2. 취향 문장 → `../user-preferences.json`에 출처 프로젝트와 함께 요약 저장
3. `DEV_BRIEF.md` 갱신
4. 채팅: 바뀐 기능 요약 + 남은 질문 0~2개
5. 아직이면 `awaiting_feedback`
6. 기능 합의 충분 / 「이대로」「컨펌」「다음」→ `awaiting_confirm`

채팅 마무리 예:

```text
기능 범위 정리했어요. 컨펌하면 구조 후보 5개(와이어프레임)로 넘어가요.
```

단계 건너뛰어 wireframe/develop을 직접 실행하지 않는다.

---

## 원자적 쓰기

`.tmp` → `bash .claude/atomic-mv.sh`  
`pipeline.json`은 `stage`/`stageStatus`/`artifacts`만 갱신.
