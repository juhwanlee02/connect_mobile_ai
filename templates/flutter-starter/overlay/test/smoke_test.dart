import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// 상대 경로 import: 이 오버레이는 임의의 패키지 이름(target 프로젝트가
// `flutter create <slug> --org <org>`로 만든 이름)을 가진 프로젝트 위에
// 복사되므로 `package:<name>/main.dart` 형태를 쓸 수 없다. lib/와 test/는
// 같은 패키지 안에 있으므로 상대 import로 어떤 프로젝트 이름에서도 동일하게
// 동작한다. `avoid_relative_lib_imports`는 이 파일 한정으로 의도적으로 무시.
// ignore: avoid_relative_lib_imports
import '../lib/main.dart';
// ignore: avoid_relative_lib_imports
import '../lib/screens/home_screen.dart';
// ignore: avoid_relative_lib_imports
import '../lib/services/settings_service.dart';

void main() {
  testWidgets('starter app boots and shows the home screen', (tester) async {
    // SettingsService가 SharedPreferences를 필요로 하므로 위젯 테스트에서도
    // mock 저장소를 초기화해야 한다(설정 없음 → 기본값 로드).
    SharedPreferences.setMockInitialValues({});
    final settings = await SettingsService.load();

    await tester.pumpWidget(StarterApp(settings: settings));
    await tester.pumpAndSettle();

    expect(find.byType(HomeScreen), findsOneWidget);

    // AppTranslations delegate가 assets/lang/en.json을 실제로 로드했는지
    // 확인한다(rootBundle을 통한 진짜 E2E 로드 — apply.sh가 pubspec.yaml에
    // assets/lang/을 등록해야만 이 텍스트가 뜬다). main.dart의 폴백 문구는
    // 'Loading…'이므로, 여기서 'Flutter Starter'가 보이면 en.json에서 온
    // 값이라는 뜻이다.
    expect(find.byKey(const Key('starter-app-name')), findsOneWidget);
    expect(find.text('Flutter Starter'), findsOneWidget);
  });
}
