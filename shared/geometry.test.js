// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { locateWords, toGray } from './geometry.js';

// Draws one line of text and returns the grey image, each word's true ink box,
// and a detection box padded the way ppu-paddle-ocr pads its boxes.
function render(text, { font = 'Arial', size = 48, tilt = 0, ink = '#161616', paper = '#f6f5f1', width = 1400 } = {}) {
  const height = size * 5;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  const x0 = size;
  const base = height / 2 + size * 0.3;
  const rad = (tilt * Math.PI) / 180;
  const turn = ([x, y]) => [
    width / 2 + (x - width / 2) * Math.cos(rad) - (y - height / 2) * Math.sin(rad),
    height / 2 + (x - width / 2) * Math.sin(rad) + (y - height / 2) * Math.cos(rad),
  ];
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rad);
  ctx.translate(-width / 2, -height / 2);
  ctx.fillStyle = ink;
  ctx.font = `${size}px "${font}"`;
  ctx.fillText(text, x0, base);
  ctx.restore();
  ctx.font = `${size}px "${font}"`; // restore() put the font back too

  const words = [...text.matchAll(/\S+/g)].map((m) => {
    const pre = ctx.measureText(text.slice(0, m.index)).width;
    const mm = ctx.measureText(m[0]);
    const corners = [
      [x0 + pre - mm.actualBoundingBoxLeft, base - mm.actualBoundingBoxAscent],
      [x0 + pre + mm.actualBoundingBoxRight, base - mm.actualBoundingBoxAscent],
      [x0 + pre + mm.actualBoundingBoxRight, base + mm.actualBoundingBoxDescent],
      [x0 + pre - mm.actualBoundingBoxLeft, base + mm.actualBoundingBoxDescent],
    ].map(turn);
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    return { t: m[0], left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  });
  const left = Math.min(...words.map((w) => w.left));
  const right = Math.max(...words.map((w) => w.right));
  const top = Math.min(...words.map((w) => w.top));
  const bottom = Math.max(...words.map((w) => w.bottom));
  // like a detection box: around the whole (possibly slanted) line, padded
  const rawH = size * 0.6;
  const box = {
    x: Math.round(left - 0.6 * rawH),
    y: Math.round(Math.min(top, (top + bottom) / 2 - 0.5 * rawH) - 0.4 * rawH),
    width: Math.round(right - left + 1.2 * rawH),
    height: Math.round(Math.max(bottom - top, rawH) + 0.8 * rawH),
  };
  const gray = toGray(ctx.getImageData(0, 0, width, height));
  return { gray, words, box, size };
}

// every word's left and right edge within `tol` em of its ink
function expectHugs(found, truth, size, tol) {
  expect(found.map((w) => w.t)).toEqual(truth.map((w) => w.t));
  found.forEach((w, i) => {
    expect(Math.abs(w.x - truth[i].left) / size, `${w.t} left`).toBeLessThan(tol);
    expect(Math.abs(w.x + w.w - truth[i].right) / size, `${w.t} right`).toBeLessThan(tol);
  });
}

describe('locateWords', () => {
  it('finds each word in the ink, where a letter count puts it in the wrong place', () => {
    // narrow and wide letters side by side: the case counting characters gets wrong
    const { gray, words, box, size } = render('Will ill WOMB MAW milk');
    expectHugs(locateWords(words.map((w) => w.t).join(' '), box, gray), words, size, 0.12);

    // the estimate, for comparison, is several times further out somewhere
    const worst = (found) =>
      Math.max(...found.map((w, i) => Math.max(Math.abs(w.x - words[i].left), Math.abs(w.x + w.w - words[i].right))));
    const text = words.map((w) => w.t).join(' ');
    expect(worst(locateWords(text, box, null))).toBeGreaterThan(worst(locateWords(text, box, gray)) * 4);
  });

  it('tells word spaces from the gaps inside monospaced letters', () => {
    const { gray, words, box, size } = render('fill it with Tr0ub4dor&3', { font: 'Courier New' });
    expectHugs(locateWords('fill it with Tr0ub4dor&3', box, gray), words, size, 0.12);
  });

  it('follows a tilted line, keeping the highlight as thick as the letters', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const { gray, words, box, size } = render(text, { tilt: 3, width: 1600 });
    const found = locateWords(text, box, gray);
    // truth is the upright box around each turned word, so allow the turn
    expectHugs(found, words, size, 0.2);
    for (const w of found) expect(w.h / size).toBeLessThan(1.3);
    // and the band steps down the line with the text
    expect(found.at(-1).y - found[0].y).toBeGreaterThan(size * 0.9);
  });

  it('includes punctuation that sits below the middle of the line', () => {
    const { gray, words, box, size } = render('milk, Jill. done');
    expectHugs(locateWords('milk, Jill. done', box, gray), words, size, 0.12);
  });

  it('reads light text on a dark background the same way', () => {
    const { gray, words, box, size } = render('HOMEBASE_5G corgi-battery-42', { ink: '#f2f2f2', paper: '#1d2126' });
    expectHugs(locateWords('HOMEBASE_5G corgi-battery-42', box, gray), words, size, 0.12);
  });

  it('estimates inside the padding when the photo has nothing to measure', () => {
    const { gray } = render('');
    const box = { x: 100, y: 90, width: 400, height: 54 };
    const found = locateWords('one two three', box, gray);
    expect(found.map((w) => w.t)).toEqual(['one', 'two', 'three']);
    expect(found[0].x).toBeGreaterThan(box.x);
    expect(found.at(-1).x + found.at(-1).w).toBeLessThan(box.x + box.width);
    for (let i = 1; i < found.length; i++) expect(found[i].x).toBeGreaterThan(found[i - 1].x + found[i - 1].w);
  });

  it('estimates when the text has more spaces than the photo has gaps', () => {
    const { gray, box } = render('WOMBAT');
    const found = locateWords('W O M B A T', box, gray);
    expect(found).toHaveLength(6);
    for (let i = 1; i < found.length; i++) expect(found[i].x).toBeGreaterThan(found[i - 1].x);
  });

  it('uses an unpadded box whole when there is no photo', () => {
    expect(locateWords('HELLO', { x: 10, y: 5, width: 100, height: 20 }, null, { padded: false })).toEqual([
      { t: 'HELLO', x: 10, y: 5, w: 100, h: 20 },
    ]);
  });
});
