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
