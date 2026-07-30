import { describe, it, expect } from 'vitest';
import { coverCropRect, computeFrame } from './image.js';

describe('computeFrame', () => {
  const usable = (vw, vh) => {
    const f = computeFrame(vw, vh);
    return { w: vw - f.left - f.right, h: vh - f.top - f.bottom, f };
  };

  it('leaves a large usable window in portrait, with symmetric sides', () => {
    const { w, h, f } = usable(390, 844);
    expect(w).toBeGreaterThan(300);
    expect(h).toBeGreaterThan(400);
    expect(f.landscape).toBe(false);
    expect(f.left).toBe(f.right);
    // portrait reserves height at the bottom for the shutter (~142px tall zone)
    expect(f.bottom).toBeGreaterThanOrEqual(142);
  });

  it('reserves width on the right in landscape, not height at the bottom', () => {
    const { h, f } = usable(844, 390);
    expect(f.landscape).toBe(true);
    // room for the 78px shutter parked on the right edge
    expect(f.right).toBeGreaterThanOrEqual(100);
    expect(f.right).toBeGreaterThan(f.left);
    // and the bottom is now just a margin, so the window is much taller
    expect(f.bottom).toBeLessThan(100);
    expect(h).toBeGreaterThan(200);
    // the window must start below the status + flash/language pills (~104px)
    expect(f.top).toBeGreaterThanOrEqual(104);
  });

  it('landscape is taller and narrower than the old bottom-shutter layout', () => {
    const land = usable(844, 390);
    // the previous layout produced roughly 748x158 here
    expect(land.h).toBeGreaterThan(158);
    expect(land.w).toBeLessThan(748);
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
      expect(f.left).toBeGreaterThanOrEqual(16);
      expect(f.left).toBeLessThanOrEqual(48);
      expect(f.right).toBeGreaterThanOrEqual(16);
      expect(f.top + f.bottom).toBeLessThan(vh);
      expect(f.left + f.right).toBeLessThan(vw);
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
