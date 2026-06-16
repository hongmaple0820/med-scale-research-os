#!/usr/bin/env bash
set -euo pipefail

FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"
if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  src/*.ts|src/**/*.ts) ;;
  *) exit 0 ;;
esac

if grep -Eq "(fetch\\(|execa\\(|spawn\\(|execFile\\(|readFileSync\\(|writeFileSync\\()" "$FILE_PATH" 2>/dev/null; then
  if ! grep -Eq "(timeout|AbortController|try \\{|catch \\{|safe|validate|z\\.)" "$FILE_PATH" 2>/dev/null; then
    echo "[scale-engine] context warning: $FILE_PATH touches IO/process APIs; check timeout, validation, and error handling."
  fi
fi

exit 0

