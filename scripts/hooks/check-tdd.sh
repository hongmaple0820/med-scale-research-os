#!/usr/bin/env bash
set -euo pipefail

FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  src/*.ts|src/**/*.ts) ;;
  *) exit 0 ;;
esac

case "$FILE_PATH" in
  *.test.ts|*.spec.ts|src/api/cli.ts) exit 0 ;;
esac

BASENAME="$(basename "$FILE_PATH" .ts)"
if ! find tests src -name "*${BASENAME}*.test.ts" -o -name "*${BASENAME}*.spec.ts" 2>/dev/null | grep -q .; then
  echo "[scale-engine] test evidence warning: changed $FILE_PATH without a nearby *${BASENAME}*.test.ts file."
fi

exit 0

