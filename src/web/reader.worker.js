import * as ort from 'onnxruntime-web';
import { PaddleOcrService } from 'ppu-paddle-ocr/web';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { toGray } from '../../shared/geometry.js';
import { readOriented, linesFromPaddle } from '../../shared/reading.js';
import { parseWifiQr } from '../../shared/wifi-qr.js';
// Everything the reader needs comes from copycam.app itself, fingerprinted so
// it can be cached for good: nothing is fetched from a CDN, and once these are
// in the browser's cache the reader starts offline.
import detUrl from '../../models/PP-OCRv6_small_det.ort?url';
import recUrl from '../../models/PP-OCRv6_small_rec.ort?url';
import dictUrl from '../../models/ppocrv6_dict.txt?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import ortGlueUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// The copycam.app tab's text reader: the same PaddleOCR model and the same
// reading rules (shared/reading.js) as the companion, run in this worker so the
// page stays responsive while a photo is read. It never sends anything
// anywhere; it only answers the page.
//
// Messages in:  { type: 'load' } | { type: 'ocr', id, bytes, script } | { type: 'wifi', id, bytes }
// Messages out: { type: 'progress', loaded, total } | { type: 'ready' } | { type: 'failed', message }
//               | { type: 'done', id, result } | { type: 'error', id, message }

/* global __READER_BYTES__ */
const BYTES = typeof __READER_BYTES__ === 'object' ? __READER_BYTES__ : {};
const CACHE = 'copycam-reader-v1';

// The library's web build makes canvases with `document`, which a worker
// doesn't have. OffscreenCanvas does the same job here.
function fitForWorker(svc) {
  const platform = Object.getPrototypeOf(svc.platform);
  platform.createCanvas = (w, h) => new OffscreenCanvas(w, h);
  platform.isCanvas = (v) => v instanceof OffscreenCanvas || typeof v?.getContext === 'function';
}

// Fetch one of the reader's files, from the cache when it's there, reporting
// bytes as they arrive so the page can show progress.
async function fetchFile(url, onBytes) {
  let cache = null;
  try {
    cache = await caches.open(CACHE);
  } catch {
    // no Cache Storage (private windows, some browsers): the HTTP cache still helps
  }
  let res = cache ? await cache.match(url) : undefined;
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`couldn't fetch ${url}: ${res.status}`);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    onBytes(value.length);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

// Drop files a newer build no longer uses, so the cache holds one reader.
async function pruneCache(keep) {
  try {
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      if (!keep.some((u) => req.url.endsWith(u))) await cache.delete(req);
    }
  } catch {
    // nothing to tidy
  }
}

let service = null;

async function load() {
  const files = { det: detUrl, rec: recUrl, dict: dictUrl, wasm: ortWasmUrl };
  const total = Object.values(BYTES).reduce((a, b) => a + b, 0) || 45_000_000;
  let loaded = 0;
  let last = 0;
  const onBytes = (n) => {
    loaded += n;
    const now = Date.now();
    if (now - last > 120) {
      last = now;
      postMessage({ type: 'progress', loaded, total });
    }
  };
  const [det, rec, dict, wasm] = await Promise.all(Object.values(files).map((u) => fetchFile(u, onBytes)));
  postMessage({ type: 'progress', loaded: total, total });
  pruneCache(Object.values(files));

  ort.env.wasm.wasmBinary = wasm;
  ort.env.wasm.wasmPaths = { mjs: ortGlueUrl, wasm: ortWasmUrl };
  // One thread. It reads a five-line, 1600×900 photo in about 1.1 s, which is
  // plenty, and ONNX Runtime 1.26's threaded start never finishes inside a
  // worker; threads would also need the page cross-origin isolated.
  ort.env.wasm.numThreads = 1;

  const svc = new PaddleOcrService({
    model: { detection: det, recognition: rec, charactersDictionary: dict },
    session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
  });
  fitForWorker(svc);
  await svc.initialize();
  service = svc;

  prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) },
  });
  postMessage({ type: 'ready' });
}

async function bitmapOf(bytes) {
  return createImageBitmap(new Blob([bytes]));
}

async function rotate(bytes, degrees) {
  const img = await bitmapOf(bytes);
  const swap = degrees === 90 || degrees === 270;
  const canvas = new OffscreenCanvas(swap ? img.height : img.width, swap ? img.width : img.height);
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  img.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return blob.arrayBuffer();
}

async function pixelsOf(bytes) {
  const img = await bitmapOf(bytes);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  img.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function gray(bytes) {
  try {
    return toGray(await pixelsOf(bytes));
  } catch {
    return null; // the word boxes are estimated instead
  }
}

async function ocr(bytes) {
  const read = await readOriented(bytes, {
    // noCache: the library caches results by image bytes, and every capture is fresh
    readLines: async (image) => linesFromPaddle(await service.recognize(image, { noCache: true })),
    rotate,
    gray,
  });
  if (!read) return { words: [], lineCount: 0, text: '', rotation: 0 };
  return read;
}

async function wifi(bytes) {
  try {
    const found = await readBarcodes(await pixelsOf(bytes), {
      formats: ['QRCode'],
      tryHarder: true,
      maxNumberOfSymbols: 4,
    });
    for (const code of found) {
      const parsed = parseWifiQr(code.text);
      if (parsed) return parsed;
    }
  } catch {
    // never let this cost the scan its text
  }
  return null;
}

let loading = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    loading ??= load().catch((e) => {
      loading = null;
      postMessage({ type: 'failed', message: String(e?.message || e) });
    });
    return;
  }
  const { id } = data;
  try {
    if (!service) throw new Error('reader not ready');
    const result = data.type === 'ocr' ? await ocr(data.bytes) : await wifi(data.bytes);
    postMessage({ type: 'done', id, result });
  } catch (e) {
    postMessage({ type: 'error', id, message: String(e?.message || e) });
  }
};
