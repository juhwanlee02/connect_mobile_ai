import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ignore: avoid_relative_lib_imports
import '../lib/services/settings_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SettingsService', () {
    test('falls back to defaults when nothing is stored', () async {
      SharedPreferences.setMockInitialValues({});

      final settings = await SettingsService.load();

      expect(settings.themeMode, ThemeMode.system);
      expect(settings.locale, const Locale('en'));
    });

    test('reads pre-existing stored values on load', () async {
      SharedPreferences.setMockInitialValues({
        SettingsService.keyThemeMode: 'dark',
        SettingsService.keyLocale: 'ko',
      });

      final settings = await SettingsService.load();

      expect(settings.themeMode, ThemeMode.dark);
      expect(settings.locale, const Locale('ko'));
    });

    test('persists changes so a later load restores them', () async {
      SharedPreferences.setMockInitialValues({});
      final settings = await SettingsService.load();

      await settings.setThemeMode(ThemeMode.light);
      await settings.setLocale(const Locale('ko'));

      // 앱 재시작을 흉내: 같은 mock 저장소를 바라보는 새 인스턴스를 로드.
      final restored = await SettingsService.load();

      expect(restored.themeMode, ThemeMode.light);
      expect(restored.locale, const Locale('ko'));
    });

    test('ignores an unrecognized stored themeMode and uses the default',
        () async {
      SharedPreferences.setMockInitialValues({
        SettingsService.keyThemeMode: 'not-a-real-mode',
      });

      final settings = await SettingsService.load();

      expect(settings.themeMode, ThemeMode.system);
    });
  });
}
