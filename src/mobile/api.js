import { seal, open, fromB64u } from '../../shared/crypto.js';

const KEY_STORAGE = 'copycam:key';

// The pairing key arrives in the URL fragment (#k=...) from the QR code —
// fragments never hit the network. We stash it in localStorage so pairing
// survives reloads ("pair once"), then scrub it from the address bar.
export function loadKey() {
  const m = /[#&]k=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (m) {
    try {
      const key = fromB64u(m[1]);
      if (key.length === 32) {
        localStorage.setItem(KEY_STORAGE, m[1]);
        history.replaceState(null, '', window.location.pathname);
        return key;
      }
    } catch {
      // fall through to stored key
    }
  }
  const stored = localStorage.getItem(KEY_STORAGE);
  if (stored) {
    try {
      const key = fromB64u(stored);
      if (key.length === 32) return key;
    } catch {
      // corrupt — treat as unpaired
    }
  }
  return null;
}

export function forgetKey() {
  localStorage.removeItem(KEY_STORAGE);
}

// The same failure handling as the native client (mobile/src/lib/api.ts), so
// the two phone apps behave alike when the network misbehaves.
//
// How long each call may take. A scan uploads a photo and runs OCR; a hello is
// a few bytes. Without any timeout, a request to a computer that had gone away
// could leave the spinner running indefinitely.
const TIMEOUT_MS = { hello: 6_000, clip: 10_000, ocr: 20_000 };

// A phone just back from the lock screen often fails its first request while
// Wi-Fi wakes. One quiet retry absorbs that. Only a request that never got a
// response is retried — after a timeout the server may already have done it.
const RETRY_DELAY_MS = 700;

export class CallError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.kind = kind; // 'unreachable' | 'timeout' | 'rejected'
    this.status = status;
  }
}

async function attempt(key, endpoint, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS[endpoint] ?? 20_000);
  let res;
  try {
    res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // sealed per attempt: nonces are single-use, so a retry must not resend
      body: JSON.stringify(seal(key, payload, endpoint)),
      signal: controller.signal,
    });
  } catch {
    throw controller.signal.aborted ? new CallError('timeout', 'timeout') : new CallError('unreachable', 'unreachable');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new CallError('rejected', `server said ${res.status}`, res.status);
  return open(key, await res.json(), `${endpoint}-ack`);
}

// Sealed request/response round-trip. Requests and responses use distinct
// AADs so neither direction's payloads can be replayed as the other.
export async function call(key, endpoint, payload) {
  try {
    return await attempt(key, endpoint, payload);
  } catch (e) {
    if (!(e instanceof CallError) || e.kind !== 'unreachable') throw e;
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return attempt(key, endpoint, payload);
  }
}

// The computer can't be reached, as opposed to having answered badly.
export function isConnectionError(e) {
  return e instanceof CallError && (e.kind === 'unreachable' || e.kind === 'timeout');
}

// The computer answered but refused the seal: its key was rotated, or this
// phone holds an old one. Only scanning its current pairing code fixes that.
export function isPairingRejected(e) {
  return e instanceof CallError && e.kind === 'rejected' && (e.status === 400 || e.status === 403);
}
