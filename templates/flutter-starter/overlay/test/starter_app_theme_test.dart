import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// 상대 경로 import 이유는 smoke_test.dart 상단 주석 참조: 이 오버레이는
// target 프로젝트 이름이 무엇이든 동일하게 동작해야 하므로 package: import를
// 쓸 수 없다.
// ignore: avoid_relative_lib_imports
import '../lib/main.dart';
// ignore: avoid_relative_lib_imports
import '../lib/screens/settings_screen.dart';
// ignore: avoid_relative_lib_imports
import '../lib/services/settings_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // 3-3 리뷰 이월: 기존 router_test.dart의 "설정 화면이 SettingsService를
  // 실제로 바꾼다" 테스트는 `MaterialApp.router`를 직접 pump해서 StarterApp
  // 자체의 setState 경로(`onSettingsChanged: () => setState(() {})`,
  // main.dart 참조)를 우회한다. 이 테스트는 StarterApp을 직접 pump하고,
  // 설정 화면에서 테마를 바꾼 뒤 Theme.of(context)가 실제로 바뀌는지 —
  // 즉 StarterApp 수준의 rebuild가 MaterialApp.router의 theme/themeMode에
  // 전파되는지 — 를 검증해서 그 우회를 메운다.
  testWidgets(
    'StarterApp: changing theme in SettingsScreen propagates to '
    'Theme.of(context) at the app root via StarterApp.setState',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final settings = await SettingsService.load();

      await tester.pumpWidget(
        StarterApp(settings: settings, initialLocation: '/settings'),
      );
      await tester.pumpAndSettle();

      // MaterialApp 자신의 Element가 아니라, 그 내부에서 빌드되는 Theme의
      // *자손* 컨텍스트를 써야 한다 — MaterialApp이 만드는 Theme 위젯은
      // MaterialApp 서브트리 "안"에 있으므로, MaterialApp의 Element 자체로
      // Theme.of를 호출하면 그 Theme을 보지 못하고 위로 더 올라가 프레임워크
      // 기본값(Brightness.light)으로 폴백해 버려 항상 light처럼 보인다.
      // 지금 라우트가 `/settings`이므로 SettingsScreen 컨텍스트를 쓴다.
      Brightness currentBrightness() =>
          Theme.of(tester.element(find.byType(SettingsScreen))).brightness;

      // 우선 Light로 고정해서 검증 시작점을 확정한다 — 기본값인
      // ThemeMode.system은 테스트 환경의 platformBrightness에 따라 달라질
      // 수 있어 기준으로 쓰지 않는다.
      await tester.tap(find.text('Light'));
      await tester.pumpAndSettle();
      expect(settings.themeMode, ThemeMode.light);
      expect(currentBrightness(), Brightness.light);

      // Dark로 전환 — SettingsScreen._setThemeMode가 SettingsService를
      // 갱신하고 onSettingsChanged()를 호출 → StarterApp._StarterAppState가
      // setState(() {}) → StarterApp.build가 새 MaterialApp.router를
      // widget.settings.themeMode(이제 dark)로 다시 만든다.
      await tester.tap(find.text('Dark'));
      await tester.pumpAndSettle();

      expect(settings.themeMode, ThemeMode.dark);
      expect(
        currentBrightness(),
        Brightness.dark,
        reason:
            'StarterApp의 setState 경로를 거쳐야만 Theme.of(context)가 '
            'dark로 바뀐다 — MaterialApp.router를 직접 pump하는 테스트는 '
            '이 경로를 검증하지 못한다.',
      );
    },
  );
}
