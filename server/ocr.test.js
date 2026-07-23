// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { linesToParas, splitWords } from './ocr.js';

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
