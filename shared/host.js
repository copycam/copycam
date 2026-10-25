import { open, seal, fromB64u, MAX_AGE_MS } from './crypto.js';
import { validDescription } from './direct.js';

// The computer's side of the phone protocol, whatever carries it: HTTP from the
// companion (server/app.js), or the copycam.app relay to a browser tab
// (src/web/). Each request is a sealed box for one endpoint; the answer is a
// status and a body, sealed when the request was good.
//
// Security model:
// - Possession of the 32-byte session key (delivered only via the QR code's
//   URL fragment) is the sole credential. Every payload must decrypt and
//   authenticate under AES-256-GCM with a per-endpoint AAD.
// - Replay: nonces are single-use for as long as a message could still pass the
//   freshness check; envelope timestamps bound cross-restart replays. Whatever
//   carries the boxes (a LAN, a relay) can delay or drop them, never forge or
//   replay them.

// Nonces seen recently enough that their message could still be accepted.
// A message is fresh while |now - t| <= MAX_AGE_MS, so a nonce must be
// remembered until the latest moment its message could pass that check:
// received + 2 * MAX_AGE_MS covers a sender clock running up to MAX_AGE_MS
// ahead. Entries are inserted in arrival order, so expired ones are always at
// the front and pruning stops at the first live one.
//
// This replaced a Set that was simply cleared once it held 5000 entries. Every
// nonce from the two minutes before a clear became replayable again, which is
// not what "single-use" promises.
export function createNonceLedger(windowMs = 2 * MAX_AGE_MS) {
  const seen = new Map(); // nonce -> expiry
  return {
    // true the first time a nonce is offered, false for a replay
    claim(nonce, now = Date.now()) {
      for (const [n, expiry] of seen) {
        if (expiry > now) break;
        seen.delete(n);
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, now + windowMs);
      return true;
    },
    get size() {
      return seen.size;
    },
  };
}

export const ENDPOINTS = ['hello', 'ocr', 'clip', 'rtc'];

// deps:
//   ocr(bytes: Uint8Array, script?) -> { words, lineCount, rotation }
//   wifi?(bytes) -> { ssid, password, security, hidden } | null
//   clipboard(text) -> anything; { copied: false } means the text is waiting
//     for a click on the computer (a browser tab can't always write the
//     clipboard by itself), and the phone is told so
//   rtc?(offer) -> answer: the direct route's introduction (shared/direct.js);
//     without it, the phone stays on the route it came by
//   onEvent?(event)
// info: extra fields for the hello answer (e.g. which scripts this reader has)
export function createHost({ key, name, deps, info = {} }) {
  const { clipboard, ocr, wifi, rtc, onEvent = () => {} } = deps;
  const nonces = createNonceLedger();

  // Decrypt + authenticate a request; enforce single-use nonces.
  const unseal = (box, aad) => {
    // open() first: only an authenticated message may occupy the ledger, so
    // someone without the key can't fill it
    const msg = open(key, box, aad);
    if (!nonces.claim(box.n)) throw new Error('replayed nonce');
    return msg;
  };
  const bad = { status: 400, body: { error: 'bad request' } };

  const handlers = {
    hello(box) {
      try {
        unseal(box, 'hello');
      } catch {
        return bad;
      }
      onEvent({ type: 'paired' });
      return { status: 200, body: seal(key, { name, ...info }, 'hello-ack') };
    },

    async ocr(box) {
      let msg;
      try {
        msg = unseal(box, 'ocr');
        if (typeof msg.img !== 'string') throw new Error('no image');
      } catch {
        return bad;
      }
      try {
        // script is a hint from the phone's language picker; ocr() validates it
        const script = typeof msg.script === 'string' ? msg.script.toLowerCase().slice(0, 20) : undefined;
        const image = fromB64u(msg.img);
        // A Wi-Fi QR on the label gives the network and password exactly, with
        // none of OCR's reading mistakes. It runs alongside the text and must
        // never cost the scan its words, so its failures are swallowed.
        const started = Date.now();
        const [result, found] = await Promise.all([
          ocr(image, script),
          wifi ? Promise.resolve(wifi(image)).catch(() => null) : null,
        ]);
        // how long reading took, so a slow scan can be told apart from a slow network
        onEvent({ type: 'scanned', blocks: result.lineCount, wifi: Boolean(found), ms: Date.now() - started });
        // `rotation` is how far the reader had to turn the image to read it; the
        // phone turns its copy to match so the highlights stay aligned.
        return {
          status: 200,
          body: seal(key, { words: result.words, rotation: result.rotation ?? 0, ...(found ? { wifi: found } : {}) }, 'ocr-ack'),
        };
      } catch {
        return { status: 500, body: { error: 'ocr failed' } };
      }
    },

    async clip(box) {
      let msg;
      try {
        msg = unseal(box, 'clip');
        if (typeof msg.text !== 'string' || !msg.text) throw new Error('no text');
      } catch {
        return bad;
      }
      try {
        const done = await clipboard(msg.text);
        const pending = done?.copied === false;
        onEvent({ type: 'copied', chars: msg.text.length, ...(pending ? { pending: true } : {}) });
        return { status: 200, body: seal(key, { ok: true, ...(pending ? { pending: true } : {}) }, 'clip-ack') };
      } catch {
        return { status: 500, body: { error: 'clipboard failed' } };
      }
    },
  };

  // The direct route's introduction: the phone's WebRTC offer in, the
  // computer's answer out, both sealed like any other message, so whatever
  // carries them (the relay) learns nothing, not even local addresses.
  handlers.rtc = async (box) => {
    let msg;
    try {
      msg = unseal(box, 'rtc');
      if (!validDescription(msg, 'offer')) throw new Error('not an offer');
    } catch {
      return bad;
    }
    if (!rtc) return { status: 404, body: { error: 'no direct route here' } };
    try {
      const answer = await rtc({ type: 'offer', sdp: msg.sdp });
      return { status: 200, body: seal(key, { type: 'answer', sdp: answer.sdp }, 'rtc-ack') };
    } catch {
      return { status: 500, body: { error: 'direct route failed' } };
    }
  };

  // -> { status, body }; never throws
  return async function handle(endpoint, box) {
    if (!Object.hasOwn(handlers, endpoint)) return { status: 404, body: { error: 'not found' } };
    if (!box || typeof box !== 'object') return bad;
    return handlers[endpoint](box);
  };
}
