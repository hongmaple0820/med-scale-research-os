#!/usr/bin/env bash
# Run workflow and quality gates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY_RUN=false
MODE="all"
SERVICES=()

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/gates/all.sh [--dry-run] [--workflow|--quality|--all] [--service <root|all>]

Examples:
  bash scripts/gates/all.sh --dry-run
  bash scripts/gates/all.sh --workflow
  bash scripts/gates/all.sh --quality --service root
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --workflow)
      MODE="workflow"
      ;;
    --quality)
      MODE="quality"
      ;;
    --all)
      MODE="all"
      ;;
    --service)
      shift
      if [ -z "${1:-}" ]; then
        echo "[GATE] --service requires a value" >&2
        exit 1
      fi
      SERVICES+=("$1")
      ;;
    root|all)
      SERVICES+=("$1")
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[GATE] unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

case "$MODE" in
  workflow) GATES=(G1 G2 G3 G16) ;;
  quality) GATES=(G0 G4 G5 G6 G7 G8 G17 G18 G19 G20) ;;
  meta) GATES=(G9 G10 G11 G12 G13 G14 G15 G21 G22) ;;
  all) GATES=(G0 G1 G2 G3 G4 G5 G6 G7 G8 G16 G17 G18 G19 G20 G21 G22) ;;
  *)
    echo "[GATE] invalid mode: $MODE" >&2
    exit 1
    ;;
esac

PASSED=0
FAILED=0
SKIPPED=0

echo "========================================"
echo "[GATE] mode: $MODE"
echo "========================================"

for gate in "${GATES[@]}"; do
  script="$SCRIPT_DIR/${gate}-verify.sh"
  echo "[GATE] $gate"

  if [ ! -f "$script" ]; then
    echo "  skipped: missing $script"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "$DRY_RUN" = true ]; then
    if bash -n "$script"; then
      echo "  schedulable"
      PASSED=$((PASSED + 1))
    else
      echo "  syntax failed"
      FAILED=$((FAILED + 1))
    fi
    continue
  fi

  if [[ "$gate" =~ ^G[4-7]$ ]]; then
    if bash "$script" "${SERVICES[@]}"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  else
    if bash "$script"; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  fi
  echo ""
done

echo "========================================"
echo "[GATE] summary"
echo "passed:  $PASSED"
echo "failed:  $FAILED"
echo "skipped: $SKIPPED"
echo "========================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
