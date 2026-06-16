import { describe, expect, it } from 'vitest'

describe('medscale CLI entrypoint', () => {
  it('exposes native medical workflow commands without the scale parent command', async () => {
    process.env.MEDSCALE_CLI_NO_AUTORUN = '1'
    const { medscaleMain } = await import('../../src/api/medscale.js')
    const commands = Object.keys(medscaleMain.subCommands ?? {})

    expect(medscaleMain.meta.name).toBe('medscale')
    expect(commands).toEqual(expect.arrayContaining([
      'analyze',
      'manuscript',
      'package',
      'remember',
      'learn',
      'memory-review',
      'token',
      'status',
      'doctor',
      'os-plan',
      'setup',
      'dashboard',
    ]))
    expect(commands).toContain('target')
    expect(commands).not.toContain('scale')
  })
})
