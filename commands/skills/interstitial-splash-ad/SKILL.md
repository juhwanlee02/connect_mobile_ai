---
name: interstitial-splash-ad
description: >
  앱 시작 시 스플래쉬 화면을 보여주는 동안 전면광고(Interstitial Ad)를 로드·표시하는 시스템 구현 스킬.
  최소 표시 시간, 광고 로드 대기, 전체 타임아웃을 조율하는 타이밍 로직 포함.
  Trigger when user asks for splash ad, cold start ad, interstitial on launch, "전면광고 스플래쉬",
  "앱 시작 광고", "스플래쉬 광고", "cold start interstitial" or similar.
---

# 전면광고 스플래쉬 시스템

앱 첫 실행 시 스플래쉬 화면을 유지하면서 전면광고를 로드하고 표시합니다.
최소 노출 시간과 전체 타임아웃으로 사용자 경험을 보호합니다.

---

## 타이밍 파라미터

| 파라미터 | 기본값 | 역할 |
|---------|--------|------|
| `minSplashMs` | 1200ms | 스플래쉬 최소 표시 시간 |
| `adLoadTimeoutSec` | 10s | 광고 로드 대기 최대 시간 (서비스 내부) |
| `splashTotalMs` | 3500ms | 스플래쉬 전체 최대 허용 시간 |

> 앱마다 숫자만 조정. 로직 구조는 그대로 재사용.

---

## 구현 파일 3개

### 1. `lib/const.dart` — 광고 ID 상수

```dart
// 전면광고 (Interstitial)
const testAndroidInterstitialAd  = 'ca-app-pub-3940256099942544/1033173712';
const testIosInterstitialAd      = 'ca-app-pub-3940256099942544/4411468910';
const releaseAndroidInterstitialAd = 'YOUR_ANDROID_INTERSTITIAL_ID';
const releaseIosInterstitialAd     = 'YOUR_IOS_INTERSTITIAL_ID';
```

---

### 2. `lib/core/services/interstitial_ad_service.dart` — 광고 서비스

```dart
import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import '../../const.dart';

class InterstitialAdService {
  InterstitialAdService._();
  static final InterstitialAdService instance = InterstitialAdService._();

  InterstitialAd? _ad;
  bool _isReady = false;
  bool _coldStartShown = false;
  Completer<void>? _loadCompleter;

  String get _adUnitId {
    if (kReleaseMode) {
      return Platform.isAndroid
          ? releaseAndroidInterstitialAd
          : releaseIosInterstitialAd;
    }
    return Platform.isAndroid
        ? testAndroidInterstitialAd
        : testIosInterstitialAd;
  }

  /// 앱 시작 시 1회 호출 (main.dart에서 await)
  Future<void> initialize() async {
    await MobileAds.instance.initialize();
    _loadAd();
  }

  void _loadAd() {
    _loadCompleter = Completer<void>();
    InterstitialAd.load(
      adUnitId: _adUnitId,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (ad) {
          _ad = ad;
          _isReady = true;
          if (!(_loadCompleter?.isCompleted ?? true)) {
            _loadCompleter!.complete();
          }
        },
        onAdFailedToLoad: (error) {
          _isReady = false;
          debugPrint('InterstitialAd failed to load: $error');
          if (!(_loadCompleter?.isCompleted ?? true)) {
            _loadCompleter!.completeError(error);
          }
        },
      ),
    );
  }

  Future<void> showAd({required VoidCallback onClosed}) async {
    if (!_isReady || _ad == null) {
      onClosed();
      return;
    }
    _isReady = false;
    _ad!.fullScreenContentCallback = FullScreenContentCallback(
      onAdDismissedFullScreenContent: (ad) {
        ad.dispose();
        _ad = null;
        _loadAd(); // 다음 광고 미리 로드
        onClosed();
      },
      onAdFailedToShowFullScreenContent: (ad, error) {
        debugPrint('InterstitialAd failed to show: $error');
        ad.dispose();
        _ad = null;
        _loadAd();
        onClosed();
      },
    );
    try {
      await _ad!.show();
    } catch (e) {
      debugPrint('InterstitialAd show exception: $e');
      _ad?.dispose();
      _ad = null;
      _loadAd();
      onClosed();
    }
  }

  /// 콜드스타트 1회만 광고 표시. isCancelled로 타임아웃 후 광고 억제.
  Future<void> showColdStartAdIfNeeded({
    VoidCallback? onClosed,
    bool Function()? isCancelled,
  }) async {
    if (_coldStartShown) {
      onClosed?.call();
      return;
    }
    _coldStartShown = true;
    final loadFuture = _loadCompleter?.future;
    if (loadFuture == null) {
      onClosed?.call();
      return;
    }
    try {
      // 광고 로드 완료까지 최대 10초 대기
      await loadFuture.timeout(const Duration(seconds: 10));
    } catch (_) {
      onClosed?.call();
      return;
    }
    // 스플래쉬 전체 타임아웃이 이미 지난 경우 광고 표시 안 함
    if (isCancelled != null && isCancelled()) return;
    await showAd(onClosed: onClosed ?? () {});
  }

  @visibleForTesting
  void resetColdStartForDebug() => _coldStartShown = false;

  @visibleForTesting
  void resetForTesting() {
    _ad?.dispose();
    _ad = null;
    _isReady = false;
    _coldStartShown = false;
    _loadCompleter = null;
  }
}
```

---

### 3. `lib/main.dart` — 스플래쉬 오케스트레이션

앱의 루트 StatefulWidget에 `_splashDone` 플래그를 추가하고 아래 패턴을 적용합니다.

```dart
class _AppState extends State<App> {
  bool _splashDone = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _runSplash());
  }

  Future<void> _runSplash() async {
    // 웹은 google_mobile_ads 미지원 → 즉시 완료
    if (kIsWeb) {
      if (mounted) setState(() => _splashDone = true);
      return;
    }

    // 디버그: hot restart 시에도 광고 테스트 가능
    if (kDebugMode) {
      InterstitialAdService.instance.resetColdStartForDebug();
    }

    bool cancelled = false;
    final adCompleter = Completer<void>();

    // 광고 로드·표시를 병렬로 시작 (unawaited)
    unawaited(
      InterstitialAdService.instance.showColdStartAdIfNeeded(
        onClosed: () {
          if (!adCompleter.isCompleted) adCompleter.complete();
        },
        isCancelled: () => cancelled,
      ),
    );

    // 최소 표시 시간 + 광고 완료 중 늦은 쪽을 기다리되, 전체 타임아웃 적용
    await Future.wait([
      Future.delayed(const Duration(milliseconds: 1200)), // minSplashMs
      adCompleter.future,
    ]).timeout(
      const Duration(milliseconds: 3500), // splashTotalMs
      onTimeout: () {
        cancelled = true; // 타임아웃 후 광고 표시 억제
        return [];
      },
    );

    if (mounted) setState(() => _splashDone = true);
  }

  @override
  Widget build(BuildContext context) {
    // 스플래쉬 완료 전: SplashScreen 유지
    if (!_splashDone) {
      return MaterialApp(home: const SplashScreen());
    }
    // 이후 정상 라우팅 (EULA, 로그인, 메인 등)
    return MaterialApp(home: const HomeScreen());
  }
}
```

---

## 타이밍 흐름

```
앱 시작
  │
  ├─ initialize() ──► _loadAd() 시작 (비동기)
  │
  ├─ _runSplash() 호출
  │     ├─ showColdStartAdIfNeeded() ─ unawaited 병렬 시작
  │     │     └─ loadFuture 최대 10초 대기
  │     │           └─ 완료 → isCancelled? → showAd() → onClosed()
  │     │
  │     └─ Future.wait([minDelay(1200ms), adCompleter])
  │           └─ .timeout(3500ms, onTimeout: cancelled=true)
  │
  └─ _splashDone = true → 다음 화면
```

**핵심:** 광고가 빨리 로드되면 `minSplashMs` 이후 진행.
광고가 느리면 `splashTotalMs` 에 강제 종료. 광고 미로드도 onClosed로 안전 처리.

---

## 초기화 (main 함수)

```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // ... Firebase 등 초기화 ...

  // 웹 제외하고 광고 초기화
  if (!kIsWeb) await InterstitialAdService.instance.initialize();

  runApp(const MyApp());
}
```

---

## pubspec.yaml

```yaml
dependencies:
  google_mobile_ads: ^7.0.0
```

---

## AndroidManifest.xml

```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX"/>
```

---

## 주의사항

- `kIsWeb` 가드 필수 — 웹은 google_mobile_ads 미지원
- `isCancelled` 콜백 없으면 타임아웃 후에도 광고가 뒤늦게 팝업될 수 있음
- `_coldStartShown` 플래그로 앱 생명주기 내 1회만 표시
- `onClosed` 누락 시 스플래쉬가 무한 대기하므로 모든 에러 경로에서 반드시 호출
- 광고 ID는 반드시 `const.dart`에 분리 보관
