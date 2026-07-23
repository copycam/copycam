import { describe, it, expect } from 'vitest';
import { coverCropRect } from './image.js';

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
