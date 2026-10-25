import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { call, pickRoute, recordSpeed, onRoute, BIG, SLOW } from './relay.js';
import { createHost } from '../../shared/host.js';
import { createDirectHost } from '../../shared/direct.js';
import { seal, newKey } from '../../shared/crypto.js';
import { toFrames, createAssembler } from '../../shared/relay.js';
import { fakeNetwork } from '../test/fake-rtc.js';

// Two routes, one pairing: the phone starts on the relay, moves to the direct
// channel once it opens, and falls back when it drops (src/mobile/relay.js).

let n = 0;
// a room per test: the link to a room is kept open between calls
const room = () => `swch${String(n++).padStart(2, '0')}${'s'.repeat(16)}`;

describe('which route a message takes', () => {
  const none = { relay: null, direct: null };
  it('stays on the relay until the direct channel is open', () => {
    expect(pickRoute({ directOpen: false, speed: none, bigSends: 0 }, 10)).toBe('relay');
    expect(pickRoute({ directOpen: false, speed: none, bigSends: 0 }, BIG * 10)).toBe('relay');
  });

  it('sends small messages direct whenever it can', () => {
    expect(pickRoute({ directOpen: true, speed: { relay: 99_000, direct: 1 }, bigSends: 0 }, 1000)).toBe('direct');
  });

  it('sends a photo direct, unless the relay has been clearly faster', () => {
    expect(pickRoute({ directOpen: true, speed: none, bigSends: 0 }, BIG)).toBe('direct');
    // a slow direct channel: try the relay once to compare
    expect(pickRoute({ directOpen: true, speed: { relay: null, direct: SLOW / 2 }, bigSends: 1 }, BIG)).toBe('relay');
    expect(pickRoute({ directOpen: true, speed: { relay: 3000, direct: 1000 }, bigSends: 1 }, BIG)).toBe('relay');
    expect(pickRoute({ directOpen: true, speed: { relay: 1100, direct: 1000 }, bigSends: 1 }, BIG)).toBe('direct');
    // while the relay wins, the direct route gets another try now and then
    expect(pickRoute({ directOpen: true, speed: { relay: 3000, direct: 1000 }, bigSends: 4 }, BIG)).toBe('direct');
  });

  it('learns speeds from photo-sized uploads only', () => {
    expect(recordSpeed({ relay: null, direct: null }, 'direct', 100, 10)).toEqual({ relay: null, direct: null });
    const once = recordSpeed({ relay: null, direct: null }, 'direct', BIG, 100);
    expect(once.direct).toBeCloseTo(BIG / 100);
    expect(recordSpeed(once, 'direct', BIG, 50).direct).toBeCloseTo((BIG / 100 + BIG / 50) / 2);
  });
});

// The relay, and the computer behind it with its direct route on a fake
// network. What the relay saw is kept, to check what it carried and what it
// could read.
function relayWithComputer(net) {
  const key = newKey();
  const clipboard = vi.fn();
  let direct = null;
  const host = createHost({ key, name: 'your PC', deps: { ocr: vi.fn(), clipboard, rtc: (offer) => direct.answer(offer) } });
  direct = createDirectHost({ loadRTC: () => net.RTCPeerConnection, handle: host });
  const seen = [];
  class FakeWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.assembler = createAssembler();
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
        this.deliver(`*\n${JSON.stringify({ pc: true })}`);
      }, 0);
    }
    deliver(data) {
      const e = new Event('message');
      e.data = data;
      this.dispatchEvent(e);
    }
    send(frame) {
      if (frame === 'ping') return;
      seen.push(frame);
      const done = this.assembler.push(frame);
      if (!done) return;
      host(done.head.ep, JSON.parse(done.body)).then(({ status, body }) => {
        for (const f of toFrames({ id: done.head.id, st: status }, body)) this.deliver(f);
      });
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  const relayed = (ep) => seen.filter((f) => JSON.parse(f).ep === ep).length;
  return { key, clipboard, FakeWebSocket, seen, relayed };
}

const routeBecomes = (want, ms = 2000) =>
  new Promise((resolve, reject) => {
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`route never became ${want}`));
    }, ms);
    stop = onRoute((r) => {
      if (r !== want) return;
      clearTimeout(timer);
      queueMicrotask(() => stop());
      resolve();
    });
  });

describe('switching between the relay and the direct route', () => {
  const realWebSocket = globalThis.WebSocket;
  const realRTC = globalThis.RTCPeerConnection;
  let net;
  beforeEach(() => {
    net = fakeNetwork();
    globalThis.RTCPeerConnection = net.RTCPeerConnection;
  });
  afterEach(() => {
    globalThis.WebSocket = realWebSocket;
    globalThis.RTCPeerConnection = realRTC;
  });

  it('starts on the relay, then moves to the direct route by itself', async () => {
    const c = relayWithComputer(net);
    globalThis.WebSocket = c.FakeWebSocket;
    const pairing = { key: c.key, room: room() };
    await call(pairing, 'hello', {});
    expect(c.relayed('hello')).toBe(1);
    await routeBecomes('direct');
    await call(pairing, 'clip', { text: 'hi' });
    expect(c.clipboard).toHaveBeenCalledWith('hi');
    expect(c.relayed('clip')).toBe(0); // it went direct
  });

  it('introduces the two devices without the relay learning their addresses', async () => {
    const c = relayWithComputer(net);
    globalThis.WebSocket = c.FakeWebSocket;
    await call({ key: c.key, room: room() }, 'hello', {});
    await routeBecomes('direct');
    expect(c.relayed('rtc')).toBe(1);
    expect(c.seen.join('')).not.toContain('192.168.0.9');
    // and the phone offered only its local candidate
    expect(net.offers[0]).toContain('192.168.0.9');
    expect(net.offers[0]).not.toContain('srflx');
  });

  it('goes back through the relay when the direct channel drops', async () => {
    const c = relayWithComputer(net);
    globalThis.WebSocket = c.FakeWebSocket;
    const pairing = { key: c.key, room: room() };
    await call(pairing, 'hello', {});
    await routeBecomes('direct');
    net.cut();
    await routeBecomes('relay');
    await call(pairing, 'clip', { text: 'again' });
    expect(c.clipboard).toHaveBeenCalledWith('again');
    expect(c.relayed('clip')).toBe(1);
  });

  it('stays on the relay when there is no direct path, as on a guest Wi-Fi', async () => {
    net.reachable = false;
    const c = relayWithComputer(net);
    globalThis.WebSocket = c.FakeWebSocket;
    const pairing = { key: c.key, room: room() };
    const routes = [];
    const stop = onRoute((r) => routes.push(r));
    await call(pairing, 'hello', {});
    await new Promise((r) => setTimeout(r, 50));
    await call(pairing, 'clip', { text: 'by relay' });
    stop();
    expect(routes).not.toContain('direct');
    expect(c.clipboard).toHaveBeenCalledWith('by relay');
    expect(c.relayed('clip')).toBe(1);
  });

  it('is introduced only with the pairing key', async () => {
    const c = relayWithComputer(net);
    globalThis.WebSocket = c.FakeWebSocket;
    // an introduction sealed with another key never reaches the computer's WebRTC side
    const ws = new c.FakeWebSocket('wss://test/relay/phone/x');
    await new Promise((r) => setTimeout(r, 5));
    for (const f of toFrames({ id: 'x1', ep: 'rtc' }, seal(newKey(), { type: 'offer', sdp: 'v=0' }, 'rtc'))) ws.send(f);
    await new Promise((r) => setTimeout(r, 5));
    expect(net.offers).toHaveLength(0);
  });
});
