import 'package:flutter/material.dart';

import 'services/settings_service.dart';

/// `--dart-define=SEED=true`로 활성화되는 데모 데이터 시드 스위치.
///
/// 스크린샷 자동화(스펙 §11)는 앱을 처음부터 실제 사용자처럼 조작하지 않고,
/// 데모 데이터가 이미 채워진 상태로 특정 화면(`--dart-define=ROUTE=...`,
/// `router.dart` 참조)에 바로 진입해 캡처한다. `kSeed`는 그 데모 데이터 주입을
/// 켤지 말지 결정하는 컴파일 타임 상수다.
const bool kSeed = bool.fromEnvironment('SEED');

/// 데모 데이터 주입 훅.
///
/// 스타터에는 실제 도메인 데이터(할 일 목록, 기록 등)가 없으므로, 훅이
/// 존재하고 호출된다는 것만 보여주는 최소 예시 하나만 둔다: 데모 모드에서는
/// 테마를 라이트로 고정해서 스크린샷이 매번 같은 외관으로 캡처되게 한다.
///
/// develop 스킬은 이 함수 본문을 앱 도메인 데이터에 맞는 실제 시드 로직으로
/// 교체한다(예: 로컬 DB에 샘플 레코드 삽입). 시그니처(필요한 서비스를 인자로
/// 받고, `main()`이 `kSeed`일 때만 호출하는 계약)는 그대로 유지하면 된다.
Future<void> seedDemoData(SettingsService settings) async {
  if (!kSeed) {
    return;
  }
  await settings.setThemeMode(ThemeMode.light);
}
