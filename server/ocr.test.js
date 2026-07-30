// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { linesToParas, splitWords, SCRIPTS, lineIsRtl } from './ocr.js';

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
