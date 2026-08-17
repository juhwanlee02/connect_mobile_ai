---
name: reward-ticket
description: >
  보상형 광고 시청으로 티켓을 획득하고, 티켓을 소모해야 특정 화면에 진입할 수 있는 시스템을 구현하는 스킬.
  Trigger when user asks for rewarded ad ticket, ad ticket system, "보상형 티켓", "광고 보고 열기",
  "티켓 시스템", "광고 시청 후 진입" or similar.
---

# 보상형 광고 티켓 시스템

보상형(RewardedAd) 광고를 시청하면 티켓 3개를 지급하고, 티켓이 있어야 특정 화면에 진입할 수 있는 시스템입니다.

---

## 핵심 규칙

- 티켓 1개 = 화면 1회 열람 (볼 때마다 1개 차감)
- SharedPreferences로 로컬 저장 (앱 꺼도 유지)
- 첫 설치 시 무료 티켓 3개 지급
- 티켓 0개 → 진입 시 광고 보기 다이얼로그 표시
- 보상형 광고 시청 완료 → **티켓 3개 지급** → 1개 차감 후 바로 화면 진입
- 광고가 아직 로드 안 됐으면 무료로 진입 허용 (사용자 경험 우선)

---

## 구현 파일

### `lib/services/ticket_service.dart` (그대로 생성)

```dart
import 'package:shared_preferences/shared_preferences.dart';

class TicketService {
  static const _key = 'ticket_count';
  static const _initKey = 'ticket_initialized';
  static const int initialTickets = 3;

  static Future<int> getTickets() async {
    final prefs = await SharedPreferences.getInstance();
    if (!prefs.containsKey(_initKey)) {
      await prefs.setInt(_key, initialTickets);
      await prefs.setBool(_initKey, true);
    }
    return prefs.getInt(_key) ?? 0;
  }

  static Future<int> useTicket() async {
    final prefs = await SharedPreferences.getInstance();
    final current = prefs.getInt(_key) ?? 0;
    if (current <= 0) return 0;
    final newCount = current - 1;
    await prefs.setInt(_key, newCount);
    return newCount;
  }

  static Future<int> addTickets([int count = 3]) async {
    final prefs = await SharedPreferences.getInstance();
    final current = prefs.getInt(_key) ?? 0;
    final newCount = current + count;
    await prefs.setInt(_key, newCount);
    return newCount;
  }
}
```

### `lib/services/admob_service.dart` (그대로 생성)

```dart
import 'dart:io';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:flutter/foundation.dart';
import '../const.dart';

class AdManager {
  static final AdManager instance = AdManager._internal();
  factory AdManager() => instance;
  AdManager._internal();

  RewardedAd? _rewardedAd;
  bool _isAdReady = false;
  Function? _onAdClosed;

  Future<void> initialize() async {
    await MobileAds.instance.initialize();
    await loadAd();
  }

  bool get isAdReady => _isAdReady;

  String _adUnitId() {
    if (kReleaseMode) {
      return Platform.isAndroid ? releaseAndroidRewardAd : releaseIosRewardAd;
    }
    return Platform.isAndroid ? testAndroidRewardAd : testIosRewardAd;
  }

  Future<void> loadAd() async {
    if (_isAdReady) return;

    await RewardedAd.load(
      adUnitId: _adUnitId(),
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          debugPrint('Rewarded Ad loaded');
          _rewardedAd = ad;
          _isAdReady = true;
          _rewardedAd?.fullScreenContentCallback = FullScreenContentCallback(
            onAdDismissedFullScreenContent: (ad) {
              debugPrint('Rewarded Ad dismissed');
              _isAdReady = false;
              ad.dispose();
              _onAdClosed?.call();
              _onAdClosed = null;
              loadAd();
            },
            onAdFailedToShowFullScreenContent: (ad, error) {
              debugPrint('Rewarded Ad failed to show: $error');
              _isAdReady = false;
              ad.dispose();
              _onAdClosed?.call();
              _onAdClosed = null;
              loadAd();
            },
          );
        },
        onAdFailedToLoad: (error) {
          debugPrint('Rewarded Ad failed to load: $error');
          _isAdReady = false;
        },
      ),
    );
  }

  Future<void> showAd({required Function onClosed}) async {
    if (_isAdReady && _rewardedAd != null) {
      _onAdClosed = onClosed;
      await _rewardedAd!.show(
        onUserEarnedReward: (AdWithoutView ad, RewardItem reward) {
          debugPrint('User earned reward: ${reward.amount} ${reward.type}');
        },
      );
    } else {
      onClosed();
    }
  }

  void dispose() {
    _rewardedAd?.dispose();
    _onAdClosed = null;
  }
}
```

---

## 구현 워크플로우

### 1단계: 파일 생성

위의 `ticket_service.dart`와 `admob_service.dart`를 그대로 생성합니다. 이미 존재하면 스킵합니다.

### 2단계: 화면 진입 로직

티켓을 적용할 화면의 진입 메서드에서:

1. `TicketService.getTickets()`로 잔여 티켓 확인
2. 티켓 > 0 → `useTicket()` 후 화면 진입
3. 티켓 == 0 → 광고 다이얼로그 표시

### 3단계: 광고 다이얼로그 UI

광고 다이얼로그의 content에 티켓 아이콘(`Icons.confirmation_number_rounded`)을 설명 텍스트 옆에 표시하여 직관적으로 티켓 시스템임을 알 수 있게 합니다:

```dart
content: Row(
  children: [
    Icon(Icons.confirmation_number_rounded,
        color: colors.highlight, size: 22),
    const SizedBox(width: 8),
    Expanded(
      child: Text(t.watchAdForTicket,
          style: TextStyle(color: colors.textSecondary)),
    ),
  ],
),
```

- 홈 화면 AppBar의 티켓 아이콘과 동일한 `confirmation_number` 계열 아이콘 사용
- `colors.highlight` 색상으로 통일
- `Expanded`로 텍스트 감싸서 overflow 방지

### 4단계: 광고 시청 후 진입

- `AdManager.instance`의 `showAd(onClosed:)` 사용
- `onClosed` 콜백에서 `TicketService.addTickets(3)` → `useTicket()` → 화면 진입
- 광고 미로드 시 무료 진입 허용

---

## 필수 번역 키

모든 언어 JSON 파일(`assets/lang/*.json`)에 다음 키를 추가:

| 키 | 한국어 | 영어 |
|---|---|---|
| `ticketNeeded` | 티켓이 필요합니다 | Ticket Required |
| `watchAdForTicket` | 광고를 시청하면 티켓 3개를 받을 수 있습니다. | Watch an ad to get 3 tickets. |
| `watchAd` | 광고 보기 | Watch Ad |
| `cancel` | 취소 | Cancel |

`lib/services/app_translations.dart`에도 getter 추가 필요.

---

## 광고 연동

- `lib/services/admob_service.dart`의 `AdManager` 싱글턴 사용
- `AdManager.instance.isAdReady`로 광고 로드 여부 확인
- `AdManager.instance.showAd(onClosed: () { ... })`로 광고 표시
- 광고 ID는 `lib/const.dart`에 정의된 보상형 광고 ID만 사용 (const.dart 내용은 절대 수정하지 말 것)
- **절대 새로운 광고 타입(Interstitial 등)을 추가하지 말 것**

---

## 주의사항

- `mounted` 체크를 반드시 async 작업 후에 할 것
- 광고 미로드 시 사용자 경험을 위해 무료 진입 허용
- 티켓 초기화는 `_initKey`로 첫 설치 여부 판단 (앱 삭제 후 재설치 시 리셋됨)
- 반드시 모든 언어별 번역도 함께 추가할 것
