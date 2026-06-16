#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"
STATE_FILE="$ROOT/.agent/state/current.json"
PY_STATE="$ROOT/scripts/lib/workflow_state.py"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  src/*.ts|src/**/*.ts|tests/*.ts|tests/**/*.ts) ;;
  *) exit 0 ;;
esac

if [ ! -f "$STATE_FILE" ]; then
  echo "[scale-engine] no workflow state found. For M/L work run: bash scripts/workflow/new-task.sh <task-slug> M"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  exit 0
fi

LEVEL="$(python3 "$PY_STATE" get "$STATE_FILE" level S 2>/dev/null || echo S)"
FILE_COUNT="$(python3 "$PY_STATE" get "$STATE_FILE" file_count 0 2>/dev/null || echo 0)"

case "$LEVEL" in
  M|L|CRITICAL)
    if [ "${FILE_COUNT:-0}" -lt 3 ]; then
      echo "[scale-engine] M/L/CRITICAL work should record exploration of at least 3 relevant files before editing source."
      echo "[scale-engine] run: bash scripts/workflow/explore.sh <files...> '<main contradiction>'"
      exit 2
    fi
    ;;
esac

exit 0

