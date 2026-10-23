// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import worker, { pageHeaders } from './index.js';
import { roomFor } from '../shared/relay.js';

const ORIGIN = 'https://copycam.app';
const SECRET = 'a'.repeat(43);

function env() {
  const fetched = [];
  return {
    fetched,
    ASSETS: { fetch: vi.fn(async () => new Response('<html>', { status: 200, headers: { 'Content-Security-Policy': 'site-wide' } })) },
    ROOMS: {
      idFromName: (name) => ({ name }),
      get: (id) => ({
        fetch: async (req) => {
          fetched.push({ room: id.name, role: req.headers.get('X-CopyCam-Role') });
          return new Response('upgraded');
        },
      }),
    },
  };
}

const socketRequest = (path, headers = {}) =>
  new Request(`${ORIGIN}${path}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN, ...headers } });

describe('pageHeaders', () => {
  it('gives the two app pages their own policy, and nothing else', () => {
    expect(pageHeaders('/', ORIGIN)).toBeNull();
    expect(pageHeaders('/privacy/', ORIGIN)).toBeNull();
    expect(pageHeaders('/apple', ORIGIN)).toBeNull();
    expect(pageHeaders('/app/', ORIGIN)['Content-Security-Policy']).toContain("'wasm-unsafe-eval'");
    expect(pageHeaders('/p/', ORIGIN)['Content-Security-Policy']).not.toContain('wasm');
  });

  it('lets only the phone page use the camera, and no page load other sites', () => {
    expect(pageHeaders('/p/', ORIGIN)['Permissions-Policy']).toContain('camera=(self)');
    expect(pageHeaders('/app/', ORIGIN)['Permissions-Policy']).toContain('camera=()');
    for (const path of ['/app/', '/p/']) {
      const csp = pageHeaders(path, ORIGIN)['Content-Security-Policy'];
      expect(csp).not.toContain('cloudflareinsights');
      expect(csp).toContain('connect-src \'self\' wss://copycam.app');
      expect(csp).toContain("frame-ancestors 'none'");
    }
  });
});

describe('worker', () => {
  it('replaces the site-wide headers on the app pages', async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/app/`), env());
    expect(res.headers.get('Content-Security-Policy')).toContain("'wasm-unsafe-eval'");
  });

  it('sends the computer to the room its secret names, and a phone to the room it asks for', async () => {
    const e = env();
    await worker.fetch(socketRequest(`/relay/pc/${SECRET}`), e);
    const room = await roomFor(SECRET);
    await worker.fetch(socketRequest(`/relay/phone/${room}`), e);
    expect(e.fetched).toEqual([
      { room, role: 'pc' },
      { room, role: 'phone' },
    ]);
  });

  it('shows the home page at the social profiles’ short links', async () => {
    const e = env();
    await worker.fetch(new Request(`${ORIGIN}/tiktok`), e);
    expect(new URL(e.ASSETS.fetch.mock.calls[0][0].url).pathname).toBe('/');
  });

  it('turns away other sites, plain requests and odd addresses', async () => {
    const e = env();
    expect((await worker.fetch(socketRequest(`/relay/pc/${SECRET}`, { Origin: 'https://evil.example' }), e)).status).toBe(403);
    expect((await worker.fetch(new Request(`${ORIGIN}/relay/pc/${SECRET}`), e)).status).toBe(426);
    expect((await worker.fetch(socketRequest('/relay/pc/short'), e)).status).toBe(404);
    expect((await worker.fetch(socketRequest(`/relay/admin/${SECRET}`), e)).status).toBe(404);
    expect(e.fetched).toEqual([]);
  });
});
