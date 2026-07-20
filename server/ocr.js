import path from 'node:path';
import os from 'node:os';
import { available as winOcrAvailable, recognizeWinWords, wordsToRows } from './winocr.js';

// Primary engine on Windows is the native Windows.Media.Ocr (much better on
// real phone photos); tesseract.js is the cross-platform fallback. Tesseract
// downloads eng traineddata (~4 MB) on first use, cached under ~/.copycam.

let workerPromise = null;

async function getTesseractWorker() {
  if (!workerPromise) {
    const { createWorker } = await import('tesseract.js');
    workerPromise = createWorker('eng', 1, {
      cachePath: path.join(os.homedir(), '.copycam'),
    });
  }
  return workerPromise;
}

// Split OCR output into selectable blocks, one per non-empty line —
// mirrors how the demo presents found text.
export function textToBlocks(text) {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 48);
}

// Best-effort word geometry from tesseract's nested block structure; the
// overlay UI degrades to a plain list when this returns null.
function tesseractWords(data) {
  try {
    const words = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const w of line.words || []) {
            if (w.text?.trim()) {
              words.push({
                t: w.text,
                x: w.bbox.x0,
                y: w.bbox.y0,
                w: w.bbox.x1 - w.bbox.x0,
                h: w.bbox.y1 - w.bbox.y0,
              });
            }
          }
        }
      }
    }
    return words.length ? words : null;
  } catch {
    return null;
  }
}

async function recognizeTesseract(imageBuffer) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(imageBuffer, {}, { blocks: true, text: true });
  const words = tesseractWords(data);
  return {
    blocks: textToBlocks(data.text || ''),
    words,
    rows: words ? wordsToRows(words) : null,
  };
}

// Resolves to { blocks: string[], words: [{t,x,y,w,h}]|null, rows: number[][]|null }.
// `words`/`rows` carry pixel-space geometry for the image-overlay review UI.
export async function recognize(imageBuffer) {
  if (winOcrAvailable) {
    try {
      const words = await recognizeWinWords(imageBuffer);
      const rows = wordsToRows(words);
      const blocks = rows
        .map((row) => row.map((i) => words[i].t).join(' ').trim())
        .filter(Boolean)
        .slice(0, 48);
      if (blocks.length) return { blocks, words, rows };
    } catch (err) {
      console.warn('Windows OCR failed, falling back to tesseract:', err.message);
    }
  }
  return recognizeTesseract(imageBuffer);
}

export async function warmup() {
  // Windows OCR needs no warmup; only pre-download tesseract data elsewhere.
  if (!winOcrAvailable) await getTesseractWorker();
}
