/**
 * Zero-knowledge envelope. Everything here runs in the browser and nothing in
 * this file ever sends data anywhere.
 *
 * The server receives ciphertext and, at most, a passphrase *verifier*. It never
 * receives a key, so it cannot decrypt a secret even under compulsion.
 *
 * Key material
 *   linkKey   32 random bytes, carried in the URL fragment (#...). Browsers do
 *             not transmit fragments, so this never reaches any server or proxy.
 *   master    PBKDF2-SHA256(passphrase, salt, 310_000)          [passphrase only]
 *   encKey    HKDF(linkKey || master, info "ss-enc")   <- the AES-GCM key
 *   verifier  HKDF(master, info "ss-auth")             <- sent to the server
 *
 * The two HKDF info strings are what make the verifier safe to hand over: it is
 * domain-separated from the encryption key, so holding it yields nothing.
 */

const KDF_ITERS = 310_000
const enc = new TextEncoder()
const dec = new TextDecoder()

// --- base64url helpers -----------------------------------------------------

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const toB64Url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64Url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/'))

// --- key derivation --------------------------------------------------------

async function pbkdf2(passphrase: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iters, hash: 'SHA-256' },
    base,
    256,
  )
  return new Uint8Array(bits)
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode(info) },
    base,
    256,
  )
  return new Uint8Array(bits)
}

// Explicit <ArrayBuffer> throughout: the default Uint8Array is generic over
// ArrayBufferLike, which includes SharedArrayBuffer and is not accepted where a
// BufferSource-backed key is required.
function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

// --- envelope framing ------------------------------------------------------
// [4-byte big-endian header length][UTF-8 JSON header]
//
// File attachments have been removed from the product, so the header now
// carries only the text and there is no trailing payload segment.
//
// The 4-byte length prefix stays. It is not file-specific — EVERY blob ever
// created carries it, including text-only ones — so dropping it would make
// previously created secrets undecryptable. It also leaves the format open to
// gaining fields later without another breaking change.

interface Header {
  text: string
}

function pack(header: Header): Uint8Array<ArrayBuffer> {
  const head = enc.encode(JSON.stringify(header))
  const out = new Uint8Array(4 + head.length)
  new DataView(out.buffer).setUint32(0, head.length, false)
  out.set(head, 4)
  return out
}

function unpack(buf: Uint8Array): Header {
  const len = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, false)
  // Anything after the header is ignored — which is what lets a secret created
  // before this change still open, attachment silently dropped.
  return JSON.parse(dec.decode(buf.slice(4, 4 + len))) as Header
}

// --- public API ------------------------------------------------------------

export interface Sealed {
  blob: Uint8Array<ArrayBuffer> // salt || IV || ciphertext — what the server stores
  linkKey: string // goes in the URL fragment, never to the server
  kdf?: { salt: string; iters: number; verifier: string }
}

export async function seal(text: string, passphrase: string): Promise<Sealed> {
  const linkKeyBytes = crypto.getRandomValues(new Uint8Array(32))
  const salt = crypto.getRandomValues(new Uint8Array(16))

  let ikm: Uint8Array<ArrayBuffer> = linkKeyBytes
  let kdf: Sealed['kdf']
  if (passphrase) {
    const master = await pbkdf2(passphrase, salt, KDF_ITERS)
    ikm = concat(linkKeyBytes, master)
    kdf = {
      salt: toB64(salt),
      iters: KDF_ITERS,
      verifier: toB64(await hkdf(master, salt, 'ss-auth')),
    }
  }

  const raw = pack({ text })

  const keyBytes = await hkdf(ikm, salt, 'ss-enc')
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, raw as BufferSource),
  )

  // salt is prepended so decryption needs nothing but the blob + the fragment
  return { blob: concat(concat(salt, iv), ct), linkKey: toB64Url(linkKeyBytes), kdf }
}

export interface Opened {
  text: string
}

export async function open(blob: Uint8Array, linkKey: string, passphrase: string): Promise<Opened> {
  const salt = blob.slice(0, 16)
  const iv = blob.slice(16, 28)
  const ct = blob.slice(28)

  const linkKeyBytes = fromB64Url(linkKey)
  let ikm = linkKeyBytes
  if (passphrase) ikm = concat(linkKeyBytes, await pbkdf2(passphrase, salt, KDF_ITERS))

  const keyBytes = await hkdf(ikm, salt, 'ss-enc')
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['decrypt'])
  const raw = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource),
  )

  return { text: unpack(raw).text }
}

/** Verifier for the server's failed-attempt counter. Never yields the key. */
export async function makeVerifier(passphrase: string, saltB64: string, iters: number): Promise<string> {
  const salt = fromB64(saltB64)
  return toB64(await hkdf(await pbkdf2(passphrase, salt, iters), salt, 'ss-auth'))
}
