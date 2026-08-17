import 'package:flutter/foundation.dart';

/// 광고 seam — `commands/skills/interstitial-splash-ad`와
/// `commands/skills/reward-ads` 스킬이 실제 구현을 꽂아 넣는 인터페이스.
///
/// 이 파일은 의도적으로 `google_mobile_ads`를 import하지 않는다(스타터는
/// 광고 SDK 의존성을 전제하지 않는다 — 스펙 §11 "그 외 공통분모"의 광고
/// seam). `pubspec.deps.yaml`에도 `google_mobile_ads`는 없다: 광고 스킬이
/// 채택될 때 그 스킬이 직접 의존성을 추가한다.
///
/// **스킬 적용 절차**: 두 스킬 중 하나 또는 둘 다 채택되면,
///   1. `pubspec.yaml`에 `google_mobile_ads`를 추가한다.
///   2. 각 스킬의 SKILL.md에 있는 서비스 코드(`InterstitialAdService`,
///      `AdManager`/`TicketService` 등)를 그대로 생성한다.
///   3. 그 서비스가 이 [AdSeam]을 구현하도록 어댑터를 하나 추가하거나, 이
///      파일 자체를 그 구현으로 교체한다.
///   4. `lib/main.dart`의 주입 지점(`ads` 변수, "광고 seam 주입 지점" 주석
///      참조)에서 `const NoopAds()` 대신 새 구현체를 사용하도록 바꾼다.
///
/// **주의**: `interstitial-splash-ad` 스킬 적용 시 [AdSeam] 교체만으로는
/// 부족하다. StarterApp을 스플래시 상태머신(_splashDone, minSplashMs/splashTotalMs
/// 타이밍, isCancelled 콜백)으로 재구성해야 한다. 또한 [showRewardedAd]의
/// bool 반환값(onUserEarnedReward 발화 여부)은 어댑터가 별도 상태로 추적하여
/// 구현해야 한다(이 인터페이스만으로는 구분 불가).
abstract class AdSeam {
  /// 앱 시작 시 1회 초기화(광고 SDK `initialize()` 등). 스타터의 기본
  /// 구현([NoopAds])은 아무 것도 하지 않는다.
  Future<void> initialize();

  /// 콜드스타트 스플래쉬 전면광고 훅(`interstitial-splash-ad` 스킬 대상).
  /// 광고가 없거나 표시가 끝나면 [onClosed]를 호출해 다음 단계(홈 화면
  /// 진입 등)로 진행한다.
  Future<void> showColdStartAdIfNeeded({required VoidCallback onClosed});

  /// 보상형 광고 훅(`reward-ads` 스킬 대상). 시청을 끝까지 마치고 보상을
  /// 받았으면 `true`, 광고가 없거나 중간에 닫혔으면 `false`를 반환한다.
  Future<bool> showRewardedAd();
}

/// [AdSeam]의 기본(no-op) 구현.
///
/// 광고 스킬이 아직 적용되지 않은 상태에서도 앱이 정상적으로 부팅·동작하게
/// 하는 것이 목적이다: 스플래쉬가 광고를 기다리며 멈추지 않고([true를
/// 반환하지 않는 콜드스타트 훅]이 즉시 [onClosed]를 호출), 보상형 화면은
/// 광고 없이 그냥 열린다([showRewardedAd]가 `false`를 반환 — 호출부가
/// "광고가 아직 로드 안 됐으면 무료로 진입 허용" 규칙을 그대로 적용하면 됨).
class NoopAds implements AdSeam {
  const NoopAds();

  @override
  Future<void> initialize() async {}

  @override
  Future<void> showColdStartAdIfNeeded({
    required VoidCallback onClosed,
  }) async {
    onClosed();
  }

  @override
  Future<bool> showRewardedAd() async => false;
}
