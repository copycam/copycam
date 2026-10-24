import { seal, open, fromB64u } from '../../shared/crypto.js';
import { toFrames, createAssembler, splitRouted, roomFor, PING } from '../../shared/relay.js';

// WebRTC lab: can a phone page and a computer (a copycam.app tab, or the
// companion in Node) open a direct data channel on the same Wi-Fi, using the
// existing relay only to introduce them? Throwaway: nothing here is part of
// the product. The introduction (offer and answer, which carry the devices'
// local addresses) is sealed with a lab pairing key, so the relay only sees
// opaque boxes. No STUN or TURN server is used, so a channel that opens can
// only be a direct one on the local network.

export const SIZE = 2_500_000; // a photo-sized message
const CHUNK = 16 * 1024; // safe on every browser's data channel
const GATHER_MS = 2500;
const DIRECT_MS = 8000;
const RTC_CONFIG = { iceServers: [] };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function randomBlock() {
  const b = new Uint8Array(CHUNK);
  crypto.getRandomValues(b);
  return b;
}

// The whole SDP, candidates included, once gathering finishes (no trickle:
// one message each way keeps the lab simple).
async function gathered(pc) {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise((resolve) => {
      const done = () => pc.iceGatheringState === 'complete' && resolve();
      if (pc.addEventListener) pc.addEventListener('icegatheringstatechange', done);
      else pc.onicegatheringstatechange = done;
      setTimeout(resolve, GATHER_MS);
    });
  }
  return { type: pc.localDescription.type, sdp: hostOnly(pc.localDescription.sdp) };
}

// Only local-network candidates go in the introduction: "direct" must mean
// on the same network, never a path opened across the internet.
export function hostOnly(sdp) {
  return sdp
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('a=candidate:') || / typ host( |$)/.test(line))
    .join('\r\n');
}

export function candidatesIn(sdp) {
  return (sdp.match(/a=candidate:.*/g) || []).map((c) => {
    const p = c.split(' ');
    return `${p[7]} ${p[4]}`; // type address
  });
}

async function sendBytes(ch, size) {
  const block = randomBlock();
  if ('bufferedAmountLowThreshold' in ch) ch.bufferedAmountLowThreshold = 256 * 1024;
  let sent = 0;
  while (sent < size) {
    if (typeof ch.bufferedAmount === 'number' && ch.bufferedAmount > 2 * 1024 * 1024) {
      await new Promise((r) => {
        ch.onbufferedamountlow = () => r();
        setTimeout(r, 200);
      });
      continue;
    }
    const n = Math.min(CHUNK, size - sent);
    ch.send(n === CHUNK ? block : block.subarray(0, n));
    sent += n;
  }
}

const byteLength = (d) => (typeof d === 'string' ? -1 : d.byteLength ?? d.length);

// Wires a channel for the transfer protocol:
//   {k:'start', size} then `size` bytes; the receiver answers {k:'got'}.
function channelProtocol(ch, onEvent) {
  let expect = 0;
  let got = 0;
  ch.binaryType = 'arraybuffer';
  ch.onmessage = ({ data }) => {
    const n = byteLength(data);
    if (n < 0) {
      const msg = JSON.parse(data);
      if (msg.k === 'start') {
        expect = msg.size;
        got = 0;
      } else onEvent(msg);
      return;
    }
    got += n;
    if (expect && got >= expect) {
      expect = 0;
      ch.send(JSON.stringify({ k: 'got' }));
      onEvent({ k: 'received' });
    }
  };
}

function relaySocket({ url, WebSocketImpl, wsOptions, onMessage, onClose }) {
  const ws = wsOptions ? new WebSocketImpl(url, wsOptions) : new WebSocketImpl(url);
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('relay connection failed')));
    ws.addEventListener('close', (e) => reject(new Error(`relay closed (${e.code})`)));
  });
  ws.addEventListener('message', (e) => onMessage(typeof e.data === 'string' ? e.data : String(e.data)));
  ws.addEventListener('close', () => onClose?.());
  const keepalive = setInterval(() => ws.readyState === 1 && ws.send(PING), 25_000);
  ws.addEventListener('close', () => clearInterval(keepalive));
  return { ws, opened };
}

// ---------------------------------------------------------------------------
// The computer: answers offers, echoes transfers on the channel and the relay.
// ---------------------------------------------------------------------------
export function startComputer({ secret, key, relayUrl, WebSocketImpl = WebSocket, wsOptions, RTCPeerConnectionImpl = RTCPeerConnection, rtcConfig = RTC_CONFIG, log = () => {} }) {
  const assemblers = new Map();
  const peers = new Map(); // phone id -> RTCPeerConnection
  let sock;

  const reply = (phone, head, body) => {
    for (const f of toFrames(head, body)) sock.ws.send(`${phone}\n${f}`);
  };

  async function onOffer(phone, head, body) {
    let offer;
    try {
      offer = open(key, JSON.parse(body), 'lab-offer');
    } catch {
      log(`refused an offer that didn't open with the lab key`);
      return;
    }
    peers.get(phone)?.close();
    const pc = new RTCPeerConnectionImpl(rtcConfig);
    peers.set(phone, pc);
    pc.ondatachannel = ({ channel }) => {
      channel.onopen = () => log('direct channel open');
      channelProtocol(channel, async (msg) => {
        if (msg.k === 'received') {
          log(`received ${SIZE} bytes direct; sending them back`);
          channel.send(JSON.stringify({ k: 'start', size: SIZE }));
          await sendBytes(channel, SIZE);
        }
      });
      if (channel.readyState === 'open') log('direct channel open');
    };
    pc.oniceconnectionstatechange = () => log(`ICE ${pc.iceConnectionState}`);
    await pc.setRemoteDescription(offer);
    log(`offer from phone: ${candidatesIn(offer.sdp).join(', ') || 'no candidates'}`);
    await pc.setLocalDescription(await pc.createAnswer());
    const answer = await gathered(pc);
    log(`answering with: ${candidatesIn(answer.sdp).join(', ') || 'no candidates'}`);
    reply(phone, { id: head.id, t: 'answer' }, seal(key, answer, 'lab-answer'));
  }

  function onMessage(data) {
    if (data === 'pong') return;
    const routed = splitRouted(data);
    if (!routed) return;
    if (routed.from === '*') {
      try {
        const news = JSON.parse(routed.frame);
        if (news.phones) log(`phones connected: ${news.phones.length}`);
      } catch {
        // not news
      }
      return;
    }
    let a = assemblers.get(routed.from);
    if (!a) assemblers.set(routed.from, (a = createAssembler()));
    let done;
    try {
      done = a.push(routed.frame);
    } catch {
      return;
    }
    if (!done) return;
    if (done.head.t === 'offer') onOffer(routed.from, done.head, done.body).catch((e) => log(`offer failed: ${e.message}`));
    else if (done.head.t === 'blob') {
      log(`received ${done.body.length} chars through the relay; sending them back`);
      reply(routed.from, { id: `${done.head.id}g`, t: 'blob-got' }, '{}');
      reply(routed.from, { id: `${done.head.id}b`, t: 'blob-back' }, done.body);
    }
  }

  const url = `${relayUrl}/relay/pc/${secret}`;
  sock = relaySocket({ url, WebSocketImpl, wsOptions, onMessage, onClose: () => log('relay closed') });
  sock.opened.then(() => log('in the relay room, waiting for a phone'), (e) => log(e.message));
  return { close: () => sock.ws.close() };
}

// ---------------------------------------------------------------------------
// The phone: runs the whole test and reports numbers.
// ---------------------------------------------------------------------------
export async function runPhoneTest({ room, key, relayUrl, log = () => {}, WebSocketImpl = WebSocket }) {
  const r = { userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node', size: SIZE };
  const waiters = new Map(); // id -> resolve
  const assembler = createAssembler();
  let pcThere = null;
  let presence;
  const presenceKnown = new Promise((res) => (presence = res));
  const waitFor = (id, ms) =>
    new Promise((resolve, reject) => {
      waiters.set(id, resolve);
      setTimeout(() => reject(new Error(`no answer within ${ms / 1000}s`)), ms);
    });

  const t0 = now();
  const sock = relaySocket({
    url: `${relayUrl}/relay/phone/${room}`,
    WebSocketImpl,
    onMessage: (data) => {
      if (data === 'pong') return;
      if (data.startsWith('*\n')) {
        try {
          const news = JSON.parse(data.slice(2));
          if ('pc' in news) {
            pcThere = news.pc;
            presence(news.pc);
          }
        } catch {
          // not news
        }
        return;
      }
      let done;
      try {
        done = assembler.push(data);
      } catch {
        return;
      }
      if (done) waiters.get(done.head.id)?.(done);
    },
  });
  await sock.opened;
  await Promise.race([presenceKnown, wait(4000)]);
  r.relayConnectMs = Math.round(now() - t0);
  if (!pcThere) {
    sock.ws.close();
    throw new Error('the computer side is not in the relay room: is the lab page or script running there?');
  }
  log(`relay: connected in ${r.relayConnectMs} ms`);

  // Through the relay, for comparison: up, then back down.
  try {
    const body = 'x'.repeat(SIZE);
    const id = `b${Date.now().toString(36)}`;
    const t = now();
    for (const f of toFrames({ id, t: 'blob' }, body)) sock.ws.send(f);
    await waitFor(`${id}g`, 60_000);
    r.relayUpMs = Math.round(now() - t);
    const t2 = now();
    await waitFor(`${id}b`, 60_000);
    r.relayDownMs = Math.round(now() - t2);
    log(`relay: 2.5 MB up in ${r.relayUpMs} ms, back in ${r.relayDownMs} ms`);
  } catch (e) {
    r.relayError = e.message;
    log(`relay transfer: ${e.message}`);
  }

  // Direct: offer, sealed answer, channel.
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const ch = pc.createDataChannel('copycam-lab', { ordered: true });
  const events = [];
  let onEvent = () => {};
  channelProtocol(ch, (msg) => {
    events.push(msg);
    onEvent(msg);
  });
  const td = now();
  const opened = new Promise((resolve, reject) => {
    ch.onopen = resolve;
    pc.oniceconnectionstatechange = () => {
      log(`ICE ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') reject(new Error('ICE failed: no direct path between the two devices'));
    };
  });
  await pc.setLocalDescription(await pc.createOffer());
  const offer = await gathered(pc);
  r.gatherMs = Math.round(now() - td);
  r.phoneCandidates = candidatesIn(offer.sdp);
  log(`phone candidates: ${r.phoneCandidates.join(', ') || 'none'}`);
  const oid = `o${Date.now().toString(36)}`;
  for (const f of toFrames({ id: oid, t: 'offer' }, seal(key, offer, 'lab-offer'))) sock.ws.send(f);
  try {
    const answered = await waitFor(oid, 10_000);
    const answer = open(key, JSON.parse(answered.body), 'lab-answer');
    r.computerCandidates = candidatesIn(answer.sdp);
    r.introductionMs = Math.round(now() - td);
    log(`computer candidates: ${r.computerCandidates.join(', ') || 'none'}`);
    await pc.setRemoteDescription(answer);
    await Promise.race([opened, wait(DIRECT_MS).then(() => Promise.reject(new Error(`no direct channel within ${DIRECT_MS / 1000}s`)))]);
    r.directConnectMs = Math.round(now() - td);
    r.route = 'direct';
    log(`direct: channel open ${r.directConnectMs} ms after starting`);

    // which addresses it actually connected over
    try {
      const stats = await pc.getStats();
      let pair;
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
      });
      if (!pair) stats.forEach((s) => s.type === 'candidate-pair' && (s.selected || s.nominated) && s.state === 'succeeded' && (pair = s));
      if (pair) {
        const l = stats.get(pair.localCandidateId);
        const rc = stats.get(pair.remoteCandidateId);
        r.selectedPair = `${l?.candidateType} ${l?.address || l?.ip || ''} -> ${rc?.candidateType} ${rc?.address || rc?.ip || ''}`;
        r.rttMs = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : undefined;
      }
    } catch {
      // stats are a bonus
    }

    const tu = now();
    const gotBack = new Promise((resolve) => {
      onEvent = (msg) => msg.k === 'received' && resolve();
    });
    const acked = new Promise((resolve) => {
      const prev = onEvent;
      onEvent = (msg) => {
        prev(msg);
        if (msg.k === 'got') resolve();
      };
    });
    ch.send(JSON.stringify({ k: 'start', size: SIZE }));
    await sendBytes(ch, SIZE);
    await Promise.race([acked, wait(60_000)]);
    r.directUpMs = Math.round(now() - tu);
    const tb = now();
    await Promise.race([gotBack, wait(60_000)]);
    r.directDownMs = Math.round(now() - tb);
    log(`direct: 2.5 MB up in ${r.directUpMs} ms, back in ${r.directDownMs} ms`);
  } catch (e) {
    r.route = 'relay (fallback)';
    r.directError = e.message;
    log(`direct: ${e.message} -> the product would stay on the relay`);
  } finally {
    pc.close();
    sock.ws.close();
  }
  r.totalMs = Math.round(now() - t0);
  return r;
}

// ---------------------------------------------------------------------------
// Lab pairing: a secret for the computer, the room the phone uses, and a key.
// ---------------------------------------------------------------------------
export async function labLink(origin, secret, k) {
  return `${origin}/p/lab/#r=${await roomFor(secret)}&k=${k}`;
}

export function readLink(hash) {
  const room = /[#&]r=([A-Za-z0-9_-]+)/.exec(hash)?.[1];
  const k = /[#&]k=([A-Za-z0-9_-]+)/.exec(hash)?.[1];
  if (!room || !k) return null;
  return { room, k, key: fromB64u(k) };
}
