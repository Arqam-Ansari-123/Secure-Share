/**
 * Employee keypair — the inbound half of the product.
 *
 * Outbound secrets are symmetric: the sender picks a key and puts it in the
 * link. Inbound cannot work that way, because the *client* encrypts but the
 * *employee* must decrypt, and they do not share a link. So the employee
 * publishes a public key, clients encrypt to it, and only the employee can read
 * the result.
 *
 * The private key is stored on the server WRAPPED — AES-GCM encrypted under a
 * key derived from the employee's password, which never leaves the browser. The
 * server therefore holds a blob it has no way to open. Storing the raw private
 * key would let the server decrypt every credential a client ever submits,
 * which would throw away the property the whole product rests on.
 *
 * ECDH P-256 rather than X25519: P-256 is supported by every browser's Web
 * Crypto today, X25519 is not yet. Same shape, no library needed.
 */

import { fromB64, toB64 } from './crypto'

const KDF_ITERS = 310_000
const enc = new TextEncoder()

export interface WrappedKeys {
  pubkey: string
  privkey_wrapped: string
  privkey_salt: string
  privkey_iters: number
}

async function wrappingKey(password: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iters, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Generate a fresh keypair and wrap the private half under the password. */
export async function createKeys(password: string): Promise<WrappedKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      await wrappingKey(password, salt, KDF_ITERS),
      priv as BufferSource,
    ),
  )

  // iv is prepended so unwrapping needs only the blob and the password
  const blob = new Uint8Array(iv.length + wrapped.length)
  blob.set(iv, 0)
  blob.set(wrapped, iv.length)

  return {
    pubkey: toB64(pub),
    privkey_wrapped: toB64(blob),
    privkey_salt: toB64(salt),
    privkey_iters: KDF_ITERS,
  }
}

/** The raw PKCS#8 bytes. Throws (AES-GCM tag mismatch) if the password is wrong. */
export async function unwrapRaw(keys: WrappedKeys, password: string): Promise<ArrayBuffer> {
  const blob = fromB64(keys.privkey_wrapped)
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.slice(0, 12) as BufferSource },
    await wrappingKey(password, fromB64(keys.privkey_salt), keys.privkey_iters),
    blob.slice(12) as BufferSource,
  )
}

/** Unwrap the private key for use. Throws if the password is wrong. */
export async function unwrapPrivate(keys: WrappedKeys, password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    await unwrapRaw(keys, password),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  )
}

/** Re-wrap under a new password. Called during a password change, which is the
 *  only moment both passwords are available — miss it and the key is orphaned. */
export async function rewrap(
  keys: WrappedKeys,
  oldPassword: string,
  newPassword: string,
): Promise<WrappedKeys> {
  const rawPriv = await unwrapRaw(keys, oldPassword)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      await wrappingKey(newPassword, salt, KDF_ITERS),
      rawPriv,
    ),
  )
  const out = new Uint8Array(iv.length + wrapped.length)
  out.set(iv, 0)
  out.set(wrapped, iv.length)

  return {
    pubkey: keys.pubkey,
    privkey_wrapped: toB64(out),
    privkey_salt: toB64(salt),
    privkey_iters: KDF_ITERS,
  }
}

// --- the actual message encryption -----------------------------------------
// ECDH is a key-agreement primitive, not an encryption one, so the client
// generates an ephemeral keypair, agrees a shared secret with the employee's
// public key, and ships its ephemeral public key alongside the ciphertext.
// Standard ECIES. The employee re-derives the same secret from their private
// key and the attached ephemeral public key.
//
//   [65B ephemeral public key][12B IV][ciphertext]

async function sharedKey(priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: pub },
    priv,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Client side: encrypt to the employee's published public key. */
export async function sealTo(pubkeyB64: string, text: string): Promise<Uint8Array> {
  const theirPub = await crypto.subtle.importKey(
    'raw',
    fromB64(pubkeyB64) as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
  ])
  const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      await sharedKey(eph.privateKey, theirPub),
      enc.encode(text) as BufferSource,
    ),
  )

  const out = new Uint8Array(ephPub.length + iv.length + ct.length)
  out.set(ephPub, 0)
  out.set(iv, ephPub.length)
  out.set(ct, ephPub.length + iv.length)
  return out
}

/** Employee side: decrypt a client's submission. */
export async function openWith(priv: CryptoKey, blob: Uint8Array): Promise<string> {
  const ephPub = blob.slice(0, 65) // uncompressed P-256 point
  const iv = blob.slice(65, 77)
  const ct = blob.slice(77)

  const theirEph = await crypto.subtle.importKey(
    'raw',
    ephPub as BufferSource,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    await sharedKey(priv, theirEph),
    ct as BufferSource,
  )
  return new TextDecoder().decode(plain)
}
