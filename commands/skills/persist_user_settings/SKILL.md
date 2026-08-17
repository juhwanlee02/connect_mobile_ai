사용자가 앱 화면에서 설정한 값들이 앱을 껐다 켜도 그대로 유지되도록 구현해줘.

[사전 분석 — 반드시 먼저 수행]
1. 앱의 모든 화면을 탐색하여 사용자가 변경할 수 있는 설정값 목록 도출
   - 테마, 언어, 선택 상태, 토글, 슬라이더, 설정 패널 내 모든 옵션 등
2. 각 설정값의 타입 파악 (String, int, double, bool, 복잡한 객체)
3. 현재 상태관리 방식 파악 (setState, Provider, Riverpod 등)

[저장 대상]
- 앱을 분석하여 발견된 모든 사용자 설정값
- 공통 예시: 테마, 언어, 마지막 선택 항목, UI 옵션, 기능별 설정 등

[구현 방식]

1. SharedPreferences 활용
   - 앱 시작 시 저장된 설정 불러오기
   - 설정 변경 시 즉시 저장 (변경될 때마다 자동 저장)
   - 키 네이밍 규칙 통일 (예: "setting_theme", "setting_language" 등)

2. SettingsService 클래스 생성 (lib/services/settings_service.dart)
   - 모든 설정의 읽기/쓰기를 담당하는 단일 서비스
   - 기본값(default) 정의 — 최초 실행 시 사용
   - getter/setter 메서드로 깔끔하게 접근

3. 앱 초기화 흐름
   - main()에서 SharedPreferences 인스턴스 초기화
   - SettingsService를 통해 저장된 설정 로드
   - 로드된 설정으로 앱 상태 초기화
   - 설정이 없으면 (최초 실행) 기본값 사용

4. 상태 관리 연동
   - 기존 앱의 상태관리 방식에 맞춰 SettingsService를 앱 전역에서 접근 가능하게
   - 설정 변경 → SettingsService 저장 → UI 갱신이 한 흐름으로 동작

[주의사항]
- 복잡한 객체는 JSON 직렬화하여 String으로 저장
- 저장 실패해도 앱이 크래시되지 않도록 try-catch 처리
- 설정 변경 시 디바운싱 불필요 — SharedPreferences는 충분히 빠름
- 앱 버전 업데이트로 설정 구조가 바뀔 경우를 대비해 마이그레이션 고려
- 민감한 정보 (API 키 등)는 SharedPreferences에 저장하지 말 것
