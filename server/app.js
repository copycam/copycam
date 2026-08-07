import path from 'node:path';
import express from 'express';
import { open, seal, fromB64u } from '../shared/crypto.js';

// App factory with injectable deps so tests can swap clipboard/OCR.
//
// Security model:
// - Possession of the 32-byte session key (delivered only via the QR code's
//   URL fragment) is the sole credential. Every /api payload must decrypt
//   and authenticate under AES-256-GCM with a per-endpoint AAD.
// - Replay: nonces are single-use per process; envelope timestamps bound
//   cross-restart replays.
// - /desktop (shows the QR, i.e. the key) is loopback-only.
// - Host header allow-list blunts DNS-rebinding tricks from random websites.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(remoteAddress) {
  return LOOPBACK.has(remoteAddress);
}

export function createApp({ key, hostname, distDir, allowedHosts, deps }) {
  const { clipboard, ocr, onEvent = () => {} } = deps;
  const seenNonces = new Set();
  const hits = new Map(); // per-IP rolling request timestamps for /api

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Host allow-list: requests must target an address we actually serve on.
  app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase();
    if (!allowedHosts.has(host)) return res.status(403).json({ error: 'forbidden' });
    next();
  });

  const loopbackOnly = (req, res, next) => {
    if (!isLoopback(req.socket.remoteAddress)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };

  // Minimal in-memory rate limit for the API: 60 requests/min per IP.
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    const ip = req.socket.remoteAddress || '?';
    const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
    list.push(now);
    hits.set(ip, list);
    if (list.length > 60) return res.status(429).json({ error: 'slow down' });
    next();
  });

  app.use('/api', express.json({ limit: '20mb' }));

  // Decrypt + authenticate a request body; enforce single-use nonces.
  const unseal = (req, aad) => {
    const msg = open(key, req.body, aad);
    if (seenNonces.has(req.body.n)) throw new Error('replayed nonce');
    seenNonces.add(req.body.n);
    if (seenNonces.size > 5000) seenNonces.clear();
    return msg;
  };

  app.post('/api/hello', (req, res) => {
    try {
      unseal(req, 'hello');
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    onEvent({ type: 'paired' });
    res.json(seal(key, { name: hostname }, 'hello-ack'));
  });

  app.post('/api/ocr', async (req, res) => {
    let msg;
    try {
      msg = unseal(req, 'ocr');
      if (typeof msg.img !== 'string') throw new Error('no image');
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    try {
      // script is a hint from the phone's language picker; ocr() validates it
      const script = typeof msg.script === 'string' ? msg.script.toLowerCase().slice(0, 20) : undefined;
      const result = await ocr(Buffer.from(fromB64u(msg.img)), script);
      onEvent({ type: 'scanned', blocks: result.lineCount });
      // `rotation` is how far the server had to turn the image to read it; the
      // client turns its copy to match so the highlights stay aligned.
      res.json(seal(key, { words: result.words, rotation: result.rotation ?? 0 }, 'ocr-ack'));
    } catch {
      res.status(500).json({ error: 'ocr failed' });
    }
  });

  app.post('/api/clip', async (req, res) => {
    let msg;
    try {
      msg = unseal(req, 'clip');
      if (typeof msg.text !== 'string' || !msg.text) throw new Error('no text');
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    try {
      await clipboard(msg.text);
      onEvent({ type: 'copied', chars: msg.text.length });
      res.json(seal(key, { ok: true }, 'clip-ack'));
    } catch {
      res.status(500).json({ error: 'clipboard failed' });
    }
  });

  // Desktop status page + live events. Never exposed beyond loopback because
  // the page embeds the pairing QR (which contains the key).
  app.get('/desktop', loopbackOnly, (req, res) => {
    res.type('html').send(app.get('desktopHtml') || 'desktop page not configured');
  });

  app.get('/desktop/events', loopbackOnly, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  const sseClients = new Set();
  app.set('broadcast', (event) => {
    for (const res of sseClients) res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  if (distDir) {
    // Phones hitting `/` get the mobile app; the landing page is not served here.
    app.get('/', (req, res) => res.sendFile(path.join(distDir, 'mobile.html')));
    app.use(express.static(distDir, { index: false }));
  }

  return app;
}
