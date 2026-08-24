/** Shared fetch plumbing. Contains no endpoint paths of its own. */

export class ApiError extends Error {
  // Longhand rather than a parameter property: `erasableSyntaxOnly` is on.
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const SESSION_EXPIRED = 'ss:session-expired'

/**
 * `staff` marks a call whose 401 means "your session expired".
 *
 * It is a caller-supplied flag rather than a path list on purpose. Two reasons:
 *
 *  1. POST /s/{token}/reveal ALSO returns 401 — for a wrong passphrase. A
 *     blanket "401 -> sign in again" would throw an external client off the
 *     passphrase screen the instant they mistype, on a page with no sign-in.
 *  2. A regex of staff paths living in this shared module would ship the names
 *     of internal endpoints inside the public bundle. Only api-staff.ts passes
 *     true, and that file never reaches a client.
 */
export async function req<T>(path: string, init: RequestInit = {}, staff = false): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(init.headers ?? {}) },
  })
  if (staff && res.status === 401) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED))
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
