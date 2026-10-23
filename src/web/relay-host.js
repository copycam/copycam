import { toFrames, createAssembler, splitRouted, PING } from '../../shared/relay.js';

// The tab's line to the relay: it sits in its room as the computer, takes
// requests from linked phones, answers them with `handle` (shared/host.js),
// and reconnects by itself when the line drops.
//
// connectHost({ secret, handle, onStatus }) -> { close() }
//   onStatus({ online, phones, replaced })
//     online    the relay has this tab in its room
//     phones    how many phones are connected now
//     replaced  CopyCam was opened in another tab, which took over; this one
//               stops until told to start again
const KEEPALIVE_MS = 25_000;
const BACKOFF_MS = [500, 1000, 2000, 5000, 10000];

export function connectHost({ secret, handle, onStatus, url = defaultUrl(secret), WebSocketImpl = WebSocket }) {
  let ws = null;
  let attempt = 0;
  let timer = null;
  let keepalive = null;
  let stopped = false;
  const assemblers = new Map(); // phone id -> assembler

  const status = { online: false, phones: 0, replaced: false };
  const report = (patch) => {
    Object.assign(status, patch);
    onStatus({ ...status });
  };

  function open() {
    ws = new WebSocketImpl(url);
    ws.addEventListener('open', () => {
      attempt = 0;
      report({ online: true, replaced: false });
      keepalive = setInterval(() => ws.readyState === 1 && ws.send(PING), KEEPALIVE_MS);
    });
    ws.addEventListener('message', (e) => onMessage(e.data));
    ws.addEventListener('close', (e) => {
      clearInterval(keepalive);
      assemblers.clear();
      if (e.code === 4001) {
        stopped = true;
        report({ online: false, phones: 0, replaced: true });
        return;
      }
      report({ online: false, phones: 0 });
      if (stopped) return;
      timer = setTimeout(open, BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]);
    });
  }

  function onMessage(data) {
    if (typeof data !== 'string' || data === 'pong') return;
    const routed = splitRouted(data);
    if (!routed) return;
    if (routed.from === '*') {
      try {
        const news = JSON.parse(routed.frame);
        if (Array.isArray(news.phones)) {
          for (const id of assemblers.keys()) if (!news.phones.includes(id)) assemblers.delete(id);
          report({ phones: news.phones.length });
        }
      } catch {
        // not news we understand
      }
      return;
    }
    let assembler = assemblers.get(routed.from);
    if (!assembler) {
      assembler = createAssembler();
      assemblers.set(routed.from, assembler);
    }
    let done;
    try {
      done = assembler.push(routed.frame);
    } catch {
      return; // a malformed frame: drop it, as the relay would
    }
    if (done) answer(routed.from, done);
  }

  async function answer(phone, { head, body }) {
    let result;
    try {
      result = await handle(head.ep, JSON.parse(body));
    } catch {
      result = { status: 400, body: { error: 'bad request' } };
    }
    if (ws?.readyState !== 1) return;
    for (const frame of toFrames({ id: head.id, st: result.status }, result.body)) ws.send(`${phone}\n${frame}`);
  }

  open();

  return {
    close() {
      stopped = true;
      clearTimeout(timer);
      ws?.close(1000, 'closed');
    },
  };
}

function defaultUrl(secret) {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/relay/pc/${secret}`;
}
