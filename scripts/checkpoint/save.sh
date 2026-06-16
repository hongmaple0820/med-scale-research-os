#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PHASE="${1:-execute}"

bash "$PROJECT_ROOT/scripts/workflow/checkpoint.sh" "$PHASE"
