#!/usr/bin/env node
// WebRTC lab, computer side, as the companion would run it: in Node, with the
// werift WebRTC library (MIT). Throwaway: nothing here is part of CopyCam.
//
//   node scripts/lab-webrtc-pc.mjs              (uses copycam.app)
//   CC_SITE=http://127.0.0.1:8790 node scripts/lab-webrtc-pc.mjs
//
// It prints a lab pairing code; scan it with the phone, then press "Run the
// test" on the phone. The lab pairing is kept in ~/.copycam/lab.json, so the
// same code works across runs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { RTCPeerConnection } from 'werift';
import { newKey, randomBytes, toB64u, fromB64u } from '../shared/crypto.js';
import { startComputer, labLink } from '../src/lab/lab.js';

const site = (process.env.CC_SITE || 'https://copycam.app').replace(/\/$/, '');
const relayUrl = site.replace(/^http/, 'ws');
const file = path.join(os.homedir(), '.copycam', 'lab.json');

let p = null;
try {
  p = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  p = null;
}
if (!p?.s || !p?.k || process.argv.includes('--new')) {
  p = { s: toB64u(randomBytes(32)), k: toB64u(newKey()) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p), { mode: 0o600 });
}

const link = await labLink(site, p.s, p.k);
console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
console.log(`Lab code for the phone (scan it, or open this on the phone):\n${link}\n`);

const log = (line) => console.log(`${new Date().toLocaleTimeString()}  ${line}`);
startComputer({
  secret: p.s,
  key: fromB64u(p.k),
  relayUrl,
  // the relay admits only copycam.app's own pages for now; the real build
  // admits the companion properly
  wsOptions: { headers: { Origin: site } },
  RTCPeerConnectionImpl: RTCPeerConnection,
  // werift falls back to Google's STUN server when given none; point it at a
  // closed local port instead, so it contacts nobody and offers only local
  // addresses
  rtcConfig: { iceServers: [{ urls: 'stun:127.0.0.1:9' }], iceStunGatherTimeout: 1 },
  log,
});
