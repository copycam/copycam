// Pure selection logic for the image-overlay review.
// `rows` is the server's reading-order grouping: arrays of word indices.

// All word indices between two words (inclusive), in reading order —
// this is what makes drag-selecting a continuous paragraph work.
export function rangeSelect(rows, a, b) {
  const order = rows.flat();
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia === -1 || ib === -1) return [];
  const [s, e] = ia <= ib ? [ia, ib] : [ib, ia];
  return order.slice(s, e + 1);
}

// Build the text to send from the selected word set.
// 'lines' keeps one line per visual row; 'flow' joins everything into a
// single flowing paragraph (right for OCR'd wrapped prose).
export function selectionText(words, rows, selected, mode = 'lines') {
  const parts = [];
  for (const row of rows) {
    const sel = row.filter((i) => selected.has(i));
    if (sel.length) parts.push(sel.map((i) => words[i].t).join(' '));
  }
  return mode === 'flow' ? parts.join(' ') : parts.join('\n');
}
