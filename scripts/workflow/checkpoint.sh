#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$PROJECT_ROOT/.agent/state/current.json"
PY_STATE="$PROJECT_ROOT/scripts/lib/workflow_state.py"
PHASE="${1:-execute}"

python3 "$PY_STATE" checkpoint "$STATE_FILE" "$PROJECT_ROOT" "$PHASE"

echo "[CHECKPOINT] saved: phase=$PHASE"
echo "[CHECKPOINT] state: $STATE_FILE"
