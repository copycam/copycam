// Pure selection logic for the image-overlay review, kept identical to the
// native app's by that app's own tests.
//
// Each item is a word ({ t, x, y, w, h, li, pi }) in reading order. The server
// already puts RTL lines in reading order (reversing both the characters within
// each token and the tokens within the line), so walking the array by index is
// correct for Arabic as well as Latin.

// Inclusive list of word indices between two bounds, in reading order. Either
// bound may be the larger (a backwards drag).
export function rangeIndices(anchor, focus) {
  if (anchor == null || focus == null) return [];
  const [s, e] = anchor <= focus ? [anchor, focus] : [focus, anchor];
  const out = [];
  for (let i = s; i <= e; i++) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// What's selected, and how a stroke changes it.
//
// The selection is any set of words, built up a stroke at a time: a drag, or a
// tap, which is a drag that never left its word. A stroke that starts on an
// unselected word adds the words it sweeps; one that starts on a selected word
// takes them away — so picking more never loses what was already picked, and a
// mistake is undone the same way it was made.
//
// The review opens with everything selected, as a suggestion (`soft`): sending
// it as-is is the common case. The first stroke replaces a suggestion instead
// of cutting a hole in it, since touching the photo means "these words". All
// and Clear make a deliberate selection, which strokes then add to or take from.
// ---------------------------------------------------------------------------

export const NOTHING = { picked: [], soft: false };

export function everything(count, soft = false) {
  return { picked: rangeIndices(0, count - 1), soft };
}

export function beginStroke(sel, anchor) {
  const mode = sel.soft ? 'replace' : sel.picked.includes(anchor) ? 'remove' : 'add';
  return { base: sel, anchor, mode };
}

// The selection with the stroke swept from its anchor to `focus`. Always worked
// out from where the stroke began, so dragging back over words undoes the sweep.
export function strokeTo(stroke, focus) {
  const lo = Math.min(stroke.anchor, focus);
  const hi = Math.max(stroke.anchor, focus);
  const outside = stroke.base.picked.filter((i) => i < lo || i > hi);
  if (stroke.mode === 'remove') return { picked: outside, soft: false };
  if (stroke.mode === 'replace') return { picked: rangeIndices(lo, hi), soft: false };
  const before = outside.filter((i) => i < lo);
  const after = outside.filter((i) => i > hi);
  return { picked: [...before, ...rangeIndices(lo, hi), ...after], soft: false };
}

// Build the outgoing text from the selected words, in reading order:
//   - words on a line are joined by spaces, even across a word left out
//   - a paragraph's wrapped lines flow together with a space, as long as the
//     selection runs straight on from one line to the next
//   - where it doesn't — separate pieces picked from different lines — each
//     piece starts on a new line
//   - paragraphs are separated by a blank line
// So the text depends only on which words are selected, never on the order or
// the strokes they were picked in.
export function selectionText(words, indices) {
  const sorted = [...new Set(indices)].filter((i) => words[i]).sort((a, b) => a - b);
  let out = '';
  sorted.forEach((i, k) => {
    const w = words[i];
    if (k > 0) {
      const prevIndex = sorted[k - 1];
      const prev = words[prevIndex];
      if (w.pi !== prev.pi) out += '\n\n';
      else if (w.li === prev.li || i === prevIndex + 1) out += ' ';
      else out += '\n';
    }
    out += w.t;
  });
  return out;
}

// The word under a point, in image pixels. Word boxes hug their ink (the server
// finds them in the photo), so:
//   - inside a box, the shortest box wins: a stray detection can span several
//     lines, and must not swallow taps meant for the words it covers
//   - between boxes, the nearest edge wins, with rows weighted over columns so
//     a drag snaps to the line under the finger, like sweeping a text cursor
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
// an upright box tall enough to cover the drift. A run ends at a word left out
// of the selection, so a highlight never covers a word that won't be sent.
// `doubt` marks a run holding a word the recogniser was unsure of.
export function selectionBars(words, indices) {
  const byLine = new Map();
  for (const i of indices) {
    const w = words[i];
    if (!w) continue;
    if (!byLine.has(w.li)) byLine.set(w.li, []);
    byLine.get(w.li).push(i);
  }
  const bars = [];
  for (const [li, lineIndices] of byLine) {
    // screen order: an RTL line's words are stored in reading order
    const sorted = [...lineIndices].sort((a, b) => words[a].x - words[b].x);
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const first = words[run[0]];
      const last = words[run[run.length - 1]];
      const c0 = [first.x + first.w / 2, first.y + first.h / 2];
      const c1 = [last.x + last.w / 2, last.y + last.h / 2];
      const slope = c1[0] > c0[0] ? (c1[1] - c0[1]) / (c1[0] - c0[0]) : 0;
      bars.push({
        x0: first.x,
        y0: c0[1] - (slope * first.w) / 2,
        x1: last.x + last.w,
        y1: c1[1] + (slope * last.w) / 2,
        h: Math.max(...run.map((i) => words[i].h)),
        li,
        doubt: run.some((i) => typeof words[i].c === 'number' && words[i].c < 0.9),
      });
      run = [];
    };
    for (const i of sorted) {
      const prevIndex = run[run.length - 1];
      if (prevIndex !== undefined) {
        const w = words[i];
        const prev = words[prevIndex];
        // a word between them isn't selected, or a "line" the recogniser
        // stitched from two rows comes back apart
        const skipped = Math.abs(i - prevIndex) !== 1;
        const jumped = Math.abs(w.y + w.h / 2 - (prev.y + prev.h / 2)) > Math.max(w.h, prev.h) * 0.6;
        if (skipped || jumped) flush();
      }
      run.push(i);
    }
    flush();
  }
  return bars;
}
