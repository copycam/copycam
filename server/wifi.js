import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { parseWifiQr } from '../shared/wifi-qr.js';

export { parseWifiQr };

// Router labels usually carry a Wi-Fi QR code beside the printed credentials.
// Reading it is exact — no OCR, so none of the reading mistakes that matter
// most on exactly this text (0 vs O, 1 vs l, a lost underscore). The photo
// already reaches the companion, so decoding here serves both phone apps with
// one implementation.
//
// The decoder is zxing-wasm: on 36 rendered label photos (QR down to 110px,
// turned up to 35 degrees, softened and JPEG'd) it read 30 against jsQR's 28,
// at half the time, and jsQR missed a large clean code merely tilted 12
// degrees. Its WebAssembly binary ships inside the package and is handed over
// as bytes below: left to itself the library fetches it from a CDN at runtime,
// which would put a network call — and a dependency on being online — in the
// middle of a scan.

const require = createRequire(import.meta.url);
let readerPromise = null;

function reader() {
  readerPromise ??= (async () => {
    const mod = await import('zxing-wasm/reader');
    const wasmBinary = fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
    mod.prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true });
    return mod;
  })();
  return readerPromise;
}

// Find a Wi-Fi QR in a photo. Returns its parsed contents, or null when there
// is no QR, none of the QRs is a Wi-Fi one, or the image can't be read.
export async function decodeWifi(imageBuffer) {
  try {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    const pixels = canvas.getContext('2d').getImageData(0, 0, img.width, img.height);
    const { readBarcodes } = await reader();
    // tryHarder: a label QR is small and often at an angle in the frame
    const found = await readBarcodes(pixels, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 4 });
    for (const code of found) {
      const wifi = parseWifiQr(code.text);
      if (wifi) return wifi;
    }
    return null;
  } catch {
    return null; // never let this cost the scan its text
  }
}
