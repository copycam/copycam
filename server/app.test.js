// @vitest-environment node
import os from 'node:os';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp, isLoopback, buildAllowedHosts, createNonceLedger } from './app.js';
import { seal, open, newKey, toB64u, MAX_AGE_MS } from '../shared/crypto.js';

function lanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

const key = newKey();
let base;
let server;
let allowedHost;
const clipboard = vi.fn(async () => {});
const wifi = vi.fn(async () => null);
const ocr = vi.fn(async () => ({
  words: [
    { t: 'SSID:', x: 1, y: 2, w: 40, h: 20, li: 0, pi: 0 },
    { t: 'HOMEBASE_5G', x: 45, y: 2, w: 90, h: 20, li: 0, pi: 0 },
    { t: 'Pass:', x: 1, y: 26, w: 40, h: 20, li: 1, pi: 0 },
    { t: 'corgi-battery-42', x: 45, y: 26, w: 100, h: 20, li: 1, pi: 0 },
  ],
  lineCount: 2,
  text: 'SSID: HOMEBASE_5G\nPass: corgi-battery-42',
  rotation: 90,
}));

function post(path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = createApp({
    key,
    hostname: 'TEST-PC',
    distDir: null,
    // populated after listen, since the port is ephemeral
    allowedHosts: { has: (h) => h === allowedHost },
    deps: { clipboard, ocr, wifi },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  allowedHost = `127.0.0.1:${port}`;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => server?.close());

describe('companion server API', () => {
  it('completes the hello handshake with the PC name', async () => {
    const res = await post('/api/hello', seal(key, {}, 'hello'));
    expect(res.status).toBe(200);
    const ack = open(key, await res.json(), 'hello-ack');
    expect(ack.name).toBe('TEST-PC');
  });

  it('forwards the phone’s script choice to the OCR engine', async () => {
    const img = toB64u(new TextEncoder().encode('bytes'));
    await post('/api/ocr', seal(key, { img, script: 'Cyrillic' }, 'ocr'));
    // normalised to lower case; the engine validates the value itself
    expect(ocr).toHaveBeenCalledWith(expect.anything(), 'cyrillic');
  });

  it('omits the script when the phone does not send one', async () => {
    const img = toB64u(new TextEncoder().encode('bytes'));
    await post('/api/ocr', seal(key, { img }, 'ocr'));
    expect(ocr).toHaveBeenCalledWith(expect.anything(), undefined);
  });

  it('runs OCR and returns sealed word geometry', async () => {
    const img = toB64u(new TextEncoder().encode('fake-jpeg-bytes'));
    const res = await post('/api/ocr', seal(key, { img }, 'ocr'));
    expect(res.status).toBe(200);
    const ack = open(key, await res.json(), 'ocr-ack');
    expect(ack.words).toHaveLength(4);
    expect(ack.words[0]).toMatchObject({ t: 'SSID:', li: 0, pi: 0 });
    expect(ack.words[3]).toMatchObject({ t: 'corgi-battery-42', li: 1 });
    // the turn the server used to read it, so the client can match its photo
    expect(ack.rotation).toBe(90);
  });

  it('returns a Wi-Fi code found in the photo alongside the text', async () => {
    wifi.mockResolvedValueOnce({ ssid: 'HOMEBASE_5G', password: 'corgi-battery-42', security: 'WPA', hidden: false });
    const res = await post('/api/ocr', seal(key, { img: 'AAAA' }, 'ocr'));
    const ack = open(key, await res.json(), 'ocr-ack');
    expect(ack.wifi).toEqual({ ssid: 'HOMEBASE_5G', password: 'corgi-battery-42', security: 'WPA', hidden: false });
    expect(ack.words.length).toBeGreaterThan(0); // the text still comes back too
  });

  it('omits the field when there is no Wi-Fi code', async () => {
    const res = await post('/api/ocr', seal(key, { img: 'AAAA' }, 'ocr'));
    expect(open(key, await res.json(), 'ocr-ack')).not.toHaveProperty('wifi');
  });

  it('still returns the text when the QR decoder fails', async () => {
    wifi.mockRejectedValueOnce(new Error('decoder exploded'));
    const res = await post('/api/ocr', seal(key, { img: 'AAAA' }, 'ocr'));
    expect(res.status).toBe(200);
    expect(open(key, await res.json(), 'ocr-ack').words.length).toBeGreaterThan(0);
  });

  it('writes the clipboard for a valid clip message', async () => {
    const res = await post('/api/clip', seal(key, { text: 'hello clipboard' }, 'clip'));
    expect(res.status).toBe(200);
    expect(clipboard).toHaveBeenCalledWith('hello clipboard');
    const ack = open(key, await res.json(), 'clip-ack');
    expect(ack.ok).toBe(true);
  });

  it('rejects payloads sealed with the wrong key', async () => {
    const res = await post('/api/clip', seal(newKey(), { text: 'evil' }, 'clip'));
    expect(res.status).toBe(400);
  });

  it('rejects a replayed nonce', async () => {
    const box = seal(key, { text: 'replay me' }, 'clip');
    expect((await post('/api/clip', box)).status).toBe(200);
    expect((await post('/api/clip', box)).status).toBe(400);
  });

  it('rejects cross-endpoint replays (ocr payload sent to clip)', async () => {
    const box = seal(key, { text: 'sneaky' }, 'ocr');
    expect((await post('/api/clip', box)).status).toBe(400);
  });

  it('rejects stale messages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() - MAX_AGE_MS - 60_000);
    const oldBox = seal(key, { text: 'from the past' }, 'clip');
    vi.useRealTimers();
    expect((await post('/api/clip', oldBox)).status).toBe(400);
  });

  it('rejects requests with an unexpected Host header (DNS rebinding)', async () => {
    // fetch/undici refuses to override Host, so drop to raw http for this one
    const { request } = await import('node:http');
    const body = JSON.stringify(seal(key, { text: 'x' }, 'clip'));
    const status = await new Promise((resolve, reject) => {
      const req = request(
        `${base}/api/clip`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Host: 'evil.example:8787' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(status).toBe(403);
  });

  it('rejects empty clip text', async () => {
    const res = await post('/api/clip', seal(key, { text: '' }, 'clip'));
    expect(res.status).toBe(400);
  });

  it('serves /desktop only to loopback (predicate)', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.50')).toBe(false);
    expect(isLoopback('10.0.0.3')).toBe(false);
  });

  it('serves /desktop over the loopback connection used by tests', async () => {
    const res = await fetch(`${base}/desktop`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('desktop page not configured');
  });
});

// The cleartext listener is bound to every interface so the native app can
// reach it, which means these guards are load-bearing, not theoretical.
describe('cleartext listener exposed on the LAN', () => {
  const ip = lanIP();
  let lanServer;
  let lanBase;

  beforeAll(async () => {
    if (!ip) return;
    const app = createApp({
      key,
      hostname: 'TEST-PC',
      distDir: null,
      allowedHosts: { has: () => true }, // isolate the loopback check
      deps: { clipboard, ocr },
    });
    lanServer = app.listen(0, '0.0.0.0');
    await new Promise((r) => lanServer.on('listening', r));
    lanBase = `http://${ip}:${lanServer.address().port}`;
  });

  afterAll(() => lanServer?.close());

  it.skipIf(!ip)('refuses the desktop page (which renders the pairing key) from a LAN address', async () => {
    const res = await fetch(`${lanBase}/desktop`);
    expect(res.status).toBe(403);
  });

  it.skipIf(!ip)('refuses the desktop event stream from a LAN address', async () => {
    const res = await fetch(`${lanBase}/desktop/events`);
    expect(res.status).toBe(403);
  });

  it.skipIf(!ip)('still serves the sealed API to the LAN (that is the point)', async () => {
    const res = await fetch(`${lanBase}/api/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(seal(key, {}, 'hello')),
    });
    expect(res.status).toBe(200);
    expect(open(key, await res.json(), 'hello-ack').name).toBe('TEST-PC');
  });

  it.skipIf(!ip)('rejects an unsealed API request from the LAN', async () => {
    const res = await fetch(`${lanBase}/api/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'plaintext, no key' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('allowed hosts', () => {
  const ports = { port: 8787, desktopPort: 8788 };

  it('accepts every LAN address on both listeners', () => {
    const hosts = buildAllowedHosts({ ips: ['192.168.0.181', '192.168.128.1'], ...ports });
    for (const h of ['192.168.0.181:8787', '192.168.0.181:8788', '192.168.128.1:8788']) {
      expect(hosts.has(h)).toBe(true);
    }
  });

  it('accepts the CC_DOMAIN host on the cleartext port the native app uses', () => {
    // the QR carries https://<domain>:8787/?h=8788 and the app derives
    // http://<domain>:8788 from it — that used to be refused with 403
    const hosts = buildAllowedHosts({ ips: ['192.168.0.181'], domain: 'CopyCam.Example.com', ...ports });
    expect(hosts.has('copycam.example.com:8787')).toBe(true);
    expect(hosts.has('copycam.example.com:8788')).toBe(true);
  });

  it('keeps loopback to the desktop port, and nothing else', () => {
    const hosts = buildAllowedHosts({ ips: [], ...ports });
    expect(hosts.has('localhost:8788')).toBe(true);
    expect(hosts.has('127.0.0.1:8788')).toBe(true);
    expect(hosts.has('localhost:8787')).toBe(false);
    expect(hosts.has('evil.example:8788')).toBe(false);
  });
});

describe('nonce ledger', () => {
  it('refuses a nonce offered twice', () => {
    const ledger = createNonceLedger(1000);
    expect(ledger.claim('a', 0)).toBe(true);
    expect(ledger.claim('a', 10)).toBe(false);
  });

  it('still refuses a replay after thousands of other messages', () => {
    // the old Set was cleared at 5000 entries, which made every recent nonce
    // replayable again for as long as its message stayed fresh
    const ledger = createNonceLedger(MAX_AGE_MS * 2);
    expect(ledger.claim('captured', 0)).toBe(true);
    for (let i = 0; i < 6000; i++) ledger.claim(`n${i}`, i);
    expect(ledger.claim('captured', 6000)).toBe(false);
  });

  it('forgets nonces once their messages could no longer pass the freshness check', () => {
    const ledger = createNonceLedger(1000);
    ledger.claim('old', 0);
    ledger.claim('newer', 900);
    expect(ledger.claim('probe', 1500)).toBe(true); // prunes 'old', keeps 'newer'
    expect(ledger.size).toBe(2);
    expect(ledger.claim('newer', 1500)).toBe(false);
  });
});
