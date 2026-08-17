#!/usr/bin/env bash
#
# apply.sh <target_dir>
#
# Flutter 스타터 오버레이를 대상 프로젝트(예: `flutter create <slug> --org
# <org>`로 만든 프로젝트)에 적용한다. Phase 4 develop 스킬은 이 스크립트만
# 호출한다 — apply 절차를 여기 고정해서 스킬 쪽에서 매번 재구현하지 않는다.
#
# 하는 일:
#   1) overlay/ 디렉터리 전체를 <target_dir>에 복사한다(기존 파일을 덮어씀 —
#      특히 lib/main.dart는 스타터 버전으로 교체된다).
#   2) pubspec.deps.yaml의 dependencies 블록을 <target_dir>/pubspec.yaml의
#      dependencies 블록에 병합한다.
#   3) pubspec.deps.yaml의 flutter.assets 블록을 <target_dir>/pubspec.yaml의
#      flutter: 섹션에 병합한다(assets/lang/ 등록 — JSON i18n용).
#   4) <target_dir>에서 `flutter pub get`을 실행한다.
#
# pubspec dependencies 병합 규칙 (pubspec.deps.yaml 상단 주석과 동일 —
# 단순·견고 우선):
#   - pubspec.deps.yaml의 `dependencies:` 아래 각 최상위 항목(`  key: value`
#     형태, 2-space 들여쓰기)을 하나씩 확인한다.
#   - target pubspec.yaml의 `dependencies:` 블록 안에 동일한 최상위 `key:`가
#     이미 있으면 건너뛴다(중복 키 무시 — 기존 값을 존중, 값 비교/버전
#     충돌 해소는 하지 않음).
#   - 없으면 target의 `dependencies:` 블록 끝(다음 최상위 섹션 — 보통
#     `dev_dependencies:` — 직전, 또는 파일 끝)에 그 줄을 그대로 append한다.
#   - 이것은 진짜 YAML 파서가 아니라 텍스트 라인 단위 처리다. 중첩 값
#     (예: `flutter:\n    sdk: flutter`처럼 4-space로 더 들여쓴 하위 줄)은
#     최상위 키 판별에서 제외되어 건드리지 않는다.
#
# pubspec flutter.assets 병합 규칙 (pubspec.deps.yaml 상단 주석과 동일):
#   - pubspec.deps.yaml의 최상위 `flutter:` 아래 `  assets:`(2-space) 리스트의
#     각 항목(`    - path`, 4-space)을 확인한다.
#   - target pubspec.yaml의 `flutter:` 섹션 안에 `  assets:` 키가 이미 있으면
#     그 리스트에 없는 항목만 끝에 append한다.
#   - `assets:` 키 자체가 없으면(flutter create 기본 pubspec은 assets 예시가
#     전부 주석 처리돼 있어 이 경우에 해당) `flutter:` 줄 바로 다음에
#     `  assets:`와 항목들을 새로 삽입한다.
#   - 이미 등록된 항목은 재실행 시 건너뛴다(멱등).
#
# 사용:
#   flutter create <slug_snake> --org <org>
#   bash templates/flutter-starter/apply.sh <slug_snake>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY_DIR="$SCRIPT_DIR/overlay"
DEPS_FILE="$SCRIPT_DIR/pubspec.deps.yaml"

if [[ $# -ne 1 ]]; then
  echo "usage: apply.sh <target_dir>" >&2
  exit 1
fi

TARGET_DIR="$1"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "error: target directory not found: $TARGET_DIR" >&2
  exit 1
fi

if [[ ! -f "$TARGET_DIR/pubspec.yaml" ]]; then
  echo "error: $TARGET_DIR/pubspec.yaml not found — run 'flutter create' first" >&2
  exit 1
fi

if [[ ! -d "$OVERLAY_DIR" ]]; then
  echo "error: overlay directory not found at $OVERLAY_DIR" >&2
  exit 1
fi

if [[ ! -f "$DEPS_FILE" ]]; then
  echo "error: pubspec.deps.yaml not found at $DEPS_FILE" >&2
  exit 1
fi

echo "==> Copying overlay files into $TARGET_DIR"
cp -R "$OVERLAY_DIR"/. "$TARGET_DIR"/

# `flutter create`가 생성한 기본 test/widget_test.dart는 기본 템플릿의
# `MyApp` 클래스를 참조한다. overlay/lib/main.dart가 그 클래스를 대체하므로
# 그대로 두면 컴파일 에러가 난다. 오버레이는 test/smoke_test.dart로 그 역할을
# 대신하므로 기본 파일은 제거한다.
if [[ -f "$TARGET_DIR/test/widget_test.dart" ]]; then
  echo "==> Removing default test/widget_test.dart (references the pre-overlay MyApp)"
  rm -f "$TARGET_DIR/test/widget_test.dart"
fi

echo "==> Merging dependencies from $DEPS_FILE into $TARGET_DIR/pubspec.yaml"
PUBSPEC="$TARGET_DIR/pubspec.yaml"
MERGED="$(mktemp)"
trap 'rm -f "$MERGED"' EXIT

awk -v deps_file="$DEPS_FILE" '
  BEGIN {
    in_deps = 0
    n = 0
    while ((getline dline < deps_file) > 0) {
      if (dline ~ /^dependencies:[ \t]*$/) {
        in_deps = 1
        continue
      }
      if (in_deps) {
        if (dline ~ /^[^ \t#]/) {
          in_deps = 0
        } else if (dline ~ /^[ \t]{2}[A-Za-z0-9_]+:/) {
          key = dline
          sub(/^[ \t]+/, "", key)
          sub(/:.*/, "", key)
          dep_key[n] = key
          dep_line[n] = dline
          n++
        }
      }
    }
    close(deps_file)
  }
  { lines[NR] = $0 }
  END {
    total = NR
    dep_start = 0
    dep_end = total + 1
    for (i = 1; i <= total; i++) {
      if (lines[i] ~ /^dependencies:[ \t]*$/) {
        dep_start = i
        continue
      }
      if (dep_start > 0 && i > dep_start && lines[i] ~ /^[^ \t#]/) {
        dep_end = i
        break
      }
    }
    if (dep_start == 0) {
      print "error: no top-level '\''dependencies:'\'' section found in target pubspec.yaml" > "/dev/stderr"
      exit 1
    }

    delete existing
    for (i = dep_start + 1; i < dep_end; i++) {
      if (lines[i] ~ /^[ \t]{2}[A-Za-z0-9_]+:/) {
        k = lines[i]
        sub(/^[ \t]+/, "", k)
        sub(/:.*/, "", k)
        existing[k] = 1
      }
    }

    for (i = 1; i <= total; i++) {
      if (i == dep_end) {
        for (j = 0; j < n; j++) {
          if (!(dep_key[j] in existing)) {
            print dep_line[j]
            existing[dep_key[j]] = 1
          }
        }
      }
      print lines[i]
    }
    if (dep_end > total) {
      for (j = 0; j < n; j++) {
        if (!(dep_key[j] in existing)) {
          print dep_line[j]
        }
      }
    }
  }
' "$PUBSPEC" > "$MERGED"

mv "$MERGED" "$PUBSPEC"

echo "==> Merging flutter.assets from $DEPS_FILE into $TARGET_DIR/pubspec.yaml"
MERGED2="$(mktemp)"
trap 'rm -f "$MERGED2"' EXIT

awk -v deps_file="$DEPS_FILE" '
  BEGIN {
    in_flutter = 0
    in_assets = 0
    an = 0
    while ((getline dline < deps_file) > 0) {
      if (dline ~ /^flutter:[ \t]*$/) {
        in_flutter = 1
        in_assets = 0
        continue
      }
      if (in_flutter) {
        if (dline ~ /^[^ \t#]/) {
          in_flutter = 0
          continue
        }
        if (dline ~ /^[ \t]{2}assets:[ \t]*$/) {
          in_assets = 1
          continue
        }
        if (in_assets) {
          if (dline ~ /^[ \t]{4}-[ \t]*/) {
            item = dline
            sub(/^[ \t]{4}-[ \t]*/, "", item)
            gsub(/[ \t]+$/, "", item)
            asset_item[an] = item
            an++
          } else if (dline ~ /^[ \t]{2}[A-Za-z]/) {
            in_assets = 0
          }
        }
      }
    }
    close(deps_file)
  }
  { lines[NR] = $0 }
  END {
    total = NR
    flutter_start = 0
    flutter_end = total + 1
    for (i = 1; i <= total; i++) {
      if (lines[i] ~ /^flutter:[ \t]*$/) {
        flutter_start = i
        continue
      }
      if (flutter_start > 0 && i > flutter_start && lines[i] ~ /^[^ \t#]/) {
        flutter_end = i
        break
      }
    }
    if (flutter_start == 0) {
      print "error: no top-level '\''flutter:'\'' section found in target pubspec.yaml" > "/dev/stderr"
      exit 1
    }

    assets_line = 0
    assets_end = flutter_end
    for (i = flutter_start + 1; i < flutter_end; i++) {
      if (lines[i] ~ /^[ \t]{2}assets:[ \t]*$/) {
        assets_line = i
        continue
      }
      if (assets_line > 0 && i > assets_line) {
        if (lines[i] ~ /^[ \t]{4}-[ \t]*/) {
          continue
        }
        assets_end = i
        break
      }
    }

    delete existing
    if (assets_line > 0) {
      for (i = assets_line + 1; i < assets_end; i++) {
        if (lines[i] ~ /^[ \t]{4}-[ \t]*/) {
          item = lines[i]
          sub(/^[ \t]{4}-[ \t]*/, "", item)
          gsub(/[ \t]+$/, "", item)
          existing[item] = 1
        }
      }
    }

    for (i = 1; i <= total; i++) {
      print lines[i]
      if (assets_line > 0 && i == assets_end - 1) {
        for (j = 0; j < an; j++) {
          if (!(asset_item[j] in existing)) {
            print "    - " asset_item[j]
            existing[asset_item[j]] = 1
          }
        }
      }
      if (assets_line == 0 && i == flutter_start) {
        print "  assets:"
        for (j = 0; j < an; j++) {
          print "    - " asset_item[j]
        }
      }
    }
  }
' "$PUBSPEC" > "$MERGED2"

mv "$MERGED2" "$PUBSPEC"

echo "==> Running flutter pub get in $TARGET_DIR"
( cd "$TARGET_DIR" && flutter pub get )

echo "==> Done. Overlay applied to $TARGET_DIR"
