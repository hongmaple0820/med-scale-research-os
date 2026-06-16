#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$PROJECT_ROOT/scripts/lib/project-config.sh"

echo "[G7] security check..."

STACK="$(detect_stack)"

if [ "$STACK" = "none" ]; then
  echo "[G7] skip: no configured stack detected"
  exit 0
fi

if ! stack_exists "$STACK"; then
  echo "[G7] unknown stack: $STACK"
  exit 1
fi

COMMAND="$(gate_command "$STACK" security)"
if ! run_gate_command "$STACK" security "$COMMAND" G7; then
  echo "[G7] security command failed"
  exit 1
fi

echo "[G7] security command passed"
