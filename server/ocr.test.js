// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  linesToParas,
  splitWords,
  SCRIPTS,
  lineIsRtl,
  orientationScore,
  isConfident,
  tidyLine,
  resolveScript,
} from './ocr.js';

// A line of writing is wide and short; a quarter-turned page yields tall,
// narrow boxes and reads badly. That is what lets the server work out which way
// up a page was — the phone cannot, when it is held flat over a desk.
const oline = (t, w, h) => ({ t, x: 0, y: 0, w, h });
const REAL_TEXT = [oline('Meeting room Wi-Fi', 300, 40), oline('Network: OFFICE-GUEST', 340, 40)];
const TURNED_TEXT = [oline('6u!199W', 40, 300), oline('>tJoM4aN', 40, 340)];

describe('orientationScore', () => {
  it('prefers a real reading over a quarter-turned one', () => {
    expect(orientationScore(REAL_TEXT, 0.98)).toBeGreaterThan(orientationScore(TURNED_TEXT, 0.9));
  });

  it('scores nothing for an empty reading', () => {
    expect(orientationScore([], 1)).toBe(0);
  });

  it('lets confidence break a tie between equally shaped readings', () => {
    expect(orientationScore(REAL_TEXT, 0.98)).toBeGreaterThan(orientationScore(REAL_TEXT, 0.4));
  });

  it('rewards more text recognised', () => {
    const more = [...REAL_TEXT, oline('Password: Tr0ub4dor', 320, 40)];
    expect(orientationScore(more, 0.95)).toBeGreaterThan(orientationScore(REAL_TEXT, 0.95));
  });
});

describe('isConfident (the upright fast path)', () => {
  it('accepts a clean upright reading, so the common case costs one pass', () => {
    expect(isConfident(REAL_TEXT, 0.97)).toBe(true);
  });

  it('rejects a quarter-turned reading', () => {
    expect(isConfident(TURNED_TEXT, 0.97)).toBe(false);
  });

  it('rejects wide-but-unsure text, which is how an upside-down page presents', () => {
    // precisely the case that made the search stop early and settle on 180
    expect(isConfident(REAL_TEXT, 0.5)).toBe(false);
  });

  it('rejects an empty reading', () => {
    expect(isConfident([], 1)).toBe(false);
  });
});

// Real Arabic text, written here in correct logical (Unicode) order --
// exactly what a user should end up with after the RTL fix.
const ARABIC_HELLO = 'مرحبا بكم'; // "مرحبا بكم"
const ARABIC_WORD1 = 'مرحبا'; // "مرحبا"
const ARABIC_WORD2 = 'بكم'; // "بكم"

describe('script selection', () => {
  it('exposes the scripts the phone can pick, including the unified default', () => {
    expect(SCRIPTS).toContain('auto');
    // every model also reads Latin, so these enable mixed-language scans
    for (const s of ['cyrillic', 'greek', 'arabic', 'japanese', 'korean']) {
      expect(SCRIPTS).toContain(s);
    }
  });
});

const line = (y, h = 30, t = 'x') => ({ t, x: 10, y, w: 100, h });

describe('tidyLine', () => {
  it('removes the space the recogniser puts beside an underscore', () => {
    expect(tidyLine('guest_ wifi_2024')).toBe('guest_wifi_2024');
    expect(tidyLine('SSID: HOMEBASE _5G')).toBe('SSID: HOMEBASE_5G');
    expect(tidyLine('my_secret_key_ 77')).toBe('my_secret_key_77');
  });

  it('closes up an email address split around its @', () => {
    expect(tidyLine('john.doe @ example.com')).toBe('john.doe@example.com');
    expect(tidyLine('john.doe@ example.com')).toBe('john.doe@example.com');
  });

  it('leaves ordinary prose and its spaces alone', () => {
    // the rules must never glue real words together — including single letters,
    // the case most at risk
    expect(tidyLine('The quick brown fox jumps over')).toBe('The quick brown fox jumps over');
    expect(tidyLine('a b c 1 2 3')).toBe('a b c 1 2 3');
    expect(tidyLine('Model No. 4421 Rev B')).toBe('Model No. 4421 Rev B');
    expect(tidyLine('Meet me @ 5 today')).toBe('Meet me @ 5 today');
  });

  it('trims and collapses whitespace', () => {
    expect(tidyLine('  spaced   out  ')).toBe('spaced out');
  });
});

describe('resolveScript', () => {
  it('keeps a known script', () => {
    expect(resolveScript('cyrillic')).toBe('cyrillic');
    expect(resolveScript('fast')).toBe('fast');
  });

  it('maps the retired "small" id onto the default, which is now that model', () => {
    // phones may still have it stored from when it was a separate choice;
    // resolving it avoids loading the same model twice under two names
    expect(resolveScript('small')).toBe('auto');
  });

  it('falls back to the default for anything unknown', () => {
    expect(resolveScript('klingon')).toBe('auto');
    expect(resolveScript(undefined)).toBe('auto');
  });
});

describe('linesToParas', () => {
  it('groups tightly-spaced wrapped lines into one paragraph', () => {
    const lines = [line(0), line(36), line(72)];
    expect(linesToParas(lines)).toEqual([[0, 1, 2]]);
  });

  it('splits paragraphs separated by a large vertical gap', () => {
    const lines = [line(0), line(36), line(140), line(176)];
    expect(linesToParas(lines)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('handles a single line and empty input', () => {
    expect(linesToParas([line(0)])).toEqual([[0]]);
    expect(linesToParas([])).toEqual([]);
  });
});

describe('splitWords', () => {
  it('keeps a single-token line as one word tagged with li/pi', () => {
    const lines = [{ t: 'HELLO', x: 10, y: 0, w: 100, h: 20 }];
    expect(splitWords(lines, [[0]])).toEqual([{ t: 'HELLO', x: 10, y: 0, w: 100, h: 20, li: 0, pi: 0 }]);
  });

  it('splits a multi-word line into words with estimated boxes in order', () => {
    const lines = [{ t: 'ab cd', x: 0, y: 0, w: 100, h: 20 }];
    const words = splitWords(lines, [[0]]);
    expect(words.map((w) => w.t)).toEqual(['ab', 'cd']);
    // first word starts at the line's left, second is further right
    expect(words[0].x).toBe(0);
    expect(words[1].x).toBeGreaterThan(words[0].x + words[0].w);
    expect(words.every((w) => w.li === 0 && w.pi === 0)).toBe(true);
  });

  it('assigns paragraph indices from the paras grouping', () => {
    const lines = [
      { t: 'one', x: 0, y: 0, w: 30, h: 20 },
      { t: 'two', x: 0, y: 100, w: 30, h: 20 },
    ];
    const words = splitWords(lines, [[0], [1]]);
    expect(words.map((w) => w.pi)).toEqual([0, 1]);
    expect(words.map((w) => w.li)).toEqual([0, 1]);
  });
});

describe('word confidence', () => {
  const withConf = (c) => [{ t: 'hard to read', x: 0, y: 0, w: 120, h: 20, c }];

  it('carries the line’s confidence onto every word it produced', () => {
    const words = splitWords(withConf(0.8123), [[0]]);
    expect(words).toHaveLength(3);
    for (const w of words) expect(w.c).toBe(0.81); // rounded: the wire stays small
  });

  it('omits it entirely when the recogniser gave none', () => {
    const [word] = splitWords([{ t: 'x', x: 0, y: 0, w: 10, h: 10 }], [[0]]);
    expect(word).not.toHaveProperty('c');
  });
});

describe('lineIsRtl', () => {
  it('detects pure Arabic as RTL', () => {
    expect(lineIsRtl(ARABIC_HELLO)).toBe(true);
  });

  it('detects pure Latin as LTR', () => {
    expect(lineIsRtl('Hello world')).toBe(false);
  });

  it('uses the first strong character when scripts are mixed', () => {
    expect(lineIsRtl(ARABIC_WORD1 + ' 52')).toBe(true); // Arabic first
    expect(lineIsRtl('Model ' + ARABIC_WORD1)).toBe(false); // Latin first
  });

  it('treats digits-only text as LTR (no strong character present)', () => {
    expect(lineIsRtl('12345')).toBe(false);
  });
});

describe('splitWords with RTL text', () => {
  // PaddleOCR emits a text line in left-to-right SCAN order, which for Arabic
  // is the reverse of correct reading order at both the word and character
  // level -- this raw fixture is what the recognizer actually returns for the
  // logical text "ARABIC_HELLO" ("مرحبا بكم"), and is what splitWords must
  // correct.
  const rawLine = { t: 'مكب ابحرم', x: 100, y: 10, w: 200, h: 30 };

  it('reorders array index to reading order and fixes character order within each word', () => {
    const words = splitWords([rawLine], [[0]]);
    expect(words.map((w) => w.t)).toEqual([ARABIC_WORD1, ARABIC_WORD2]);
    // joining in array order now reads correctly, left to right in the string
    expect(words.map((w) => w.t).join(' ')).toBe(ARABIC_HELLO);
  });

  it('keeps geometry visually accurate: reading-order word 0 sits rightmost on screen', () => {
    const words = splitWords([rawLine], [[0]]);
    // the first word to be read is visually the rightmost (larger x)
    expect(words[0].x).toBeGreaterThan(words[1].x);
    expect(words.every((w) => w.li === 0 && w.pi === 0)).toBe(true);
  });

  it('leaves a pure-LTR line completely unaffected (no regression)', () => {
    const words = splitWords([{ t: 'ab cd', x: 0, y: 0, w: 100, h: 20 }], [[0]]);
    expect(words.map((w) => w.t)).toEqual(['ab', 'cd']);
    expect(words[0].x).toBeLessThan(words[1].x); // still left to right
  });

  it('does not reverse an embedded digit token, only the Arabic tokens', () => {
    // raw scan order for a line whose logical text is "الرقم 52" (a mixed
    // Arabic + number line): Arabic word comes out char-reversed, but "52"
    // is a genuine LTR run and should survive as "52", not "25".
    const mixedRaw = { t: '52 مقرلا', x: 0, y: 0, w: 150, h: 20 };
    const words = splitWords([mixedRaw], [[0]]);
    const texts = words.map((w) => w.t);
    expect(texts).toContain('52'); // untouched
    expect(texts).not.toContain('25'); // would indicate a wrong blind reversal
  });

  it('a single-token RTL line still gets its characters corrected', () => {
    const words = splitWords([{ t: ARABIC_WORD1.split('').reverse().join(''), x: 0, y: 0, w: 60, h: 20 }], [[0]]);
    expect(words).toEqual([{ t: ARABIC_WORD1, x: 0, y: 0, w: 60, h: 20, li: 0, pi: 0 }]);
  });
});
