/// `commands/skills/version-check` 스킬 적용 전 기본 스텁.
///
/// version-check 스킬은 Firebase Realtime Database(`firebase_database`)를
/// 전제로 하는데, 스타터는 "기본 백엔드 없음" 원칙을 따르므로(스펙 §11)
/// 이 스킬은 채택 시에만 활성화되는 스텁으로 시드한다. 스타터 자체는
/// `firebase_database`, `url_launcher`, `package_info_plus` 중 어느 것도
/// 의존성에 추가하지 않는다.
///
/// **스킬 적용 절차** (`commands/skills/version-check/SKILL.md` 참조):
///   1. `pubspec.yaml`에 `firebase_database`, `url_launcher`,
///      `package_info_plus`를 추가하고 Firebase 프로젝트를 구성한다.
///   2. SKILL.md의 `VersionCheckService`(원격 버전 조회·비교)와
///      업데이트 다이얼로그 위젯을 그대로 생성한다.
///   3. 아래 [kVersionCheckEnabled]를 `true`로 바꾸거나, 이 파일 자체를
///      실제 서비스 export로 교체한다.
///   4. 홈 화면 `initState`의 `addPostFrameCallback` 안에서
///      `VersionCheckService.checkVersion(context)` 호출을 배선한다
///      (SKILL.md 4단계 — `initState`에서 직접 호출하면 다이얼로그가 뜨지
///      않으므로 반드시 `addPostFrameCallback`으로 감싼다. main()에는
///      BuildContext가 없어 호출 불가).
///
/// 이 상수가 `false`인 동안은 버전 체크가 아예 호출되지 않는다 — 스타터
/// 단계에서는 Firebase 프로젝트가 없어도 앱이 정상 동작해야 하기 때문이다.
const bool kVersionCheckEnabled = false;
