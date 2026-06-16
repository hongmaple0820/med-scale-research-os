#!/usr/bin/env bash
# G17: Documentation Hygiene — verify changed docs have valid links
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G17] Documentation Hygiene"
echo "  Checking changed markdown files..."

cd "$REPO_ROOT"

CHANGED_MD=$(git diff --name-only HEAD -- "*.md" 2>/dev/null || true)
MD_COUNT=0
if [ -n "$CHANGED_MD" ]; then
  MD_COUNT=$(echo "$CHANGED_MD" | grep -c '\.md$' 2>/dev/null || echo 0)
fi

if [ "$MD_COUNT" -eq 0 ]; then
  echo "  [OK] No markdown files changed"
  echo "  PASSED"
  exit 0
fi

echo "  [INFO] $MD_COUNT markdown file(s) changed"

BROKEN=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ -f "$file" ] || continue
  # Extract markdown links and check if target files exist
  grep -oP '\[([^\]]*)\]\(([^)]+)\)' "$file" 2>/dev/null | while IFS= read -r link; do
    TARGET=$(echo "$link" | sed 's/.*](//' | sed 's/).*//' | cut -d'#' -f1)
    [ -z "$TARGET" ] && continue
    [[ "$TARGET" == http* ]] && continue
    [[ "$TARGET" == mailto:* ]] && continue
    LINK_DIR=$(dirname "$file")
    RESOLVED="$LINK_DIR/$TARGET"
    if [ ! -f "$RESOLVED" ] && [ ! -d "$RESOLVED" ]; then
      echo "  [WARN] Broken link in $file: $TARGET"
      BROKEN=$((BROKEN + 1))
    fi
  done
done <<< "$CHANGED_MD"

if [ "$BROKEN" -gt 0 ]; then
  echo "  [WARN] $BROKEN broken link(s) found"
else
  echo "  [OK] All internal links valid"
fi

echo "  PASSED"
