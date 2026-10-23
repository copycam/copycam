import { locateWords } from './geometry.js';

// What a reading becomes once the recogniser has produced its lines: tidied
// text, paragraphs, words placed on the photo, and the choice of which way up
// the photo was. None of it touches a file, a canvas or a model, so the
// companion (server/ocr.js) and the browser reader (src/web/) share it, and
// both read a photo the same way.

// Whitespace the recogniser adds where written text never has it. Measured on
// 384 rendered lines (4 fonts, 2 sizes, clean and photo-degraded): these lifted
// exact lines from 57% to 59% (tiny) and 85% to 86% (small), and never turned a
// correct line into a wrong one.
export function tidyLine(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    // an underscore joins what it sits between; the recogniser often reads a
    // space beside it ("guest_ wifi_2024", "HOMEBASE _5G")
    .replace(/ ?_ ?/g, '_')
    // an email address has no space around its @ ("john.doe @ example.com")
    .replace(/(\S) ?@ ?(?=[\w-]+\.[\w.-]+)/g, '$1@');
}

function unionBox(items) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of items) {
    const b = w.box;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

// Cluster reading-order lines into paragraphs by vertical gap: a gap larger
// than ~0.9x the median line height starts a new paragraph. Normal line
// wrapping (gap well under one line height) stays in the same paragraph.
export function linesToParas(lines) {
  if (!lines.length) return [];
  const heights = lines.map((l) => l.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 1;
  const paras = [];
  let cur = [0];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].y - (lines[i - 1].y + lines[i - 1].h);
    if (gap > medianH * 0.9) {
      paras.push(cur);
      cur = [i];
    } else {
      cur.push(i);
    }
  }
  paras.push(cur);
  return paras;
}

// Right-to-left scripts (Arabic, Hebrew -- the latter not currently OCR'd but
// harmless to detect). Ranges are decimal Unicode code points, deliberately
// not written as regex \u escapes or literal glyphs -- both have proven
// unreliable to get through this codebase's text pipeline intact. Covers:
// Hebrew (1425-1524), Arabic/Syriac/Thaana (1536-1983), combined Hebrew+Arabic
// Presentation Forms-A (64285-65023), Arabic Presentation Forms-B
// (65136-65279).
const RTL_RANGES = [
  [1425, 1524],
  [1536, 1983],
  [64285, 65023],
  [65136, 65279],
];

function isRtlChar(ch) {
  const code = ch.codePointAt(0);
  return RTL_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

function isLatinLetter(ch) {
  const code = ch.codePointAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122); // A-Z, a-z
}

// PaddleOCR's recognizer reads a text line as an image, left to right, and
// emits characters in that same left-to-right scan order -- which is the
// correct logical order for LTR scripts, but the *reverse* of correct
// Unicode reading order for RTL scripts (confirmed empirically: reversing a
// recognized Arabic line character-by-character restores the original text).
// A whitespace-delimited token is treated as one RTL "run" if it contains any
// RTL character, and reversed as a unit; pure digit/Latin tokens (numbers,
// embedded English words) are left alone, since those still read left-to-right
// even inside an RTL line. This is a practical approximation, not a full
// Unicode Bidi Algorithm implementation -- good enough for whitespace-separated
// tokens, not for multi-word phrases mixing scripts inside one token.
function fixRtlToken(token) {
  return [...token].some(isRtlChar) ? [...token].reverse().join('') : token;
}

// "First strong character" direction of a line: the first char that is
// unambiguously RTL or LTR decides it (same rule CSS dir="auto" uses),
// skipping digits/punctuation/whitespace which carry no direction of their own.
export function lineIsRtl(text) {
  for (const ch of text) {
    if (isRtlChar(ch)) return true;
    if (isLatinLetter(ch)) return false;
  }
  return false;
}

// Split each detected line into words, each with the box it occupies in the
// photo (see geometry.js: found from the ink when the photo is given, estimated
// otherwise). Lines with no internal spaces (e.g. CJK) stay as a single word.
// Each word carries its line index (li) and paragraph index (pi) for
// reading-order selection, and the confidence of the detection box it came
// from, so one hard-to-read box doesn't cast doubt on the rest of its line.
//
// For RTL lines, word *geometry* is left exactly as computed (it already
// matches true left-to-right screen position, since that's what the raw scan
// order gives us for free) -- only each word's *text* is corrected (see
// fixRtlToken) and the words' *array order* is reversed, so that array-index
// order matches reading order even though on-screen position runs the other
// way. Selection (rangeIndices/selectionText) already walks words purely by
// array index, so this alone makes drag-selecting and pasting RTL text work.
// Two decimals is plenty for "was this hard to read", and keeps the sealed
// payload small on a page full of words.
const conf = (c) => (typeof c === 'number' ? { c: Math.round(c * 100) / 100 } : {});

// A line's words in screen order, with boxes. `line.t` has been through
// tidyLine, which only ever removes spaces, so its words map back onto the
// detection boxes' words by their non-space characters: a word tidy joined
// across two boxes ("HOMEBASE" + "_5G") gets the union of both.
function placeLine(line, gray) {
  const whole = { x: line.x, y: line.y, width: line.w, height: line.h };
  const raw = line.pieces
    ? line.pieces.flatMap((p) => locateWords(p.text, p.box, gray).map((w) => ({ ...w, c: p.c })))
    : locateWords(line.t, whole, gray, { padded: false }).map((w) => ({ ...w, c: line.c }));
  const owner = raw.flatMap((w, i) => [...w.t].map(() => i));
  const tokens = line.t.split(' ').filter(Boolean);
  let pos = 0;
  const out = [];
  for (const t of tokens) {
    const from = [...new Set([...t].map(() => owner[pos++]))].map((i) => raw[i]).filter(Boolean);
    if (!from.length) break;
    const x0 = Math.min(...from.map((w) => w.x));
    const y0 = Math.min(...from.map((w) => w.y));
    const x1 = Math.max(...from.map((w) => w.x + w.w));
    const y1 = Math.max(...from.map((w) => w.y + w.h));
    const cs = from.map((w) => w.c).filter((c) => typeof c === 'number');
    out.push({ t, x: x0, y: y0, w: x1 - x0, h: y1 - y0, c: cs.length ? Math.min(...cs) : undefined });
  }
  // the two texts disagree (not expected): estimate across the whole line
  if (out.length !== tokens.length || pos !== owner.length) {
    return locateWords(line.t, whole, null, { padded: false }).map((w) => ({ ...w, c: line.c }));
  }
  return out;
}

export function splitWords(lines, paras, gray = null) {
  const linePi = [];
  paras.forEach((p, pi) => p.forEach((li) => (linePi[li] = pi)));
  const words = [];
  lines.forEach((line, li) => {
    const pi = linePi[li] ?? 0;
    const lineWords = placeLine(line, gray).map(({ t, x, y, w, h, c }) => ({
      t: fixRtlToken(t),
      x,
      y,
      w,
      h,
      li,
      pi,
      ...conf(c),
    }));
    // screen order is reading order for LTR; an RTL line reads from the right
    words.push(...(lineIsRtl(line.t) ? lineWords.reverse() : lineWords));
  });
  return words;
}

// Reconstruct display text from the (already reading-order) words array,
// grouping consecutive same-line words. Used instead of the raw `lines` text
// so RTL correction is reflected consistently everywhere.
function wordsToText(words) {
  const byLine = [];
  for (const w of words) {
    const last = byLine[byLine.length - 1];
    if (last && last.li === w.li) last.parts.push(w.t);
    else byLine.push({ li: w.li, parts: [w.t] });
  }
  return byLine.map((l) => l.parts.join(' ')).join('\n');
}

export function pack(lines, gray) {
  const paras = linesToParas(lines);
  const words = splitWords(lines, paras, gray);
  return { words, lineCount: lines.length, text: wordsToText(words) };
}

// ---------------------------------------------------------------------------
// Orientation
// ---------------------------------------------------------------------------
// A phone held flat over a page cannot tell landscape from portrait — gravity
// has no roll to measure — so no amount of sensor plumbing on the client can be
// trusted to say which way up the text is. The text itself can, though: a line
// of writing is wide and short, so if the detected line boxes come back tall
// and narrow, the image is a quarter turn out.
//
// So the client sends the framed crop as-is and the server decides, trying the
// upright guess first and falling back to the other turns only when the reading
// is poor. It returns the rotation it settled on so the client can turn the
// photo to match and keep the highlight boxes aligned.

export function orientationScore(lines, confidence = 1) {
  if (!lines.length) return 0;
  const chars = lines.reduce((sum, l) => sum + l.t.replace(/\s+/g, '').length, 0);
  const wide = lines.filter((l) => l.w >= l.h).length / lines.length;
  // Characters recognised is the dominant signal — a quarter-turned page reads
  // as near-gibberish — with line shape and the recogniser's own confidence
  // breaking ties. Upside-down text is the hard case: it still produces wide
  // boxes, so it can only be told apart by reading worse.
  return chars * (0.25 + 0.75 * wide) * (0.5 + 0.5 * confidence);
}

// Good enough to stop looking, used only for the upright first pass: plenty of
// text, in line-shaped boxes, that the recogniser itself was sure of. The
// confidence bar is what keeps upside-down gibberish from qualifying.
export function isConfident(lines, confidence = 1) {
  if (lines.length === 0) return false;
  const chars = lines.reduce((sum, l) => sum + l.t.replace(/\s+/g, '').length, 0);
  const wide = lines.filter((l) => l.w >= l.h).length / lines.length;
  return chars >= 12 && wide >= 0.6 && confidence >= 0.85;
}

// Read a photo upright, or in whichever quarter turn reads best. The platform
// supplies the three things that differ between Node and a browser:
//   readLines(image)      -> { lines, confidence } from the recogniser
//   rotate(image, deg)    -> the image turned by deg degrees
//   gray(image)           -> grey pixels for placing words, or null
// Resolves to { words, lineCount, text, rotation }, or null when no turn read
// anything, so the caller can try another reader.
export async function readOriented(image, { readLines, rotate, gray }) {
  // Upright first: the overwhelmingly common case, and it costs one pass.
  let best = { ...(await readLines(image)), rotation: 0, image };
  if (!isConfident(best.lines, best.confidence)) {
    // Otherwise weigh every turn and take the best reading. Deliberately no
    // early exit here: upside-down text also yields wide, plausible-looking
    // boxes, so stopping at the first "good enough" candidate picks 180° out
    // instead of the true orientation. Four passes only happen on a scan that
    // already failed to read upright.
    let bestScore = orientationScore(best.lines, best.confidence);
    for (const deg of [90, 270, 180]) {
      let candidate;
      try {
        const turned = await rotate(image, deg);
        candidate = { ...(await readLines(turned)), rotation: deg, image: turned };
      } catch {
        continue; // a failed turn must never lose us the reading we have
      }
      const score = orientationScore(candidate.lines, candidate.confidence);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best.lines.length) return null;
  }
  // Words are placed only for the reading that won, and in the frame it was
  // read in: the turned image, when it was turned. `lines` was a scoring aid
  // and stays off the wire.
  return { ...pack(best.lines, await gray(best.image)), rotation: best.rotation };
}

// The recogniser's result as reading lines: each line of detected words merged
// into one item with its box, its tidied text, and the detection boxes it came
// from (for placing the words, see geometry.js).
export function linesFromPaddle(result) {
  const out = result.lines
    .filter((wordsOnLine) => wordsOnLine.length)
    .map((wordsOnLine) => ({
      t: tidyLine(wordsOnLine.map((w) => w.text).join(' ')),
      // the recogniser's own certainty about this line, carried through to the
      // phone so the review can point at what was hard to read
      c: Math.min(...wordsOnLine.map((w) => w.confidence ?? 1)),
      ...unionBox(wordsOnLine),
      pieces: wordsOnLine
        .filter((w) => w.text && w.text.trim())
        .map((w) => ({ text: w.text, box: w.box, c: w.confidence })),
    }))
    .filter((l) => l.t)
    .slice(0, 60);
  return { lines: out, confidence: result.confidence ?? 1 };
}
