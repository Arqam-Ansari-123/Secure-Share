/**
 * THE PUBLIC API CLIENT — the only one an external client's browser receives.
 *
 * Contains exactly the two endpoints a recipient needs. The staff endpoints live
 * in api-staff.ts, which is imported solely from the staff route module, so the
 * internal path map is never shipped in the public bundle. Keeping them in one
 * file put strings like "/auth/logout-all" into every client's download.
 */

import { req } from './http'

export { ApiError, SESSION_EXPIRED } from './http'

export interface SecretMeta {
  has_passphrase: boolean
  kdf_salt: string | null
  kdf_iters: number | null
  expires_at: string
  size_bytes: number
  attempts_remaining: number
  reveal_ticket: string
}

export interface RequestPublic {
  label: string | null
  requested_by: string
  requested_by_email: string
  /** base64 — the key the client encrypts to. */
  pubkey: string
  expires_at: string
}

export const api = {
  meta: (token: string) => req<SecretMeta>(`/s/${encodeURIComponent(token)}/meta`),

  // --- inbound: a client answering a credential request ---
  viewRequest: (token: string) => req<RequestPublic>(`/r/${encodeURIComponent(token)}`),

  submitRequest(token: string, blob: Uint8Array) {
    const form = new FormData()
    form.append('blob', new Blob([blob as BlobPart], { type: 'application/octet-stream' }), 'blob.bin')
    return req<{ ok: boolean }>(`/r/${encodeURIComponent(token)}/submit`, {
      method: 'POST',
      body: form,
    })
  },

  reveal: (token: string, ticket: string, verifier?: string) =>
    req<{ blob: string; size_bytes: number }>(`/s/${encodeURIComponent(token)}/reveal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifier ? { ticket, verifier } : { ticket }),
    }),
}

/**
 * One-release cleanup: Phase 1 stored an anonymous sender id in localStorage and
 * handed it to /session/adopt, which made that value a bearer credential. Both
 * the endpoint and the concept are gone; this clears the leftovers from browsers
 * that already have one. Remove after a release.
 */
export function purgeLegacySession(): void {
  localStorage.removeItem('ss_sender_id')
}
