#!/usr/bin/env bash
# G19: Code Review — verify review artifacts exist
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G19] Code Review"
echo "  Checking review artifacts..."

cd "$REPO_ROOT"

SCALE_DIR="${SCALE_DIR:-.scale}"
STATE_DIR="$SCALE_DIR/state"

if [ ! -d "$STATE_DIR" ]; then
  echo "  [INFO] No $STATE_DIR directory (advisory for L+ tasks)"
  echo "  PASSED"
  exit 0
fi

REVIEW_COUNT=$(find "$STATE_DIR" -name "review-*.json" -type f 2>/dev/null | wc -l | tr -d ' ')

if [ "$REVIEW_COUNT" -eq 0 ]; then
  echo "  [INFO] No review artifacts found (required for L/CRITICAL)"
  echo "  PASSED"
  exit 0
fi

echo "  [OK] $REVIEW_COUNT review file(s) found"

# Check for unresolved findings
UNRESOLVED=0
for f in "$STATE_DIR"/review-*.json; do
  [ -f "$f" ] || continue
  if command -v node &>/dev/null; then
    COUNT=$(node -e "
      const r = JSON.parse(require('fs').readFileSync('$f','utf-8'));
      const u = (r.findings||[]).filter(f=>!f.resolved).length;
      process.stdout.write(String(u));
    " 2>/dev/null || echo 0)
    UNRESOLVED=$((UNRESOLVED + COUNT))
  fi
done

if [ "$UNRESOLVED" -gt 0 ]; then
  echo "  [WARN] $UNRESOLVED unresolved finding(s)"
else
  echo "  [OK] No unresolved findings"
fi

echo "  PASSED"
