import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../services/app_translations.dart';

/// 홈 화면 — 라우트 `/home`(화면 ID `home`).
///
/// 파일명·클래스명은 스펙 §2.5 변환 규약의 실물 예시: 라우트 kebab(`/home`)
/// → 파일 snake(`home_screen.dart`) → 클래스 Pascal(`HomeScreen`).
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // AppTranslations가 실제로 assets/lang/*.json에서 로드됐는지 스모크
    // 테스트가 확인할 수 있도록 번역된 appName을 보여준다(rootBundle을 통한
    // 실제 E2E 로드 확인). delegate 로드가 끝나기 전 첫 프레임에서는
    // Localizations.of가 아직 null일 수 있으므로 로딩 중 문구로 폴백한다 —
    // 폴백 문구는 en.json의 appName("Flutter Starter")과 일부러 다르게 둬서,
    // 테스트에서 어떤 문구가 보이는지가 실제 로드 여부를 구분해 준다.
    final translations = AppTranslations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(
            key: const Key('starter-home-settings-button'),
            icon: const Icon(Icons.settings),
            tooltip: 'Settings',
            onPressed: () => context.go('/settings'),
          ),
        ],
      ),
      body: Center(
        key: const Key('starter-home-body'),
        child: Text(
          translations?.appName ?? 'Loading…',
          key: const Key('starter-app-name'),
        ),
      ),
    );
  }
}
