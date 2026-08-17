import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 사용자 설정(테마·언어)의 단일 영속 저장 서비스.
///
/// `commands/skills/persist_user_settings/SKILL.md` 패턴을 따른다: 모든
/// 설정의 읽기/쓰기를 이 클래스 하나로 모으고, 키 네이밍을 통일하고
/// (`setting_*`), 기본값을 명시적으로 정의한다. 저장은 변경 즉시 이뤄지므로
/// (매 setter가 곧바로 SharedPreferences에 쓴다) 별도 "저장" 버튼이 필요
/// 없다.
class SettingsService {
  SettingsService(this._prefs);

  /// 테스트에서도 참조할 수 있도록 공개 상수로 둔다(persist_user_settings의
  /// "키 네이밍 규칙 통일" 원칙 — `test/settings_test.dart`가 이 상수로
  /// `SharedPreferences.setMockInitialValues`를 미리 채워 로드 동작을 검증한다).
  static const String keyThemeMode = 'setting_theme_mode';
  static const String keyLocale = 'setting_locale';

  static const ThemeMode defaultThemeMode = ThemeMode.system;
  static const Locale defaultLocale = Locale('en');

  final SharedPreferences _prefs;

  /// 앱 부팅 시 호출: SharedPreferences 인스턴스를 얻고 이 서비스로 감싼다.
  /// 저장된 값이 없으면(최초 실행) 아래 getter들이 기본값을 반환한다.
  static Future<SettingsService> load() async {
    final prefs = await SharedPreferences.getInstance();
    return SettingsService(prefs);
  }

  ThemeMode get themeMode {
    final stored = _prefs.getString(keyThemeMode);
    return ThemeMode.values.firstWhere(
      (mode) => mode.name == stored,
      orElse: () => defaultThemeMode,
    );
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    await _prefs.setString(keyThemeMode, mode.name);
  }

  Locale get locale {
    final stored = _prefs.getString(keyLocale);
    if (stored == null || stored.isEmpty) {
      return defaultLocale;
    }
    return Locale(stored);
  }

  Future<void> setLocale(Locale locale) async {
    await _prefs.setString(keyLocale, locale.languageCode);
  }
}
