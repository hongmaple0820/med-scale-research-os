import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()
const requiredPaths = [
  join(cwd, 'node_modules'),
  join(cwd, 'node_modules', 'typescript', 'package.json'),
  join(cwd, 'node_modules', 'vitest', 'package.json'),
]

if (requiredPaths.every(path => existsSync(path))) {
  console.log('[ensure-node-deps] Reusing existing node_modules')
  process.exit(0)
}

console.log('[ensure-node-deps] Installing dependencies with npm ci')
const result = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-fund --no-audit'], {
      cwd,
      stdio: 'inherit',
    })
  : spawnSync('npm', ['ci', '--no-fund', '--no-audit'], {
      cwd,
      stdio: 'inherit',
    })

if (result.error) {
  console.error('[ensure-node-deps] Failed to launch npm ci', result.error)
}

process.exit(result.status ?? 1)
