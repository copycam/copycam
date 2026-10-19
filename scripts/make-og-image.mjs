// Draws site/public/og.png, the 1200x630 preview shown when copycam.app is
// shared. Run `node scripts/make-og-image.mjs` after changing the wording.
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const W = 1200;
const H = 630;
const INK = '#161616';
const ACCENT = '#CFFF3B';
const fams = GlobalFonts.families.map((f) => f.family);
const pick = (...names) => names.find((n) => fams.includes(n)) ?? 'sans-serif';
const SANS = pick('Segoe UI', 'Helvetica Neue', 'Arial');
const MONO = pick('Consolas', 'Menlo', 'DejaVu Sans Mono', 'Courier New');

const c = createCanvas(W, H);
const g = c.getContext('2d');
g.fillStyle = '#f1f0ec';
g.fillRect(0, 0, W, H);

// the logo: "Copy" then "Cam" on an accent pill
const x0 = 96;
g.font = `800 132px "${SANS}"`;
g.textBaseline = 'alphabetic';
g.fillStyle = INK;
g.fillText('Copy', x0, 250);
const copyW = g.measureText('Copy').width;
const camW = g.measureText('Cam').width;
const pillX = x0 + copyW + 10;
g.fillStyle = ACCENT;
g.beginPath();
g.roundRect(pillX, 128, camW + 36, 152, 30);
g.fill();
g.fillStyle = INK;
g.fillText('Cam', pillX + 18, 250);

g.font = `500 46px "${SANS}"`;
g.fillStyle = '#3a3a36';
g.fillText('Point your phone at any text.', x0, 372);
g.fillText('It lands on your computer’s clipboard.', x0, 432);

g.font = `600 27px "${MONO}"`;
g.fillStyle = '#8a8a82';
g.fillText('copycam.app  ·  end-to-end encrypted  ·  no ads', x0, 548);

const out = path.join(import.meta.dirname, '..', 'site', 'public', 'og.png');
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log(`wrote ${out} (${SANS} / ${MONO})`);
