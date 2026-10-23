import path from 'node:path';
import os from 'node:os';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { toGray } from '../shared/geometry.js';
import { pack, readOriented, linesFromPaddle, tidyLine } from '../shared/reading.js';
import { withBundled } from './models.js';
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

// The reading itself (tidying, paragraphs, word placement, orientation) lives in
// shared/reading.js, shared with the browser reader on copycam.app. Re-exported
// here for the tests and callers that have always found it in this module.
export {
  tidyLine,
  linesToParas,
  lineIsRtl,
  splitWords,
  orientationScore,
  isConfident,
} from '../shared/reading.js';

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

const paddleByScript = new Map();
let tesseractPromise = null;

function getPaddle(script) {
  const key = resolveScript(script);
  if (!paddleByScript.has(key)) {
    const model = withBundled(SCRIPT_MODELS[key]);
    const svc = new PaddleOcrService({ model });
    paddleByScript.set(
      key,
      svc.initialize().then(() => svc),
    );
  }
  return paddleByScript.get(key);
}

// The photo as grey pixels, for placing words. Never fails a scan: without it
// the word boxes are estimated instead.
async function grayOf(imageBuffer) {
  try {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return toGray(ctx.getImageData(0, 0, img.width, img.height));
  } catch {
    return null;
  }
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
  return linesFromPaddle(await svc.recognize(ab, { noCache: true }));
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
  return { ...pack(capped, await grayOf(imageBuffer)), rotation: 0 };
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
    const read = await readOriented(imageBuffer, {
      readLines: (image) => recognizePaddle(image, key),
      rotate: rotateImage,
      gray: grayOf,
    });
    if (read) return read;
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
