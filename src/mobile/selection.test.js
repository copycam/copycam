import { describe, it, expect } from 'vitest';
import { rangeSelect, selectionText } from './selection.js';

// Six detected lines: two standalone, then a 3-line wrapped paragraph.
const lines = [
  { t: 'Café de la Gare', x: 0, y: 0, w: 200, h: 30 },
  { t: 'Contraseña: Azul-72', x: 0, y: 90, w: 200, h: 30 },
  { t: 'This is a longer paragraph', x: 0, y: 200, w: 200, h: 30 },
  { t: 'that wraps across lines', x: 0, y: 236, w: 200, h: 30 },
  { t: 'into one sentence.', x: 0, y: 272, w: 200, h: 30 },
];
const paras = [[0], [1], [2, 3, 4]];

describe('rangeSelect', () => {
  it('selects a continuous run across the paragraph in reading order', () => {
    expect(rangeSelect(paras, 2, 4)).toEqual([2, 3, 4]);
  });

  it('works with a backwards drag', () => {
    expect(rangeSelect(paras, 4, 1)).toEqual([1, 2, 3, 4]);
  });

  it('single line range', () => {
    expect(rangeSelect(paras, 3, 3)).toEqual([3]);
  });

  it('returns empty for unknown indices', () => {
    expect(rangeSelect(paras, 99, 1)).toEqual([]);
  });
});

describe('selectionText', () => {
  it('lines mode: one output line per selected line, in reading order', () => {
    const sel = new Set([0, 2, 3, 4]);
    expect(selectionText(lines, paras, sel, 'lines')).toBe(
      'Café de la Gare\nThis is a longer paragraph\nthat wraps across lines\ninto one sentence.',
    );
  });

  it('flow mode: joins wrapped lines within a paragraph into flowing text', () => {
    const sel = new Set([2, 3, 4]);
    expect(selectionText(lines, paras, sel, 'flow')).toBe('This is a longer paragraph that wraps across lines into one sentence.');
  });

  it('flow mode: separates distinct paragraphs with a blank line', () => {
    const sel = new Set([0, 1, 2, 3, 4]);
    expect(selectionText(lines, paras, sel, 'flow')).toBe(
      'Café de la Gare\n\nContraseña: Azul-72\n\nThis is a longer paragraph that wraps across lines into one sentence.',
    );
  });

  it('keeps reading order regardless of set insertion order', () => {
    const sel = new Set([4, 0]);
    expect(selectionText(lines, paras, sel, 'lines')).toBe('Café de la Gare\ninto one sentence.');
  });
});
