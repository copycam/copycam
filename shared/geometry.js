// Where each recognised word actually sits in the photo.
//
// PaddleOCR reports text as detection boxes (one or a few per line) and pads
// every box generously: 0.6 of its height either side and 0.4 above and below,
// because the recogniser reads better with a margin. The old split shared that
// padded box among its words by character count. Measured on 72 rendered crops
// (6 fonts, 2 sizes, 3 tilts, clean and photo-degraded; 1158 words), that put a
// highlight edge 0.93 letter-heights from the ink on average, and a tap near
// the end of a word selected its neighbour 31% of the time.
//
// So the words are found in the photo itself. Inside each box the columns that
// hold ink are known; the gaps between words are among the runs of empty
// columns; and the text says how many word gaps there must be and roughly
// where — which is what tells a word space from the gap inside "r n". On the
// same crops edges now sit 0.03 letter-heights from the ink on upright text
// (0.16 tilted), and with the phones' hit test a tap near either end of a word
// lands on it 98.8% of the time. A second set of 24 crops with closely set lines
// went from 62% to 98.9%.
// Where the photo gives no clean answer — too little contrast, fewer gaps than
// spaces — the split falls back to an estimate weighted by letter width,
// inside the box's padding rather than across it.

// ppu-paddle-ocr's paddingHorizontal / paddingVertical, as fractions of the
// raw box height; a padded box is (1 + 2 * PAD_Y) raw heights tall
const PAD_X = 0.6;
const PAD_Y = 0.4;

// Tuned on the crops above; the neighbouring values score within a few tenths
// of a percent, so none of these is balanced on a knife edge.
const BAND = [0.22, 0.78]; // rows of the box, around the line's centre, that decide which columns hold ink
const INK_FRAC = 0.06; // share of those rows a column needs inked to count
const BAND_INK_FRAC = 0.04; // the same, over the line's full band
const LAMBDA = 0.15; // how far (px) a gap may sit from where a space is expected, per px of its width
const MIN_CONTRAST = 28; // grey levels between ink and paper, below which the photo isn't trusted

// Rough advance widths in em for a generic proportional font. Only the ratios
// matter, and only as a guide: the gaps in the photo decide.
function glyphWidth(ch) {
  if ("iljI!|.,:;'`".includes(ch)) return 0.28;
  if ('frt()[]{}-"/\\'.includes(ch)) return 0.36;
  if ('mwMW@%'.includes(ch)) return 0.86;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.56;
  if (/[a-z]/.test(ch)) return 0.52;
  // anything else (CJK, Arabic, symbols): CJK is about square
  return ch.codePointAt(0) >= 0x2e80 ? 1 : 0.6;
}

// Monospaced text, common on router labels and exactly where passwords get
// printed, gives every character and the space the same width. Both models are
// tried, and the one that agrees better with the photo's gaps is kept.
const FONTS = [
  { glyph: glyphWidth, space: 0.3 },
  { glyph: () => 1, space: 1 },
];

// Share [x0, x1) among tokens by estimated width.
function estimate(tokens, x0, x1, font = FONTS[0]) {
  const widths = tokens.map((t) => [...t].reduce((s, ch) => s + font.glyph(ch), 0));
  const total = widths.reduce((a, b) => a + b, 0) + font.space * (tokens.length - 1);
  const per = (x1 - x0) / (total || 1);
  const out = [];
  let cx = x0;
  for (const w of widths) {
    out.push([cx, cx + w * per]);
    cx += (w + font.space) * per;
  }
  return out;
}

function otsu(hist, count) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = count - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

// Ink inside one box: which pixels are ink, the line's centre across the box,
// and which columns hold ink. Null when the photo can't be trusted.
function inkIn(gray, box) {
  const { data, width, height } = gray;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.width));
  const y1 = Math.min(height, Math.ceil(box.y + box.height));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 4 || bh < 4) return null;

  const hist = new Uint32Array(256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[data[y * width + x]]++;
  const thr = otsu(hist, bw * bh);
  let lo = 0;
  let loSum = 0;
  for (let i = 0; i <= thr; i++) {
    lo += hist[i];
    loSum += i * hist[i];
  }
  const hi = bw * bh - lo;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  if (!lo || !hi || (total - loSum) / hi - loSum / lo < MIN_CONTRAST) return null;
  // text is the minority: dark on light, or light on dark
  const isInk = lo <= hi ? (v) => v <= thr : (v) => v > thr;
  const inkAt = (x, y) => y >= y0 && y < y1 && isInk(data[y * width + x]);

  // The line's centre, column by column. A handheld photo is rarely square to
  // the page, and a couple of degrees over a long line carries the text out of
  // any fixed band of rows, which reads as gaps that aren't there. Fit a
  // straight line through the ink, then again through only the ink near it, so
  // a neighbouring line reaching into the padding doesn't drag it.
  let a = y0 + bh / 2;
  let slope = 0;
  for (const reach of [0.5, 0.3]) {
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let x = x0; x < x1; x += 2) {
      const c = a + slope * (x - x0);
      let n = 0;
      let my = 0;
      for (let y = Math.round(c - bh * reach); y < Math.round(c + bh * reach); y++)
        if (inkAt(x, y)) {
          n++;
          my += y;
        }
      if (!n) continue;
      my /= n;
      const dx = x - x0;
      sw += n;
      sx += n * dx;
      sy += n * my;
      sxx += n * dx * dx;
      sxy += n * dx * my;
    }
    if (!sw) break;
    const den = sw * sxx - sx * sx;
    // past about 12 degrees this is no longer a line of text being measured
    slope = den > 1e-9 ? Math.max(-0.21, Math.min(0.21, (sw * sxy - sx * sy) / den)) : 0;
    a = (sy - slope * sx) / sw;
  }
  const centre = (x) => a + slope * (x - x0);

  const half = Math.max(1, Math.round((bh * (BAND[1] - BAND[0])) / 2));
  const need = Math.max(1, Math.round(half * 2 * INK_FRAC));
  const cols = new Uint8Array(bw);
  for (let x = x0; x < x1; x++) {
    const c = Math.round(centre(x));
    let n = 0;
    for (let y = c - half; y < c + half; y++) if (inkAt(x, y)) n++;
    cols[x - x0] = n >= need ? 1 : 0;
  }
  return { x0, y0, y1, bh, cols, inkAt, centre };
}

// Pick `expected.length` of the gaps, in order, trading each gap's width
// against its distance from where the text says a space should be.
function chooseGaps(gaps, expected) {
  const m = expected.length;
  const G = gaps.length;
  if (m === 0) return Object.assign([], { score: 0 });
  if (G < m) return null;
  const gain = (k, j) => gaps[j].w - LAMBDA * Math.abs(gaps[j].c - expected[k]);
  // score[k][j]: best total with space k placed in gap j
  const score = Array.from({ length: m }, () => new Float64Array(G).fill(-Infinity));
  const from = Array.from({ length: m }, () => new Int32Array(G).fill(-1));
  for (let j = 0; j < G; j++) score[0][j] = gain(0, j);
  for (let k = 1; k < m; k++) {
    let bestPrev = -Infinity;
    let bestIdx = -1;
    for (let j = k; j < G; j++) {
      if (score[k - 1][j - 1] > bestPrev) {
        bestPrev = score[k - 1][j - 1];
        bestIdx = j - 1;
      }
      score[k][j] = bestPrev + gain(k, j);
      from[k][j] = bestIdx;
    }
  }
  let j = m - 1;
  for (let i = m; i < G; i++) if (score[m - 1][i] > score[m - 1][j]) j = i;
  const picked = Object.assign(new Array(m), { score: score[m - 1][j] });
  for (let k = m - 1; k >= 0; k--) {
    picked[k] = gaps[j];
    j = from[k][j];
  }
  return picked;
}

// The line's ink band as offsets from its fitted centre: the run of inked
// offsets around the centre, allowing small breaks (the dot of an i), so a
// neighbouring line reaching into the padding is left out. Measured against the
// tilted centre, so a slanted line's band is as thick as its letters, not as
// tall as its drift.
function band(ink, xa, xb) {
  const size = ink.bh * 2 + 1;
  const counts = new Uint32Array(size);
  for (let x = xa; x < xb; x++) {
    const c = Math.round(ink.centre(x));
    for (let y = ink.y0; y < ink.y1; y++) if (ink.inkAt(x, y)) counts[y - c + ink.bh]++;
  }
  const need = Math.max(1, Math.round((xb - xa) * 0.02));
  const has = (o) => o >= 0 && o < size && counts[o] >= need;
  let top = -1;
  for (let d = 0; d <= ink.bh && top < 0; d++) {
    if (has(ink.bh - d)) top = ink.bh - d;
    else if (has(ink.bh + d)) top = ink.bh + d;
  }
  if (top < 0) return null;
  let bottom = top;
  const allow = Math.max(1, Math.round(ink.bh * 0.07));
  for (let o = top - 1, gap = 0; o >= 0 && gap <= allow; o--) {
    if (has(o)) {
      top = o;
      gap = 0;
    } else gap++;
  }
  for (let o = bottom + 1, gap = 0; o < size && gap <= allow; o++) {
    if (has(o)) {
      bottom = o;
      gap = 0;
    } else gap++;
  }

  // Closely set lines can leave no empty row between one line's descenders and
  // the next one's ascenders, and a slanted line's box takes in more of its
  // neighbours. So cap the band by the letters' own proportions: the densest
  // rows are the x-height (or cap height), and ascenders and descenders reach
  // well under that height again beyond it.
  // the dense run through the fitted centre, which sits inside this line's
  // x-height rather than a neighbour's
  const mid = Math.max(top, Math.min(bottom, ink.bh));
  let peak = counts[mid];
  let coreTop = mid;
  let coreBottom = mid;
  while (coreTop > top && counts[coreTop - 1] >= peak * 0.3) peak = Math.max(peak, counts[--coreTop]);
  while (coreBottom < bottom && counts[coreBottom + 1] >= peak * 0.3) peak = Math.max(peak, counts[++coreBottom]);
  const coreH = coreBottom - coreTop + 1;
  top = Math.max(top, coreTop - Math.round(coreH * 0.75));
  bottom = Math.min(bottom, coreBottom + Math.round(coreH * 0.65));
  return [top - ink.bh, bottom + 1 - ink.bh];
}

// One box and its text -> [{ t, x, y, w, h }], left to right on screen.
// `padded` says whether the box carries PaddleOCR's detection padding;
// tesseract's line boxes don't.
//
// Every word on a box shares the box's band of rows, placed on the fitted
// centre at that word, so a highlight keeps one height along a line and steps
// with its tilt instead of growing to cover it.
export function locateWords(text, box, gray, { padded = true } = {}) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const rawH = padded ? box.height / (1 + 2 * PAD_Y) : box.height;
  const inset = padded ? Math.min(PAD_X * rawH, box.width * 0.25) : 0;
  const guess = () =>
    estimate(tokens, box.x + inset, box.x + box.width - inset).map(([a, b], i) => ({
      t: tokens[i],
      x: Math.round(a),
      y: Math.round(padded ? box.y + (PAD_Y - 0.1) * rawH : box.y),
      w: Math.max(1, Math.round(b - a)),
      h: Math.round(padded ? rawH * 1.2 : box.height),
    }));

  const ink = gray ? inkIn(gray, box) : null;
  if (!ink) return guess();
  const { x0 } = ink;
  const bw = ink.cols.length;
  // where the line's ink starts and ends, judged from its centre rows
  let L = 0;
  while (L < bw && !ink.cols[L]) L++;
  let R = bw - 1;
  while (R > L && !ink.cols[R]) R--;
  if (L >= R) return guess();

  const offs = band(ink, x0 + L, x0 + R + 1);
  if (!offs) return guess();
  const [top, bottom] = offs;

  // Columns with ink anywhere in the line's band. The centre rows alone miss
  // whatever sits above or below them: an underscore leaves a gap there as wide
  // as a space, and a comma or the bar of a T falls outside its word. The band
  // stops short of neighbouring lines, so they can't fill a gap in.
  const need = Math.max(1, Math.round((bottom - top) * BAND_INK_FRAC));
  const cols = new Uint8Array(bw);
  for (let i = 0; i < bw; i++) {
    const c = Math.round(ink.centre(x0 + i));
    let n = 0;
    for (let y = c + top; y < c + bottom; y++) if (ink.inkAt(x0 + i, y)) n++;
    cols[i] = n >= need ? 1 : 0;
  }
  // a little past the centre rows' extent, not into text beside the box
  const reach = Math.round((bottom - top) * 0.5);
  for (let i = Math.max(0, L - reach); i < L; i++)
    if (cols[i]) {
      L = i;
      break;
    }
  for (let i = Math.min(bw - 1, R + reach); i > R; i--)
    if (cols[i]) {
      R = i;
      break;
    }

  const gaps = [];
  for (let x = L; x <= R; x++) {
    if (cols[x]) continue;
    const s = x;
    while (x <= R && !cols[x]) x++;
    gaps.push({ s, e: x - 1, w: x - s, c: (s + x - 1) / 2 });
  }
  let picked = null;
  for (const font of FONTS) {
    const est = estimate(tokens, L, R + 1, font);
    const expected = est.slice(0, -1).map(([, b], i) => (b + est[i + 1][0]) / 2);
    const p = chooseGaps(gaps, expected);
    if (p && (!picked || p.score > picked.score)) picked = p;
  }
  if (!picked) return guess();

  const out = [];
  let from = L;
  for (let k = 0; k < tokens.length; k++) {
    const to = k < picked.length ? picked[k].s : R + 1;
    const ax = x0 + from;
    const bx = x0 + to;
    out.push({ t: tokens[k], x: ax, y: Math.round(ink.centre((ax + bx) / 2) + top), w: bx - ax, h: bottom - top });
    if (k < picked.length) from = picked[k].e + 1;
  }
  return out;
}

// RGBA pixels -> one grey byte per pixel.
export function toGray({ data, width, height }) {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  return { data: out, width, height };
}
