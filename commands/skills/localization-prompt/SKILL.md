Flutter 앱에 JSON 기반 다국어(i18n) 시스템을 구축해줘.

## 지원 언어
de, en, es, fr, hi, ja, ko, pt, vi, zh (10개 언어)
기본 언어: English (en)

## 사전 분석 — 반드시 먼저 수행
1. 앱의 모든 dart 파일을 스캔하여 하드코딩된 문자열 목록 도출
2. 파라미터가 필요한 문자열 식별 (예: "Score: 5" → "{score}점")
3. 기존 상태관리 방식 파악 (Provider, Riverpod 등)
4. 앱 이름도 번역 대상에 포함

## 구현 순서

### 1단계: JSON 번역 파일 생성
- `assets/lang/{locale}.json` 형식으로 각 언어별 JSON 파일 생성
- 앱 내 모든 하드코딩된 텍스트를 키로 추출
- 앱이름도 각 언어에 맞게 짧고 직관적으로 번역
- 파라미터가 필요한 문자열은 `{param}` 플레이스홀더 사용
- l10n/ARB 기반 시스템은 사용하지 않음 (순수 JSON 방식)

### 2단계: AppTranslations 서비스 생성
- `lib/services/app_translations.dart` 생성
- `rootBundle.loadString`로 JSON 로드
- `Localizations.of<AppTranslations>(context, AppTranslations)`로 접근
- 커스텀 `LocalizationsDelegate` 구현
- 단순 getter + 파라미터 메서드 패턴:
  ```dart
  String get appName => _t('appName');
  String scoreDisplay(int score) => _replace('scoreDisplay', {'score': '$score'});
  ```

### 3단계: 앱 상태에 locale 관리 추가
- 기존 상태관리 방식에 맞춰 locale 상태 추가
- `setLocale(Locale locale)` 메서드
- UI 갱신 트리거

### 4단계: MaterialApp에 연결
- `locale: state.locale`
- `localizationsDelegates`: AppTranslations.delegate + Global delegates
- `supportedLocales`: AppTranslations.supportedLocales
- `flutter_localizations` 패키지 사용 (Material/Cupertino/Widgets delegates)

### 5단계: 하드코딩 텍스트 교체
- 모든 dart 파일에서 하드코딩된 문자열을 `AppTranslations.of(context)!.xxx`로 교체

### 6단계: 언어 선택 UI 생성
- `lib/widgets/language_selector.dart` 생성
- BottomSheet 형태, 국기 이모지 + 네이티브 언어명 + 영어명 표시
- 선택된 언어 체크 표시
- 반드시 스크롤 가능하게 (`maxHeight` 제약 + `Flexible` + `ListView`)

### 7단계: pubspec.yaml 설정
- `assets:` 에 `- assets/lang/` 추가
- `flutter_localizations` SDK dependency 확인

## 체크리스트
- [ ] assets/lang/ 에 10개 JSON 파일 생성
- [ ] lib/services/app_translations.dart 생성 (delegate 포함)
- [ ] 앱 상태에 locale 관리 추가
- [ ] main.dart에 localizationsDelegates/supportedLocales/locale 연결
- [ ] 모든 하드코딩 텍스트 → AppTranslations 교체
- [ ] lib/widgets/language_selector.dart 생성 (BottomSheet, 스크롤 가능)
- [ ] 헤더에 언어 선택 아이콘 버튼 추가
- [ ] pubspec.yaml assets 등록
- [ ] flutter analyze 통과 확인
