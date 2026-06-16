#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

CHANGED_CODE="$(git diff --name-only -- src tests package.json package-lock.json 2>/dev/null | head -20 || true)"
if [ -n "$CHANGED_CODE" ]; then
  echo "[scale-engine] changed code/package files:"
  echo "$CHANGED_CODE"
  echo "[scale-engine] expected verification: npm run typecheck and targeted Vitest or scripts/preflight/all.ps1."
fi

exit 0

