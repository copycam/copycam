// @vitest-environment node
// Both phone apps mark up recognised text the same way; the native app can't
// import the browser build's copy, so this keeps the two honest — a drift here
// would mean the same scan is proofread differently on the two clients.
import { describe, it, expect } from 'vitest';
import * as web from '../src/mobile/annotate.js';
import * as app from '../mobile/src/lib/annotate.ts';

const CASES = [
  'SSID: HOMEBASE_5G',
  'Pass: corgi-battery-42',
  'The quick brown fox jumps over',
  '192.168.0.1:8080',
  'john.doe@example.com',
  'a b c 1 2 3',
  'guest_wifi_2024 and plain words',
  'line one\nline two',
  'Tr0ub4dor&3',
  '',
];

describe('annotate: the two clients agree', () => {
  for (const text of CASES) {
    it(`marks ${JSON.stringify(text)} identically`, () => {
      expect(app.annotate(text)).toEqual(web.annotate(text));
    });
  }

  it('agrees on what counts as code-like', () => {
    for (const t of ['HOMEBASE_5G', 'Friday', '4421', 'Wi-Fi', 'a', '192.168.0.1', 'x7#Kq_9zL-mn', 'Pass:']) {
      expect(app.isCodeLike(t)).toBe(web.isCodeLike(t));
    }
  });
});

describe('annotate', () => {
  const plain = (text) => web.annotate(text).map((s) => s.t).join('');

  it('never changes the text itself', () => {
    for (const text of CASES) expect(plain(text)).toBe(text);
  });

  it('marks look-alike characters only inside codes', () => {
    const marks = (text) => web.annotate(text).filter((s) => s.mark === 'risky').map((s) => s.t);
    // the 0/O/l/5 in a password are worth a second look
    expect(marks('Pass: Tr0ub4dor&3').join('')).toContain('0');
    // the same letters in ordinary words are not
    expect(marks('Model No. 4421 Rev B')).toEqual([]);
    expect(marks('The quick brown fox')).toEqual([]);
  });

  it('marks spaces beside codes, where one wrongly added breaks a password', () => {
    const spaces = web.annotate('SSID: HOMEBASE_5G').filter((s) => s.mark === 'space');
    expect(spaces).toHaveLength(1);
    // a space between two ordinary words is left alone
    expect(web.annotate('brown fox').some((s) => s.mark === 'space')).toBe(false);
  });

  it('leaves line breaks unmarked', () => {
    expect(web.annotate('HOMEBASE_5G\nx7#Kq_9zL').some((s) => s.mark === 'space')).toBe(false);
  });

  it('flags words the recogniser was unsure of', () => {
    expect(web.anyDoubtful([{ c: 0.99 }, { c: 0.72 }])).toBe(true);
    expect(web.anyDoubtful([{ c: 0.99 }, {}])).toBe(false);
  });
});
