import { describe, it, expect } from 'vitest';
import { rangeIndices, selectionText } from './selection.js';

// words across two paragraphs:
//   p0: "Café de" (line 0), "la Gare" (line 1)   <- wrapped
//   p1: "Pass Azul" (line 2)
const words = [
  { t: 'Café', x: 0, y: 0, w: 40, h: 20, li: 0, pi: 0 },
  { t: 'de', x: 50, y: 0, w: 20, h: 20, li: 0, pi: 0 },
  { t: 'la', x: 0, y: 30, w: 20, h: 20, li: 1, pi: 0 },
  { t: 'Gare', x: 30, y: 30, w: 40, h: 20, li: 1, pi: 0 },
  { t: 'Pass', x: 0, y: 120, w: 40, h: 20, li: 2, pi: 1 },
  { t: 'Azul', x: 50, y: 120, w: 40, h: 20, li: 2, pi: 1 },
];

describe('rangeIndices', () => {
  it('expands an anchor/focus pair into an inclusive reading-order run', () => {
    expect(rangeIndices(1, 4)).toEqual([1, 2, 3, 4]);
  });

  it('handles a backwards drag', () => {
    expect(rangeIndices(4, 1)).toEqual([1, 2, 3, 4]);
  });

  it('single word', () => {
    expect(rangeIndices(2, 2)).toEqual([2]);
  });

  it('null selection is empty', () => {
    expect(rangeIndices(null, null)).toEqual([]);
  });
});

describe('selectionText', () => {
  it('flows wrapped lines within a paragraph and separates paragraphs', () => {
    const all = [0, 1, 2, 3, 4, 5];
    expect(selectionText(words, all)).toBe('Café de la Gare\n\nPass Azul');
  });

  it('selects specific words within a line', () => {
    // just "de la Gare" — a mid-word start spanning the wrap
    expect(selectionText(words, [1, 2, 3])).toBe('de la Gare');
  });

  it('a single word', () => {
    expect(selectionText(words, [5])).toBe('Azul');
  });

  it('orders output by reading order regardless of index order', () => {
    expect(selectionText(words, [5, 0])).toBe('Café\n\nAzul');
  });

  it('empty selection is empty string', () => {
    expect(selectionText(words, [])).toBe('');
  });
});
