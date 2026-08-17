#!/usr/bin/env bash
# 원자적 rename 헬퍼 — 파이프라인 스킬 전용.
# 사용: bash .claude/atomic-mv.sh <tmp파일> <대상파일>
set -euo pipefail
tmp="$1"; target="$2"
[ -f "$tmp" ] || { echo "tmp 없음: $tmp" >&2; exit 1; }
# 경계: 대상은 현재 프로젝트 내부 경로 또는 정확히 ../ideas-index.json 만 허용
case "$target" in
  ../ideas-index.json) ;;                      # 유일한 외부 예외(전역 인덱스)
  /*|../*) echo "허용되지 않는 대상 경로: $target" >&2; exit 1 ;;
  *) ;;
esac
mv "$tmp" "$target"
