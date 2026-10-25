#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import clipboard from 'clipboardy';
import { newKey, randomBytes, toB64u, fromB64u } from '../shared/crypto.js';
import { roomFor } from '../shared/relay.js';
import { connectHost } from '../shared/relay-host.js';
import { createDirectHost } from '../shared/direct.js';
import { createApp, createCompanionHost, buildAllowedHosts } from './app.js';
import { recognize, warmup } from './ocr.js';
import { decodeWifi } from './wifi.js';
import { loadTlsMaterial } from './tls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const KEY_FILE = path.join(os.homedir(), '.copycam', 'key.json');
const CERT_FILE = path.join(os.homedir(), '.copycam', 'tls.json');
// HTTPS on PORT for the browser build (iOS HTTPS-Only mode rejects plain http
// URLs). Plain HTTP on PORT+1 for the native app and the desktop page, on every
// interface — /desktop* itself is loopback-gated in createApp.
const PORT = Number(process.env.PORT) || 8787;
const DESKTOP_PORT = PORT + 1;

// copycam.app, whose relay links a phone to this computer from any network.
// CC_SITE points at another copy of it (a local `wrangler dev`, for testing).
const SITE = (process.env.CC_SITE || 'https://copycam.app').replace(/\/$/, '');
// how long to wait at start for copycam.app before showing the Wi-Fi link instead
const RELAY_WAIT_MS = 5000;
// werift falls back to Google's STUN server when it's given none. Pointed at a
// closed port on this computer instead, it contacts nobody and offers only
// local addresses, which is all the direct route uses (seconds).
const WERIFT_CONFIG = { iceServers: [{ urls: 'stun:127.0.0.1:9' }], iceStunGatherTimeout: 0.05 };

// The pairing: the session key every message is sealed with, and the secret
// that makes this computer the one in its copycam.app relay room. --reset
// makes a new key; the room stays, so phones holding the old key reach this
// computer, are refused, and are told to rescan.
function loadOrCreateKey({ reset }) {
  let stored = null;
  try {
    stored = fs.existsSync(KEY_FILE) ? JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')) : null;
  } catch {
    // corrupt key file — fall through and regenerate
  }
  let key = null;
  try {
    key = !reset && stored?.key ? fromB64u(stored.key) : null;
  } catch {
    key = null;
  }
  const isNew = key?.length !== 32;
  if (isNew) key = newKey();
  const secret = typeof stored?.secret === 'string' && stored.secret.length === 43 ? stored.secret : toB64u(randomBytes(32));
  if (isNew || secret !== stored?.secret) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify({ key: toB64u(key), secret }), { mode: 0o600 });
  }
  return { key, secret, isNew };
}

// Adapters a phone on the Wi-Fi can never reach. WSL and Hyper-V hand out
// 192.168.* addresses too, so preferring that range alone picked the WSL
// switch (it enumerates first) and put an unreachable address in the QR.
const VIRTUAL_ADAPTER = /vethernet|wsl|hyper-v|virtualbox|vmware|docker|vbox|loopback|tailscale|zerotier/i;

function lanIPs() {
  const real = [];
  const virtual = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      // 169.254.* is self-assigned (Wi-Fi Direct, a cable with no DHCP): never reachable
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      (VIRTUAL_ADAPTER.test(name) ? virtual : real).push(i.address);
    }
  }
  // prefer private ranges, most home LANs are 192.168.*; virtual adapters are
  // kept last as a fallback rather than dropped, so an unusual setup still starts
  const byRange = (a, b) => b.startsWith('192.168.') - a.startsWith('192.168.');
  const ips = [...real.sort(byRange), ...virtual.sort(byRange)];
  // escape hatch when the guess is still wrong
  return process.env.CC_IP ? [process.env.CC_IP, ...ips.filter((ip) => ip !== process.env.CC_IP)] : ips;
}

// via: 'relay' when the QR is the copycam.app link (any network), 'lan' when
// it's this computer's own address (same Wi-Fi, certificate warning)
function desktopHtml({ qrSvg, hostname, via }) {
  const relay = via === 'relay';
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CopyCam — ${hostname}</title>
<style>
  body{margin:0;background:#F1F0EC;font-family:-apple-system,'Helvetica Neue',system-ui,sans-serif;color:#161616;
       min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{display:flex;flex-direction:column;align-items:center;gap:20px;padding:48px;text-align:center}
  .logo{font-size:30px;font-weight:800;letter-spacing:-1px}
  .logo b{background:#CFFF3B;padding:2px 8px 4px;border-radius:10px;margin-left:2px;font-weight:800}
  .qr{background:#fff;border-radius:24px;padding:22px;box-shadow:0 2px 14px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.05)}
  .qr svg{width:240px;height:240px;display:block}
  .hint{font-size:14.5px;color:#55554f;max-width:320px;line-height:1.5}
  .status{font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#161616;background:#fff;
          border-radius:12px;padding:10px 16px;min-width:300px;box-shadow:0 0 0 1px rgba(0,0,0,.06)}
  .log{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#8a8a82;max-width:360px}
  .ways{display:flex;gap:14px;align-items:stretch;max-width:660px;text-align:left}
  .way{flex:1;background:#fff;border-radius:16px;padding:16px 18px;box-shadow:0 0 0 1px rgba(0,0,0,.06);
       display:flex;flex-direction:column;gap:7px}
  .way h2{margin:0;font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:7px}
  .way .tag{font-family:ui-monospace,Menlo,monospace;font-size:9.5px;font-weight:700;letter-spacing:.6px;
            background:#161616;color:#fff;border-radius:5px;padding:2px 6px}
  .way ol{margin:0;padding-left:17px;font-size:12.5px;line-height:1.65;color:#55554f}
  .way li::marker{color:#b0afa8}
  .way code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;background:#F1F0EC;
            border-radius:4px;padding:1px 5px}
  .way .note{font-size:11.5px;color:#8a8a82;line-height:1.5;margin-top:auto}
  @media (max-width:700px){ .ways{flex-direction:column} }
  .safe{display:flex;align-items:center;gap:6px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:#9a9a92}
  .safe svg{flex:none}
</style>
<div class="card">
  <div class="logo">Copy<b>Cam</b></div>
  <div class="qr">${qrSvg}</div>
  <div class="hint">${relay ? 'Any network: your phone doesn&rsquo;t need to be on this Wi&#8209;Fi.' : 'Same Wi&#8209;Fi. Open it in your phone&rsquo;s browser.'}</div>

  <div class="ways">
    <div class="way">
      <h2><span class="tag">BROWSER</span> nothing to install</h2>
      <ol>
        <li>Point your phone&rsquo;s camera at the code above.</li>
        <li>Tap the link it offers.</li>
      </ol>
      <div class="note">${relay ? 'It opens copycam.app on your phone, linked to this computer. On the same Wi&#8209;Fi they talk directly; anywhere else, through copycam.app. Either way, sealed end to end.' : 'First time only, your phone warns &ldquo;not private&rdquo; &mdash; that is CopyCam&rsquo;s own certificate. Tap Show&nbsp;Details (or Advanced) &rarr; Visit&nbsp;Website.'}</div>
    </div>
    <div class="way">
      <h2><span class="tag">APP</span> coming soon</h2>
      <div class="note">A native iPhone and Android app is on the way. It will switch the camera flash on, which a browser cannot.</div>
    </div>
  </div>

  <div class="status" id="status">Waiting for phone&hellip;</div>
  <div class="log" id="log"></div>
  <div class="safe">
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><rect x="0.75" y="5" width="8.5" height="6.25" rx="1.5" fill="none" stroke="#9a9a92" stroke-width="1.5"/><path d="M2.5 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke="#9a9a92" stroke-width="1.5"/></svg>
    everything is end-to-end encrypted${relay ? '' : ' &middot; use Wi&#8209;Fi you trust'}
  </div>
</div>
<script>
  const status = document.getElementById('status');
  const log = document.getElementById('log');
  const es = new EventSource('/desktop/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    const time = new Date().toLocaleTimeString();
    if (ev.type === 'paired') status.textContent = 'Phone linked \\u2713';
    if (ev.type === 'scanned') log.textContent = time + ' \\u2014 scanned photo, ' + ev.blocks + ' text blocks found' + (ev.wifi ? ' + a Wi-Fi code' : '');
    if (ev.type === 'copied') { status.textContent = 'Phone linked \\u2713'; log.textContent = time + ' \\u2014 \\u2713 copied ' + ev.chars + ' chars to clipboard'; }
  };
</script>`;
}

// Joins this computer's copycam.app relay room, and resolves to whether it
// got in within RELAY_WAIT_MS. It keeps trying in the background either way.
async function joinRelay({ secret, host, log }) {
  const WebSocketImpl = globalThis.WebSocket ?? (await import('ws')).default;
  let first;
  const firstStatus = new Promise((resolve) => (first = resolve));
  let phones = 0;
  connectHost({
    secret,
    handle: host,
    url: `${SITE.replace(/^http/, 'ws')}/relay/pc/${secret}`,
    WebSocketImpl,
    onStatus: (s) => {
      first(s.online);
      if (s.replaced) log('Another CopyCam on this computer took over the pairing; this one is no longer reachable through copycam.app.');
      if (s.phones !== phones && s.online) log(s.phones > phones ? '✓ Phone connected through copycam.app' : 'Phone left');
      phones = s.phones;
    },
  });
  return Promise.race([firstStatus, new Promise((resolve) => setTimeout(() => resolve(false), RELAY_WAIT_MS))]);
}

async function main() {
  const reset = process.argv.includes('--reset');
  // "Only connect on my own Wi-Fi": never contact copycam.app, as before 0.2.0
  const localOnly = process.argv.includes('--local-only') || process.env.CC_LOCAL_ONLY === '1';
  const { key, secret, isNew } = loadOrCreateKey({ reset });
  const hostname = os.hostname();
  const ips = lanIPs();

  if (!fs.existsSync(path.join(DIST, 'mobile.html'))) {
    console.error('dist/mobile.html not found — run `npm run build` first (or use `npm start`).');
    process.exit(1);
  }
  if (ips.length === 0) {
    console.error('No LAN network interface found — connect this PC to Wi-Fi/Ethernet first.');
    process.exit(1);
  }

  const ip = ips[0];
  // With a trusted certificate, set CC_DOMAIN to the cert's hostname (must
  // resolve to this PC on your LAN) so the QR URL matches the cert.
  const domain = process.env.CC_DOMAIN;
  const pairHost = domain || ip;
  // `h` tells the native app which port speaks plain HTTP. React Native can't
  // be told to accept our self-signed certificate (and Expo Go offers no way
  // to bypass TLS validation), so the app talks to the cleartext listener
  // instead. That costs nothing in confidentiality: every payload is already
  // sealed with AES-256-GCM, and unlike the browser build there is no served
  // page for a network attacker to tamper with. The browser build ignores `h`.
  const lanUrl = `https://${pairHost}:${PORT}/?h=${DESKTOP_PORT}#k=${toB64u(key)}`;
  const allowedHosts = buildAllowedHosts({ ips, domain, port: PORT, desktopPort: DESKTOP_PORT });

  // One handler for every route the phone may come by (see createCompanionHost).
  let directHost = null;
  let app = null;
  const deps = {
    clipboard: (text) => clipboard.write(text),
    ocr: recognize,
    wifi: decodeWifi,
    // the direct route's introduction; never offered with --local-only, where
    // phones come over the Wi-Fi to /api and nothing goes through copycam.app
    rtc: localOnly ? undefined : (offer) => directHost.answer(offer),
    onEvent: (ev) => {
      app?.get('broadcast')(ev);
        if (ev.type === 'paired') console.log('✓ Phone linked');
        if (ev.type === 'scanned') {
          // the network name and password themselves are never logged
          console.log(
            `  scanned photo — ${ev.blocks} text blocks${ev.wifi ? ' + a Wi-Fi code' : ''}, read in ${(ev.ms / 1000).toFixed(1)} s`,
          );
        }
      if (ev.type === 'copied') console.log(`✓ Copied ${ev.chars} chars to clipboard`);
    },
  };
  const host = createCompanionHost({ key, hostname, deps });
  app = createApp({ key, hostname, distDir: DIST, allowedHosts, deps, host });

  // Through copycam.app (any network), and direct on the Wi-Fi once the phone
  // has been introduced; the WebRTC library loads on the first introduction.
  let viaRelay = false;
  if (!localOnly) {
    let directCount = 0;
    directHost = createDirectHost({
      loadRTC: async () => (await import('werift')).RTCPeerConnection,
      rtcConfig: WERIFT_CONFIG,
      handle: host,
      onChange: ({ open }) => {
        if (open > directCount) console.log('✓ Phone connected directly on the Wi-Fi');
        directCount = open;
      },
    });
    viaRelay = await joinRelay({ secret, host, log: (line) => console.log(line) });
  }
  const pairUrl = viaRelay ? `${SITE}/p/#r=${await roomFor(secret)}&k=${toB64u(key)}` : lanUrl;

  const qrSvg = await QRCode.toString(pairUrl, { type: 'svg', margin: 1 });
  app.set('desktopHtml', desktopHtml({ qrSvg, hostname, via: viaRelay ? 'relay' : 'lan' }));

  const tls = await loadTlsMaterial(CERT_FILE, ips);
  const phoneServer = https.createServer({ key: tls.key, cert: tls.cert }, app);
  const desktopServer = http.createServer(app);

  // Bound to every interface so the native app can reach /api over cleartext.
  // The desktop page is not exposed by that: /desktop* is loopback-gated in
  // createApp (it renders the QR, which carries the pairing key), and /api is
  // useless without the key regardless of which listener it arrives on.
  phoneServer.listen(PORT, () => {
    desktopServer.listen(DESKTOP_PORT, '0.0.0.0', () => {
      console.log(`CopyCam companion on ${hostname}\n`);
      QRCode.toString(pairUrl, { type: 'terminal', small: true }, (err, qr) => {
        if (!err) console.log(qr);
        if (viaRelay) {
          console.log('Scan the QR with your phone (any network), or open it at:');
          console.log(`  http://localhost:${DESKTOP_PORT}/desktop\n`);
          console.log('On the same Wi-Fi the phone connects directly; anywhere else, through copycam.app.');
          console.log('Everything is sealed end to end either way. To keep it all on this network: --local-only');
        } else {
          if (!localOnly) console.log(`Couldn't reach ${SITE}, so this is the direct link for this Wi-Fi.\n`);
          console.log('Scan the QR with your phone (same Wi-Fi), or open it at:');
          console.log(`  http://localhost:${DESKTOP_PORT}/desktop\n`);
        }
        console.log(`Browser app: https://${pairHost}:${PORT}   CopyCam app: http://${ip}:${DESKTOP_PORT}`);
        if (ips.length > 1) console.log(`(multiple networks detected, using ${ip} — others: ${ips.slice(1).join(', ')})`);
        console.log(isNew ? 'New pairing key generated.' : 'Using existing pairing key (run with --reset to rotate).');
        console.log(`TLS certificate: ${tls.source}`);
        if (!viaRelay && tls.source === 'self-signed') {
          console.log('First connect: your phone shows a one-time certificate warning');
          console.log('("not private") — tap Show Details / Advanced, then Visit Website.');
        }
        console.log('Windows may ask to allow Node on private networks — allow it.');
      });
      // download traineddata in the background so the first scan is fast
      warmup().catch(() => {});
    });
  });
}

main();
