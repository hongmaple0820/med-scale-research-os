#!/usr/bin/env bash
# G8: document and workflow artifact standards verification.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "========================================"
echo "[G8] Document standards gate"
echo "========================================"

cd "$PROJECT_ROOT"

CHANGED_MD="$(
  {
    git diff --name-only --diff-filter=AM HEAD -- '*.md' 2>/dev/null || true
    git ls-files --others --exclude-standard -- '*.md' 2>/dev/null || true
  } | sort -u
)"

if [ -z "$CHANGED_MD" ]; then
  echo "[G8] passed: no new/modified markdown files"
  exit 0
fi

echo "[G8] checking changed markdown files:"
echo "$CHANGED_MD"
echo ""

ALL_PASS=true

while IFS= read -r file; do
  [ -z "$file" ] && continue
  filepath="$PROJECT_ROOT/$file"
  [ -f "$filepath" ] || continue

  echo "[G8] checking: $file"

  if grep -qiE "(password|secret|token|api_key)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}" "$filepath" 2>/dev/null; then
    echo "  [FAIL] possible hardcoded secret detected"
    ALL_PASS=false
  fi

  if grep -q $'\r' "$filepath" 2>/dev/null; then
    echo "  [WARN] CRLF detected in markdown"
  fi

  if grep -nE '[[:blank:]]$' "$filepath" >/dev/null 2>&1; then
    echo "  [WARN] trailing whitespace detected"
  fi

  if grep -qE '\[[^]]+\]\(https?://(localhost|127\.0\.0\.1)' "$filepath" 2>/dev/null; then
    echo "  [WARN] localhost links found; prefer relative paths or runtime notes"
  fi
done <<< "$CHANGED_MD"

echo ""
if [ "$ALL_PASS" = true ]; then
  echo "[G8] passed"
  exit 0
fi

echo "[G8] failed"
exit 1
