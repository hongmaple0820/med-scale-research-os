import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { resolveExternalCommandPath } from './ExternalCommand.js'

export interface GbrainCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeout?: number
  maxBuffer?: number
  input?: string | Buffer
  stdio?: SpawnSyncOptions['stdio']
}

export interface GbrainCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  usedMirroredRuntime: boolean
  recoveredTimeout: boolean
}

export interface GbrainRuntimeDeps {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  tmpDir?: string
  resolveCommandPath?: (command: string) => string | null
  spawn?: typeof spawnSync
}

interface WindowsGbrainRuntime {
  shimPath: string
  bunExe: string
  cliPath: string
  packageRoot: string
  version?: string
}

interface MirroredGbrainRuntime extends WindowsGbrainRuntime {
  mirrorRoot: string
}

interface MirrorMetadata {
  sourceRoot: string
  version?: string
  cliMtimeMs: number
}

const MIRROR_META_FILE = '.scale-gbrain-runtime.json'

export function runGbrainCommandSync(
  args: string[],
  options: GbrainCommandOptions = {},
  deps: GbrainRuntimeDeps = {},
): GbrainCommandResult {
  const currentPlatform = deps.platform ?? process.platform
  const resolveCommandPath = deps.resolveCommandPath ?? resolveExternalCommandPath
  const spawn = deps.spawn ?? spawnSync

  if (currentPlatform === 'win32') {
    const runtime = resolveWindowsGbrainRuntime(resolveCommandPath)
    if (runtime) {
      const direct = spawnGbrain(spawn, runtime.bunExe, [runtime.cliPath, ...args], {
        ...options,
        env: mergeEnv(deps.env, options.env),
        cwd: options.cwd ?? runtime.packageRoot,
      })
      if (!shouldRetryWithMirroredRuntime(direct, runtime.cliPath)) return direct
      const mirrored = ensureMirroredRuntime(runtime, deps)
      const retried = spawnGbrain(spawn, mirrored.bunExe, [mirrored.cliPath, ...args], {
        ...options,
        env: mergeEnv(deps.env, options.env),
        cwd: options.cwd ?? mirrored.mirrorRoot,
      })
      return {
        ...retried,
        usedMirroredRuntime: true,
      }
    }
  }

  return spawnResolvedCommand(resolveCommandPath, spawn, currentPlatform, 'gbrain', args, {
    ...options,
    env: mergeEnv(deps.env, options.env),
  })
}

function spawnResolvedCommand(
  resolveCommandPath: (command: string) => string | null,
  spawn: typeof spawnSync,
  currentPlatform: NodeJS.Platform,
  command: string,
  args: string[],
  options: GbrainCommandOptions,
): GbrainCommandResult {
  const resolved = resolveWindowsCommandShim(resolveCommandPath(command) ?? command, currentPlatform)
  if (currentPlatform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    return spawnGbrain(spawn, process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'call', resolved, ...args], options)
  }
  return spawnGbrain(spawn, resolved, args, options)
}

function spawnGbrain(
  spawn: typeof spawnSync,
  command: string,
  args: string[],
  options: GbrainCommandOptions,
): GbrainCommandResult {
  const result = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  return toCommandResult(args, result)
}

function toCommandResult(args: string[], result: SpawnSyncReturns<string>): GbrainCommandResult {
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
    usedMirroredRuntime: false,
    recoveredTimeout,
  }
}

const GBRAIN_TIMEOUT_RECOVERY_COMMANDS = new Set(['--version', 'version', 'doctor', 'list', 'get', 'query', 'search'])

function shouldRecoverGbrainTimeout(
  args: string[],
  stdout: string,
  stderr: string,
  exitCode: number,
  timedOut: boolean,
): boolean {
  if (!timedOut || exitCode === 0) return false
  const command = normalizeGbrainSubcommand(args)
  if (!command || !GBRAIN_TIMEOUT_RECOVERY_COMMANDS.has(command)) return false
  const cleanedStderr = stripRecoverableTimeoutNoise(stderr)
  if (cleanedStderr) return false
  return hasRecoverableGbrainOutput(command, stdout.trim())
}

function normalizeGbrainSubcommand(args: string[]): string | null {
  const command = String(args[0] ?? '').trim().toLowerCase()
  return command || null
}

function hasRecoverableGbrainOutput(command: string, stdout: string): boolean {
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

function looksLikeJsonOutput(stdout: string): boolean {
  const trimmed = stdout.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function stripRecoverableTimeoutNoise(stderr: string): string {
  return String(stderr ?? '')
    .replace(/\n?spawnSync .*?\bETIMEDOUT\b\s*/gim, '\n')
    .replace(/\n?Command failed: .*?\bETIMEDOUT\b\s*/gim, '\n')
    .replace(/\n?timed out after .*$/gim, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function shouldRetryWithMirroredRuntime(result: GbrainCommandResult, cliPath: string): boolean {
  if (result.exitCode === 0) return false
  const output = `${result.stdout}\n${result.stderr}`
  if (!/EPERM reading/i.test(output)) return false
  const normalizedOutput = normalizeForCompare(output)
  const normalizedCli = normalizeForCompare(cliPath)
  return normalizedOutput.includes(normalizedCli) || /src[\\/]cli\.ts/i.test(output)
}

function resolveWindowsGbrainRuntime(resolveCommandPath: (command: string) => string | null): WindowsGbrainRuntime | null {
  const shimPath = resolveCommandPath('gbrain')
  if (!shimPath || !/\.cmd$/i.test(shimPath) || !existsSync(shimPath)) return null
  try {
    const content = readFileSync(shimPath, 'utf8')
    const match = content.match(/call\s+"([^"]*bun\.cmd)"\s+"([^"]*src[\\/]cli\.ts)"/i)
    const cliPath = match?.[2]
    const bunShim = match?.[1] ?? resolveCommandPath('bun')
    const bunExe = resolveWindowsBunExe(bunShim)
    if (!cliPath || !bunExe || !existsSync(cliPath) || !existsSync(bunExe)) return null
    const packageRoot = dirname(dirname(cliPath))
    return {
      shimPath,
      bunExe,
      cliPath,
      packageRoot,
      version: readPackageVersion(packageRoot),
    }
  } catch {
    return null
  }
}

function resolveWindowsBunExe(bunShim: string | null | undefined): string | null {
  if (!bunShim) return null
  const candidate = join(dirname(bunShim), 'node_modules', 'bun', 'bin', 'bun.exe')
  return existsSync(candidate) ? candidate : null
}

function ensureMirroredRuntime(runtime: WindowsGbrainRuntime, deps: GbrainRuntimeDeps): MirroredGbrainRuntime {
  const cliMtimeMs = statSync(runtime.cliPath).mtimeMs
  const mirrorKey = `${resolve(runtime.packageRoot)}|${runtime.version ?? ''}|${cliMtimeMs}`
  const mirrorRoot = join(
    deps.tmpDir ?? tmpdir(),
    'scale-engine',
    'gbrain-runtime',
    createHash('sha1').update(mirrorKey).digest('hex').slice(0, 16),
  )
  const cliRelativePath = relative(runtime.packageRoot, runtime.cliPath)
  const mirrorCliPath = join(mirrorRoot, cliRelativePath)
  let selectedRoot = mirrorRoot
  if (!isMirrorFresh(mirrorRoot, runtime.packageRoot, runtime.version, cliMtimeMs, mirrorCliPath)) {
    const stagedRoot = `${mirrorRoot}-staging-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    rmSync(stagedRoot, { recursive: true, force: true })
    mkdirSync(dirname(mirrorRoot), { recursive: true })
    cpSync(runtime.packageRoot, stagedRoot, { recursive: true, force: true })
    const metadata: MirrorMetadata = {
      sourceRoot: runtime.packageRoot,
      version: runtime.version,
      cliMtimeMs,
    }
    writeFileSync(join(stagedRoot, MIRROR_META_FILE), JSON.stringify(metadata, null, 2), 'utf8')
    const stagedCliPath = join(stagedRoot, cliRelativePath)
    if (!isMirrorFresh(mirrorRoot, runtime.packageRoot, runtime.version, cliMtimeMs, mirrorCliPath)) {
      try {
        renameSync(stagedRoot, mirrorRoot)
      } catch {
        if (isMirrorFresh(mirrorRoot, runtime.packageRoot, runtime.version, cliMtimeMs, mirrorCliPath)) {
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
    ...runtime,
    cliPath: join(selectedRoot, cliRelativePath),
    mirrorRoot: selectedRoot,
  }
}

function isMirrorFresh(
  mirrorRoot: string,
  sourceRoot: string,
  version: string | undefined,
  cliMtimeMs: number,
  mirrorCliPath: string,
): boolean {
  if (!existsSync(mirrorCliPath)) return false
  const metadataPath = join(mirrorRoot, MIRROR_META_FILE)
  if (!existsSync(metadataPath)) return false
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8')) as Partial<MirrorMetadata>
    return parsed.sourceRoot === sourceRoot
      && parsed.version === version
      && parsed.cliMtimeMs === cliMtimeMs
  } catch {
    return false
  }
}

function readPackageVersion(packageRoot: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

function resolveWindowsCommandShim(executable: string, currentPlatform: NodeJS.Platform): string {
  if (currentPlatform !== 'win32') return executable
  if (!/[\\/]/.test(executable) || /\.[a-z0-9]+$/i.test(executable)) return executable
  for (const extension of ['.cmd', '.exe', '.bat', '.com']) {
    const candidate = `${executable}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return executable
}

function normalizeForCompare(value: string): string {
  return value.replace(/\//g, '\\').toLowerCase()
}

function mergeEnv(
  baseEnv: NodeJS.ProcessEnv | undefined,
  overrideEnv: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(baseEnv ?? {}),
    ...(overrideEnv ?? {}),
  }
}
