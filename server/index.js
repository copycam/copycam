import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import clipboard from 'clipboardy';
import { newKey, toB64u, fromB64u } from '../shared/crypto.js';
import { createApp } from './app.js';
import { recognize, warmup } from './ocr.js';
import { loadTlsMaterial } from './tls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const KEY_FILE = path.join(os.homedir(), '.copycam', 'key.json');
const CERT_FILE = path.join(os.homedir(), '.copycam', 'tls.json');
// HTTPS for phones (iOS HTTPS-Only mode rejects plain http URLs);
// plain HTTP for the desktop page, bound to loopback only.
const PORT = Number(process.env.PORT) || 8787;
const DESKTOP_PORT = PORT + 1;

function loadOrCreateKey({ reset }) {
  if (!reset && fs.existsSync(KEY_FILE)) {
    try {
      const stored = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
      const key = fromB64u(stored.key);
      if (key.length === 32) return { key, isNew: false };
    } catch {
      // corrupt key file — fall through and regenerate
    }
  }
  const key = newKey();
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify({ key: toB64u(key) }), { mode: 0o600 });
  return { key, isNew: true };
}

function lanIPs() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  // prefer private ranges, most home LANs are 192.168.*
  return out.sort((a, b) => b.startsWith('192.168.') - a.startsWith('192.168.'));
}

function desktopHtml({ qrSvg, hostname }) {
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
  <div class="hint">Same Wi&#8209;Fi, no account. Use it in your phone&rsquo;s browser, or in the CopyCam app.</div>

  <div class="ways">
    <div class="way">
      <h2><span class="tag">BROWSER</span> nothing to install</h2>
      <ol>
        <li>Point your phone&rsquo;s camera at the code above.</li>
        <li>Tap the link it offers.</li>
      </ol>
      <div class="note">First time only, your phone warns &ldquo;not private&rdquo; &mdash; that is CopyCam&rsquo;s own certificate. Tap Show&nbsp;Details (or Advanced) &rarr; Visit&nbsp;Website.</div>
    </div>
    <div class="way">
      <h2><span class="tag">APP</span> flash, and faster</h2>
      <ol>
        <li>Install <b>Expo Go</b> from the App Store or Play Store.</li>
        <li>On this PC run <code>npm run app</code>, then scan <i>that</i> QR to load CopyCam.</li>
        <li>In the app, scan the code above to pair.</li>
      </ol>
      <div class="note">The app can switch the camera flash on, which the browser cannot, and remembers the pairing in the phone&rsquo;s secure storage.</div>
    </div>
  </div>

  <div class="status" id="status">Waiting for phone&hellip;</div>
  <div class="log" id="log"></div>
  <div class="safe">
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><rect x="0.75" y="5" width="8.5" height="6.25" rx="1.5" fill="none" stroke="#9a9a92" stroke-width="1.5"/><path d="M2.5 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke="#9a9a92" stroke-width="1.5"/></svg>
    everything is end-to-end encrypted &middot; use Wi&#8209;Fi you trust
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
    if (ev.type === 'scanned') log.textContent = time + ' \\u2014 scanned photo, ' + ev.blocks + ' text blocks found';
    if (ev.type === 'copied') { status.textContent = 'Phone linked \\u2713'; log.textContent = time + ' \\u2014 \\u2713 copied ' + ev.chars + ' chars to clipboard'; }
  };
</script>`;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const { key, isNew } = loadOrCreateKey({ reset });
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
  const pairUrl = `https://${pairHost}:${PORT}/?h=${DESKTOP_PORT}#k=${toB64u(key)}`;
  const allowedHosts = new Set([
    `localhost:${DESKTOP_PORT}`,
    `127.0.0.1:${DESKTOP_PORT}`,
    ...(domain ? [`${domain.toLowerCase()}:${PORT}`] : []),
    ...ips.flatMap((i) => [`${i}:${PORT}`, `${i}:${DESKTOP_PORT}`]),
  ]);

  const app = createApp({
    key,
    hostname,
    distDir: DIST,
    allowedHosts,
    deps: {
      clipboard: (text) => clipboard.write(text),
      ocr: recognize,
      onEvent: (ev) => {
        app.get('broadcast')(ev);
        if (ev.type === 'paired') console.log('✓ Phone linked');
        if (ev.type === 'scanned') console.log(`  scanned photo — ${ev.blocks} text blocks`);
        if (ev.type === 'copied') console.log(`✓ Copied ${ev.chars} chars to clipboard`);
      },
    },
  });

  const qrSvg = await QRCode.toString(pairUrl, { type: 'svg', margin: 1 });
  app.set('desktopHtml', desktopHtml({ qrSvg, hostname }));

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
        console.log(`Scan the QR with your phone (same Wi-Fi), or open it at:`);
        console.log(`  http://localhost:${DESKTOP_PORT}/desktop\n`);
        console.log(`Browser app: https://${pairHost}:${PORT}   CopyCam app: http://${ip}:${DESKTOP_PORT}`);
        if (ips.length > 1) console.log(`(multiple networks detected, using ${ip} — others: ${ips.slice(1).join(', ')})`);
        console.log(isNew ? 'New pairing key generated.' : 'Using existing pairing key (run with --reset to rotate).');
        console.log(`TLS certificate: ${tls.source}`);
        if (tls.source === 'self-signed') {
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
