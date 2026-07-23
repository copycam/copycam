// Pure selection logic for the image-overlay review.
// Each item is a detected text LINE ({ t, x, y, w, h }); `paras` groups line
// indices into paragraphs in reading order (from the server).

// All line indices between two lines (inclusive), in reading order — this is
// what makes drag-selecting a continuous paragraph work across line breaks.
export function rangeSelect(paras, a, b) {
  const order = paras.flat();
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia === -1 || ib === -1) return [];
  const [s, e] = ia <= ib ? [ia, ib] : [ib, ia];
  return order.slice(s, e + 1);
}

// Build the text to send from the selected line set.
// 'lines' — one line of output per selected line, in reading order.
// 'flow'  — join wrapped lines within a paragraph into flowing text (single
//           spaces), separating distinct paragraphs with a blank line. This is
//           what turns a photographed paragraph into one clean block.
export function selectionText(lines, paras, selected, mode = 'lines') {
  if (mode === 'flow') {
    const blocks = [];
    for (const para of paras) {
      const sel = para.filter((i) => selected.has(i));
      if (sel.length) blocks.push(sel.map((i) => lines[i].t).join(' '));
    }
    return blocks.join('\n\n');
  }
  return paras
    .flat()
    .filter((i) => selected.has(i))
    .map((i) => lines[i].t)
    .join('\n');
}
