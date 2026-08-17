import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'router.dart';
import 'seed.dart';
import 'services/ad_seam.dart';
import 'services/app_translations.dart';
import 'services/settings_service.dart';
import 'services/version_check_stub.dart';
import 'theme/app_theme.dart';

/// 광고 seam 주입 지점 (`services/ad_seam.dart` 참조).
///
/// 기본은 [NoopAds] — `interstitial-splash-ad`·`reward-ads` 스킬이 적용되면
/// 이 변수를 그 스킬이 구현한 [AdSeam] 구현체로 교체한다(예:
/// `final AdSeam ads = InterstitialAdService.instance;`). 스타터 자체는
/// `google_mobile_ads`를 의존성에 추가하지 않는다.
final AdSeam ads = const NoopAds();

/// 스크린샷 자동화 등이 특정 화면으로 바로 진입하기 위한 딥링크 오버라이드.
/// 예: `flutter run --dart-define=ROUTE=/settings` (스펙 §11).
///
/// dart-define은 컴파일 타임 상수라 `flutter test`에는 주입되지 않는다 —
/// `test/router_test.dart`는 이 값 대신 `buildRouter(initialLocation: ...)`
/// 파라미터를 직접 지정해서 동일한 분기(딥링크 진입)를 검증한다.
const String _routeOverride = String.fromEnvironment('ROUTE');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settings = await SettingsService.load();

  // 광고 seam 초기화 — 기본 NoopAds는 아무 것도 하지 않으므로 안전하게
  // 항상 호출해도 된다. 광고 스킬이 적용되면 위 `ads` 주입 지점만 바꾸면
  // 이 호출은 그대로 실제 SDK 초기화로 이어진다.
  await ads.initialize();

  // version-check 스킬 주입 지점 (`services/version_check_stub.dart` 참조).
  // kVersionCheckEnabled가 true가 되고 스킬이 적용되면, 홈 화면 initState의
  // addPostFrameCallback 안에서 `VersionCheckService.checkVersion(context)`를
  // 호출하도록 배선한다 (SKILL.md 4단계 — main()에는 BuildContext가 없어 여기서
  // 호출 불가). 스타터 자체는 Firebase 의존성을 추가하지 않으므로 지금은
  // 상수만 참조하고 아무 것도 하지 않는다.
  if (kVersionCheckEnabled) {
    // version-check 스킬 적용 후 홈 화면 initState의 addPostFrameCallback에
    // 체크 호출을 배선한다.
  }

  // SEED: `--dart-define=SEED=true`일 때만 데모 데이터를 주입한다(lib/seed.dart).
  if (kSeed) {
    await seedDemoData(settings);
  }

  runApp(
    StarterApp(
      settings: settings,
      initialLocation: _routeOverride.isEmpty ? '/home' : _routeOverride,
    ),
  );
}

class StarterApp extends StatefulWidget {
  const StarterApp({
    super.key,
    required this.settings,
    this.initialLocation = '/home',
  });

  final SettingsService settings;
  final String initialLocation;

  @override
  State<StarterApp> createState() => _StarterAppState();
}

class _StarterAppState extends State<StarterApp> {
  late final GoRouter _router = buildRouter(
    settings: widget.settings,
    // 설정 화면에서 테마/언어가 바뀐 뒤 MaterialApp.router의 theme/locale이
    // SettingsService의 최신 값을 즉시 반영하도록 이 위젯 전체를 rebuild한다.
    onSettingsChanged: () => setState(() {}),
    initialLocation: widget.initialLocation,
  );

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Flutter Starter',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: widget.settings.themeMode,
      locale: widget.settings.locale,
      supportedLocales: AppTranslations.supportedLocales,
      // GlobalMaterialLocalizations 등은 flutter_localizations 패키지가
      // 필요하지만(의존성 카탈로그 미포함), MaterialApp은 프레임워크 내장
      // Default*Localizations를 항상 폴백으로 함께 등록하므로 이 delegate
      // 하나만으로도 컴파일·동작에 문제없다.
      localizationsDelegates: const [AppTranslations.delegate],
      routerConfig: _router,
    );
  }
}
