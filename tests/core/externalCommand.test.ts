import { afterEach, describe, expect, it, vi } from 'vitest'
import { externalCommandExists, resolveExternalCommandPath, runExternalCommandSync } from '../../src/core/ExternalCommand.js'

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
})

describe('ExternalCommand', () => {
  it('resolves the first lookup hit for an external command', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const execFileSync = vi.fn(() => 'C:\\tools\\gbrain.cmd\r\nC:\\backup\\gbrain.cmd\r\n')

    const resolved = resolveExternalCommandPath('gbrain', {
      execFileSync: execFileSync as unknown as typeof import('node:child_process').execFileSync,
      spawnSync: vi.fn() as unknown as typeof import('node:child_process').spawnSync,
    })

    expect(resolved).toBe('C:\\tools\\gbrain.cmd')
    expect(externalCommandExists('gbrain', {
      execFileSync: execFileSync as unknown as typeof import('node:child_process').execFileSync,
      spawnSync: vi.fn() as unknown as typeof import('node:child_process').spawnSync,
    })).toBe(true)
  })

  it('uses spawnSync for Windows cmd shims so batch wrappers are executable', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const execFileSync = vi.fn(() => 'C:\\Users\\li\\.local\\bin\\gbrain.cmd\r\n')
    const spawnSync = vi.fn(() => ({ status: 0, stdout: 'gbrain 0.37.11.0', stderr: '' }))

    const output = runExternalCommandSync('gbrain', ['--version'], { encoding: 'utf8' }, {
      execFileSync: execFileSync as unknown as typeof import('node:child_process').execFileSync,
      spawnSync: spawnSync as unknown as typeof import('node:child_process').spawnSync,
    })

    expect(output).toBe('gbrain 0.37.11.0')
    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      ['/d', '/c', 'call', 'C:\\Users\\li\\.local\\bin\\gbrain.cmd', '--version'],
      expect.objectContaining({ shell: false, encoding: 'utf8' }),
    )
  })
})
