import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from '../shared/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'winocr.ps1');

export const available = process.platform === 'win32';

function runScript(imagePath) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Path', imagePath],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

// Rebuild visual rows from word boxes: OcrEngine splits a row containing a
// wide gap ("SSID:      HOMEBASE_5G") into separate lines, in column order.
// Cluster words whose vertical centers overlap, then sort each row by x.
// Returns rows as arrays of indices into `words`, in reading order.
export function wordsToRows(words) {
  const rows = [];
  const byCenter = words
    .map((w, i) => ({ ...w, i }))
    .sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  for (const word of byCenter) {
    const cy = word.y + word.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) < Math.max(word.h, r.h) * 0.6);
    if (row) {
      row.words.push(word);
      row.cy = (row.cy * (row.words.length - 1) + cy) / row.words.length;
      row.h = Math.max(row.h, word.h);
    } else {
      rows.push({ cy, h: word.h, words: [word] });
    }
  }
  return rows.map((r) => r.words.sort((a, b) => a.x - b.x).map((w) => w.i));
}

export function wordsToLines(words) {
  return wordsToRows(words).map((row) =>
    row
      .map((i) => words[i].t)
      .join(' ')
      .trim(),
  );
}

// Raw OCR words with bounding boxes (pixel coordinates of the input image).
export async function recognizeWinWords(imageBuffer) {
  const tmpFile = path.join(os.tmpdir(), `copycam-${toHex(randomBytes(8))}.jpg`);
  fs.writeFileSync(tmpFile, imageBuffer);
  try {
    const out = await runScript(tmpFile);
    const parsed = JSON.parse(out.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

export async function recognizeWin(imageBuffer) {
  return wordsToLines(await recognizeWinWords(imageBuffer));
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
