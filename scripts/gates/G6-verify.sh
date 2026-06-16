#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_FILE="$ROOT/.agent/state/current.json"
PY_STATE="$ROOT/scripts/lib/workflow_state.py"

cd "$ROOT"

run_diff_check() {
  if command -v powershell >/dev/null 2>&1; then
    local winroot ps_paths="" escaped
    winroot="$(cd "$ROOT" && pwd -W)"
    for item in "$@"; do
      escaped="${item//\'/\'\'}"
      ps_paths="$ps_paths'$escaped',"
    done
    ps_paths="${ps_paths%,}"
    powershell -NoProfile -Command "
      Set-Location '$winroot'
      \$paths = @($ps_paths)
      if (\$paths.Count -gt 0) {
        git diff --check -- @paths
      } else {
        git diff --check
      }
      exit \$LASTEXITCODE
    " >/dev/null
  else
    git diff --check -- "$@" >/dev/null
  fi
}

if [ -f "$STATE_FILE" ]; then
  FILES_MODIFIED="$(python3 "$PY_STATE" get "$STATE_FILE" files_modified "" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | sed '/^$/d')"
  if [ -n "$FILES_MODIFIED" ]; then
    mapfile -t PATHS < <(printf '%s\n' "$FILES_MODIFIED")
    run_diff_check "${PATHS[@]}"
  fi
else
  echo "[G6] no active workflow state; skip scoped diff check and rely on explicit git diff --check in final verification"
fi

if [ -f "$STATE_FILE" ]; then
  LEVEL=$(python3 "$PY_STATE" get "$STATE_FILE" level "")
  ARTIFACTS=$(python3 "$PY_STATE" get "$STATE_FILE" artifacts_dir "")
  case "$LEVEL" in
    M|L|CRITICAL)
      if [ -z "$ARTIFACTS" ] || [ ! -d "$ROOT/$ARTIFACTS" ]; then
        echo "[G6] task artifacts_dir missing"
        exit 1
      fi
      for file in explore.md plan.md runtime.md reality-check.md resource-cleanup.md verification.md review.md summary.md; do
        if [ ! -f "$ROOT/$ARTIFACTS/$file" ]; then
          echo "[G6] missing task artifact: $file"
          exit 1
        fi
      done
      ;;
  esac
fi

if command -v powershell >/dev/null 2>&1; then
  powershell -NoProfile -ExecutionPolicy Bypass -File "$ROOT/scripts/workflow/check-docs-scope.ps1"
fi

echo "[G6] diff hygiene and task artifacts present"
