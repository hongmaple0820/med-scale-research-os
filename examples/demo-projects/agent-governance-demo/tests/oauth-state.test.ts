import { describe, expect, it } from 'vitest'
import { verifyOAuthState, type OAuthStateRecord } from '../src/oauth-state.js'

const future = 2_000
const now = 1_000

function record(overrides: Partial<OAuthStateRecord> = {}): OAuthStateRecord {
  return {
    state: 'state-123',
    userId: 'user-1',
    expiresAt: future,
    ...overrides
  }
}

describe('verifyOAuthState', () => {
  it('accepts a valid unexpired state', () => {
    expect(verifyOAuthState(record(), 'state-123', now)).toEqual({
      ok: true,
      userId: 'user-1'
    })
  })

  it('rejects a missing record', () => {
    expect(verifyOAuthState(undefined, 'state-123', now)).toEqual({
      ok: false,
      reason: 'missing-record'
    })
  })

  it('rejects a mismatched state', () => {
    expect(verifyOAuthState(record(), 'other-state', now)).toEqual({
      ok: false,
      reason: 'state-mismatch'
    })
  })

  it('rejects an expired state', () => {
    expect(verifyOAuthState(record({ expiresAt: now }), 'state-123', now)).toEqual({
      ok: false,
      reason: 'state-expired'
    })
  })

  it('rejects a consumed state', () => {
    expect(verifyOAuthState(record({ consumedAt: 900 }), 'state-123', now)).toEqual({
      ok: false,
      reason: 'state-consumed'
    })
  })
})

