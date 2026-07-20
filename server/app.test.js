// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp, isLoopback } from './app.js';
import { seal, open, newKey, toB64u, MAX_AGE_MS } from '../shared/crypto.js';

const key = newKey();
let base;
let server;
let allowedHost;
const clipboard = vi.fn(async () => {});
const ocr = vi.fn(async () => ({
  blocks: ['SSID: HOMEBASE_5G', 'Pass: corgi-battery-42'],
  words: [{ t: 'SSID:', x: 1, y: 2, w: 30, h: 10 }],
  rows: [[0]],
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
    deps: { clipboard, ocr },
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

  it('runs OCR and returns sealed blocks with word geometry', async () => {
    const img = toB64u(new TextEncoder().encode('fake-jpeg-bytes'));
    const res = await post('/api/ocr', seal(key, { img }, 'ocr'));
    expect(res.status).toBe(200);
    const ack = open(key, await res.json(), 'ocr-ack');
    expect(ack.blocks).toEqual(['SSID: HOMEBASE_5G', 'Pass: corgi-battery-42']);
    expect(ack.words).toEqual([{ t: 'SSID:', x: 1, y: 2, w: 30, h: 10 }]);
    expect(ack.rows).toEqual([[0]]);
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
