import path from 'node:path';
import express from 'express';
import { createHost, createNonceLedger } from '../shared/host.js';

export { createNonceLedger };

// App factory with injectable deps so tests can swap clipboard/OCR.
//
// Security model:
// - The /api endpoints are shared/host.js over HTTP: the session key from the
//   QR code's URL fragment is the sole credential, and nonces are single-use.
// - /desktop (shows the QR, i.e. the key) is loopback-only.
// - Host header allow-list blunts DNS-rebinding tricks from random websites.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(remoteAddress) {
  return LOOPBACK.has(remoteAddress);
}

// Every Host a legitimate request can carry. Both clients derive their address
// from the pairing QR: the browser opens https://<host>:PORT, and the native
// app talks to http://<same host>:DESKTOP_PORT. So whatever host the QR carries
// — a LAN IP, or CC_DOMAIN when a trusted certificate is in use — has to be
// accepted on both ports. Missing the domain on the cleartext port meant the
// native app got 403 on every request once a trusted certificate was set up.
export function buildAllowedHosts({ ips, domain, port, desktopPort }) {
  const hosts = [`localhost:${desktopPort}`, `127.0.0.1:${desktopPort}`];
  for (const host of [...(domain ? [domain.toLowerCase()] : []), ...ips]) {
    hosts.push(`${host}:${port}`, `${host}:${desktopPort}`);
  }
  return new Set(hosts);
}

export function createApp({ key, hostname, distDir, allowedHosts, deps }) {
  const { ocr, wifi } = deps;
  const host = createHost({
    key,
    name: hostname,
    deps: {
      ...deps,
      // the readers here take Node Buffers
      ocr: (bytes, script) => ocr(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), script),
      wifi: wifi && ((bytes) => wifi(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))),
    },
  });
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
    // forget addresses that have gone quiet, so the table can't only ever grow
    if (hits.size > 256) {
      for (const [addr, times] of hits) {
        if (!times.some((t) => now - t < 60_000)) hits.delete(addr);
      }
    }
    if (list.length > 60) return res.status(429).json({ error: 'slow down' });
    next();
  });

  app.use('/api', express.json({ limit: '20mb' }));

  app.post('/api/:endpoint', async (req, res) => {
    const { status, body } = await host(req.params.endpoint, req.body);
    res.status(status).json(body);
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
