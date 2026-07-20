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

// Sealed request/response round-trip. Requests and responses use distinct
// AADs so neither direction's payloads can be replayed as the other.
export async function call(key, endpoint, payload) {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(seal(key, payload, endpoint)),
  });
  if (!res.ok) throw new Error(`server said ${res.status}`);
  return open(key, await res.json(), `${endpoint}-ack`);
}
