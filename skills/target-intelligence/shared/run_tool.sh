#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"

if [ "$#" -lt 1 ]; then
  echo "Usage: bash shared/run_tool.sh <tool.py> [args...]" >&2
  echo "       tool.py can be a relative path from any phase directory" >&2
  exit 2
fi

TOOL_NAME="$1"
shift

# Search for the tool in phase directories and shared
TOOL_PATH=""
for dir in "$SKILL_DIR/phase1-expression/scripts" "$SKILL_DIR/phase2-screening/scripts" "$SKILL_DIR/phase3-research/scripts" "$SKILL_DIR/phase4-planning/scripts" "$SKILL_DIR/shared"; do
  if [ -f "$dir/$TOOL_NAME" ]; then
    TOOL_PATH="$dir/$TOOL_NAME"
    break
  fi
done

if [ -z "$TOOL_PATH" ]; then
  echo "Tool not found: $TOOL_NAME" >&2
  echo "Searched in:" >&2
  echo "  - phase1-expression/scripts/" >&2
  echo "  - phase2-screening/scripts/" >&2
  echo "  - phase3-research/scripts/" >&2
  echo "  - phase4-planning/scripts/" >&2
  echo "  - shared/" >&2
  exit 2
fi

PYTHON_BIN=""
# Prefer 'python' first (more likely to be the active venv on Windows)
if command -v python >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python)"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "No usable Python interpreter found. Tried: python3, python" >&2
  exit 127
fi

# Set PYTHONPATH to include the skill directory for imports
export PYTHONPATH="${SKILL_DIR}:${PYTHONPATH:-}"

exec "$PYTHON_BIN" "$TOOL_PATH" "$@"
