import path from 'node:path';
import os from 'node:os';
import {
  PaddleOcrService,
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

const SCRIPT_MODELS = {
  auto: undefined, // V6 unified -- Latin scripts + Chinese/Japanese/Korean
  small: V6_SMALL_MODEL, // same coverage, more accurate, slower
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

const paddleByScript = new Map();
let tesseractPromise = null;

function getPaddle(script) {
  const key = SCRIPT_MODELS[script] === undefined && script !== 'auto' ? 'auto' : script;
  if (!paddleByScript.has(key)) {
    const model = SCRIPT_MODELS[key];
    const svc = new PaddleOcrService(model ? { model } : undefined);
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
export function splitWords(lines, paras) {
  const linePi = [];
  paras.forEach((p, pi) => p.forEach((li) => (linePi[li] = pi)));
  const words = [];
  lines.forEach((line, li) => {
    const pi = linePi[li] ?? 0;
    const rtl = lineIsRtl(line.t);
    const parts = line.t.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      words.push({ t: fixRtlToken(line.t), x: line.x, y: line.y, w: line.w, h: line.h, li, pi });
      return;
    }
    // total layout units = word characters + single-space gaps between words
    const units = parts.reduce((s, p) => s + p.length, 0) + (parts.length - 1);
    const perUnit = line.w / units;
    let cx = line.x;
    const lineWords = [];
    for (const p of parts) {
      const wpx = p.length * perUnit;
      lineWords.push({ t: fixRtlToken(p), x: Math.round(cx), y: line.y, w: Math.round(wpx), h: line.h, li, pi });
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
    .map((wordsOnLine) => ({ t: wordsOnLine.map((w) => w.text).join(' ').trim(), ...unionBox(wordsOnLine) }))
    .filter((l) => l.t)
    .slice(0, 60);
  return pack(lines);
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
        if (t) lines.push({ t, x: line.bbox.x0, y: line.bbox.y0, w: line.bbox.x1 - line.bbox.x0, h: line.bbox.y1 - line.bbox.y0 });
      }
    }
  }
  return pack(lines.slice(0, 60));
}

// Resolves to { words: [{ t, x, y, w, h, li, pi }], lineCount, text }.
// `words` carries pixel-space geometry (line index li, paragraph index pi) for
// the image-overlay review UI's word-level drag selection.
// `script` picks the recognition model (see SCRIPT_MODELS); unknown values
// fall back to the unified model rather than failing the scan.
export async function recognize(imageBuffer, script = DEFAULT_SCRIPT) {
  const key = SCRIPT_MODELS[script] !== undefined || script === 'auto' ? script : 'auto';
  try {
    const out = await recognizePaddle(imageBuffer, key);
    if (out.words.length) return out;
  } catch (err) {
    console.warn('PaddleOCR failed, falling back to tesseract:', err.message);
  }
  return recognizeTesseract(imageBuffer);
}

export async function warmup() {
  try {
    await getPaddle(DEFAULT_SCRIPT);
  } catch {
    // model download blocked -- recognize() will fall back to tesseract on demand
  }
}
