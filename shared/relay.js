import { toB64u } from './crypto.js';

// How the phone and a copycam.app tab reach each other when neither can reach
// the other directly: both open a WebSocket to the relay (worker/), which
// passes messages between them and keeps nothing. What it passes are the same
// sealed boxes the companion takes over HTTP, so the relay can see their size
// and timing but never their contents (see shared/host.js).
//
// Addresses:
//   /relay/pc/<secret>    the computer. Only it knows the secret.
//   /relay/phone/<room>   a phone. room = roomFor(secret), carried in the QR.
// A phone can find the computer's room but can't become the computer in it,
// so whoever sees the room address can at most knock, never answer.
//
// On the wire, the relay prefixes what it hands the computer with the sender's
// connection id, and the computer prefixes its answers with the id they're for:
//   "<id>\n<frame>"          a message from (or to) one phone
//   "*\n<json>"              news from the relay itself: who's connected
// The phone's side carries bare frames, and the relay's "*\n" news.

export const PART_CHARS = 256 * 1024; // well under any WebSocket message limit
// On the direct route (a WebRTC data channel, shared/direct.js) a message may
// be 64 KB at most in some browsers and in the companion's WebRTC library, and
// pieces that size or larger also move fastest (the WebRTC lab, src/lab).
export const DIRECT_PART_CHARS = 60 * 1024;
export const MAX_MESSAGE_CHARS = 24 * 1024 * 1024; // a sealed photo is a few MB
export const PING = 'ping';
export const PONG = 'pong';

export async function roomFor(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`copycam-room:${secret}`));
  return toB64u(new Uint8Array(digest)).slice(0, 22);
}

export const ADDRESS = /^[A-Za-z0-9_-]{22,64}$/;

// One message, as the frames that carry it. `head` is the routing the receiver
// needs before it has every part: { id, ep } for a request, { id, st } for an
// answer.
export function toFrames(head, body, partChars = PART_CHARS) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const n = Math.max(1, Math.ceil(text.length / partChars));
  const frames = [];
  for (let i = 0; i < n; i++) {
    frames.push(JSON.stringify({ ...head, i, n, d: text.slice(i * partChars, (i + 1) * partChars) }));
  }
  return frames;
}

// Puts frames back together. Returns { head, body } when a message is
// complete, null while it's still arriving, and throws on a frame that can't
// be part of anything (the caller drops it). Unfinished messages are given up
// on after `ttlMs`, and never hold more than `maxChars` between them.
export function createAssembler({ maxChars = MAX_MESSAGE_CHARS, ttlMs = 60_000, maxOpen = 8, partChars = PART_CHARS } = {}) {
  const open = new Map(); // id -> { parts, got, chars, n, head, since }
  let held = 0;

  const drop = (id) => {
    const m = open.get(id);
    if (!m) return;
    held -= m.chars;
    open.delete(id);
  };

  return {
    push(frame, now = Date.now()) {
      for (const [id, m] of open) if (now - m.since > ttlMs) drop(id);

      const f = JSON.parse(frame);
      const { id, i, n, d } = f;
      if (typeof id !== 'string' || !id || id.length > 64) throw new Error('bad id');
      if (!Number.isInteger(n) || n < 1 || n > Math.ceil(maxChars / partChars)) throw new Error('bad count');
      if (!Number.isInteger(i) || i < 0 || i >= n || typeof d !== 'string' || d.length > partChars) {
        throw new Error('bad part');
      }
      const { i: _i, n: _n, d: _d, ...head } = f;

      if (n === 1) return { head, body: d };

      let m = open.get(id);
      if (!m) {
        if (open.size >= maxOpen) throw new Error('too many messages at once');
        m = { parts: new Array(n), got: 0, chars: 0, n, head, since: now };
        open.set(id, m);
      }
      if (m.n !== n) throw new Error('count changed');
      if (m.parts[i] !== undefined) return null; // a repeat: already have it
      if (held + d.length > maxChars) {
        drop(id);
        throw new Error('too large');
      }
      m.parts[i] = d;
      m.got++;
      m.chars += d.length;
      held += d.length;
      if (m.got < n) return null;
      drop(id);
      return { head: m.head, body: m.parts.join('') };
    },
    get pending() {
      return open.size;
    },
  };
}

// Split what the relay hands the computer into the sender and the frame.
export function splitRouted(message) {
  const cut = message.indexOf('\n');
  if (cut < 1) return null;
  return { from: message.slice(0, cut), frame: message.slice(cut + 1) };
}
