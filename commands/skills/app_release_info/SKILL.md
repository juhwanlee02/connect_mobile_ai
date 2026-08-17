---
name: app-release-info
description: >
  Use when preparing app store release information for Android (Google Play) and iOS (App Store).
  Trigger on "배포 정보", "스토어 등록", "릴리즈 정보", "앱 출시", "store listing", "release info",
  "스크린샷 프롬프트", "screenshot prompt" or similar.
---

# App Release Info Generator

앱의 코드와 기능을 분석하여 Android / iOS 스토어 등록에 필요한 모든 텍스트 정보를 **영어로** 생성하는 스킬.

---

## Step 1: 앱 분석

스킬 실행 시 아래 파일들을 읽어 앱의 기능과 특징을 파악한다:

- `lib/` 전체 구조 (화면, 기능, 서비스)
- `pubspec.yaml` (앱 이름, 의존성)
- `ios/Runner/Info.plist` (번들 정보)
- `android/app/build.gradle` (패키지 정보)

### 핵심 기능 필터링 (중요)

분석 후 반드시 **핵심 기능만** 선별한다. 아래 기준을 따른다:

**포함할 것 (핵심 기능):**
- 앱의 고유한 가치를 제공하는 기능 (이 앱이 아니면 못 하는 것)
- 사용자가 이 앱을 설치하는 직접적인 이유가 되는 기능
- 경쟁 앱과 차별화되는 데이터/서비스

**제외할 것 (부가 기능):**
- 다크/라이트 모드, 테마 설정
- 다국어 지원
- 오프라인 모드
- 튜토리얼, 온보딩
- 알림 설정
- 기타 대부분의 앱에 있는 범용 기능

스토어 설명에는 **"이 앱만의 핵심 가치"**만 담아야 한다. 부가 기능은 사용자가 설치 후 자연스럽게 발견하게 한다.

---

## Step 2: Android (Google Play) 정보 생성

아래 항목을 **영어로** 생성한다. 반드시 글자 수 제한을 지킨다.

### App Title (30자 이하)
- 형식: `{앱이름} - {검색 키워드 설명}`
- 특수문자 사용 금지
- 스토어 검색 최적화(ASO)를 고려한 키워드 포함
- 예: `Fundex - Stock Fundamentals & Financial Data`

### Short Description (80자 이하)
- 앱의 핵심 가치를 한 문장으로 요약
- 특수문자 사용 금지

### Full Description (4000자 이하, 절대 초과 금지)
- 구조:
  1. 첫 문단: 앱의 핵심 가치 (사용자가 왜 설치해야 하는지)
  2. 주요 기능 목록 (bullet points)
  3. 사용 시나리오
  4. 마무리 CTA (Call to Action)
- 글자 수를 반드시 세서 4000자를 넘지 않도록 한다
- 특수문자 사용 금지

### Category & Tags
- 앱에 가장 적합한 카테고리 1개 추천
- 관련 태그 5~8개 추천

---

## Step 3: iOS (App Store) 정보 생성

### App Title (30자 이하)
- 형식: `{앱이름} - {검색 키워드 설명}`
- 특수문자 사용 금지
- 스토어 검색 최적화(ASO)를 고려한 키워드 포함
- 예: `Fundex - Stock Fundamentals & Financial Data`

### Subtitle (30자 이하)
- 앱의 핵심 기능을 간결하게 설명
- 특수문자 사용 금지

### Full Description (4000자 이하, 절대 초과 금지)
- 구조:
  1. 첫 문단: 앱의 핵심 가치 (사용자가 왜 설치해야 하는지)
  2. 주요 기능 목록 (bullet points)
  3. 사용 시나리오
  4. 마무리 CTA (Call to Action)
- 글자 수를 반드시 세서 4000자를 넘지 않도록 한다
- 특수문자 사용 금지

### Keywords (100자 이하)
- 구분자: `,` (쉼표)
- 다운로드를 높이기 위한 ASO 키워드 전략 적용
- 앱 이름에 이미 포함된 단어는 제외 (중복 낭비)
- 경쟁 앱 키워드, 관련 동의어, 사용자 검색 의도 반영
- 예: `stocks,fundamentals,financials,earnings,PE ratio,valuation,investing`

### Category
- Primary Category 1개
- Secondary Category 1개



---

## Step 4: App Screenshot Prompt 생성

실제 앱 스크린샷과 함께 이미지 생성 AI(Midjourney, DALL-E, ChatGPT 등)에 입력할 프롬프트를 생성한다.

### 프롬프트 생성 규칙
- 앱의 브랜드 컬러와 분위기에 맞는 배경 디자인
- 각 스크린샷마다 **헤드라인 텍스트** 포함 (기능 설명 한 줄)
- 디바이스 프레임(iPhone/Android mockup) 포함 여부 선택 가능
- 스토어 가이드라인에 맞는 비율 (iOS: 6.7", 6.5", 5.5" / Android: 16:9)

### 생성할 프롬프트 수
- 메인 화면 포함 **최소 4~6장** 분량의 프롬프트
- 각 프롬프트에 포함할 내용:
  1. 배경 스타일 (그라데이션, 패턴, 컬러)
  2. 디바이스 목업 배치
  3. 헤드라인 텍스트 (영어)
  4. 보조 설명 텍스트 (선택)

### 프롬프트 출력 형식

```
[Screenshot 1 - Main Screen]
Headline: "..."
Background: ...
Device: ...
Prompt: "..."

[Screenshot 2 - Feature Screen]
...
```

---

## Output Format & 저장

최종 출력은 아래 순서로 정리하고, **프로젝트 루트의 `release_doc/` 폴더에 `.txt` 파일로 저장**한다.

### 저장 파일 구조

```
release_doc/
  android_listing.txt      # Android 스토어 등록 정보
  ios_listing.txt           # iOS 스토어 등록 정보
  screenshot_prompts.txt    # 스크린샷 생성 프롬프트
```

### android_listing.txt

```
================================================
ANDROID (Google Play)
================================================

App Title (xx/30 chars):
...

Short Description (xx/80 chars):
...

Full Description (xxxx/4000 chars):
...

Category: ...
Tags: ...
```

### ios_listing.txt

```
================================================
iOS (App Store)
================================================

Keywords (xx/100 chars):
...

Subtitle (xx/30 chars):
...

Primary Category: ...
Secondary Category: ...
```

### screenshot_prompts.txt

```
================================================
SCREENSHOT PROMPTS
================================================

[Screenshot 1 - ...]
Headline: "..."
Background: ...
Device: ...
Prompt: "..."

[Screenshot 2 - ...]
...
```
