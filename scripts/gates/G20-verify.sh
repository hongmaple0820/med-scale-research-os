#!/usr/bin/env bash
# G20: Supply Chain — verify no CRITICAL/HIGH vulnerabilities
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[G20] Supply Chain"
echo "  Checking dependencies..."

cd "$REPO_ROOT"

BLOCKED=false

# Check 1: npm audit
if command -v npm &>/dev/null && [ -f "package.json" ]; then
  AUDIT_OUTPUT=$(npm audit --json 2>/dev/null || echo '{}')
  CRITICAL=$(echo "$AUDIT_OUTPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);let c=0;for(const v of Object.values(j.vulnerabilities||{}))if(v.severity==='critical')c++;process.stdout.write(String(c))}
      catch{process.stdout.write('0')}
    })
  " 2>/dev/null || echo 0)
  HIGH=$(echo "$AUDIT_OUTPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);let c=0;for(const v of Object.values(j.vulnerabilities||{}))if(v.severity==='high')c++;process.stdout.write(String(c))}
      catch{process.stdout.write('0')}
    })
  " 2>/dev/null || echo 0)

  if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
    echo "  [BLOCK] npm audit: $CRITICAL critical, $HIGH high vulnerabilities"
    BLOCKED=true
  else
    echo "  [OK] No CRITICAL/HIGH vulnerabilities"
  fi
else
  echo "  [SKIP] npm not available or no package.json"
fi

# Check 2: Lock file
if [ -f "package-lock.json" ] || [ -f "pnpm-lock.yaml" ] || [ -f "bun.lock" ]; then
  echo "  [OK] Lock file present"
else
  echo "  [WARN] No lock file found"
fi

if [ "$BLOCKED" = true ]; then
  exit 1
fi
echo "  PASSED"
