import { PING, PONG, PART_CHARS, splitRouted } from '../shared/relay.js';

// One computer and the phones linked to it, meeting in the middle. The room
// passes messages along and keeps nothing: no storage, no logs, and what it
// passes is sealed end to end (see shared/relay.js for the wire format).
//
// Uses the hibernation API: between messages the room is evicted from memory
// while Cloudflare holds its sockets open, so an idle tab costs nothing.

export const MAX_PHONES = 4;
// generous for a person scanning, tight for anything flooding: a photo is a
// dozen frames, and a minute of steady scanning is a few dozen photos
export const LIMITS = { framesPerMinute: 600, charsPerMinute: 48 * 1024 * 1024 };
const MAX_FRAME = PART_CHARS + 1024; // a part, its head, and a routing prefix

const news = (o) => `*\n${JSON.stringify(o)}`;

function send(ws, text) {
  try {
    ws.send(text);
  } catch {
    // already gone; its close handler tidies up
  }
}

function close(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}

export class Room {
  constructor(ctx) {
    this.ctx = ctx;
    // the clients' keep-alive pings are answered without waking the room
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    }
    this.usage = new Map(); // socket -> { since, frames, chars }; lost on eviction, which is fine
  }

  async fetch(request) {
    const role = request.headers.get('X-CopyCam-Role');
    if (role !== 'pc' && role !== 'phone') return new Response('bad role', { status: 400 });
    const pair = new WebSocketPair();
    this.accept(pair[1], role);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Seat a new connection. A computer replaces the one before it (the same
  // page opened again, or in a second tab); a fifth phone retires the oldest.
  accept(ws, role, now = Date.now()) {
    if (role === 'pc') {
      for (const old of this.ctx.getWebSockets('pc')) close(old, 4001, 'opened elsewhere');
    } else {
      const phones = this.ctx.getWebSockets('phone');
      if (phones.length >= MAX_PHONES) {
        const oldest = phones.reduce((a, b) => (a.deserializeAttachment().since <= b.deserializeAttachment().since ? a : b));
        close(oldest, 4002, 'too many phones');
      }
    }
    this.ctx.acceptWebSocket(ws, [role]);
    ws.serializeAttachment({ role, id: role === 'pc' ? 'pc' : crypto.randomUUID().slice(0, 8), since: now });
    this.announce();
  }

  live(tag, gone) {
    return this.ctx.getWebSockets(tag).filter((w) => w !== gone && w.readyState !== 2 && w.readyState !== 3);
  }

  // Tell everyone who's here: the phones whether their computer is, the
  // computer which phones are.
  announce(gone = null) {
    const pcs = this.live('pc', gone);
    const phones = this.live('phone', gone);
    for (const p of phones) send(p, news({ pc: pcs.length > 0 }));
    for (const c of pcs) send(c, news({ phones: phones.map((p) => p.deserializeAttachment().id) }));
  }

  allow(ws, chars, now = Date.now()) {
    let u = this.usage.get(ws);
    if (!u || now - u.since >= 60_000) {
      u = { since: now, frames: 0, chars: 0 };
      this.usage.set(ws, u);
    }
    u.frames++;
    u.chars += chars;
    return u.frames <= LIMITS.framesPerMinute && u.chars <= LIMITS.charsPerMinute;
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string') return close(ws, 1003, 'text only');
    if (message.length > MAX_FRAME) return close(ws, 1009, 'too large');
    if (!this.allow(ws, message.length)) return close(ws, 4008, 'too fast');

    const me = ws.deserializeAttachment();
    if (me.role === 'phone') {
      const pc = this.live('pc')[0];
      // no computer: say so at once, rather than let the phone wait it out
      if (!pc) return send(ws, news({ pc: false }));
      return send(pc, `${me.id}\n${message}`);
    }
    const routed = splitRouted(message);
    if (!routed) return;
    const phone = this.live('phone').find((p) => p.deserializeAttachment().id === routed.from);
    if (phone) send(phone, routed.frame);
  }

  webSocketClose(ws, code) {
    this.usage.delete(ws);
    // 1005/1006 mean "no code given"; neither may be sent back
    close(ws, code === 1005 || code === 1006 ? 1000 : code, 'bye');
    this.announce(ws);
  }

  webSocketError(ws) {
    this.usage.delete(ws);
    this.announce(ws);
  }
}
