import * as childProcess from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

type CommandRuntime = {
  execFileSync: typeof childProcess.execFileSync
  spawnSync: typeof childProcess.spawnSync
}

const DEFAULT_RUNTIME: CommandRuntime = {
  execFileSync: childProcess.execFileSync,
  spawnSync: childProcess.spawnSync,
}

export function resolveExternalCommandPath(
  command: string,
  runtime: CommandRuntime = DEFAULT_RUNTIME,
): string | null {
  try {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
    const output = runtime.execFileSync(lookup, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = String(output)
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean)
    return match ?? null
  } catch {
    return null
  }
}

export function externalCommandExists(
  command: string,
  runtime: CommandRuntime = DEFAULT_RUNTIME,
): boolean {
  return Boolean(resolveExternalCommandPath(command, runtime))
}

export function runExternalCommandSync(
  command: string,
  args: string[],
  options: childProcess.ExecFileSyncOptions = {},
  runtime: CommandRuntime = DEFAULT_RUNTIME,
): string | Buffer {
  const resolved = resolveWindowsCommandShim(resolveExternalCommandPath(command, runtime) ?? command)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const result = runtime.spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'call', resolved, ...args], {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv | undefined,
      encoding: options.encoding as BufferEncoding | undefined,
      input: options.input as string | Buffer | undefined,
      maxBuffer: options.maxBuffer,
      shell: false,
      stdio: options.stdio as childProcess.StdioOptions | undefined,
      timeout: options.timeout,
      windowsHide: options.windowsHide,
    })
    if (result.error) throw result.error
    if (typeof result.status === 'number' && result.status !== 0) {
      const message = typeof result.stderr === 'string'
        ? result.stderr.trim()
        : result.stderr?.toString('utf8').trim()
      const error = new Error(message || `Command failed: ${resolved} ${args.join(' ')}`) as Error & {
        status?: number | null
        stdout?: string | Buffer | null
        stderr?: string | Buffer | null
      }
      error.status = result.status
      error.stdout = result.stdout
      error.stderr = result.stderr
      throw error
    }
    return result.stdout ?? ''
  }
  return runtime.execFileSync(resolved, args, options)
}

function resolveWindowsCommandShim(executable: string): string {
  if (process.platform !== 'win32') return executable
  if (!/[\\/]/.test(executable) || extname(executable)) return executable
  for (const extension of ['.cmd', '.exe', '.bat', '.com']) {
    const candidate = `${executable}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return executable
}
