import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

// 상대 경로 import 이유는 smoke_test.dart 상단 주석 참조: 이 오버레이는
// target 프로젝트 이름이 무엇이든 동일하게 동작해야 하므로 package: import를
// 쓸 수 없다.
// ignore: avoid_relative_lib_imports
import '../lib/router.dart';
// ignore: avoid_relative_lib_imports
import '../lib/screens/home_screen.dart';
// ignore: avoid_relative_lib_imports
import '../lib/screens/settings_screen.dart';
// ignore: avoid_relative_lib_imports
import '../lib/services/settings_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late SettingsService settings;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    settings = await SettingsService.load();
  });

  group('appRoutes <-> GoRouter paths (§12.4 대조 대상 리스트)', () {
    test('every appRoutes screen id maps to exactly one GoRoute path, 1:1',
        () {
      final router = buildRouter(
        settings: settings,
        onSettingsChanged: () {},
      );

      final configuredPaths = router.configuration.routes
          .whereType<GoRoute>()
          .map((route) => route.path)
          .toList();

      // 개수도, 각 항목도 정확히 일치해야 한다 — 화면 ID를 추가/삭제하면서
      // appRoutes 또는 buildRouter의 GoRoute 목록 중 하나만 갱신하는 실수를
      // 잡아낸다.
      expect(configuredPaths.length, appRoutes.length);
      for (final id in appRoutes) {
        expect(
          configuredPaths,
          contains('/$id'),
          reason: 'appRoutes 화면 ID "$id"에 대응하는 GoRoute("/$id")가 없다',
        );
      }
    });
  });

  group('ROUTE dart-define surrogate: initialLocation override', () {
    // dart-define은 flutter test에 주입되지 않으므로, main()에서 ROUTE
    // dart-define을 그대로 전달하는 buildRouter의 initialLocation 파라미터를
    // 직접 지정해서 동일한 딥링크 분기를 검증한다.
    testWidgets(
      'initialLocation="/settings" navigates straight to SettingsScreen',
      (tester) async {
        final router = buildRouter(
          settings: settings,
          onSettingsChanged: () {},
          initialLocation: '/settings',
        );

        await tester.pumpWidget(MaterialApp.router(routerConfig: router));
        await tester.pumpAndSettle();

        expect(find.byType(SettingsScreen), findsOneWidget);
        expect(find.byType(HomeScreen), findsNothing);
      },
    );

    testWidgets(
      'default initialLocation (no ROUTE override) shows HomeScreen',
      (tester) async {
        final router = buildRouter(
          settings: settings,
          onSettingsChanged: () {},
        );

        await tester.pumpWidget(MaterialApp.router(routerConfig: router));
        await tester.pumpAndSettle();

        expect(find.byType(HomeScreen), findsOneWidget);
        expect(find.byType(SettingsScreen), findsNothing);
      },
    );
  });

  group('settings screen actually mutates SettingsService', () {
    testWidgets('theme mode selection persists via SettingsService',
        (tester) async {
          var rebuildCount = 0;
          final router = buildRouter(
            settings: settings,
            onSettingsChanged: () => rebuildCount++,
            initialLocation: '/settings',
          );

          await tester.pumpWidget(MaterialApp.router(routerConfig: router));
          await tester.pumpAndSettle();

          expect(settings.themeMode, ThemeMode.system);

          await tester.tap(find.text('Dark'));
          await tester.pumpAndSettle();

          expect(settings.themeMode, ThemeMode.dark);
          expect(rebuildCount, greaterThan(0));
        });
  });
}
