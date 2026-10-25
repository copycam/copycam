// Draws the phone page's Home Screen icons into site/public/p/: the "Cam" of
// the logo on its lime pill, on the camera screen's dark ground. Run
// `node scripts/make-icons.mjs` after changing the design.
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const INK = '#141518';
const ACCENT = '#CFFF3B';
const fams = GlobalFonts.families.map((f) => f.family);
const SANS = ['Segoe UI', 'Helvetica Neue', 'Arial'].find((n) => fams.includes(n)) ?? 'sans-serif';
const out = path.resolve(import.meta.dirname, '..', 'site', 'public', 'p');
fs.mkdirSync(out, { recursive: true });

// `safe`: the share of the icon the design may use. A maskable icon is cut to
// a circle or a squircle, so its design keeps to the middle 80%.
function icon(size, safe = 0.86) {
  const c = createCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = INK;
  g.fillRect(0, 0, size, size);
  const w = size * safe * 0.78;
  const h = w * 0.62;
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  g.fillStyle = ACCENT;
  g.beginPath();
  g.roundRect(x, y, w, h, h * 0.24);
  g.fill();
  g.fillStyle = '#161616';
  g.font = `800 ${Math.round(h * 0.62)}px "${SANS}"`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Cam', size / 2, size / 2 + h * 0.03);
  return c.toBuffer('image/png');
}

const files = {
  'icon-180.png': icon(180), // iPhone Home Screen
  'icon-192.png': icon(192),
  'icon-512.png': icon(512),
  'icon-maskable-512.png': icon(512, 0.7),
};
for (const [name, png] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), png);
  console.log(`wrote site/public/p/${name}`);
}
