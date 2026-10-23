import { Room } from './room.js';
import { roomFor, ADDRESS } from '../shared/relay.js';

// copycam.app: the static site (dist-site, served by the assets binding), the
// relay that lets a phone reach a CopyCam tab (worker/room.js), the stricter
// headers the two app pages need, and the social profiles' short links. Only
// those paths reach this code (wrangler.jsonc, run_worker_first); every other
// path is a plain static file.

export { Room };

// The pages that hold a pairing key get a policy of their own: nothing from
// any other origin, not even the analytics beacon the information pages carry,
// so no third-party script ever runs beside the key.
export function pageHeaders(pathname, origin) {
  const app = pathname === '/app' || pathname.startsWith('/app/');
  const phone = pathname === '/p' || pathname.startsWith('/p/');
  if (!app && !phone) return null;
  const socket = origin.replace(/^http/, 'ws'); // older Safari doesn't count wss: as 'self'
  const csp = [
    "default-src 'self'",
    // the text reader is WebAssembly, compiled in the computer's tab
    app ? "script-src 'self' 'wasm-unsafe-eval'" : "script-src 'self'",
    "worker-src 'self'",
    `connect-src 'self' ${socket}`,
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'Permissions-Policy': phone ? 'camera=(self), microphone=(), geolocation=()' : 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-cache',
    // no other page keeps a handle on these tabs
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

async function relay(request, env, url) {
  const m = /^\/relay\/(pc|phone)\/([^/]+)$/.exec(url.pathname);
  if (!m || !ADDRESS.test(m[2])) return new Response('not found', { status: 404 });
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected a WebSocket', { status: 426 });
  }
  // only CopyCam's own pages may open the relay
  if (request.headers.get('Origin') !== url.origin) return new Response('forbidden', { status: 403 });

  const role = m[1];
  const room = role === 'pc' ? await roomFor(m[2]) : m[2];
  const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
  const headers = new Headers(request.headers);
  headers.set('X-CopyCam-Role', role);
  return stub.fetch(new Request(request, { headers }));
}

// Short links for CopyCam's social profiles. They show the home page under
// their own path, so the analytics totals can tell where visits came from.
export const SOURCE_LINKS = ['/tiktok', '/ig', '/yt'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/relay/')) return relay(request, env, url);
    if (SOURCE_LINKS.includes(url.pathname.replace(/\/$/, ''))) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }

    const res = await env.ASSETS.fetch(request);
    const extra = pageHeaders(url.pathname, url.origin);
    // every response, 304s included: a revalidated page takes the headers of
    // the 304, and the site-wide ones would replace the page's own
    if (!extra) return res;
    const out = new Response(res.body, res);
    for (const [name, value] of Object.entries(extra)) out.headers.set(name, value);
    return out;
  },
};
