#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS=(
  "$ROOT/scripts/gates/all.sh"
  "$ROOT/scripts/gates/G1-verify.sh"
  "$ROOT/scripts/gates/G2-verify.sh"
  "$ROOT/scripts/gates/G3-verify.sh"
  "$ROOT/scripts/gates/G4-verify.sh"
  "$ROOT/scripts/gates/G5-verify.sh"
  "$ROOT/scripts/gates/G6-verify.sh"
  "$ROOT/scripts/gates/G7-verify.sh"
  "$ROOT/scripts/init-plan.sh"
  "$ROOT/scripts/preflight/all.sh"
  "$ROOT/scripts/checkpoint/save.sh"
  "$ROOT/scripts/checkpoint/resume.sh"
  "$ROOT/scripts/workflow/new-task.sh"
  "$ROOT/scripts/workflow/explore.sh"
  "$ROOT/scripts/workflow/checkpoint.sh"
  "$ROOT/scripts/workflow/resume.sh"
  "$ROOT/scripts/workflow/lint-scaffold.sh"
  "$ROOT/scripts/workflow/verify.sh"
)

for script in "${SCRIPTS[@]}"; do
  bash -n "$script"
done

python3 -m py_compile "$ROOT/scripts/lib/workflow_state.py"

for script in \
  "$ROOT/scripts/workflow/check-reality.ps1" \
  "$ROOT/scripts/workflow/check-docs-scope.ps1" \
  "$ROOT/scripts/workflow/write-runtime-contract.ps1"; do
  [ -f "$script" ] || { echo "[G4] missing $script"; exit 1; }
done

echo "[G4] workflow scripts passed"
