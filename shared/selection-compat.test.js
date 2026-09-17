// @vitest-environment node
// Both phone apps pick words, draw highlights and zoom the review photo the
// same way; the native app can't import the browser build's copies, so this
// keeps the two honest — and pins down how those pieces behave.
import { describe, it, expect } from 'vitest';
import * as webSel from '../src/mobile/selection.js';
import * as appSel from '../mobile/src/lib/selection.ts';
import * as webView from '../src/mobile/view.js';
import * as appView from '../mobile/src/lib/view.ts';

// Two lines, the second photographed on a slant, plus a stray detection box
// the recogniser drew across both. Boxes hug the ink, as the server sends them.
const WORDS = [
  { t: 'SSID:', x: 100, y: 100, w: 90, h: 30, li: 0, pi: 0 },
  { t: 'HOMEBASE_5G', x: 205, y: 100, w: 230, h: 30, li: 0, pi: 0, c: 0.97 },
  { t: 'Pass:', x: 100, y: 160, w: 85, h: 30, li: 1, pi: 0 },
  { t: 'corgi-battery-42', x: 200, y: 168, w: 300, h: 30, li: 1, pi: 0, c: 0.82 },
  { t: '~', x: 90, y: 90, w: 60, h: 120, li: 2, pi: 0, c: 0.4 },
];

// a short page: two paragraphs, the first wrapped over two lines
const PAGE = [
  { t: 'one', x: 0, y: 0, w: 40, h: 20, li: 0, pi: 0 },
  { t: 'two', x: 50, y: 0, w: 40, h: 20, li: 0, pi: 0 },
  { t: 'three', x: 100, y: 0, w: 60, h: 20, li: 0, pi: 0 },
  { t: 'four', x: 0, y: 30, w: 40, h: 20, li: 1, pi: 0 },
  { t: 'five', x: 50, y: 30, w: 40, h: 20, li: 1, pi: 0 },
  { t: 'six', x: 0, y: 90, w: 40, h: 20, li: 2, pi: 1 },
];

// a wide photo fitted and centred in a tall review area, as a sideways shot is
const photo = { x: 24, y: 220, w: 340, h: 160 };
const area = { width: 388, height: 600 };
const margin = { x: 24, top: 70, bottom: 12 };

describe('selection and zoom: the two clients agree', () => {
  it('pick the same word for the same point', () => {
    for (let x = 60; x <= 520; x += 20)
      for (let y = 70; y <= 230; y += 10) expect(appSel.wordAt(WORDS, x, y)).toBe(webSel.wordAt(WORDS, x, y));
  });

  it('draw the same bars', () => {
    for (const indices of [[0], [0, 1], [2, 3], [0, 1, 2, 3, 4], [3], [], [0, 2]]) {
      expect(appSel.selectionBars(WORDS, indices)).toEqual(webSel.selectionBars(WORDS, indices));
    }
  });

  it('build the same selections from the same strokes, and the same text from them', () => {
    const run = (lib) => {
      const seen = [];
      let sel = lib.everything(PAGE.length, true);
      for (const [anchor, focus] of [[1, 1], [3, 5], [4, 3], [0, 5], [2, 2], [5, 0]]) {
        sel = lib.strokeTo(lib.beginStroke(sel, anchor), focus);
        seen.push(sel, lib.selectionText(PAGE, sel.picked));
      }
      return seen;
    };
    expect(run(appSel)).toEqual(run(webSel));
  });

  it('agree on the view math', () => {
    const views = [webView.IDENTITY, { z: 2, tx: -120, ty: -80 }, { z: 5.5, tx: -900, ty: 30 }, { z: 1.04, tx: 3, ty: 9 }];
    for (const v of views) {
      expect(appView.toLayer(v, 150, 90)).toEqual(webView.toLayer(v, 150, 90));
      expect(appView.clampView(v, photo, area, margin)).toEqual(webView.clampView(v, photo, area, margin));
      expect(appView.zoomAbout(v, 3, 200, 100)).toEqual(webView.zoomAbout(v, 3, 200, 100));
      expect(appView.pinch(v, [100, 100], 80, [130, 90], 200)).toEqual(webView.pinch(v, [100, 100], 80, [130, 90], 200));
      expect(appView.settle(v)).toEqual(webView.settle(v));
      expect(appView.toggleZoom(v, 180, 120, photo, area, margin)).toEqual(
        webView.toggleZoom(v, 180, 120, photo, area, margin),
      );
    }
    expect(appView.MAX_ZOOM).toBe(webView.MAX_ZOOM);
  });
});

describe('strokes', () => {
  const { everything, NOTHING, beginStroke, strokeTo } = webSel;
  const stroke = (sel, anchor, focus) => strokeTo(beginStroke(sel, anchor), focus);

  it('replace the opening suggestion, however they start', () => {
    const suggested = everything(6, true);
    expect(beginStroke(suggested, 2).mode).toBe('replace');
    expect(stroke(suggested, 2, 3)).toEqual({ picked: [2, 3], soft: false });
  });

  it('add what they sweep when they start on an unselected word', () => {
    const sel = stroke(NOTHING, 1, 1);
    expect(beginStroke(sel, 4).mode).toBe('add');
    expect(stroke(sel, 4, 5).picked).toEqual([1, 4, 5]);
  });

  it('take away what they sweep when they start on a selected word', () => {
    const all = everything(6);
    expect(beginStroke(all, 2).mode).toBe('remove');
    expect(stroke(all, 2, 4).picked).toEqual([0, 1, 5]);
  });

  it('never lose what was picked before, even when sweeping over it again', () => {
    // [1..2] picked, then a stroke from unselected 0 across to 3 adds around it
    expect(stroke(stroke(NOTHING, 1, 2), 0, 3).picked).toEqual([0, 1, 2, 3]);
  });

  it('are worked out from where they began, so dragging back undoes the sweep', () => {
    const base = stroke(NOTHING, 5, 5);
    const s = beginStroke(base, 1);
    strokeTo(s, 4); // swept out to 4...
    expect(strokeTo(s, 2).picked).toEqual([1, 2, 5]); // ...and back to 2
  });

  it('backwards works the same as forwards', () => {
    expect(stroke(NOTHING, 4, 1)).toEqual(stroke(NOTHING, 1, 4));
  });

  it('All and Clear are deliberate, so the next stroke refines them', () => {
    expect(everything(3)).toEqual({ picked: [0, 1, 2], soft: false });
    expect(NOTHING).toEqual({ picked: [], soft: false });
  });
});

describe('selectionText', () => {
  const { selectionText } = webSel;

  it('flows a paragraph selected straight through, and separates paragraphs', () => {
    expect(selectionText(PAGE, [0, 1, 2, 3, 4, 5])).toBe('one two three four five\n\nsix');
  });

  it('keeps a line together with a space where a word was left out', () => {
    expect(selectionText(PAGE, [0, 2])).toBe('one three');
  });

  it('starts pieces picked from separate lines on new lines', () => {
    expect(selectionText(PAGE, [1, 4])).toBe('two\nfive');
    expect(selectionText(PAGE, [2, 4])).toBe('three\nfive');
  });

  it('depends only on what is selected, not the order it was picked in', () => {
    expect(selectionText(PAGE, [4, 1, 1])).toBe(selectionText(PAGE, [1, 4]));
  });
});

describe('wordAt', () => {
  const { wordAt } = webSel;

  it('gives a tap inside a word to that word, not a stray box drawn over it', () => {
    expect(WORDS[wordAt(WORDS, 120, 115)].t).toBe('SSID:');
    expect(WORDS[wordAt(WORDS, 430, 115)].t).toBe('HOMEBASE_5G');
  });

  it('snaps a point between words to the line under it', () => {
    // in the space between SSID: and HOMEBASE_5G
    expect(WORDS[wordAt(WORDS, 197, 112)].li).toBe(0);
    // just below the second line's right-hand word
    expect(WORDS[wordAt(WORDS, 480, 204)].t).toBe('corgi-battery-42');
  });

  it('finds nothing in an empty photo', () => {
    expect(wordAt([], 10, 10)).toBeNull();
  });
});

describe('selectionBars', () => {
  const { selectionBars } = webSel;

  it('draws a level line as a level bar from its first word to its last', () => {
    const [bar] = selectionBars(WORDS, [0, 1]);
    expect(bar).toMatchObject({ x0: 100, x1: 435, h: 30, li: 0 });
    expect(bar.y0).toBeCloseTo(115);
    expect(bar.y1).toBeCloseTo(115);
  });

  it('follows the slant of a tilted line out to its ends', () => {
    const [bar] = selectionBars(WORDS, [2, 3]);
    // centres at x 142.5 (y 175) and 350 (y 183): 8px over 207.5px
    const slope = 8 / 207.5;
    expect(bar.y0).toBeCloseTo(175 - slope * 42.5);
    expect(bar.y1).toBeCloseTo(183 + slope * 150);
  });

  it('never covers a word left out of the selection', () => {
    const bars = selectionBars(PAGE, [0, 2]);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => [b.x0, b.x1])).toEqual([
      [0, 40],
      [100, 160],
    ]);
  });

  it('marks a bar holding a word the recogniser doubted', () => {
    expect(selectionBars(WORDS, [0, 1])[0].doubt).toBe(false);
    expect(selectionBars(WORDS, [2, 3])[0].doubt).toBe(true);
  });

  it('runs left to right on screen for a right-to-left line stored in reading order', () => {
    const rtl = [
      { t: 'a', x: 300, y: 0, w: 60, h: 20, li: 0, pi: 0 },
      { t: 'b', x: 100, y: 10, w: 80, h: 20, li: 0, pi: 0 },
    ];
    const [bar] = selectionBars(rtl, [0, 1]);
    expect(bar.x0).toBe(100);
    expect(bar.x1).toBe(360);
    expect(bar.y1).toBeLessThan(bar.y0); // rises to the right, as the words do
  });

  it('splits a line the recogniser stitched together from two rows', () => {
    const stitched = [
      { t: 'upper', x: 0, y: 0, w: 100, h: 20, li: 0, pi: 0 },
      { t: 'lower', x: 150, y: 60, w: 100, h: 20, li: 0, pi: 0 },
    ];
    expect(selectionBars(stitched, [0, 1])).toHaveLength(2);
  });
});

describe('view', () => {
  const { IDENTITY, MAX_ZOOM, toLayer, clampView, zoomAbout, pinch, settle, toggleZoom } = webView;
  // where the photo's top and left edges land on screen
  const edges = (v) => [photo.x * v.z + v.tx, photo.y * v.z + v.ty];

  it('leaves the fitted photo exactly where it was at 1x, even when it reaches under the top bar', () => {
    expect(clampView(IDENTITY, photo, area, margin)).toEqual(IDENTITY);
    // a short area (the phone held sideways) fits the photo from y 12, above the top margin
    const short = { width: 388, height: 180 };
    expect(clampView(IDENTITY, { x: 24, y: 12, w: 340, h: 156 }, short, margin)).toEqual(IDENTITY);
  });

  it('lets a zoomed photo still shorter than the area slide up and down', () => {
    // at 1.5x the photo is 240 tall in a 600 tall area: it used to be held centred
    const z = 1.5;
    const down = clampView({ z, tx: 0, ty: 1000 }, photo, area, margin);
    const up = clampView({ z, tx: 0, ty: -1000 }, photo, area, margin);
    expect(edges(down)[1] + photo.h * z).toBeCloseTo(area.height - margin.bottom); // bottom edge on the bottom margin
    expect(edges(up)[1]).toBeCloseTo(margin.top); // top edge just below the top bar
  });

  it('brings a zoomed photo taller than the area down to just below the top bar, no further', () => {
    const v = clampView({ z: 4, tx: -100, ty: 5000 }, photo, area, margin);
    expect(edges(v)[1]).toBeCloseTo(margin.top);
  });

  it('never lets the zoomed photo drift off screen', () => {
    for (const z of [1.5, 3, 6]) {
      const lost = clampView({ z, tx: 5000, ty: -5000 }, photo, area, margin);
      // wider than the area: its left edge stops at the margin
      expect(edges(lost)[0]).toBeCloseTo(margin.x);
      // and vertically it's still in sight: on screen where it fits, filling the area where it doesn't
      const [top, bottom] = [edges(lost)[1], edges(lost)[1] + photo.h * z];
      expect(Math.min(bottom, area.height) - Math.max(top, 0)).toBeGreaterThan(Math.min(photo.h * z, area.height) * 0.5);
    }
  });

  it('keeps the point being zoomed about under the finger', () => {
    const v = zoomAbout(IDENTITY, 3, 200, 140);
    const [lx, ly] = toLayer(v, 200, 140);
    expect(lx).toBeCloseTo(200);
    expect(ly).toBeCloseTo(140);
  });

  it('pans with two fingers that move without spreading', () => {
    const start = { z: 2, tx: -100, ty: -50 };
    expect(pinch(start, [100, 100], 80, [130, 90], 80)).toEqual({ z: 2, tx: -70, ty: -60 });
  });

  it('stops between 1x and the maximum', () => {
    expect(pinch(IDENTITY, [100, 100], 100, [100, 100], 20).z).toBe(1);
    expect(pinch(IDENTITY, [100, 100], 10, [100, 100], 1000).z).toBe(MAX_ZOOM);
  });

  it('comes to rest on the whole photo when a gesture ends barely zoomed', () => {
    expect(settle({ z: 1.03, tx: 4, ty: -9 })).toEqual(IDENTITY);
    const zoomed = { z: 2, tx: -40, ty: -30 };
    expect(settle(zoomed)).toBe(zoomed);
  });

  it('double tap zooms in around the tap, and back out to the whole photo', () => {
    const inView = toggleZoom(IDENTITY, 190, 140, photo, area, margin);
    expect(inView.z).toBeGreaterThan(2);
    expect(toggleZoom(inView, 10, 10, photo, area, margin)).toEqual(IDENTITY);
  });
});
