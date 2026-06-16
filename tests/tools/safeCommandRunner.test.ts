import { describe, expect, it } from 'vitest'
import { parseCommandLine, runSafeCommand } from '../../src/tools/SafeCommandRunner.js'

describe('SafeCommandRunner', () => {
  it('parses quoted argv without invoking a shell', () => {
    expect(parseCommandLine('node -e "process.stdout.write(String(40 + 2))"')).toEqual({
      file: 'node',
      args: ['-e', 'process.stdout.write(String(40 + 2))'],
    })
  })

  it('runs ordinary commands without shell semantics', async () => {
    const result = await runSafeCommand('node -e "process.stdout.write(String(40 + 2))"', { timeout: 10_000 })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('42')
  })

  it('blocks unquoted shell metacharacters by default', async () => {
    await expect(runSafeCommand('node -v && node -e "process.exit(9)"')).rejects.toThrow('Shell metacharacter "&" is not allowed')
  })
})
