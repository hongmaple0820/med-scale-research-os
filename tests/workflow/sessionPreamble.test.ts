// SCALE Engine — Session Preamble Tests

import { describe, it, expect } from 'vitest'
import {
  collectSessionPreamble,
  formatPreambleForAgent,
  type SessionPreamble,
} from '../../src/workflow/SessionPreamble.js'

describe('collectSessionPreamble', () => {
  it('collects preamble with default options', () => {
    const preamble = collectSessionPreamble()
    expect(preamble.sessionId).toBeDefined()
    expect(preamble.sessionId.length).toBe(8)
    expect(preamble.timestamp).toBeDefined()
    expect(preamble.scaleVersion).toBeDefined()
    expect(preamble.projectSlug).toBeDefined()
    expect(preamble.warnings).toBeDefined()
  })

  it('collects git branch when in a git repo', () => {
    const preamble = collectSessionPreamble()
    // We're in a git repo during testing
    expect(preamble.gitBranch).not.toBe('unknown')
  })

  it('uses custom projectDir and scaleDir', () => {
    const preamble = collectSessionPreamble({
      projectDir: process.cwd(),
      scaleDir: '.scale',
    })
    expect(preamble.projectSlug).toBeDefined()
    expect(preamble.verificationProfile).toBeDefined()
  })

  it('gracefully handles non-git directory', () => {
    const preamble = collectSessionPreamble({ projectDir: '/tmp' })
    // May have warnings about git, but should not throw
    expect(preamble.sessionId).toBeDefined()
  })
})

describe('formatPreambleForAgent', () => {
  it('formats preamble as readable text', () => {
    const preamble: SessionPreamble = {
      sessionId: 'abc12345',
      timestamp: '2026-05-21T10:00:00Z',
      gitBranch: 'main',
      gitRoot: '/home/user/project',
      projectSlug: 'my-project',
      scaleVersion: '0.31.0',
      activeRunCount: 3,
      learningCount: 12,
      verificationProfile: 'default',
      governanceMode: 'standard',
      warnings: [],
    }

    const formatted = formatPreambleForAgent(preamble)
    expect(formatted).toContain('SESSION: abc12345')
    expect(formatted).toContain('BRANCH: main')
    expect(formatted).toContain('PROJECT: my-project')
    expect(formatted).toContain('SCALE_VERSION: 0.31.0')
    expect(formatted).toContain('ACTIVE_RUNS: 3')
    expect(formatted).toContain('LEARNINGS: 12')
    expect(formatted).toContain('VERIFICATION_PROFILE: default')
    expect(formatted).toContain('GOVERNANCE_MODE: standard')
  })

  it('includes warnings when present', () => {
    const preamble: SessionPreamble = {
      sessionId: 'test',
      timestamp: '2026-05-21T10:00:00Z',
      gitBranch: 'unknown',
      gitRoot: '/tmp',
      projectSlug: 'test',
      scaleVersion: '0.31.0',
      activeRunCount: 0,
      learningCount: 0,
      verificationProfile: 'default',
      governanceMode: 'standard',
      warnings: ['Not in a git repository'],
    }

    const formatted = formatPreambleForAgent(preamble)
    expect(formatted).toContain('WARNINGS: Not in a git repository')
  })

  it('omits warnings line when no warnings', () => {
    const preamble: SessionPreamble = {
      sessionId: 'test',
      timestamp: '2026-05-21T10:00:00Z',
      gitBranch: 'main',
      gitRoot: '/project',
      projectSlug: 'test',
      scaleVersion: '0.31.0',
      activeRunCount: 0,
      learningCount: 0,
      verificationProfile: 'default',
      governanceMode: 'standard',
      warnings: [],
    }

    const formatted = formatPreambleForAgent(preamble)
    expect(formatted).not.toContain('WARNINGS')
  })
})
