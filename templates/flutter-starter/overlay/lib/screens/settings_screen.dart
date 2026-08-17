import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../services/settings_service.dart';

/// 설정 화면 — 라우트 `/settings`(화면 ID `settings`).
///
/// 파일명·클래스명은 스펙 §2.5 변환 규약의 실물 예시: 라우트 kebab
/// (`/settings`) → 파일 snake(`settings_screen.dart`) → 클래스 Pascal
/// (`SettingsScreen`).
///
/// 테마 모드·언어 선택을 [SettingsService]로 실제 변경·영속한다(Task 2 서비스
/// 사용 — persist_user_settings 패턴). 변경 후에는 [onSettingsChanged]
/// 콜백으로 상위(`StarterApp`)에 rebuild를 요청해서 `MaterialApp.router`의
/// theme/locale이 즉시 반영되게 한다.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({
    super.key,
    required this.settings,
    required this.onSettingsChanged,
  });

  final SettingsService settings;
  final VoidCallback onSettingsChanged;

  Future<void> _setThemeMode(ThemeMode mode) async {
    await settings.setThemeMode(mode);
    onSettingsChanged();
  }

  Future<void> _setLocale(Locale locale) async {
    await settings.setLocale(locale);
    onSettingsChanged();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        leading: IconButton(
          key: const Key('starter-settings-back-button'),
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Home',
          onPressed: () => context.go('/home'),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Theme'),
          const SizedBox(height: 8),
          SegmentedButton<ThemeMode>(
            key: const Key('starter-theme-mode-selector'),
            segments: const [
              ButtonSegment(value: ThemeMode.system, label: Text('System')),
              ButtonSegment(value: ThemeMode.light, label: Text('Light')),
              ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
            ],
            selected: {settings.themeMode},
            onSelectionChanged: (selection) => _setThemeMode(selection.first),
          ),
          const SizedBox(height: 24),
          const Text('Language'),
          const SizedBox(height: 8),
          SegmentedButton<Locale>(
            key: const Key('starter-locale-selector'),
            segments: const [
              ButtonSegment(value: Locale('en'), label: Text('English')),
              ButtonSegment(value: Locale('ko'), label: Text('한국어')),
            ],
            selected: {settings.locale},
            onSelectionChanged: (selection) => _setLocale(selection.first),
          ),
        ],
      ),
    );
  }
}
