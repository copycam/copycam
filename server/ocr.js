import path from 'node:path';
import os from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  PaddleOcrService,
  V6_TINY_MODEL,
  V6_SMALL_MODEL,
  V6_MEDIUM_MODEL,
  V5_CYRILLIC_MOBILE_MODEL,
  V5_ARABIC_MOBILE_MODEL,
  V5_DEVANAGARI_MOBILE_MODEL,
  V5_GREEK_MOBILE_MODEL,
  V5_KOREAN_MOBILE_MODEL,
  V5_LATIN_MOBILE_MODEL,
  V5_THAI_MOBILE_MODEL,
  V5_TAMIL_MOBILE_MODEL,
  V5_TELUGU_MOBILE_MODEL,
  V3_JAPANESE_MOBILE_MODEL,
} from 'ppu-paddle-ocr';

// Primary OCR is PaddleOCR (PP-OCR models) running on ONNX Runtime, natively
// in Node -- no Python. tesseract.js is the portable fallback. Both return the
// same line-level shape, packed into { words, lineCount, text }.
//
// Script selection matters: the default unified model reads Latin scripts and
// CJK, and each script-specific model *also* includes Latin -- so mixed text
// (e.g. English + Russian) works as long as the non-Latin script is selected.
// Models are loaded lazily and cached per script, so switching is cheap after
// the first use. CC_OCR_MODEL sets the default; the phone can override it
// per scan.

// 'auto' is the unified Latin + CJK reader and the default. It used to be the
// V6 tiny model; measured over 384 rendered lines (4 fonts, 2 sizes, clean and
// photo-degraded), tiny read 57% of lines exactly and small 86%, and tiny lost
// 15 underscores outright (HOMEBASE_5G -> "HOMEBASE 5G") where small lost none.
// Small costs roughly twice the time (~2s vs ~1s on a phone-sized crop), which
// is why tiny stays available as 'fast'.
const SCRIPT_MODELS = {
  auto: V6_SMALL_MODEL, // V6 unified -- Latin scripts + Chinese/Japanese/Korean
  fast: V6_TINY_MODEL, // same coverage, about twice as quick, misreads more
  small: V6_SMALL_MODEL, // the old name for what 'auto' now is; still accepted
  medium: V6_MEDIUM_MODEL,
  latin: V5_LATIN_MOBILE_MODEL,
  cyrillic: V5_CYRILLIC_MOBILE_MODEL, // Russian, Ukrainian, Bulgarian, Serbian...
  greek: V5_GREEK_MOBILE_MODEL,
  arabic: V5_ARABIC_MOBILE_MODEL, // Arabic, Persian, Urdu
  devanagari: V5_DEVANAGARI_MOBILE_MODEL, // Hindi, Marathi, Nepali
  korean: V5_KOREAN_MOBILE_MODEL,
  japanese: V3_JAPANESE_MOBILE_MODEL,
  thai: V5_THAI_MOBILE_MODEL,
  tamil: V5_TAMIL_MOBILE_MODEL,
  telugu: V5_TELUGU_MOBILE_MODEL,
};

export const SCRIPTS = Object.keys(SCRIPT_MODELS);
export const DEFAULT_SCRIPT = (process.env.CC_OCR_MODEL || 'auto').toLowerCase();

// The model actually used for a requested script: anything unknown falls back
// to the default rather than failing a scan, and 'small' — which phones may
// still have stored from when it was a separate choice — resolves to 'auto' so
// the same model isn't loaded into memory twice under two names.
export function resolveScript(script) {
  if (script === 'small') return 'auto';
  return SCRIPT_MODELS[script] ? script : 'auto';
}

// Whitespace the recogniser adds where written text never has it. Measured on
// the same 384 lines: these lifted exact lines from 57% to 59% (tiny) and 85%
// to 86% (small), and never turned a correct line into a wrong one.
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

const paddleByScript = new Map();
let tesseractPromise = null;

function getPaddle(script) {
  const key = resolveScript(script);
  if (!paddleByScript.has(key)) {
    const model = SCRIPT_MODELS[key];
    const svc = new PaddleOcrService({ model });
    paddleByScript.set(
      key,
      svc.initialize().then(() => svc),
    );
  }
  return paddleByScript.get(key);
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

// Split each detected line into words with proportionally-estimated boxes.
// PaddleOCR only gives line boxes, so per-word x/width are estimates based on
// character count -- good enough for touch selection and highlighting. Lines
// with no internal spaces (e.g. CJK) stay as a single word. Each word carries
// its line index (li) and paragraph index (pi) for reading-order selection.
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
const conf = (line) => (typeof line.c === 'number' ? { c: Math.round(line.c * 100) / 100 } : {});

export function splitWords(lines, paras) {
  const linePi = [];
  paras.forEach((p, pi) => p.forEach((li) => (linePi[li] = pi)));
  const words = [];
  lines.forEach((line, li) => {
    const pi = linePi[li] ?? 0;
    const rtl = lineIsRtl(line.t);
    const parts = line.t.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      words.push({ t: fixRtlToken(line.t), x: line.x, y: line.y, w: line.w, h: line.h, li, pi, ...conf(line) });
      return;
    }
    // total layout units = word characters + single-space gaps between words
    const units = parts.reduce((s, p) => s + p.length, 0) + (parts.length - 1);
    const perUnit = line.w / units;
    let cx = line.x;
    const lineWords = [];
    for (const p of parts) {
      const wpx = p.length * perUnit;
      lineWords.push({ t: fixRtlToken(p), x: Math.round(cx), y: line.y, w: Math.round(wpx), h: line.h, li, pi, ...conf(line) });
      cx += wpx + perUnit; // advance past the word and one space (screen-position order)
    }
    words.push(...(rtl ? lineWords.reverse() : lineWords));
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

function pack(lines) {
  const paras = linesToParas(lines);
  const words = splitWords(lines, paras);
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

async function rotateImage(buffer, degrees) {
  const img = await loadImage(buffer);
  const swap = degrees === 90 || degrees === 270;
  const canvas = createCanvas(swap ? img.height : img.width, swap ? img.width : img.height);
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return canvas.toBuffer('image/jpeg', 0.92);
}

async function recognizePaddle(imageBuffer, script) {
  const svc = await getPaddle(script);
  const ab = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength);
  // noCache: the library's result cache is keyed by image bytes alone, so
  // re-scanning the same photo under a different script would otherwise hand
  // back the previous script's text. Each capture is a fresh frame anyway.
  const result = await svc.recognize(ab, { noCache: true });
  // Each result line is an array of recognized words; merge into one line item.
  const lines = result.lines
    .filter((wordsOnLine) => wordsOnLine.length)
    .map((wordsOnLine) => ({
      t: tidyLine(wordsOnLine.map((w) => w.text).join(' ')),
      // the recogniser's own certainty about this line, carried through to the
      // phone so the review can point at what was hard to read
      c: Math.min(...wordsOnLine.map((w) => w.confidence ?? 1)),
      ...unionBox(wordsOnLine),
    }))
    .filter((l) => l.t)
    .slice(0, 60);
  return { ...pack(lines), lines, confidence: result.confidence ?? 1 };
}

async function recognizeTesseract(imageBuffer) {
  if (!tesseractPromise) {
    const { createWorker } = await import('tesseract.js');
    tesseractPromise = createWorker('eng', 1, { cachePath: path.join(os.homedir(), '.copycam') });
  }
  const worker = await tesseractPromise;
  const { data } = await worker.recognize(imageBuffer, {}, { blocks: true, text: true });
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const t = (line.text || '').trim();
        if (t) {
          lines.push({
            t: tidyLine(t),
            c: (line.confidence ?? 100) / 100,
            x: line.bbox.x0,
            y: line.bbox.y0,
            w: line.bbox.x1 - line.bbox.x0,
            h: line.bbox.y1 - line.bbox.y0,
          });
        }
      }
    }
  }
  const capped = lines.slice(0, 60);
  return { ...pack(capped), lines: capped };
}

// Resolves to { words: [{ t, x, y, w, h, li, pi }], lineCount, text, rotation }.
// `words` carries pixel-space geometry (line index li, paragraph index pi) for
// the image-overlay review UI's word-level drag selection, expressed in the
// frame of the image *after* `rotation` degrees — the client turns its copy of
// the photo by the same amount so the highlights line up.
// `script` picks the recognition model (see SCRIPT_MODELS); unknown values
// fall back to the unified model rather than failing the scan.
export async function recognize(imageBuffer, script = DEFAULT_SCRIPT) {
  const key = resolveScript(script);
  try {
    // Upright first: the overwhelmingly common case, and it costs one pass.
    let best = { ...(await recognizePaddle(imageBuffer, key)), rotation: 0 };
    if (isConfident(best.lines, best.confidence)) return strip(best);

    // Otherwise weigh every turn and take the best reading. Deliberately no
    // early exit here: upside-down text also yields wide, plausible-looking
    // boxes, so stopping at the first "good enough" candidate picks 180° out
    // instead of the true orientation. Four passes only happen on a scan that
    // already failed to read upright.
    let bestScore = orientationScore(best.lines, best.confidence);
    for (const deg of [90, 270, 180]) {
      let candidate;
      try {
        candidate = {
          ...(await recognizePaddle(await rotateImage(imageBuffer, deg), key)),
          rotation: deg,
        };
      } catch {
        continue; // a failed turn must never lose us the reading we have
      }
      const score = orientationScore(candidate.lines, candidate.confidence);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best.words.length) return strip(best);
  } catch (err) {
    console.warn('PaddleOCR failed, falling back to tesseract:', err.message);
  }
  return { ...(await recognizeTesseract(imageBuffer)), rotation: 0 };
}

// `lines` is an internal scoring aid; the wire format stays words-only.
function strip({ lines, ...rest }) {
  void lines;
  return rest;
}

export async function warmup() {
  try {
    await getPaddle(DEFAULT_SCRIPT);
  } catch {
    // model download blocked -- recognize() will fall back to tesseract on demand
  }
}
