import { seal, open, fromB64u } from '../../shared/crypto.js';
import { toFrames, createAssembler, ADDRESS, PING } from '../../shared/relay.js';
import { CallError, isConnectionError, isPairingRejected } from './api.js';

export { CallError, isConnectionError, isPairingRejected };

// The phone's way to its computer when that computer is a copycam.app tab:
// through the relay (shared/relay.js), instead of straight over the Wi-Fi as
// with the companion (api.js). Same calls, same sealed boxes, same errors, so
// MobileApp can't tell the two apart except by their wording.

const STORAGE = 'copycam:web';

// The QR carries the room and the key in the fragment (#r=...&k=...), which
// never goes over the network. Both are kept so the link survives a reload,
// then scrubbed from the address bar.
export function loadKey() {
  const hash = window.location.hash;
  const room = /[#&]r=([A-Za-z0-9_-]+)/.exec(hash)?.[1];
  const k = /[#&]k=([A-Za-z0-9_-]+)/.exec(hash)?.[1];
  if (room && k) {
    try {
      const key = fromB64u(k);
      if (key.length === 32 && ADDRESS.test(room)) {
        localStorage.setItem(STORAGE, JSON.stringify({ r: room, k }));
        history.replaceState(null, '', window.location.pathname);
        return { key, room };
      }
    } catch {
      // fall through to the stored link
    }
  }
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    const key = stored && fromB64u(stored.k);
    if (key?.length === 32 && ADDRESS.test(stored.r)) return { key, room: stored.r };
  } catch {
    // corrupt: treat as unpaired
  }
  return null;
}

export function forgetKey() {
  localStorage.removeItem(STORAGE);
}

// A scan here also crosses the internet twice and may wait for the computer's
// reader to finish loading, so it gets longer than on a LAN.
const TIMEOUT_MS = { hello: 8_000, clip: 10_000, ocr: 60_000 };
// how long to wait for the relay to say whether the computer is there
const PRESENCE_MS = 3_000;
const KEEPALIVE_MS = 25_000;

let link = null; // { room, ws, ready, pc, pending: Map }

function relayUrl(room) {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/relay/phone/${room}`;
}

function failAll(l, kind) {
  for (const p of l.pending.values()) p.reject(new CallError(kind, kind));
  l.pending.clear();
}

function connect(room) {
  if (link && link.room === room && link.ws.readyState <= 1) return link;
  link?.ws.close();
  const ws = new WebSocket(relayUrl(room));
  const l = { room, ws, pc: null, pending: new Map(), waiters: [] };
  const assembler = createAssembler();
  const presence = (pc) => {
    l.pc = pc;
    for (const w of l.waiters.splice(0)) w(pc);
    if (!pc) failAll(l, 'unreachable');
  };
  let keepalive = null;

  ws.addEventListener('open', () => {
    keepalive = setInterval(() => ws.readyState === 1 && ws.send(PING), KEEPALIVE_MS);
  });
  ws.addEventListener('message', (e) => {
    if (typeof e.data !== 'string' || e.data === 'pong') return;
    if (e.data.startsWith('*\n')) {
      try {
        const news = JSON.parse(e.data.slice(2));
        if ('pc' in news) presence(Boolean(news.pc));
      } catch {
        // not news we understand
      }
      return;
    }
    let done;
    try {
      done = assembler.push(e.data);
    } catch {
      return;
    }
    if (!done) return;
    const waiting = l.pending.get(done.head.id);
    if (waiting) {
      l.pending.delete(done.head.id);
      waiting.resolve(done);
    }
  });
  ws.addEventListener('close', () => {
    clearInterval(keepalive);
    if (link === l) link = null;
    presence(false);
  });
  link = l;
  return l;
}

// Resolves to whether the computer is in the room, once the relay has said.
function computerThere(l) {
  if (l.pc !== null) return Promise.resolve(l.pc);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), PRESENCE_MS);
    l.waiters.push((pc) => {
      clearTimeout(timer);
      resolve(pc);
    });
  });
}

let counter = 0;

async function attempt({ key, room }, endpoint, payload) {
  const l = connect(room);
  if (!(await computerThere(l)) || l.ws.readyState !== 1) throw new CallError('unreachable', 'unreachable');

  const id = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  const answer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      l.pending.delete(id);
      reject(new CallError('timeout', 'timeout'));
    }, TIMEOUT_MS[endpoint] ?? 20_000);
    l.pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
  // sealed per attempt: nonces are single-use, so a retry must not resend
  for (const frame of toFrames({ id, ep: endpoint }, seal(key, payload, endpoint))) l.ws.send(frame);

  const { head, body } = await answer;
  if (head.st !== 200) throw new CallError('rejected', `computer said ${head.st}`, head.st);
  return open(key, JSON.parse(body), `${endpoint}-ack`);
}

// One quiet retry when the computer couldn't be reached at all, as on a LAN: a
// phone just back from the lock screen often loses its first try.
export async function call(pairing, endpoint, payload) {
  try {
    return await attempt(pairing, endpoint, payload);
  } catch (e) {
    if (!(e instanceof CallError) || e.kind !== 'unreachable') throw e;
    await new Promise((r) => setTimeout(r, 700));
    return attempt(pairing, endpoint, payload);
  }
}
