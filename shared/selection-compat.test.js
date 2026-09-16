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

describe('selection and zoom: the two clients agree', () => {
  it('pick the same word for the same point', () => {
    for (let x = 60; x <= 520; x += 20)
      for (let y = 70; y <= 230; y += 10) expect(appSel.wordAt(WORDS, x, y)).toBe(webSel.wordAt(WORDS, x, y));
  });

  it('draw the same bars', () => {
    for (const indices of [[0], [0, 1], [2, 3], [0, 1, 2, 3, 4], [3], []]) {
      expect(appSel.selectionBars(WORDS, indices)).toEqual(webSel.selectionBars(WORDS, indices));
    }
  });

  it('agree on the view math', () => {
    const photo = { x: 24, y: 40, w: 340, h: 160 };
    const area = { width: 388, height: 280 };
    const margin = { x: 24, y: 12 };
    const views = [webView.IDENTITY, { z: 2, tx: -120, ty: -80 }, { z: 5.5, tx: -900, ty: 30 }];
    for (const v of views) {
      expect(appView.toLayer(v, 150, 90)).toEqual(webView.toLayer(v, 150, 90));
      expect(appView.clampView(v, photo, area, margin)).toEqual(webView.clampView(v, photo, area, margin));
      expect(appView.zoomAbout(v, 3, 200, 100)).toEqual(webView.zoomAbout(v, 3, 200, 100));
      expect(appView.pinch(v, [100, 100], 80, [130, 90], 200)).toEqual(webView.pinch(v, [100, 100], 80, [130, 90], 200));
      expect(appView.toggleZoom(v, 180, 120, photo, area, margin)).toEqual(
        webView.toggleZoom(v, 180, 120, photo, area, margin),
      );
    }
    expect(appView.MAX_ZOOM).toBe(webView.MAX_ZOOM);
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
  const { IDENTITY, MAX_ZOOM, toLayer, clampView, zoomAbout, pinch, toggleZoom } = webView;
  const photo = { x: 24, y: 60, w: 340, h: 160 }; // fitted and centred in the area
  const area = { width: 388, height: 280 };
  const margin = { x: 24, y: 12 };

  it('leaves the fitted photo exactly where it was at 1x', () => {
    expect(clampView(IDENTITY, photo, area, margin)).toEqual(IDENTITY);
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

  it('never lets the zoomed photo drift off screen', () => {
    const lost = clampView({ z: 3, tx: 5000, ty: -5000 }, photo, area, margin);
    // left and bottom edges held at the margins
    expect(photo.x * 3 + lost.tx).toBeCloseTo(margin.x);
    expect((photo.y + photo.h) * 3 + lost.ty).toBeCloseTo(area.height - margin.y);
  });

  it('double tap zooms in around the tap, and back out to the whole photo', () => {
    const inView = toggleZoom(IDENTITY, 190, 140, photo, area, margin);
    expect(inView.z).toBeGreaterThan(2);
    expect(toggleZoom(inView, 10, 10, photo, area, margin)).toEqual(IDENTITY);
  });
});
