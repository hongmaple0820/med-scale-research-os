import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runGbrainCommandSync } from '../../src/core/GbrainRuntime.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('GbrainRuntime', () => {
  it('mirrors the Windows gbrain package when Bun cannot read the original cli.ts', () => {
    const root = makeDir('scale-gbrain-runtime-')
    const localBin = join(root, '.local', 'bin')
    const bunBin = join(root, 'nodejs', 'node_modules', 'bun', 'bin')
    const gbrainRoot = join(root, '.local', 'gbrain')
    const gbrainSrc = join(gbrainRoot, 'src')
    mkdirSync(localBin, { recursive: true })
    mkdirSync(bunBin, { recursive: true })
    mkdirSync(gbrainSrc, { recursive: true })
    const bunCmd = join(root, 'nodejs', 'bun.cmd')
    const bunExe = join(bunBin, 'bun.exe')
    const gbrainCmd = join(localBin, 'gbrain.cmd')
    const cliPath = join(gbrainSrc, 'cli.ts')
    writeFileSync(bunCmd, '@echo off\r\n', 'utf8')
    writeFileSync(bunExe, '', 'utf8')
    writeFileSync(cliPath, 'console.log("gbrain")\n', 'utf8')
    writeFileSync(join(gbrainRoot, 'package.json'), JSON.stringify({ version: '0.37.11.0' }, null, 2), 'utf8')
    writeFileSync(gbrainCmd, `@echo off\r\ncall "${bunCmd}" "${cliPath}" %*\r\n`, 'utf8')

    const spawn = vi.fn()
      .mockImplementationOnce((_command, callArgs: string[]) => ({
        status: 1,
        stdout: '',
        stderr: `error: EPERM reading "${callArgs[0]}"`,
      }))
      .mockImplementationOnce((_command, callArgs: string[], options: { cwd?: string }) => ({
        status: 0,
        stdout: JSON.stringify({
          status: 'healthy',
          checks: [
            { name: 'connection', status: 'ok' },
            { name: 'schema_version', status: 'ok' },
            { name: 'brain_score', status: 'ok' },
          ],
        }),
        stderr: '',
        options,
        callArgs,
      }))

    const result = runGbrainCommandSync(['doctor', '--json'], {
      timeout: 10_000,
    }, {
      platform: 'win32',
      tmpDir: join(root, 'tmp'),
      resolveCommandPath(command) {
        if (command === 'gbrain') return gbrainCmd
        if (command === 'bun') return bunCmd
        return null
      },
      spawn,
    })

    const secondCall = spawn.mock.calls[1]
    expect(result.exitCode).toBe(0)
    expect(result.usedMirroredRuntime).toBe(true)
    expect(secondCall?.[1]?.[0]).not.toBe(cliPath)
    expect(secondCall?.[1]?.[0]).toContain('scale-engine')
    expect(secondCall?.[2]?.cwd).toContain('gbrain-runtime')
  })

  it('recovers read-only gbrain timeouts when complete output is already available', () => {
    const spawn = vi.fn().mockImplementation(() => ({
      status: 1,
      stdout: '[1.0000] scale-note -- Sentinel memory result',
      stderr: '',
      error: new Error('spawnSync bun.exe ETIMEDOUT'),
    }))

    const result = runGbrainCommandSync(['query', 'Sentinel'], {}, {
      platform: 'linux',
      resolveCommandPath(command) {
        return command
      },
      spawn,
    })

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      recoveredTimeout: true,
      stderr: '',
    })
    expect(result.stdout).toContain('Sentinel memory result')
  })

  it('keeps timeout failures visible when gbrain produces no usable output', () => {
    const spawn = vi.fn().mockImplementation(() => ({
      status: 1,
      stdout: '',
      stderr: '',
      error: new Error('spawnSync bun.exe ETIMEDOUT'),
    }))

    const result = runGbrainCommandSync(['query', 'Sentinel'], {}, {
      platform: 'linux',
      resolveCommandPath(command) {
        return command
      },
      spawn,
    })

    expect(result).toMatchObject({
      exitCode: 1,
      timedOut: true,
      recoveredTimeout: false,
    })
  })
})
