---
name: version-check
description: >
  Use when implementing app version check against Firebase Realtime Database.
  Trigger when user asks for update dialog, version comparison, force update,
  store link popup, "버전 체크", "업데이트 팝업", "스토어 링크 보여줘" or similar.
---

# App Version Check (Firebase Realtime Database)

Firebase Realtime Database의 `/versioning/{app_name}` 경로에서 최신 버전을 가져와 현재 앱 버전과 비교하고, 업데이트가 필요하면 App Store / Play Store 링크를 보여주는 기능을 구현하는 스킬입니다.

---

## 데이터 구조

### Firebase Realtime Database

경로: `/versioning/{app_name}`

```json
{
  "appstore_link": "https://apps.apple.com/...",
  "playstore_link": "https://play.google.com/...",
  "version": "1.0.0"
}
```

### 로컬 참조

- **app_name**: `lib/const.dart`의 `appNameRealtimeDatabase` 변수
- **현재 버전**: `pubspec.yaml`의 `version` 필드

---

## 구현 워크플로우

### 1단계: 참조값 확인

1. `lib/const.dart`에서 `appNameRealtimeDatabase` 값 확인
2. `pubspec.yaml`에서 현재 앱 버전 확인
3. Firebase Realtime Database 패키지가 `pubspec.yaml`에 있는지 확인 (없으면 추가)

### 2단계: 버전 체크 서비스 구현

별도의 서비스 파일을 만들어 깔끔하게 관리합니다.

**핵심 로직:**

```dart
// Firebase Realtime Database에서 버전 정보 가져오기
final ref = FirebaseDatabase.instance.ref('versioning/$appName');
final snapshot = await ref.get();

if (snapshot.exists) {
  final data = snapshot.value as Map;
  final remoteVersion = data['version'] as String;
  final appstoreLink = data['appstore_link'] as String;
  final playstoreLink = data['playstore_link'] as String;

  // 버전 비교
  if (_isNewerVersion(remoteVersion, currentVersion)) {
    // 업데이트 다이얼로그 표시
  }
}
```

**버전 비교 함수:**

```dart
bool _isNewerVersion(String remote, String current) {
  final remoteParts = remote.split('.').map(int.parse).toList();
  final currentParts = current.split('.').map(int.parse).toList();

  for (int i = 0; i < remoteParts.length; i++) {
    if (i >= currentParts.length) return true;
    if (remoteParts[i] > currentParts[i]) return true;
    if (remoteParts[i] < currentParts[i]) return false;
  }
  return false;
}
```

### 3단계: 업데이트 다이얼로그 구현

- App Store, Play Store 버튼 **둘 다 항상** 보여줌 (플랫폼 구분 없이 심플하게)
- "나중에" 버튼 **없음** — 스토어 버튼만 제공
- `barrierDismissible: false` — 반드시 스토어 버튼을 눌러야 함
- `url_launcher` 패키지로 링크 열기
- 링크가 비어있어도 버튼은 항상 표시 (비어있으면 `onPressed: null`로 비활성화)
- 나중에 Firebase에 링크를 채워넣으면 자동으로 활성화됨

```dart
showDialog(
  context: context,
  barrierDismissible: false,
  builder: (context) => AlertDialog(
    title: Text('업데이트 알림'),
    content: Text('새로운 버전이 출시되었습니다.\n앱을 업데이트해주세요.'),
    actions: [
      TextButton.icon(
        onPressed: appstoreLink.isNotEmpty
            ? () => launchUrl(Uri.parse(appstoreLink))
            : null,
        icon: Icon(Icons.apple_rounded),
        label: Text('App Store'),
      ),
      TextButton.icon(
        onPressed: playstoreLink.isNotEmpty
            ? () => launchUrl(Uri.parse(playstoreLink))
            : null,
        icon: Icon(Icons.shop_rounded),
        label: Text('Play Store'),
      ),
    ],
  ),
);
```

### 4단계: 앱 시작 시 호출

- 홈 화면의 `initState`에서 버전 체크 호출
- **반드시 `addPostFrameCallback` 안에서 호출해야 함** — `initState` 시점에는 위젯 트리가 아직 빌드되지 않아 `showDialog`가 동작하지 않음
- Firebase 초기화 이후에 실행되어야 함

```dart
@override
void initState() {
  super.initState();
  WidgetsBinding.instance.addPostFrameCallback((_) {
    VersionCheckService.checkVersion(context);
  });
}
```

> **주의:** `initState`에서 직접 `VersionCheckService.checkVersion(context)`를 호출하면 dialog가 뜨지 않습니다. 반드시 `addPostFrameCallback`으로 감싸세요.

---

## 필수 패키지

- `firebase_database` — Realtime Database 연결
- `url_launcher` — 스토어 링크 열기
- `package_info_plus` — 런타임에서 현재 앱 버전 가져오기 (pubspec.yaml 버전을 코드에서 읽을 때)

---

## 주의사항

- `pubspec.yaml`의 version은 `1.0.0+1` 형태이므로 `+` 이후 빌드넘버는 비교에서 제외
- `package_info_plus`로 런타임 버전을 가져오는 게 하드코딩보다 안전
- 다이얼로그는 `barrierDismissible: false`로 강제 업데이트 유도 가능 (선택)
- 네트워크 에러 시 조용히 실패 (앱 사용에 지장 없도록), 단 `debugPrint`로 에러 로그는 남길 것
- catch 블록에서 에러를 완전히 삼키지 말고 `debugPrint('VersionCheck error: $e')`로 디버깅 가능하게 할 것

---

## 파일 구조 예시

```
lib/
  services/
    version_check_service.dart    # 버전 체크 로직
  widgets/
    update_dialog.dart            # 업데이트 다이얼로그 (선택)
```


반드시 언어별 번역도 함께해줘.
https:// 가 없으면 추가해서 이동할수있게해줘