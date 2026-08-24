/**
 * The employee's private key, for the duration of a browser session.
 *
 * The key is unwrapped once — at sign-in, the only moment the password is in
 * memory — and held in sessionStorage so a page reload does not lose it.
 * sessionStorage rather than localStorage on purpose: it dies with the tab, so
 * a shared machine does not leave a usable key behind after the browser closes,
 * even though the 30-day session cookie survives.
 *
 * The trade-off this creates, stated plainly: the server session lasts 30 days
 * but the unwrapped key does not. Someone returning tomorrow has a valid session
 * and no key, so opening a reply prompts for their password. `needsPassword()`
 * is how the UI knows.
 */

import { createKeys, rewrap, unwrapRaw, type WrappedKeys } from './keys'
import { staffApi } from './api-staff'

const SLOT = 'ss_priv'
// The public half of whatever private key is in SLOT. Kept so the UI can tell
// whether the key it holds still matches the one a request was issued against —
// without that check, retrieving a reply destroys it before discovering it
// cannot be decrypted.
const PUB_SLOT = 'ss_pub'

/** PKCS#8 bytes, base64. Held only for this tab's lifetime. */
function stash(rawPkcs8B64: string, pubB64: string): void {
  try {
    sessionStorage.setItem(SLOT, rawPkcs8B64)
    sessionStorage.setItem(PUB_SLOT, pubB64)
  } catch {
    /* private browsing — the user will be asked for their password instead */
  }
}

export function forget(): void {
  try {
    sessionStorage.removeItem(SLOT)
    sessionStorage.removeItem(PUB_SLOT)
  } catch {
    /* nothing to do */
  }
}

/** The public key matching the private key currently held, or null. */
export function currentPublicKey(): string | null {
  try {
    return sessionStorage.getItem(PUB_SLOT)
  } catch {
    return null
  }
}

export function needsPassword(): boolean {
  try {
    return !sessionStorage.getItem(SLOT)
  } catch {
    return true
  }
}

async function toCryptoKey(pkcs8B64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(pkcs8B64), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey('pkcs8', raw as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ])
}

/**
 * Called right after a successful sign-in, while the password is still in hand.
 *
 * Generates a keypair on first use — so an existing account gains one the next
 * time its owner signs in, with no migration step and no admin action.
 */
export async function unlock(password: string, allowRotate = false): Promise<void> {
  let keys = (await staffApi.getKeys()) as Partial<WrappedKeys>

  if (!keys.pubkey) {
    const fresh = await createKeys(password)
    await staffApi.putKeys(fresh)
    keys = fresh
  }

  try {
    const pkcs8 = await unwrapRaw(keys as WrappedKeys, password)
    let s = ''
    for (const b of new Uint8Array(pkcs8)) s += String.fromCharCode(b)
    stash(btoa(s), keys.pubkey!)
    return
  } catch {
    forget()
  }

  // The stored key cannot be opened with this password. Two very different
  // causes, and conflating them would be destructive:
  //
  //   allowRotate = true   called from sign-in, where the server has just
  //                        verified the password. So the key really is
  //                        orphaned — almost always an admin `resetpw`, which
  //                        has no old password to re-wrap with. Issue a fresh
  //                        keypair, otherwise the account is permanently
  //                        broken: unable to read replies AND publishing a
  //                        public key nobody holds the private half of.
  //
  //   allowRotate = false  called from the unlock prompt, where the password is
  //                        unverified. A typo must never rotate the keypair —
  //                        that would destroy every pending reply.
  if (allowRotate) {
    const fresh = await createKeys(password)
    await staffApi.putKeys(fresh)
    const pkcs8 = await unwrapRaw(fresh, password)
    let s = ''
    for (const b of new Uint8Array(pkcs8)) s += String.fromCharCode(b)
    stash(btoa(s), fresh.pubkey)
  }
}

/**
 * Move an existing key across to a new password, without generating a new one.
 *
 * Under Active Directory this is the common case, not the rare one: people
 * change their domain password at the Windows lock screen, so the app never sees
 * the old one at the moment of change. On the next sign-in the key will not
 * open, and the honest fix is to ask for the previous password rather than
 * silently issuing a fresh keypair and orphaning every pending client reply.
 *
 * Returns false if the old password is wrong — nothing is written in that case.
 */
export async function migrateKey(oldPassword: string, currentPassword: string): Promise<boolean> {
  const keys = (await staffApi.getKeys()) as Partial<WrappedKeys>
  if (!keys.pubkey) return false
  try {
    const moved = await rewrap(keys as WrappedKeys, oldPassword, currentPassword)
    await staffApi.putKeys(moved)
    await unlock(currentPassword, false)
    return !needsPassword()
  } catch {
    return false
  }
}

/**
 * Give up on the old key and start fresh. Deliberately explicit — the caller
 * must have told the user that replies awaiting collection become unreadable.
 */
export async function abandonKey(currentPassword: string): Promise<void> {
  const fresh = await createKeys(currentPassword)
  await staffApi.putKeys(fresh)
  await unlock(currentPassword, false)
}

/** The private key for this session, or null if it must be unlocked first. */
export async function privateKey(): Promise<CryptoKey | null> {
  try {
    const stored = sessionStorage.getItem(SLOT)
    return stored ? await toCryptoKey(stored) : null
  } catch {
    return null
  }
}

/** Unlock on demand — when a session outlived the tab that unlocked it.
 *  Never rotates: an unverified password here is far more likely a typo. */
export async function unlockWithPassword(password: string): Promise<boolean> {
  await unlock(password, false)
  return !needsPassword()
}
