export type OAuthStateFailure = 'missing-record' | 'state-mismatch' | 'state-expired' | 'state-consumed'

export interface OAuthStateRecord {
  state: string
  userId: string
  expiresAt: number
  consumedAt?: number
}

export interface OAuthStateVerification {
  ok: boolean
  userId?: string
  reason?: OAuthStateFailure
}

export function verifyOAuthState(
  record: OAuthStateRecord | undefined,
  providedState: string,
  now: number = Date.now()
): OAuthStateVerification {
  if (!record) {
    return { ok: false, reason: 'missing-record' }
  }

  if (record.state !== providedState) {
    return { ok: false, reason: 'state-mismatch' }
  }

  if (record.expiresAt <= now) {
    return { ok: false, reason: 'state-expired' }
  }

  if (record.consumedAt !== undefined) {
    return { ok: false, reason: 'state-consumed' }
  }

  return { ok: true, userId: record.userId }
}

