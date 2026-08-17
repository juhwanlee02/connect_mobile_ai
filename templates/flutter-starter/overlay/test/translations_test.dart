import 'package:flutter_test/flutter_test.dart';

// ignore: avoid_relative_lib_imports
import '../lib/services/app_translations.dart';

void main() {
  group('AppTranslations', () {
    test('exposes seeded values via typed getters (fromMap seam)', () {
      final translations = AppTranslations.fromMap({
        'appName': 'Test App',
        'homeTitle': 'Test Home',
        'greeting': 'Hi, {name}!',
      });

      expect(translations.appName, 'Test App');
      expect(translations.homeTitle, 'Test Home');
    });

    test('substitutes {param} placeholders', () {
      final translations = AppTranslations.fromMap({
        'greeting': 'Hello, {name}!',
      });

      expect(translations.greeting('World'), 'Hello, World!');
    });

    test('falls back to a bracketed key marker when a key is missing', () {
      final translations = AppTranslations.fromMap(<String, dynamic>{});

      expect(translations.appName, '[appName]');
      expect(translations.greeting('World'), '[greeting]');
    });
  });
}
