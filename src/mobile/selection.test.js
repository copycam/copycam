import { describe, it, expect } from 'vitest';
import { rangeSelect, selectionText } from './selection.js';

// words: "The quick / brown fox / jumps" laid out in three rows
const words = [
  { t: 'The', x: 0, y: 0, w: 30, h: 10 },
  { t: 'quick', x: 40, y: 0, w: 40, h: 10 },
  { t: 'brown', x: 0, y: 20, w: 40, h: 10 },
  { t: 'fox', x: 50, y: 20, w: 30, h: 10 },
  { t: 'jumps', x: 0, y: 40, w: 40, h: 10 },
];
const rows = [
  [0, 1],
  [2, 3],
  [4],
];

describe('rangeSelect', () => {
  it('selects a continuous run across rows in reading order', () => {
    expect(rangeSelect(rows, 1, 4)).toEqual([1, 2, 3, 4]);
  });

  it('works with anchor after target (backwards drag)', () => {
    expect(rangeSelect(rows, 3, 0)).toEqual([0, 1, 2, 3]);
  });

  it('single word range', () => {
    expect(rangeSelect(rows, 2, 2)).toEqual([2]);
  });

  it('returns empty for unknown indices', () => {
    expect(rangeSelect(rows, 99, 1)).toEqual([]);
  });
});

describe('selectionText', () => {
  it('joins rows with newlines in lines mode', () => {
    const sel = new Set([0, 1, 2, 3, 4]);
    expect(selectionText(words, rows, sel, 'lines')).toBe('The quick\nbrown fox\njumps');
  });

  it('joins everything with spaces in flow mode (continuous paragraph)', () => {
    const sel = new Set([0, 1, 2, 3, 4]);
    expect(selectionText(words, rows, sel, 'flow')).toBe('The quick brown fox jumps');
  });

  it('skips unselected words and empty rows', () => {
    const sel = new Set([1, 4]);
    expect(selectionText(words, rows, sel, 'lines')).toBe('quick\njumps');
  });

  it('keeps reading order regardless of set insertion order', () => {
    const sel = new Set([4, 0]);
    expect(selectionText(words, rows, sel, 'flow')).toBe('The jumps');
  });
});
