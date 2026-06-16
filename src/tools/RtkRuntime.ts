import { execFileSync } from 'node:child_process'

export interface WrappedCliInvocation {
  command: string
  args: string[]
  wrapped: boolean
}

export function commandExists(command: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function rtkAvailable(commandExistsFn: (command: string) => boolean = commandExists): boolean {
  return commandExistsFn('rtk')
}

export function wrapCliCommandWithRtk(
  command: string,
  args: string[] = [],
  commandExistsFn: (command: string) => boolean = commandExists,
): WrappedCliInvocation {
  if (!rtkAvailable(commandExistsFn) || command === 'rtk') {
    return { command, args, wrapped: false }
  }
  return {
    command: 'rtk',
    args: [command, ...args],
    wrapped: true,
  }
}

export function wrapShellCommandWithRtk(
  shellCommand: string,
  commandExistsFn: (command: string) => boolean = commandExists,
): WrappedCliInvocation | null {
  if (!rtkAvailable(commandExistsFn)) return null
  const trimmed = shellCommand.trim()
  if (!trimmed || trimmed.startsWith('rtk ')) return null
  if (process.platform === 'win32') {
    return {
      command: 'rtk',
      args: ['proxy', 'powershell', '-NoProfile', '-Command', shellCommand],
      wrapped: true,
    }
  }
  return {
    command: 'rtk',
    args: ['proxy', 'bash', '-lc', shellCommand],
    wrapped: true,
  }
}
