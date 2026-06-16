import { execFileSync } from 'node:child_process'

export interface WorkspaceSafetyReport {
  checked: boolean
  gitRepository: boolean
  blocked: boolean
  conflicts: string[]
  message: string
}

export function inspectWorkspaceSafety(projectDir: string): WorkspaceSafetyReport {
  try {
    execFileSync('git', ['-C', projectDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return {
      checked: true,
      gitRepository: false,
      blocked: false,
      conflicts: [],
      message: 'Project directory is not a git repository; workspace conflict check skipped.',
    }
  }

  try {
    const porcelain = execFileSync('git', ['-C', projectDir, 'status', '--porcelain=v1', '--untracked-files=no'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const conflicts = porcelain
      .split(/\r?\n/)
      .map(line => line.trimEnd())
      .filter(Boolean)
      .filter(line => isUnmergedPorcelainStatus(line.slice(0, 2)))
      .map(line => line.slice(3).trim())
    return {
      checked: true,
      gitRepository: true,
      blocked: conflicts.length > 0,
      conflicts,
      message: conflicts.length > 0
        ? `Unresolved git conflicts: ${conflicts.join(', ')}`
        : 'No unresolved git conflicts detected.',
    }
  } catch (error) {
    return {
      checked: true,
      gitRepository: true,
      blocked: true,
      conflicts: [],
      message: `Git workspace conflict check failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function isUnmergedPorcelainStatus(status: string): boolean {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status)
}
