#!/usr/bin/env bash
# G21: Context Budget — advisory check on context token usage
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G21] Context Budget"
echo "  Checking context budget..."

cd "$REPO_ROOT"

SCALE_DIR="${SCALE_DIR:-.scale}"

if [ -f "$SCALE_DIR/context-budget.json" ]; then
  echo "  [OK] Context budget configured"
else
  echo "  [INFO] No context budget configuration (advisory)"
fi

if [ -f "$SCALE_DIR/context-budget-report.json" ]; then
  if command -v node &>/dev/null; then
    node -e "
      const r = JSON.parse(require('fs').readFileSync('$SCALE_DIR/context-budget-report.json','utf-8'));
      const total = r.summary?.totalTokens ?? 0;
      const max = r.thresholds?.maxAlwaysTokens ?? 10000;
      console.log('  [INFO] ' + total + ' tokens / ' + max + ' max');
    " 2>/dev/null || echo "  [INFO] Budget report exists"
  fi
else
  echo "  [INFO] No budget report"
fi

echo "  PASSED"
