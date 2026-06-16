#!/usr/bin/env bash
set -euo pipefail

FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  *.env|*.env.*|*.key|*.pem|*.p12|*.crt|*secret*|*credential*|*password*|*token*)
    echo "[scale-engine] blocked sensitive file edit: $FILE_PATH"
    exit 2
    ;;
  node_modules/*|dist/*|coverage/*|test-results/*|playwright-report/*|.scale/events/*|.scale/evidence/*|.scale/state/*|.scale/*.db*)
    echo "[scale-engine] blocked generated/runtime file edit: $FILE_PATH"
    exit 2
    ;;
esac

exit 0

