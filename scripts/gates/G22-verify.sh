#!/usr/bin/env bash
# G22: Session Health — advisory check on worktrees and session state
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G22] Session Health"
echo "  Checking session state..."

cd "$REPO_ROOT"

# Check 1: Stale worktrees
STALE=0
for dir in .claude/worktrees .scale/worktrees .codex/worktrees; do
  if [ -d "$dir" ]; then
    COUNT=$(find "$dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    STALE=$((STALE + COUNT))
  fi
done

if [ "$STALE" -gt 0 ]; then
  echo "  [WARN] $STALE worktree directory entries found"
else
  echo "  [OK] No stale worktrees"
fi

# Check 2: Git worktree count
if command -v git &>/dev/null; then
  WT_COUNT=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')
  if [ "$WT_COUNT" -gt 3 ]; then
    echo "  [WARN] $WT_COUNT git worktrees (>3)"
  else
    echo "  [OK] $WT_COUNT git worktree(s)"
  fi
fi

# Check 3: Session state
SCALE_DIR="${SCALE_DIR:-.scale}"
if [ -f "$SCALE_DIR/state/current.json" ]; then
  if command -v node &>/dev/null; then
    node -e "
      const s = JSON.parse(require('fs').readFileSync('$SCALE_DIR/state/current.json','utf-8'));
      console.log('  [INFO] Task: ' + (s.taskId||'none') + ', Phase: ' + (s.phase||'none') + ', Open: ' + (s.openTasks?.length||0));
    " 2>/dev/null || echo "  [INFO] Session state exists"
  fi
else
  echo "  [INFO] No active session state"
fi

echo "  PASSED"
