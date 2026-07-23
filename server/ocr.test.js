// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { linesToParas } from './ocr.js';

const line = (y, h = 30, t = 'x') => ({ t, x: 10, y, w: 100, h });

describe('linesToParas', () => {
  it('groups tightly-spaced wrapped lines into one paragraph', () => {
    // three lines ~30px tall with small inter-line gaps
    const lines = [line(0), line(36), line(72)];
    expect(linesToParas(lines)).toEqual([[0, 1, 2]]);
  });

  it('splits paragraphs separated by a large vertical gap', () => {
    // gap of a full line height between the two blocks
    const lines = [line(0), line(36), line(140), line(176)];
    expect(linesToParas(lines)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('treats every well-separated line as its own paragraph', () => {
    const lines = [line(0), line(90), line(180)];
    expect(linesToParas(lines)).toEqual([[0], [1], [2]]);
  });

  it('handles a single line and empty input', () => {
    expect(linesToParas([line(0)])).toEqual([[0]]);
    expect(linesToParas([])).toEqual([]);
  });
});
