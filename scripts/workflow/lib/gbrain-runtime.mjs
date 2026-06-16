import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const MIRROR_META_FILE = '.scale-gbrain-runtime.json'
const GBRAIN_TIMEOUT_RECOVERY_COMMANDS = new Set(['--version', 'version', 'doctor', 'list', 'get', 'query', 'search'])

export function resolveDirectWindowsGbrainInvocation(command, args, resolveCommandPath) {
  if (process.platform !== 'win32' || command !== 'gbrain') return null
  const gbrainShim = resolveCommandPath('gbrain')
  if (!gbrainShim || !/\.cmd$/i.test(gbrainShim) || !existsSync(gbrainShim)) return null
  try {
    const content = readFileSync(gbrainShim, 'utf8')
    const match = content.match(/call\s+"([^"]*bun\.cmd)"\s+"([^"]*src[\\/]cli\.ts)"/i)
    const cliPath = match?.[2]
    const bunShim = match?.[1] ?? resolveCommandPath('bun')
    const bunExe = bunShim ? join(dirname(bunShim), 'node_modules', 'bun', 'bin', 'bun.exe') : ''
    if (cliPath && bunExe && existsSync(bunExe)) {
      return {
        command: bunExe,
        args: [cliPath, ...args],
        cwd: dirname(dirname(cliPath)),
        cliPath,
      }
    }
  } catch {
    return null
  }
  return null
}

export function shouldRetryWithMirroredGbrain(invocation, result) {
  if (!invocation?.cliPath) return false
  if (result.status === 0) return false
  const output = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}\n${String(result.error?.message ?? '')}`
  if (!/EPERM reading/i.test(output)) return false
  return normalizeForCompare(output).includes(normalizeForCompare(invocation.cliPath))
}

export function ensureMirroredGbrainInvocation(invocation) {
  const packageRoot = invocation.cwd
  const cliMtimeMs = statSync(invocation.cliPath).mtimeMs
  const version = readPackageVersion(packageRoot)
  const mirrorKey = `${resolve(packageRoot)}|${version ?? ''}|${cliMtimeMs}`
  const mirrorRoot = join(
    tmpdir(),
    'scale-engine',
    'gbrain-runtime',
    createHash('sha1').update(mirrorKey).digest('hex').slice(0, 16),
  )
  const cliRelativePath = invocation.cliPath.slice(packageRoot.length + 1)
  const mirrorCliPath = join(mirrorRoot, cliRelativePath)
  let selectedRoot = mirrorRoot
  if (!isMirrorFresh(mirrorRoot, packageRoot, version, cliMtimeMs, mirrorCliPath)) {
    const stagedRoot = `${mirrorRoot}-staging-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    rmSync(stagedRoot, { recursive: true, force: true })
    mkdirSync(dirname(mirrorRoot), { recursive: true })
    cpSync(packageRoot, stagedRoot, { recursive: true, force: true })
    writeFileSync(join(stagedRoot, MIRROR_META_FILE), JSON.stringify({
      sourceRoot: packageRoot,
      version,
      cliMtimeMs,
    }, null, 2), 'utf8')
    const stagedCliPath = join(stagedRoot, cliRelativePath)
    if (!isMirrorFresh(mirrorRoot, packageRoot, version, cliMtimeMs, mirrorCliPath)) {
      try {
        renameSync(stagedRoot, mirrorRoot)
      } catch {
        if (isMirrorFresh(mirrorRoot, packageRoot, version, cliMtimeMs, mirrorCliPath)) {
          rmSync(stagedRoot, { recursive: true, force: true })
        } else {
          selectedRoot = stagedRoot
        }
      }
    } else {
      rmSync(stagedRoot, { recursive: true, force: true })
    }
    if (selectedRoot === mirrorRoot && !existsSync(mirrorCliPath) && existsSync(stagedCliPath)) selectedRoot = stagedRoot
  }
  return {
    ...invocation,
    args: [join(selectedRoot, cliRelativePath), ...invocation.args.slice(1)],
    cwd: selectedRoot,
    cliPath: join(selectedRoot, cliRelativePath),
  }
}

export function normalizeGbrainSpawnResult(args, result) {
  const stdout = String(result.stdout ?? '')
  const stderr = `${String(result.stderr ?? '')}${result.error ? `\n${result.error.message}` : ''}`.trim()
  const exitCode = typeof result.status === 'number' ? result.status : 1
  const timedOut = /ETIMEDOUT/i.test(String(result.error?.message ?? ''))
  const recoveredTimeout = shouldRecoverGbrainTimeout(args, stdout, stderr, exitCode, timedOut)
  return {
    stdout,
    stderr: recoveredTimeout ? stripRecoverableTimeoutNoise(stderr) : stderr,
    exitCode: recoveredTimeout ? 0 : exitCode,
    timedOut: recoveredTimeout ? false : timedOut,
    recoveredTimeout,
  }
}

function isMirrorFresh(mirrorRoot, sourceRoot, version, cliMtimeMs, mirrorCliPath) {
  if (!existsSync(mirrorCliPath)) return false
  const metadataPath = join(mirrorRoot, MIRROR_META_FILE)
  if (!existsSync(metadataPath)) return false
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8'))
    return parsed.sourceRoot === sourceRoot
      && parsed.version === version
      && parsed.cliMtimeMs === cliMtimeMs
  } catch {
    return false
  }
}

function readPackageVersion(packageRoot) {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

function normalizeForCompare(value) {
  return String(value).replace(/\//g, '\\').toLowerCase()
}

function shouldRecoverGbrainTimeout(args, stdout, stderr, exitCode, timedOut) {
  if (!timedOut || exitCode === 0) return false
  const command = String(args?.[0] ?? '').trim().toLowerCase()
  if (!command || !GBRAIN_TIMEOUT_RECOVERY_COMMANDS.has(command)) return false
  const cleanedStderr = stripRecoverableTimeoutNoise(stderr)
  if (cleanedStderr) return false
  return hasRecoverableGbrainOutput(command, stdout.trim())
}

function hasRecoverableGbrainOutput(command, stdout) {
  if (!stdout) return false
  switch (command) {
    case '--version':
    case 'version':
      return /\bgbrain\b/i.test(stdout) || /\d+\.\d+\.\d+/.test(stdout)
    case 'doctor':
      return looksLikeJsonOutput(stdout)
    case 'list':
      return /no pages found/i.test(stdout)
        || /^\d+\.\s+\S+/m.test(stdout)
        || /^\[\d+(?:\.\d+)?\]\s+/m.test(stdout)
    case 'get':
      return /^---$/m.test(stdout)
        || /^#\s+\S+/m.test(stdout)
        || looksLikeJsonOutput(stdout)
    case 'query':
    case 'search':
      return looksLikeJsonOutput(stdout)
        || /no (pages|results) found/i.test(stdout)
        || /^\[\d+(?:\.\d+)?\]\s+/m.test(stdout)
        || /^\d+\.\s+\S+/m.test(stdout)
    default:
      return false
  }
}

function looksLikeJsonOutput(stdout) {
  const trimmed = String(stdout ?? '').trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function stripRecoverableTimeoutNoise(stderr) {
  return String(stderr ?? '')
    .replace(/\n?spawnSync .*?\bETIMEDOUT\b\s*/gim, '\n')
    .replace(/\n?Command failed: .*?\bETIMEDOUT\b\s*/gim, '\n')
    .replace(/\n?timed out after .*$/gim, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
