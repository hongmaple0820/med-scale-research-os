#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FILE_PATH="${CLAUDE_FILE_PATH:-${1:-}}"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  src/*.ts|src/**/*.ts|tests/*.ts|tests/**/*.ts) ;;
  *) exit 0 ;;
esac

STATE_FILE="$ROOT/.agent/state/current.json"
if [ ! -f "$STATE_FILE" ]; then
  echo "[scale-engine] workflow state is not initialized. Run: bash scripts/workflow/new-task.sh <task-slug> M"
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  PHASE="$(python3 "$ROOT/scripts/lib/workflow_state.py" get "$STATE_FILE" phase unknown 2>/dev/null || echo unknown)"
else
  PHASE="unknown"
fi

case "$PHASE" in
  explore|plan|execute|verify|review|ship|done|unknown) exit 0 ;;
  *)
    echo "[scale-engine] unexpected workflow phase: $PHASE"
    exit 0
    ;;
esac

