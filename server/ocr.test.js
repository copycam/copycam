// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { textToBlocks } from './ocr.js';
import { wordsToLines } from './winocr.js';

describe('textToBlocks', () => {
  it('splits lines, trims, and drops empties', () => {
    expect(textToBlocks('  a  \n\n b \r\n\nc')).toEqual(['a', 'b', 'c']);
  });

  it('caps at 48 blocks', () => {
    const text = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    expect(textToBlocks(text)).toHaveLength(48);
  });
});

describe('wordsToLines', () => {
  it('merges words split across a wide gap into one visual row', () => {
    // "SSID:" and "HOMEBASE_5G" on the same row, far apart — OcrEngine
    // reports them as separate lines; we should rejoin them.
    const words = [
      { t: 'SSID:', x: 10, y: 100, w: 60, h: 20 },
      { t: 'HOMEBASE_5G', x: 400, y: 101, w: 150, h: 20 },
      { t: 'Pass:', x: 10, y: 150, w: 60, h: 20 },
      { t: 'corgi-battery-42', x: 400, y: 149, w: 180, h: 20 },
    ];
    expect(wordsToLines(words)).toEqual(['SSID: HOMEBASE_5G', 'Pass: corgi-battery-42']);
  });

  it('orders words left-to-right within a row regardless of input order', () => {
    const words = [
      { t: 'world', x: 100, y: 10, w: 50, h: 15 },
      { t: 'hello', x: 10, y: 12, w: 50, h: 15 },
    ];
    expect(wordsToLines(words)).toEqual(['hello world']);
  });

  it('keeps distinct rows separate and in top-to-bottom order', () => {
    const words = [
      { t: 'bottom', x: 10, y: 200, w: 60, h: 18 },
      { t: 'top', x: 10, y: 20, w: 40, h: 18 },
    ];
    expect(wordsToLines(words)).toEqual(['top', 'bottom']);
  });

  it('handles empty input', () => {
    expect(wordsToLines([])).toEqual([]);
  });
});
