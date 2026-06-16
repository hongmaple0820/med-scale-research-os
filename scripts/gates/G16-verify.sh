#!/usr/bin/env bash
# G16: Commit Discipline — verify uncommitted changes are within thresholds
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G16] Commit Discipline"
echo "  Checking uncommitted files..."

cd "$REPO_ROOT"

UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
LAST_COMMIT_MINUTES=""
if LAST_COMMIT_TS=$(git log -1 --format=%ct 2>/dev/null); then
  NOW_TS=$(date +%s)
  ELAPSED=$((NOW_TS - LAST_COMMIT_TS))
  LAST_COMMIT_MINUTES=$((ELAPSED / 60))
fi

STAGED_LARGE=""
if git diff --cached --name-only 2>/dev/null | head -20 | while read -r f; do
  if [ -f "$f" ]; then
    SIZE=$(stat --printf="%s" "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 1000000 ]; then
      echo "$f"
    fi
  fi
done | head -1 | grep -q .; then
  STAGED_LARGE="yes"
fi

BLOCKED=false

if [ "$UNCOMMITTED" -ge 25 ]; then
  echo "  [BLOCK] $UNCOMMITTED uncommitted files (threshold: 25)"
  BLOCKED=true
elif [ "$UNCOMMITTED" -ge 10 ]; then
  echo "  [WARN] $UNCOMMITTED uncommitted files (threshold: 10)"
else
  echo "  [OK] $UNCOMMITTED uncommitted files"
fi

if [ -n "$LAST_COMMIT_MINUTES" ]; then
  if [ "$LAST_COMMIT_MINUTES" -ge 180 ]; then
    echo "  [BLOCK] Last commit ${LAST_COMMIT_MINUTES}min ago (threshold: 180min)"
    BLOCKED=true
  elif [ "$LAST_COMMIT_MINUTES" -ge 60 ]; then
    echo "  [WARN] Last commit ${LAST_COMMIT_MINUTES}min ago (threshold: 60min)"
  else
    echo "  [OK] Last commit ${LAST_COMMIT_MINUTES}min ago"
  fi
fi

if [ -n "$STAGED_LARGE" ]; then
  echo "  [BLOCK] Large staged files detected (>1MB)"
  BLOCKED=true
else
  echo "  [OK] No large staged files"
fi

DIFF_CHECK=$(git diff --check 2>&1 || true)
if [ -n "$DIFF_CHECK" ]; then
  echo "  [WARN] git diff --check found whitespace errors"
else
  echo "  [OK] No whitespace errors"
fi

if [ "$BLOCKED" = true ]; then
  exit 1
fi
echo "  PASSED"
