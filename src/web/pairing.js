import { newKey, randomBytes, toB64u, fromB64u } from '../../shared/crypto.js';
import { roomFor } from '../../shared/relay.js';

// This computer's side of the pairing, kept in the browser so a phone linked
// once stays linked across visits:
//   s  the secret that makes this tab the computer in its relay room
//   k  the session key the phone seals everything with
// Neither ever leaves the browser except inside the QR code, and the QR puts
// the key in the URL fragment, which phones don't send anywhere.
const STORAGE = 'copycam:host';

function valid(p) {
  try {
    return typeof p?.s === 'string' && p.s.length === 43 && fromB64u(p.k).length === 32;
  } catch {
    return false;
  }
}

export function loadPairing(storage = localStorage) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE) || 'null');
    if (valid(stored)) return stored;
  } catch {
    // unreadable: start over
  }
  const fresh = { s: toB64u(randomBytes(32)), k: toB64u(newKey()) };
  try {
    storage.setItem(STORAGE, JSON.stringify(fresh));
  } catch {
    // private window: linked for this visit only
  }
  return fresh;
}

// A new key, the same room: phones holding the old key still reach this tab,
// which turns them away, so they're told to rescan rather than left wondering
// where the computer went.
export function newCode(pairing, storage = localStorage) {
  const next = { ...pairing, k: toB64u(newKey()) };
  try {
    storage.setItem(STORAGE, JSON.stringify(next));
  } catch {
    // as above
  }
  return next;
}

export async function phoneLink(pairing, origin = window.location.origin) {
  return `${origin}/p/#r=${await roomFor(pairing.s)}&k=${pairing.k}`;
}

// What the phone calls this computer: there's no hostname to read in a
// browser, so a friendly name from the platform.
export function computerName(nav = navigator) {
  const platform = `${nav.userAgentData?.platform || ''} ${nav.platform || ''} ${nav.userAgent || ''}`;
  if (/cros/i.test(platform)) return 'your Chromebook';
  if (/mac/i.test(platform)) return 'your Mac';
  if (/win/i.test(platform)) return 'your PC';
  return 'your computer';
}
