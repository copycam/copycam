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
// in Node — no Python. The default unified model covers Latin scripts + CJK;
// CC_OCR_MODEL selects a bigger tier or a script-specific model for others.
// tesseract.js is the portable fallback. Both return the same line-level shape:
//   { lines: [{ t, x, y, w, h }], paras: number[][], text }
// where `paras` groups line indices into paragraphs (reading order) so the
// phone can join a wrapped paragraph into flowing text.

const MODEL_ALIASES = {
  tiny: undefined, // library default (V6 tiny unified)
  small: V6_SMALL_MODEL,
  medium: V6_MEDIUM_MODEL,
  cyrillic: V5_CYRILLIC_MOBILE_MODEL,
  arabic: V5_ARABIC_MOBILE_MODEL,
  devanagari: V5_DEVANAGARI_MOBILE_MODEL,
  greek: V5_GREEK_MOBILE_MODEL,
  korean: V5_KOREAN_MOBILE_MODEL,
  latin: V5_LATIN_MOBILE_MODEL,
  thai: V5_THAI_MOBILE_MODEL,
  tamil: V5_TAMIL_MOBILE_MODEL,
  telugu: V5_TELUGU_MOBILE_MODEL,
  japanese: V3_JAPANESE_MOBILE_MODEL,
};

let paddlePromise = null;
let tesseractPromise = null;

function getPaddle() {
  if (!paddlePromise) {
    const alias = (process.env.CC_OCR_MODEL || 'tiny').toLowerCase();
    const model = MODEL_ALIASES[alias];
    const svc = new PaddleOcrService(model ? { model } : undefined);
    paddlePromise = svc.initialize().then(() => svc);
  }
  return paddlePromise;
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

function pack(lines) {
  return { lines, paras: linesToParas(lines), text: lines.map((l) => l.t).join('\n') };
}

async function recognizePaddle(imageBuffer) {
  const svc = await getPaddle();
  const ab = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength);
  const result = await svc.recognize(ab);
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

// Resolves to { lines, paras, text }. `lines`/`paras` carry pixel-space
// geometry for the image-overlay review UI.
export async function recognize(imageBuffer) {
  try {
    const out = await recognizePaddle(imageBuffer);
    if (out.lines.length) return out;
  } catch (err) {
    console.warn('PaddleOCR failed, falling back to tesseract:', err.message);
  }
  return recognizeTesseract(imageBuffer);
}

export async function warmup() {
  try {
    await getPaddle();
  } catch {
    // model download blocked — recognize() will fall back to tesseract on demand
  }
}
