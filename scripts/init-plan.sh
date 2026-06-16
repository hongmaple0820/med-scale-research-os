#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PROJECT_ROOT/.planning/tasks"
echo "[INIT-PLAN] ensured $PROJECT_ROOT/.planning/tasks"
