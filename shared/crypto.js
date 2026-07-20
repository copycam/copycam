import { gcm } from '@noble/ciphers/aes.js';

// Shared by the phone web app (bundled by Vite) and the Node server.
// AES-256-GCM envelopes. The 32-byte session key travels only inside the QR
// code's URL fragment (never over the network); possession of it is what
// authenticates a phone. Each message type carries its own AAD so a captured
// payload can't be replayed against a different endpoint.

const te = new TextEncoder();
const td = new TextDecoder();

// Message freshness window. Combined with the server's seen-nonce set this
// bounds replay: same-session replays fail the nonce check, cross-restart
// replays fail the timestamp check.
export const MAX_AGE_MS = 2 * 60 * 1000;

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function newKey() {
  return randomBytes(32);
}

export function toB64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromB64u(s) {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Encrypt a JSON-serializable object into { n, c } (nonce + ciphertext, base64url).
// A timestamp is stamped in so receivers can enforce freshness.
export function seal(key, obj, aad) {
  const nonce = randomBytes(12);
  const plaintext = te.encode(JSON.stringify({ ...obj, t: Date.now() }));
  const ct = gcm(key, nonce, te.encode(aad)).encrypt(plaintext);
  return { n: toB64u(nonce), c: toB64u(ct) };
}

// Decrypt and authenticate a { n, c } box. Throws on any failure: bad shape,
// bad tag (tamper/wrong key/wrong aad), or stale timestamp.
export function open(key, box, aad, maxAgeMs = MAX_AGE_MS) {
  if (!box || typeof box.n !== 'string' || typeof box.c !== 'string') {
    throw new Error('malformed box');
  }
  const nonce = fromB64u(box.n);
  if (nonce.length !== 12) throw new Error('malformed nonce');
  const pt = gcm(key, nonce, te.encode(aad)).decrypt(fromB64u(box.c));
  const obj = JSON.parse(td.decode(pt));
  if (typeof obj.t !== 'number' || Math.abs(Date.now() - obj.t) > maxAgeMs) {
    throw new Error('stale message');
  }
  return obj;
}
