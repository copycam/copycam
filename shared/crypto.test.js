// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { seal, open, newKey, toB64u, fromB64u, MAX_AGE_MS } from './crypto.js';

describe('crypto envelopes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips an object', () => {
    const key = newKey();
    const box = seal(key, { text: 'SSID: HOMEBASE_5G' }, 'clip');
    const out = open(key, box, 'clip');
    expect(out.text).toBe('SSID: HOMEBASE_5G');
    expect(typeof out.t).toBe('number');
  });

  it('rejects a tampered ciphertext', () => {
    const key = newKey();
    const box = seal(key, { text: 'secret' }, 'clip');
    const bytes = fromB64u(box.c);
    bytes[0] ^= 0xff;
    expect(() => open(key, { ...box, c: toB64u(bytes) }, 'clip')).toThrow();
  });

  it('rejects the wrong key', () => {
    const box = seal(newKey(), { text: 'secret' }, 'clip');
    expect(() => open(newKey(), box, 'clip')).toThrow();
  });

  it('rejects a cross-endpoint replay (AAD mismatch)', () => {
    const key = newKey();
    const box = seal(key, { img: 'zzz' }, 'ocr');
    expect(() => open(key, box, 'clip')).toThrow();
  });

  it('rejects stale messages', () => {
    const key = newKey();
    const box = seal(key, { text: 'old' }, 'clip');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + MAX_AGE_MS + 1000);
    expect(() => open(key, box, 'clip')).toThrow(/stale/);
  });

  it('rejects malformed boxes', () => {
    const key = newKey();
    expect(() => open(key, null, 'clip')).toThrow();
    expect(() => open(key, { n: 'abc' }, 'clip')).toThrow();
    expect(() => open(key, { n: toB64u(new Uint8Array(4)), c: 'abcd' }, 'clip')).toThrow(/nonce/);
  });

  it('base64url survives binary round-trips including large buffers', () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    expect(fromB64u(toB64u(big))).toEqual(big);
  });
});
