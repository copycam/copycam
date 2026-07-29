import { describe, it, expect } from 'vitest';
import { coverCropRect, computeFrame } from './image.js';

describe('computeFrame', () => {
  const usable = (vw, vh) => {
    const f = computeFrame(vw, vh);
    return { w: vw - f.side * 2, h: vh - f.top - f.bottom, f };
  };

  it('leaves a large usable window in portrait', () => {
    const { w, h } = usable(390, 844);
    expect(w).toBeGreaterThan(300);
    expect(h).toBeGreaterThan(400);
  });

  it('still leaves a usable window in landscape (the rotation case)', () => {
    const { w, h, f } = usable(844, 390);
    expect(w).toBeGreaterThan(600);
    expect(h).toBeGreaterThanOrEqual(96);
    // must clear the shutter, which sits ~142px up from the bottom edge
    expect(f.bottom).toBeGreaterThanOrEqual(142);
  });

  it('never collapses the window, even on absurdly short viewports', () => {
    for (const vh of [240, 280, 320, 360, 400]) {
      const { h, f } = usable(700, vh);
      expect(h).toBeGreaterThanOrEqual(96);
      expect(f.top).toBeGreaterThan(0);
      expect(f.bottom).toBeGreaterThan(0);
    }
  });

  it('keeps insets inside sane bounds across a range of sizes', () => {
    for (const [vw, vh] of [
      [320, 568],
      [390, 844],
      [430, 932],
      [844, 390],
      [1024, 768],
    ]) {
      const f = computeFrame(vw, vh);
      expect(f.side).toBeGreaterThanOrEqual(16);
      expect(f.side).toBeLessThanOrEqual(48);
      expect(f.top + f.bottom).toBeLessThan(vh);
    }
  });
});

describe('coverCropRect', () => {
  it('maps a full-box crop to the whole frame when box and video match (scale 1)', () => {
    const r = coverCropRect({ left: 0, top: 0, width: 200, height: 100 }, { cw: 200, ch: 100, vw: 200, vh: 100 });
    expect(r).toEqual({ sx: 0, sy: 0, sw: 200, sh: 100 });
  });

  it('maps an inset window to the matching source region (scale 1)', () => {
    const r = coverCropRect({ left: 20, top: 10, width: 100, height: 50 }, { cw: 200, ch: 100, vw: 200, vh: 100 });
    expect(r).toEqual({ sx: 20, sy: 10, sw: 100, sh: 50 });
  });

  it('clamps a window that runs past the frame edge', () => {
    const r = coverCropRect({ left: 180, top: 0, width: 100, height: 100 }, { cw: 200, ch: 100, vw: 200, vh: 100 });
    expect(r.sx).toBe(180);
    expect(r.sw).toBe(20); // clamped to the remaining width
  });

  it('accounts for object-fit: cover centre-cropping (portrait box, landscape video)', () => {
    // box 100x200 over a 200x100 video → scale 2, horizontal centre-crop
    const r = coverCropRect({ left: 0, top: 0, width: 100, height: 200 }, { cw: 100, ch: 200, vw: 200, vh: 100 });
    expect(r).toEqual({ sx: 75, sy: 0, sw: 50, sh: 100 });
  });

  it('a sub-window of the visible area yields a proportionally smaller crop', () => {
    const full = coverCropRect({ left: 0, top: 0, width: 200, height: 100 }, { cw: 200, ch: 100, vw: 400, vh: 200 });
    const inset = coverCropRect({ left: 26, top: 20, width: 148, height: 60 }, { cw: 200, ch: 100, vw: 400, vh: 200 });
    expect(inset.sw).toBeLessThan(full.sw);
    expect(inset.sh).toBeLessThan(full.sh);
    expect(inset.sx).toBeGreaterThan(full.sx);
  });
});
