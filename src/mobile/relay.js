import { seal, open, fromB64u } from '../../shared/crypto.js';
import { toFrames, createAssembler, ADDRESS, PING, DIRECT_PART_CHARS } from '../../shared/relay.js';
import { RTC_CONFIG, gathered, sendFrames, validDescription } from '../../shared/direct.js';
import { CallError, isConnectionError, isPairingRejected } from './api.js';

export { CallError, isConnectionError, isPairingRejected };

// The phone's way to its computer when it was paired through copycam.app (a
// copycam.app tab, or the companion): two routes, one pairing.
//
//   through copycam.app   the relay (shared/relay.js): works from any network
//   direct on Wi-Fi       a WebRTC data channel (shared/direct.js), when the
//                         phone and the computer share a network
//
// It always starts on the relay, which always works, and opens the direct
// channel in the background; once that's open, messages go direct, and if it
// drops they go back through the relay. Nothing for anyone to choose. Both
// routes carry the same sealed boxes to the same handler on the computer,
// which accepts each nonce once, whichever way it came.
//
// Same calls, same errors as the LAN transport (api.js), plus onRoute(fn) for
// the label that says which route is in use.

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
  link?.close();
}

// A scan through the relay crosses the internet twice and may wait for the
// computer's reader to finish loading, so it gets longer than on a LAN.
const TIMEOUT_MS = { hello: 8_000, clip: 10_000, ocr: 60_000, rtc: 10_000 };
// how long to wait for the relay to say whether the computer is there
const PRESENCE_MS = 3_000;
const KEEPALIVE_MS = 25_000;
// the direct channel gets this long to open, once the computer has answered
const DIRECT_OPEN_MS = 8_000;
// after a failed try, wait this long before trying the direct route again
const DIRECT_RETRY_MS = 20_000;

// ---------------------------------------------------------------------------
// Which route a message takes
// ---------------------------------------------------------------------------
// Small messages go direct whenever the channel is open. For a photo, the
// route that has been faster: the WebRTC lab found a direct channel can be
// slower than the relay on some phones and networks. Speeds come from the
// computer's receipts (shared/relay-host.js, shared/direct.js), in bytes per
// millisecond, for messages of at least BIG.
export const BIG = 128 * 1024;
// below this (1.5 MB/s), a direct channel is slow enough to see whether the
// relay does better
export const SLOW = 1500;

export function pickRoute({ directOpen, speed, bigSends }, size) {
  if (!directOpen) return 'relay';
  if (size < BIG) return 'direct';
  const { direct, relay } = speed;
  if (direct == null) return 'direct'; // find out how fast it is
  if (relay == null) return direct < SLOW ? 'relay' : 'direct'; // slow: try the relay once, to compare
  const faster = relay > direct * 1.2 ? 'relay' : 'direct';
  // networks change: while the relay wins, try the direct route again now and then
  if (faster === 'relay' && bigSends % 5 === 4) return 'direct';
  return faster;
}

export function recordSpeed(speed, route, bytes, ms) {
  if (bytes < BIG || ms <= 0) return speed;
  const rate = bytes / ms;
  return { ...speed, [route]: speed[route] == null ? rate : speed[route] * 0.5 + rate * 0.5 };
}

// ---------------------------------------------------------------------------
// The route label
// ---------------------------------------------------------------------------
const routeListeners = new Set();
let currentRoute = 'relay';

function setRoute(route) {
  if (route === currentRoute) return;
  currentRoute = route;
  for (const fn of routeListeners) fn(route);
}

// fn('relay' | 'direct'), now and on every change; returns an unsubscribe
export function onRoute(fn) {
  routeListeners.add(fn);
  fn(currentRoute);
  return () => routeListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// The link: one per paired computer, with its relay socket and direct channel
// ---------------------------------------------------------------------------
let link = null;
let counter = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function relayUrl(room) {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/relay/phone/${room}`;
}

function directLost() {
  const e = new CallError('unreachable', 'direct route lost');
  e.direct = true;
  return e;
}

function receive(l, done, route) {
  const { id, rc } = done.head;
  if (rc) {
    // a receipt: the whole request arrived, so this is how long the upload took
    const sent = l.sent.get(id);
    if (sent && sent.route === route) l.speed = recordSpeed(l.speed, route, sent.bytes, now() - sent.t);
    l.sent.delete(id);
    return;
  }
  l.sent.delete(id);
  const waiting = l.pending.get(id);
  if (waiting) {
    l.pending.delete(id);
    waiting.resolve(done);
  }
}

function fail(l, route, makeError) {
  for (const [id, p] of l.pending) {
    if (p.route !== route) continue;
    l.pending.delete(id);
    p.reject(makeError());
  }
}

function openRelay(l) {
  if (l.ws && l.ws.readyState <= 1) return;
  const ws = new WebSocket(relayUrl(l.room));
  const assembler = createAssembler();
  let keepalive = null;
  l.ws = ws;
  l.pc = null;
  const presence = (pc) => {
    l.pc = pc;
    for (const w of l.waiters.splice(0)) w(pc);
    // the relay route can't deliver now; the direct route may still be fine
    if (!pc) fail(l, 'relay', () => new CallError('unreachable', 'unreachable'));
  };
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
    if (done) receive(l, done, 'relay');
  });
  ws.addEventListener('close', () => {
    clearInterval(keepalive);
    if (l.ws === ws) presence(false);
  });
}

function linkFor(pairing) {
  if (link && link.room === pairing.room) {
    link.pairing = pairing;
    openRelay(link);
    return link;
  }
  link?.close();
  const l = {
    room: pairing.room,
    pairing,
    ws: null,
    pc: null, // whether the relay says the computer is there (null: not told yet)
    waiters: [],
    pending: new Map(), // id -> { resolve, reject, route }
    sent: new Map(), // id -> { t, bytes, route }, until its receipt arrives
    speed: { relay: null, direct: null },
    bigSends: 0,
    direct: { state: 'idle', pc: null, channel: null, lastTry: 0 },
    closed: false,
    close() {
      l.closed = true;
      l.ws?.close();
      l.direct.pc?.close();
      if (link === l) link = null;
      setRoute('relay');
    },
  };
  link = l;
  openRelay(l);
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

async function attempt(pairing, endpoint, payload, { via } = {}) {
  const l = linkFor(pairing);
  // sealed per attempt: nonces are single-use, so a retry must not resend
  const text = JSON.stringify(seal(pairing.key, payload, endpoint));
  const directOpen = l.direct.state === 'open';
  let route = via ?? pickRoute({ directOpen, speed: l.speed, bigSends: l.bigSends }, text.length);
  if (text.length >= BIG) l.bigSends++;
  if (route === 'relay' && !((await computerThere(l)) && l.ws.readyState === 1)) {
    // no relay, but the computer may still be right here on the Wi-Fi
    if (!via && l.direct.state === 'open') route = 'direct';
    else throw new CallError('unreachable', 'unreachable');
  }

  const id = `${Date.now().toString(36)}${(counter++).toString(36)}`;
  const answer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      l.pending.delete(id);
      l.sent.delete(id);
      reject(new CallError('timeout', 'timeout'));
    }, TIMEOUT_MS[endpoint] ?? 20_000);
    l.pending.set(id, {
      route,
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
  l.sent.set(id, { t: now(), bytes: text.length, route });
  if (route === 'direct') {
    sendFrames(l.direct.channel, toFrames({ id, ep: endpoint }, text, DIRECT_PART_CHARS)).catch(() => {
      const p = l.pending.get(id);
      if (!p) return;
      l.pending.delete(id);
      p.reject(directLost());
    });
  } else {
    for (const frame of toFrames({ id, ep: endpoint }, text)) l.ws.send(frame);
  }

  const { head, body } = await answer;
  if (head.st !== 200) throw new CallError('rejected', `computer said ${head.st}`, head.st);
  return open(pairing.key, JSON.parse(body), `${endpoint}-ack`);
}

// ---------------------------------------------------------------------------
// The direct route, opened in the background
// ---------------------------------------------------------------------------
async function startDirect(l, { force = false } = {}) {
  const d = l.direct;
  if (typeof RTCPeerConnection === 'undefined' || l.closed) return;
  if (d.state === 'connecting' || d.state === 'open') return;
  if (!force && Date.now() - d.lastTry < DIRECT_RETRY_MS) return;
  d.lastTry = Date.now();
  d.state = 'connecting';
  let pc = null;
  try {
    pc = new RTCPeerConnection(RTC_CONFIG);
    const channel = pc.createDataChannel('copycam', { ordered: true });
    const assembler = createAssembler({ partChars: DIRECT_PART_CHARS });
    channel.onmessage = ({ data }) => {
      if (typeof data !== 'string') return;
      let done;
      try {
        done = assembler.push(data);
      } catch {
        return;
      }
      if (done) receive(l, done, 'direct');
    };
    let opened;
    let failed;
    const ready = new Promise((resolve, reject) => {
      opened = resolve;
      failed = reject;
    });
    channel.onopen = () => opened();
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') failed(new Error('no direct path'));
    };

    await pc.setLocalDescription(await pc.createOffer());
    const offer = await gathered(pc);
    // the introduction: sealed, through the relay, like any other message
    const answer = await attempt(l.pairing, 'rtc', { type: 'offer', sdp: offer.sdp }, { via: 'relay' });
    if (!validDescription(answer, 'answer')) throw new Error('bad answer');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), DIRECT_OPEN_MS))]);
    if (l.closed || link !== l) throw new Error('link closed');

    d.pc = pc;
    d.channel = channel;
    d.state = 'open';
    setRoute('direct');
    const lost = () => {
      if (d.channel !== channel) return;
      d.channel = null;
      d.pc = null;
      d.state = 'idle';
      setRoute('relay');
      fail(l, 'direct', directLost);
      pc.close();
    };
    channel.onclose = lost;
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) lost();
    };
  } catch {
    d.state = 'failed';
    pc?.close();
  }
}

// Back on the page: the network may have changed, so try the direct route again.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && link && link.direct.state !== 'open' && link.pc) startDirect(link, { force: true });
  });
}

// ---------------------------------------------------------------------------
// The call MobileApp makes
// ---------------------------------------------------------------------------
// A message that was on the direct route when it dropped goes again through
// the relay at once. Otherwise, one quiet retry when the computer couldn't be
// reached at all: a phone just back from the lock screen often loses its
// first try.
export async function call(pairing, endpoint, payload) {
  let result;
  try {
    result = await attempt(pairing, endpoint, payload);
  } catch (e) {
    if (!(e instanceof CallError) || e.kind !== 'unreachable') throw e;
    if (!e.direct) await new Promise((r) => setTimeout(r, 700));
    result = await attempt(pairing, endpoint, payload, e.direct ? { via: 'relay' } : {});
  }
  // linked: now see whether there's a direct way to the computer too
  if (endpoint === 'hello' && link) startDirect(link);
  return result;
}
