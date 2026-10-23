import { describe, it, expect } from 'vitest';
import { loadPairing, newCode, phoneLink, computerName } from './pairing.js';
import { roomFor } from '../../shared/relay.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

describe('the computer’s pairing', () => {
  it('is made once and found again on the next visit', () => {
    const storage = memoryStorage();
    const first = loadPairing(storage);
    expect(first.s).toHaveLength(43);
    expect(loadPairing(storage)).toEqual(first);
  });

  it('starts over when what was stored is unusable', () => {
    const storage = memoryStorage();
    storage.setItem('copycam:host', '{"s":"short","k":"x"}');
    expect(loadPairing(storage).s).toHaveLength(43);
  });

  it('keeps its room but changes its key for a new code', () => {
    const storage = memoryStorage();
    const before = loadPairing(storage);
    const after = newCode(before, storage);
    expect(after.s).toBe(before.s);
    expect(after.k).not.toBe(before.k);
    expect(loadPairing(storage)).toEqual(after);
  });

  it('puts the room and the key in the link’s fragment only', async () => {
    const pairing = loadPairing(memoryStorage());
    const link = await phoneLink(pairing, 'https://copycam.app');
    const url = new URL(link);
    expect(url.pathname).toBe('/p/');
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#r=${await roomFor(pairing.s)}&k=${pairing.k}`);
    expect(link).not.toContain(pairing.s);
  });

  it('names the computer the way a person would', () => {
    expect(computerName({ platform: 'Win32', userAgent: '' })).toBe('your PC');
    expect(computerName({ platform: 'MacIntel', userAgent: '' })).toBe('your Mac');
    expect(computerName({ userAgentData: { platform: 'Chrome OS' }, userAgent: 'X11; CrOS x86_64' })).toBe('your Chromebook');
    expect(computerName({ platform: 'Linux x86_64', userAgent: '' })).toBe('your computer');
  });
});
