import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadKey, forgetKey, call, isConnectionError, isPairingRejected } from './relay.js';
import { createHost } from '../../shared/host.js';
import { newKey, toB64u } from '../../shared/crypto.js';
import { toFrames, createAssembler } from '../../shared/relay.js';

let n = 0;
// a room per test: the link to a room is kept open between calls
const room = () => `room${String(n++).padStart(2, '0')}${'r'.repeat(16)}`;

// A relay with a computer in it (or not), in place of the real WebSocket:
// frames from the phone go to a real host, and its answers come back as the
// relay would hand them over.
function fakeRelay({ pcThere = true, host = null } = {}) {
  const sockets = [];
  class FakeWebSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.assembler = createAssembler();
      sockets.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
        this.deliver(`*\n${JSON.stringify({ pc: pcThere })}`);
      }, 0);
    }
    deliver(data) {
      const e = new Event('message');
      e.data = data;
      this.dispatchEvent(e);
    }
    send(frame) {
      if (frame === 'ping') return;
      const done = this.assembler.push(frame);
      if (!done || !host) return;
      host(done.head.ep, JSON.parse(done.body)).then(({ status, body }) => {
        for (const f of toFrames({ id: done.head.id, st: status }, body)) this.deliver(f);
      });
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  return { FakeWebSocket, sockets };
}

describe('the phone’s relay link', () => {
  const realWebSocket = globalThis.WebSocket;
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/p/');
  });
  afterEach(() => {
    globalThis.WebSocket = realWebSocket;
  });

  it('takes the room and key from the QR link, keeps them, and scrubs the address bar', () => {
    const r = room();
    const key = newKey();
    history.replaceState(null, '', `/p/#r=${r}&k=${toB64u(key)}`);
    const pairing = loadKey();
    expect(pairing.room).toBe(r);
    expect([...pairing.key]).toEqual([...key]);
    expect(window.location.hash).toBe('');
    // a reload finds it again
    expect(loadKey().room).toBe(r);
    forgetKey();
    expect(loadKey()).toBeNull();
  });

  it('ignores a link without both halves', () => {
    history.replaceState(null, '', `/p/#k=${toB64u(newKey())}`);
    expect(loadKey()).toBeNull();
  });

  it('asks the computer through the relay and opens its sealed answer', async () => {
    const key = newKey();
    const host = createHost({ key, name: 'your Mac', deps: { ocr: vi.fn(), clipboard: vi.fn() } });
    const relay = fakeRelay({ host });
    globalThis.WebSocket = relay.FakeWebSocket;
    const r = room();
    const ack = await call({ key, room: r }, 'hello', {});
    expect(ack.name).toBe('your Mac');
    expect(relay.sockets[0].url.endsWith(`/relay/phone/${r}`)).toBe(true);
  });

  it('says the computer can’t be reached when its tab isn’t open', async () => {
    globalThis.WebSocket = fakeRelay({ pcThere: false }).FakeWebSocket;
    const err = await call({ key: newKey(), room: room() }, 'hello', {}).catch((e) => e);
    expect(isConnectionError(err)).toBe(true);
  });

  it('reports a computer that no longer knows this phone’s key', async () => {
    const host = createHost({ key: newKey(), name: 'x', deps: { ocr: vi.fn(), clipboard: vi.fn() } });
    globalThis.WebSocket = fakeRelay({ host }).FakeWebSocket;
    const err = await call({ key: newKey(), room: room() }, 'hello', {}).catch((e) => e);
    expect(isPairingRejected(err)).toBe(true);
  });
});
