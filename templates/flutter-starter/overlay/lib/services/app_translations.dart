import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

/// JSON 기반 i18n 서비스 — `commands/skills/localization-prompt/SKILL.md`
/// 패턴을 따르되, l10n/ARB는 쓰지 않고 `assets/lang/{locale}.json`을 직접
/// 로드한다. 지원 언어는 스타터 시드 기준 en/ko 두 개(develop 단계에서 필요에
/// 따라 늘린다).
///
/// 테스트 seam: [AppTranslations.fromMap] 생성자로 임의의 맵을 주입할 수
/// 있어 `rootBundle.loadString` 없이 순수 단위 테스트가 가능하다
/// (`test/translations_test.dart`). 실제 asset 로드(rootBundle)는
/// widget 테스트/E2E에서 [AppTranslations.load]를 통해 확인한다
/// (`test/smoke_test.dart` 참조).
class AppTranslations {
  AppTranslations(Map<String, String> values) : _values = values;

  /// 테스트 전용 seam: JSON 디코드 결과(또는 임의의 맵)를 직접 주입한다.
  factory AppTranslations.fromMap(Map<String, dynamic> values) {
    return AppTranslations(
      values.map((key, value) => MapEntry(key, value.toString())),
    );
  }

  final Map<String, String> _values;

  static const List<Locale> supportedLocales = [Locale('en'), Locale('ko')];
  static const Locale fallbackLocale = Locale('en');

  static const LocalizationsDelegate<AppTranslations> delegate =
      _AppTranslationsDelegate();

  static AppTranslations? of(BuildContext context) {
    return Localizations.of<AppTranslations>(context, AppTranslations);
  }

  /// `assets/lang/{languageCode}.json`을 rootBundle에서 읽어 로드한다.
  /// 지원하지 않는 언어면 [fallbackLocale]로 대체한다.
  static Future<AppTranslations> load(Locale locale) async {
    final supported = supportedLocales.any(
      (l) => l.languageCode == locale.languageCode,
    );
    final languageCode =
        supported ? locale.languageCode : fallbackLocale.languageCode;
    final jsonString = await rootBundle.loadString(
      'assets/lang/$languageCode.json',
    );
    final decoded = json.decode(jsonString) as Map<String, dynamic>;
    return AppTranslations.fromMap(decoded);
  }

  String _t(String key) => _values[key] ?? '[$key]';

  String _replace(String key, Map<String, String> params) {
    var text = _t(key);
    for (final entry in params.entries) {
      text = text.replaceAll('{${entry.key}}', entry.value);
    }
    return text;
  }

  // 시드 키 — develop 단계에서 앱별 문자열로 확장한다.
  String get appName => _t('appName');
  String get homeTitle => _t('homeTitle');
  String greeting(String name) => _replace('greeting', {'name': name});
}

class _AppTranslationsDelegate extends LocalizationsDelegate<AppTranslations> {
  const _AppTranslationsDelegate();

  @override
  bool isSupported(Locale locale) => AppTranslations.supportedLocales.any(
        (l) => l.languageCode == locale.languageCode,
      );

  @override
  Future<AppTranslations> load(Locale locale) => AppTranslations.load(locale);

  @override
  bool shouldReload(_AppTranslationsDelegate old) => false;
}
