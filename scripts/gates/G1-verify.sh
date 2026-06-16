#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.agent/state/current.json"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"

if [ ! -f "$STATE_FILE" ]; then
  echo "missing .agent/state/current.json"
  exit 1
fi

COUNT=$(python3 "$PY_STATE" get "$STATE_FILE" file_count 0)
CONFLICT=$(python3 "$PY_STATE" get "$STATE_FILE" main_contradiction "")

if [ "$COUNT" -lt 3 ]; then
  echo "explored files insufficient: $COUNT < 3"
  exit 1
fi

if [ -z "$CONFLICT" ]; then
  echo "main_contradiction missing"
  exit 1
fi

echo "[G1] passed"
