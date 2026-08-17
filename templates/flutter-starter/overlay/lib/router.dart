import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';
import 'services/settings_service.dart';

/// PRD 화면 ID 목록 — 라우트 경로에서 맨 앞 `/`를 뺀 kebab 세그먼트다.
///
/// §12.4 "PRD 화면 ID ↔ 라우트 1:1 자동 대조"가 이 리스트를 읽어서 PRD에
/// 정의된 화면 ID마다 실제 GoRouter 경로(`/<id>`)가 정확히 하나씩 존재하는지
/// 자동으로 대조한다. 화면을 추가/삭제할 때는 이 리스트와 [buildRouter]의
/// `GoRoute` 목록을 함께 갱신해야 한다 — `test/router_test.dart`가 둘의 1:1
/// 대응을 회귀 테스트로 고정한다.
///
/// 변환 규약(스펙 §2.5)의 실물 예시: 화면 ID `home`(kebab) →
/// 라우트 `/home` → 파일 `screens/home_screen.dart`(snake) →
/// 클래스 `HomeScreen`(Pascal). `settings`도 동일한 규약을 따른다.
const List<String> appRoutes = ['home', 'settings'];

/// go_router 라우터 팩토리.
///
/// [initialLocation]은 기본 `/home`이며, `main()`에서
/// `--dart-define=ROUTE=/settings`처럼 오버라이드된 값을 그대로 전달할 수
/// 있다(스크린샷 자동화가 특정 화면으로 바로 진입하기 위한 딥링크 — 스펙
/// §11). `flutter test`는 dart-define을 주입하지 않으므로, 대신
/// `test/router_test.dart`가 이 파라미터를 직접 지정해서 동일한 분기를
/// 검증한다.
///
/// [onSettingsChanged]는 설정 화면에서 테마/언어가 바뀐 뒤 상위
/// (`StarterApp`)에 rebuild를 요청하는 콜백이다(`MaterialApp.router`의
/// theme/locale이 `SettingsService`의 최신 값을 즉시 반영하도록).
GoRouter buildRouter({
  required SettingsService settings,
  required VoidCallback onSettingsChanged,
  String initialLocation = '/home',
}) {
  return GoRouter(
    initialLocation: initialLocation,
    routes: [
      GoRoute(
        path: '/home',
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: '/settings',
        name: 'settings',
        builder: (context, state) => SettingsScreen(
          settings: settings,
          onSettingsChanged: onSettingsChanged,
        ),
      ),
    ],
  );
}
