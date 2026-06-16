#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$PROJECT_ROOT/.agent/state"
STATE_FILE="$STATE_DIR/current.json"
EXPLORE_FILE="$STATE_DIR/explore.json"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"

mkdir -p "$STATE_DIR"

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/workflow/explore.sh file1 file2 \"main contradiction\""
  exit 1
fi

CONTRADICTION_PARTS=()
REAL_FILES=()
for item in "$@"; do
  if [ -f "$PROJECT_ROOT/$item" ]; then
    REAL_FILES+=("$item")
  else
    CONTRADICTION_PARTS+=("$item")
  fi
done

CONTRADICTION="${CONTRADICTION_PARTS[*]}"
python3 "$PY_STATE" explore "$STATE_FILE" "$EXPLORE_FILE" "$CONTRADICTION" "${REAL_FILES[@]}"
echo "[EXPLORE] recorded ${#REAL_FILES[@]} files"
echo "[EXPLORE] main contradiction: ${CONTRADICTION:-not set}"
