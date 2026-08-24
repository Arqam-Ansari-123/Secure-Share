/**
 * THE STAFF API CLIENT.
 *
 * Imported only from src/routes/staff.tsx and the pages it owns, so Rollup keeps
 * it out of the public bundle entirely. Nothing in this file — no endpoint path,
 * no field name — reaches a client's browser.
 */

import { json, req as rawReq } from './http'

/** Every call from this module is a staff call, so a 401 always means the
 *  session expired. See the note in http.ts on why this is a flag. */
const req = <T,>(path: string, init: RequestInit = {}) => rawReq<T>(path, init, true)

export interface Me {
  email: string
  display_name: string
  is_admin: boolean
  must_change_password: boolean
  /** 'ad' users have no local password — no change-password form, and a
   *  different key-migration story when the domain password rotates. */
  auth_source: 'local' | 'ad'
}

export interface SecretRow {
  tid: string
  label: string | null
  created_by: string | null
  created_at: string
  expires_at: string
  status: 'active' | 'viewed' | 'expired' | 'revoked' | 'destroyed'
  status_at: string | null
  status_reason: string | null
  has_passphrase: boolean
  size_bytes: number
  failed_attempts: number
  max_attempts: number
}

export interface AuditRow {
  event: string
  ok: boolean
  at: string
  ip: string | null
  user_agent: string | null
  detail: Record<string, unknown> | null
  actor_email: string | null
}

export interface RequestRow {
  rid: string
  label: string | null
  client_hint: string | null
  created_at: string
  expires_at: string
  status: 'open' | 'fulfilled' | 'expired' | 'revoked'
  status_at: string | null
  fulfilled_tid: string | null
  requested_by: string | null
  /** 'active' = a reply is waiting, 'viewed' = already read, 'expired' = timed out unread. */
  reply_status: 'active' | 'viewed' | 'expired' | 'revoked' | 'destroyed' | null
  reply_read_at: string | null
  /** The public key this request was issued against, base64. Compared with the
   *  key currently held before a reply is retrieved — retrieval destroys it. */
  request_pubkey: string | null
}

export interface ActivityRow {
  id: number
  tid: string | null
  event: string
  ok: boolean
  at: string
  ip: string | null
  user_agent: string | null
  detail: Record<string, unknown> | null
  actor_email: string | null
}

export interface WrappedKeys {
  pubkey: string
  privkey_wrapped: string
  privkey_salt: string
  privkey_iters: number
}

export const staffApi = {
  // --- auth ---
  login: (email: string, password: string) => req<Me>('/auth/login', json({ email, password })),
  logout: () => req<void>('/auth/logout', { method: 'POST' }),
  logoutAll: () => req<void>('/auth/logout-all', { method: 'POST' }),
  me: () => req<Me>('/auth/me'),
  changePassword: (current: string, next: string) =>
    req<void>('/auth/password', json({ current, new: next })),

  // --- secrets ---
  create(meta: Record<string, unknown>, blob: Uint8Array) {
    const form = new FormData()
    form.append('meta', JSON.stringify(meta))
    form.append('blob', new Blob([blob as BlobPart], { type: 'application/octet-stream' }), 'blob.bin')
    return req<{ token: string; tid: string; url: string; expires_at: string }>('/secrets', {
      method: 'POST',
      body: form,
    })
  },
  list: () => req<SecretRow[]>('/secrets'),
  revoke: (tid: string) => req<void>(`/secrets/${tid}/revoke`, { method: 'POST' }),
  audit: (tid: string) => req<AuditRow[]>(`/secrets/${tid}/audit`),

  // --- the employee's encryption keypair ---
  getKeys: () => req<Partial<WrappedKeys>>('/auth/keys'),
  putKeys: (keys: WrappedKeys) =>
    req<void>('/auth/keys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(keys) }),

  // --- credential requests (inbound) ---
  createRequest: (body: { label?: string | null; client_hint?: string | null; expires_in?: number }) =>
    req<{ token: string; rid: string; url: string; expires_at: string }>('/requests', json(body)),
  listRequests: () => req<RequestRow[]>('/requests'),
  revokeRequest: (rid: string) => req<void>(`/requests/${rid}/revoke`, { method: 'POST' }),
  /** Retrieves the client's submission — once. */
  takeReply: (rid: string) => req<{ blob: string; size_bytes: number }>(`/requests/${rid}/reply`, { method: 'POST' }),

  // --- admin ---
  activity: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
    return req<{ rows: ActivityRow[]; next_cursor: number | null }>(`/admin/activity?${q}`)
  },
  actors: () => req<string[]>('/admin/actors'),
}
