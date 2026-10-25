// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGES, buildLegal } from './build-legal.mjs';
import { buildNotices } from './make-notices.mjs';

const root = path.resolve(import.meta.dirname, '..');
let out;
afterEach(() => out && fs.rmSync(out, { recursive: true, force: true }));

describe('legal pages', () => {
  it('builds a page for every document, as /slug/index.html', () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-legal-'));
    const files = buildLegal({ outDir: out });
    expect(files).toHaveLength(PAGES.length);
    for (const page of PAGES) {
      const html = fs.readFileSync(path.join(out, page.slug, 'index.html'), 'utf8');
      expect(html).toContain(`<title>${page.title} · CopyCam</title>`);
      expect(html).toContain(`rel="canonical" href="https://copycam.app/${page.slug}/"`);
      expect(html).toContain('<h1>');
    }
  });

  it('builds the Hebrew accessibility statement right-to-left, linked to the English one', () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-legal-'));
    buildLegal({ outDir: out });
    const he = fs.readFileSync(path.join(out, 'he', 'accessibility', 'index.html'), 'utf8');
    expect(he).toContain('<html lang="he" dir="rtl">');
    expect(he).toContain('<title>הצהרת נגישות · CopyCam</title>');
    expect(he).toContain('hreflang="en" href="https://copycam.app/accessibility/"');
    const en = fs.readFileSync(path.join(out, 'accessibility', 'index.html'), 'utf8');
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(en).toContain('hreflang="he" href="https://copycam.app/he/accessibility/"');
    // both statements name the same contact, so neither can drift from the other
    expect(he).toContain('hello@copycam.app');
    expect(en).toContain('hello@copycam.app');
    expect(he).toContain('tel:+972549742062');
    expect(en).toContain('tel:+972549742062');
    expect(he).toContain('סאפי חזאן');
  });

  it('pages carry no scripts and load nothing from other sites, so the strict CSP holds', () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-legal-'));
    buildLegal({ outDir: out });
    for (const page of PAGES) {
      const html = fs.readFileSync(path.join(out, page.slug, 'index.html'), 'utf8');
      expect(html).not.toMatch(/<script|<iframe|<img|<link[^>]+stylesheet|@import/i);
    }
  });

  it('the privacy policy names who runs CopyCam and how to reach them', () => {
    const md = fs.readFileSync(path.join(root, 'docs/legal/privacy.md'), 'utf8');
    expect(md).toContain('Safi Hazzan');
    expect(md).toContain('hello@copycam.app');
  });

  it('every page the site footer and sitemap point to exists', () => {
    const sitemap = fs.readFileSync(path.join(root, 'site/public/sitemap.xml'), 'utf8');
    for (const page of PAGES) expect(sitemap).toContain(`https://copycam.app/${page.slug}/`);
    expect(fs.readFileSync(path.join(root, 'site/public/robots.txt'), 'utf8')).toContain('Sitemap: https://copycam.app/sitemap.xml');
  });
});

describe('third-party notices', () => {
  it('THIRD_PARTY_NOTICES.md is up to date with the lockfile (run `npm run notices`)', () => {
    expect(fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toBe(buildNotices());
  });

  it('reproduces the licence text of everything bundled into the web build', () => {
    const md = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const bundled = ['react', 'react-dom', 'scheduler', '@noble/ciphers', 'onnxruntime-web', 'ppu-paddle-ocr', 'ppu-ocv', 'zxing-wasm', 'qrcode'];
    for (const name of bundled) expect(md).toContain('### ' + name + ' ');
    expect(md).not.toContain('licence file not found');
  });

  it('lists only licences that are compatible with the GPL-3.0', () => {
    const md = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const used = [...md.matchAll(/^### (.+) \((\d+)\)$/gm)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(3); // the headings were found, so the check below means something
    // MPL-2.0 is compatible with the GPL-3.0 unless its code is marked
    // "Incompatible With Secondary Licenses" (mediabunny, through werift, is not)
    const fine = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', '(MIT OR CC0-1.0)', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0', 'Python-2.0', 'MIT-0', 'MPL-2.0']);
    expect(used.filter((l) => !fine.has(l))).toEqual([]);
  });
});
