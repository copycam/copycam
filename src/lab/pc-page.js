import QRCode from 'qrcode';
import { newKey, randomBytes, toB64u } from '../../shared/crypto.js';
import { startComputer, labLink } from './lab.js';

// copycam.app/app/lab: the browser tab as the computer side of the lab.
const STORE = 'copycam:lab-pc';
const $ = (id) => document.getElementById(id);
const log = (line) => {
  $('log').textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
};

function pairing(fresh = false) {
  let p = null;
  try {
    p = fresh ? null : JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    p = null;
  }
  if (!p?.s || !p?.k) {
    p = { s: toB64u(randomBytes(32)), k: toB64u(newKey()) };
    try {
      localStorage.setItem(STORE, JSON.stringify(p));
    } catch {
      // this visit only
    }
  }
  return p;
}

let line = null;
async function start(fresh) {
  line?.close();
  const p = pairing(fresh);
  const link = await labLink(location.origin, p.s, p.k);
  $('link').textContent = link;
  $('qr').src = await QRCode.toDataURL(link, { margin: 1, width: 440 });
  const relayUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const { fromB64u } = await import('../../shared/crypto.js');
  line = startComputer({ secret: p.s, key: fromB64u(p.k), relayUrl, log });
}

$('new').addEventListener('click', () => start(true));
start(false);
