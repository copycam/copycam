import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from '@napi-rs/canvas';

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

// Split on a separator that isn't backslash-escaped.
function splitUnescaped(text, sep) {
  const out = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      cur += ch + text[i + 1];
      i++;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const unescape = (v) => v.replace(/\\(.)/g, '$1');

// Parse the payload a Wi-Fi QR carries:
//   WIFI:S:<name>;T:<WPA|WEP|nopass>;P:<password>;H:<true|false>;;
// Fields may come in any order, and ; : , \ and " inside a value are
// backslash-escaped. Returns null for anything that isn't a Wi-Fi code.
export function parseWifiQr(payload) {
  if (typeof payload !== 'string') return null;
  const m = /^WIFI:/i.exec(payload.trim());
  if (!m) return null;

  const fields = {};
  for (const part of splitUnescaped(payload.trim().slice(m[0].length), ';')) {
    if (!part) continue;
    const at = splitUnescaped(part, ':');
    if (at.length < 2) continue;
    const key = at[0].toUpperCase();
    // a value may itself contain escaped colons, so re-join everything after
    // the first separator rather than taking only the second piece
    if (!(key in fields)) fields[key] = unescape(at.slice(1).join(':'));
  }

  const ssid = fields.S ?? '';
  if (!ssid) return null; // a code with no network name is not usable

  const type = (fields.T || '').toUpperCase();
  const security = type === 'WEP' ? 'WEP' : type === 'NOPASS' || (!type && !fields.P) ? 'nopass' : 'WPA';
  return {
    ssid,
    password: security === 'nopass' ? '' : (fields.P ?? ''),
    security,
    hidden: /^true$/i.test(fields.H || ''),
  };
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
