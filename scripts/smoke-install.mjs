// Does `npx copycam` actually work for a stranger? This installs the packed
// tarball into an empty folder, with an empty home folder, the way a new user's
// machine starts, and checks what they would meet:
//   - the bundled model reads text with no download (and nothing is cached)
//   - the server starts, creates its key and certificate, and serves the phone page
//   - the pairing page is refused to anything but this machine
// It runs in CI on Windows, macOS and Linux, and by hand with `npm run smoke`.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-smoke-'));
const home = path.join(work, 'home');
const project = path.join(work, 'project');
fs.mkdirSync(home);
fs.mkdirSync(project);

const win = process.platform === 'win32';
// Under `npm run`, call npm's own script with node: no shell, and the same on every OS.
// Run directly, fall back to the npm launcher (a .cmd file on Windows needs a shell).
const npmCli = process.env.npm_execpath?.endsWith('.js') ? process.env.npm_execpath : null;
const npm = npmCli ? process.execPath : win ? 'npm.cmd' : 'npm';
const npmArgs = (args) => (npmCli ? [npmCli, ...args] : args);
const run = (cmd, args, cwd, extra = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: win && cmd.endsWith('.cmd'), stdio: ['ignore', 'pipe', 'inherit'], ...extra });

// a fresh machine: nothing under the home folder, nothing cached from before
const env = { ...process.env, HOME: home, USERPROFILE: home, PORT: '18787' };

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok ? '' : detail ? `  (${detail})` : ''}`);
};

const lanAddress = () => {
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) return i.address;
  return null;
};

const get = (url) =>
  new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.code || e.message) }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });

let server;
try {
  console.log('Packing and installing, as a new user would...');
  const packed = run(npm, npmArgs(['pack', '--pack-destination', work, '--silent']), root).trim().split('\n').pop();
  const tarball = path.join(work, packed);
  check('package packs', fs.existsSync(tarball), tarball);
  run(npm, npmArgs(['init', '-y']), project);
  run(npm, npmArgs(['install', tarball, '--no-audit', '--no-fund']), project, { stdio: ['ignore', 'ignore', 'inherit'] });
  const pkgDir = path.join(project, 'node_modules', 'copycam');
  check('installs with its dependencies', fs.existsSync(path.join(pkgDir, 'server', 'index.js')));
  // for information, not a pass/fail: what ONNX Runtime's installer put on this machine
  const binDir = path.join(pkgDir, '..', 'onnxruntime-node', 'bin', 'napi-v6', process.platform, process.arch);
  const sizeOf = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? sizeOf(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
  if (fs.existsSync(binDir)) {
    const cuda = fs.readdirSync(binDir).filter((f) => /cuda/i.test(f));
    console.log('  info   ONNX Runtime binaries on this machine: ' + (sizeOf(binDir) / 1e6).toFixed(0) + ' MB, GPU (CUDA) add-on ' + (cuda.length ? 'PRESENT (' + cuda.join(', ') + ')' : 'absent'));
  }
  check('ships the default model', fs.existsSync(path.join(pkgDir, 'models', 'PP-OCRv6_small_rec.ort')));

  console.log('Reading text offline with the bundled model...');
  fs.writeFileSync(
    path.join(project, 'scan.mjs'),
    [
      "import { createCanvas } from '@napi-rs/canvas';",
      "import { recognize } from 'copycam/server/ocr.js';",
      "const c = createCanvas(900, 260); const g = c.getContext('2d');",
      "g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 260); g.fillStyle = '#111'; g.font = '56px sans-serif';",
      "g.fillText('Network: HOMEBASE_5G', 40, 100); g.fillText('Password: K7mq-Rv2p-90', 40, 190);",
      "const r = await recognize(c.toBuffer('image/png'), 'auto');",
      'console.log(JSON.stringify(r.text));',
    ].join('\n'),
  );
  let text = '';
  try {
    text = JSON.parse(run('node', ['scan.mjs'], project, { env }).trim().split('\n').pop());
  } catch (e) {
    text = `crashed: ${e.message.split('\n')[0]}`;
  }
  check('reads the text on this operating system', /HOMEBASE/i.test(text) && /Password/i.test(text), JSON.stringify(text));
  check('downloaded and cached nothing', !fs.existsSync(path.join(home, '.cache')), 'a model was fetched');

  console.log('Starting it, as `npx copycam` does...');
  let log = '';
  server = spawn('node', [path.join(pkgDir, 'server', 'index.js')], { cwd: project, env });
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const ip = lanAddress();
  if (!ip) {
    check('has a network address to serve on', false, 'no LAN interface on this machine');
  } else {
    let page = { status: 0, body: '' };
    for (let i = 0; i < 40 && page.status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 750));
      page = await get(`https://${ip}:18787/`);
    }
    check('serves the phone page over HTTPS', page.status === 200 && /<title>CopyCam/.test(page.body), `status ${page.status}: ${page.body.slice(0, 80)}`);
    const asset = page.body.match(/\/assets\/mobile-[\w-]+\.js/)?.[0];
    const js = asset ? await get(`https://${ip}:18787${asset}`) : { status: 0 };
    check('serves the phone app bundle', js.status === 200, asset ?? 'no bundle referenced');
    const lan = await get(`http://${ip}:18788/desktop`);
    check('refuses the pairing page to the network', lan.status === 403, `status ${lan.status}`);
    const local = await get('http://127.0.0.1:18788/desktop');
    check('shows the pairing page on this machine', local.status === 200 && /CopyCam/.test(local.body), `status ${local.status}`);
    const keyFile = path.join(home, '.copycam', 'key.json');
    const certFile = path.join(home, '.copycam', 'tls.json');
    check('creates its key and certificate on first run', fs.existsSync(keyFile) && fs.existsSync(certFile));
    check('prints a pairing QR code in the terminal', /Scan the QR/i.test(log), log.slice(0, 120));
  }
} catch (e) {
  check('smoke test ran to the end', false, e.message.split('\n')[0]);
} finally {
  server?.kill();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed on ${process.platform}/${process.arch}`);
process.exit(failed ? 1 : 0);
