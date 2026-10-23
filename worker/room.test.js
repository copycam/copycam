// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { Room, MAX_PHONES, LIMITS } from './room.js';

// A stand-in for the Durable Object runtime: just enough of its hibernatable
// WebSocket API for the room's routing.
class FakeSocket {
  constructor() {
    this.sent = [];
    this.readyState = 1;
    this.attachment = null;
  }
  send(text) {
    if (this.readyState !== 1) throw new Error('closed');
    this.sent.push(text);
  }
  close(code, reason) {
    this.readyState = 3;
    this.closed = { code, reason };
  }
  serializeAttachment(a) {
    this.attachment = a;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

function fakeCtx() {
  const sockets = [];
  return {
    sockets,
    acceptWebSocket(ws, tags) {
      ws.tags = tags;
      sockets.push(ws);
    },
    getWebSockets(tag) {
      return sockets.filter((s) => s.tags.includes(tag) && s.readyState === 1);
    },
    setWebSocketAutoResponse() {},
  };
}

const news = (ws) => ws.sent.filter((m) => m.startsWith('*\n')).map((m) => JSON.parse(m.slice(2)));
const lastNews = (ws) => news(ws).at(-1);

describe('Room', () => {
  let ctx;
  let room;
  beforeEach(() => {
    ctx = fakeCtx();
    room = new Room(ctx);
  });

  it('tells each side who is there', () => {
    const phone = new FakeSocket();
    room.accept(phone, 'phone');
    expect(lastNews(phone)).toEqual({ pc: false });

    const pc = new FakeSocket();
    room.accept(pc, 'pc');
    expect(lastNews(phone)).toEqual({ pc: true });
    expect(lastNews(pc).phones).toHaveLength(1);

    room.webSocketClose(pc, 1006);
    expect(lastNews(phone)).toEqual({ pc: false });
  });

  it('passes a phone’s frames to the computer, marked with who sent them', () => {
    const pc = new FakeSocket();
    const phone = new FakeSocket();
    room.accept(pc, 'pc');
    room.accept(phone, 'phone');
    room.webSocketMessage(phone, '{"id":"1"}');
    const id = phone.attachment.id;
    expect(pc.sent.at(-1)).toBe(`${id}\n{"id":"1"}`);
  });

  it('passes the computer’s answer to that phone only', () => {
    const pc = new FakeSocket();
    const a = new FakeSocket();
    const b = new FakeSocket();
    room.accept(pc, 'pc');
    room.accept(a, 'phone');
    room.accept(b, 'phone');
    const before = b.sent.length;
    room.webSocketMessage(pc, `${a.attachment.id}\n{"id":"1","st":200}`);
    expect(a.sent.at(-1)).toBe('{"id":"1","st":200}');
    expect(b.sent).toHaveLength(before);
  });

  it('answers a phone at once when no computer is there', () => {
    const phone = new FakeSocket();
    room.accept(phone, 'phone');
    phone.sent.length = 0;
    room.webSocketMessage(phone, '{"id":"1"}');
    expect(news(phone)).toEqual([{ pc: false }]);
  });

  it('lets a computer opened again take over from the old one', () => {
    const first = new FakeSocket();
    const second = new FakeSocket();
    room.accept(first, 'pc');
    room.accept(second, 'pc');
    expect(first.closed.code).toBe(4001);
    expect(second.readyState).toBe(1);
  });

  it('retires the oldest phone to make room for another', () => {
    const phones = Array.from({ length: MAX_PHONES + 1 }, () => new FakeSocket());
    phones.forEach((p, i) => room.accept(p, 'phone', 1000 + i));
    expect(phones[0].closed.code).toBe(4002);
    expect(ctx.getWebSockets('phone')).toHaveLength(MAX_PHONES);
  });

  it('cuts off a connection that floods it or sends too much at once', () => {
    const pc = new FakeSocket();
    const phone = new FakeSocket();
    room.accept(pc, 'pc');
    room.accept(phone, 'phone');
    room.webSocketMessage(phone, 'x'.repeat(400 * 1024));
    expect(phone.closed.code).toBe(1009);

    const busy = new FakeSocket();
    room.accept(busy, 'phone');
    for (let i = 0; i <= LIMITS.framesPerMinute; i++) room.webSocketMessage(busy, '{}');
    expect(busy.closed.code).toBe(4008);
  });

  it('ignores binary frames and badly routed answers', () => {
    const pc = new FakeSocket();
    room.accept(pc, 'pc');
    room.webSocketMessage(pc, 'nobody-here\n{}');
    room.webSocketMessage(pc, 'no route');
    expect(pc.closed).toBeUndefined();
    room.webSocketMessage(pc, new ArrayBuffer(4));
    expect(pc.closed.code).toBe(1003);
  });
});
