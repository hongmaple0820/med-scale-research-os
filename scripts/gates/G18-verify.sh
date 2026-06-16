#!/usr/bin/env bash
# G18: Runtime Evidence — verify runtime evidence exists and is fresh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G18] Runtime Evidence"
echo "  Checking evidence directory..."

cd "$REPO_ROOT"

SCALE_DIR="${SCALE_DIR:-.scale}"
EVIDENCE_DIR="$SCALE_DIR/evidence"

if [ ! -d "$EVIDENCE_DIR" ]; then
  echo "  [BLOCK] No $EVIDENCE_DIR directory found"
  exit 1
fi

EVIDENCE_COUNT=$(find "$EVIDENCE_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "  [INFO] $EVIDENCE_COUNT evidence file(s)"

if [ "$EVIDENCE_COUNT" -eq 0 ]; then
  echo "  [BLOCK] No evidence files found"
  exit 1
fi

# Check freshness (most recent file within 24h)
LATEST=$(find "$EVIDENCE_DIR" -name "*.json" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
if [ -n "$LATEST" ]; then
  if [ -f "$LATEST" ]; then
    MTIME=$(stat --printf="%Y" "$LATEST" 2>/dev/null || stat -f%m "$LATEST" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    HOURS=$(( (NOW - MTIME) / 3600 ))
    if [ "$HOURS" -lt 24 ]; then
      echo "  [OK] Latest evidence ${HOURS}h ago (< 24h)"
    else
      echo "  [WARN] Latest evidence ${HOURS}h ago (>= 24h, stale)"
    fi
  fi
fi

echo "  PASSED"
