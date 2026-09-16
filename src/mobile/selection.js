// Pure selection logic for the image-overlay review.
// Each item is a word ({ t, x, y, w, h, li, pi }) in reading order. Selection
// is a single contiguous range [anchor..focus] — like native text selection.

// Expand an anchor/focus pair into the inclusive list of word indices between
// them, in reading order. Either bound may be the larger (backwards drag).
export function rangeIndices(anchor, focus) {
  if (anchor == null || focus == null) return [];
  const [s, e] = anchor <= focus ? [anchor, focus] : [focus, anchor];
  const out = [];
  for (let i = s; i <= e; i++) out.push(i);
  return out;
}

// Build the outgoing text from a set of selected word indices, single flowing
// mode: words on a line joined by spaces, wrapped lines within a paragraph
// flowed together, and distinct paragraphs separated by a blank line.
export function selectionText(words, indices) {
  const sorted = [...indices].sort((a, b) => a - b);
  const paraOrder = [];
  const paras = new Map(); // pi -> Map(li -> [word text])
  for (const i of sorted) {
    const w = words[i];
    if (!w) continue;
    if (!paras.has(w.pi)) {
      paras.set(w.pi, new Map());
      paraOrder.push(w.pi);
    }
    const lines = paras.get(w.pi);
    if (!lines.has(w.li)) lines.set(w.li, []);
    lines.get(w.li).push(w.t);
  }
  return paraOrder
    .sort((a, b) => a - b)
    .map((pi) => {
      const lines = paras.get(pi);
      return [...lines.keys()]
        .sort((a, b) => a - b)
        .map((li) => lines.get(li).join(' '))
        .join(' ');
    })
    .join('\n\n');
}

// The word under a point, in image pixels. Word boxes hug their ink (the server
// finds them in the photo), so:
//   - inside a box, the shortest box wins: a stray detection can span several
//     lines, and must not swallow taps meant for the words it covers
//   - between boxes, the nearest edge wins, with rows weighted over columns so
//     a drag snaps to the line under the finger, like sweeping a text cursor
// The native app keeps an identical copy (mobile/src/lib/selection.ts); the two
// are held together by shared/selection-compat.test.js.
export function wordAt(words, ix, iy) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const ox = Math.max(w.x - ix, 0, ix - (w.x + w.w));
    const oy = Math.max(w.y - iy, 0, iy - (w.y + w.h));
    const d =
      ox || oy
        ? 1e6 + oy * 3 + ox
        : w.h * 1000 + Math.abs(iy - (w.y + w.h / 2)) * 3 + Math.abs(ix - (w.x + w.w / 2));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// One highlight per run of selected words on a line, as a centre line from
// (x0, y0) to (x1, y1) with a thickness `h`. A photographed line is rarely
// level, and the server places each word on its line's slant, so the run's
// ends follow that slant and the bar is drawn turned to match rather than as
// an upright box tall enough to cover the drift. `doubt` marks a run holding a
// word the recogniser was unsure of.
export function selectionBars(words, indices) {
  const byLine = new Map();
  for (const i of indices) {
    const w = words[i];
    if (!w) continue;
    if (!byLine.has(w.li)) byLine.set(w.li, []);
    byLine.get(w.li).push(w);
  }
  const bars = [];
  for (const [li, lineWords] of byLine) {
    // screen order: an RTL line's words are stored in reading order
    const sorted = [...lineWords].sort((a, b) => a.x - b.x);
    // a "line" the recogniser stitched from two rows splits back apart here
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      const c0 = [first.x + first.w / 2, first.y + first.h / 2];
      const c1 = [last.x + last.w / 2, last.y + last.h / 2];
      const slope = c1[0] > c0[0] ? (c1[1] - c0[1]) / (c1[0] - c0[0]) : 0;
      bars.push({
        x0: first.x,
        y0: c0[1] - (slope * first.w) / 2,
        x1: last.x + last.w,
        y1: c1[1] + (slope * last.w) / 2,
        h: Math.max(...run.map((w) => w.h)),
        li,
        doubt: run.some((w) => typeof w.c === 'number' && w.c < 0.9),
      });
      run = [];
    };
    for (const w of sorted) {
      const prev = run[run.length - 1];
      if (prev && Math.abs(w.y + w.h / 2 - (prev.y + prev.h / 2)) > Math.max(w.h, prev.h) * 0.6) flush();
      run.push(w);
    }
    flush();
  }
  return bars;
}
