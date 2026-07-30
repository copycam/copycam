// @vitest-environment node
// The phone app carries its own TypeScript port of the crypto layer (the
// browser build's version leans on atob/TextEncoder, which are not dependable
// on Hermes). Two implementations of a wire format is exactly the kind of thing
// that silently drifts, and a drift would only show up as "pairing mysteriously
// stopped working" on a device I cannot debug from here — so seal with each and
// open with the other, in both directions, on every test run.
import { describe, it, expect } from 'vitest';
import * as web from './crypto.js';
import * as app from '../mobile/src/lib/crypto.ts';

const KEY = new Uint8Array(32).map((_, i) => (i * 7 + 11) % 256);

describe('web <-> app crypto compatibility', () => {
  it('the app opens what the browser build sealed', () => {
    const box = web.seal(KEY, { text: 'SSID: HOMEBASE_5G' }, 'clip');
    expect(app.open(KEY, box, 'clip').text).toBe('SSID: HOMEBASE_5G');
  });

  it('the browser build opens what the app sealed', () => {
    const box = app.seal(KEY, { text: 'corgi-battery-42' }, 'clip');
    expect(web.open(KEY, box, 'clip').text).toBe('corgi-battery-42');
  });

  it('round-trips non-Latin and RTL text intact', () => {
    const text = 'Пароль: Ключ-Река-88 / مرحبا بكم / 日本語';
    expect(app.open(KEY, web.seal(KEY, { text }, 'clip'), 'clip').text).toBe(text);
    expect(web.open(KEY, app.seal(KEY, { text }, 'clip'), 'clip').text).toBe(text);
  });

  it('agrees on base64url encoding for every byte value', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect(app.toB64u(all)).toBe(web.toB64u(all));
    expect(app.fromB64u(web.toB64u(all))).toEqual(all);
    expect(web.fromB64u(app.toB64u(all))).toEqual(all);
  });

  it('agrees on base64url for every length remainder (padding cases)', () => {
    for (let len = 0; len < 12; len++) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 5) % 256);
      expect(app.toB64u(bytes)).toBe(web.toB64u(bytes));
      expect(app.fromB64u(app.toB64u(bytes))).toEqual(bytes);
    }
  });

  it('rejects a cross-endpoint replay the same way (AAD is honoured)', () => {
    const box = app.seal(KEY, { img: 'zzz' }, 'ocr');
    expect(() => web.open(KEY, box, 'clip')).toThrow();
    expect(() => app.open(KEY, box, 'clip')).toThrow();
  });

  it('rejects a tampered ciphertext the same way', () => {
    const box = app.seal(KEY, { text: 'secret' }, 'clip');
    const bytes = app.fromB64u(box.c);
    bytes[0] ^= 0xff;
    const tampered = { ...box, c: app.toB64u(bytes) };
    expect(() => web.open(KEY, tampered, 'clip')).toThrow();
    expect(() => app.open(KEY, tampered, 'clip')).toThrow();
  });

  it('refuses to invent randomness when no secure source exists', () => {
    const realCrypto = globalThis.crypto;
    // simulate Hermes without WebCrypto and without setRandomSource()
    delete globalThis.crypto;
    try {
      expect(() => app.randomBytes(12)).toThrow(/secure random/);
    } finally {
      globalThis.crypto = realCrypto;
    }
  });
});
