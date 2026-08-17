import 'package:flutter/material.dart';

/// 앱 전역 라이트/다크 테마.
///
/// 색상 값은 `commands/skills/color_theme_black_white/SKILL.md`의 흑백 팔레트
/// 가이드를 그대로 따른다. 화면/위젯 코드에서는 이 색상을 직접 하드코딩하지
/// 말고 `Theme.of(context).colorScheme` / `AppTheme.*` 상수를 참조한다.
abstract final class AppTheme {
  // 다크 모드 팔레트
  static const Color darkBackground = Color(0xFF0D1117);
  static const Color darkSurface = Color(0xFF161B22);
  static const Color darkBorder = Color(0xFF21262D);
  static const Color darkText = Color(0xFFE6EDF3);

  // 라이트 모드 팔레트
  static const Color lightBackground = Color(0xFFFFFFFF);
  static const Color lightSurface = Color(0xFFF6F8FA);
  static const Color lightCard = Color(0xFFF0F0F0);
  static const Color lightBorder = Color(0xFFD1D9E0);
  static const Color lightText = Color(0xFF1F2328);

  static ThemeData get light {
    final scheme = ColorScheme.fromSeed(
      seedColor: lightText,
      brightness: Brightness.light,
      surface: lightSurface,
      onSurface: lightText,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: scheme,
      scaffoldBackgroundColor: lightBackground,
      cardColor: lightCard,
      dividerColor: lightBorder,
      appBarTheme: const AppBarTheme(
        backgroundColor: lightBackground,
        foregroundColor: lightText,
        elevation: 0,
      ),
      textTheme: ThemeData.light().textTheme.apply(
            bodyColor: lightText,
            displayColor: lightText,
          ),
    );
  }

  static ThemeData get dark {
    final scheme = ColorScheme.fromSeed(
      seedColor: darkText,
      brightness: Brightness.dark,
      surface: darkSurface,
      onSurface: darkText,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: darkBackground,
      cardColor: darkSurface,
      dividerColor: darkBorder,
      appBarTheme: const AppBarTheme(
        backgroundColor: darkBackground,
        foregroundColor: darkText,
        elevation: 0,
      ),
      textTheme: ThemeData.dark().textTheme.apply(
            bodyColor: darkText,
            displayColor: darkText,
          ),
    );
  }
}
