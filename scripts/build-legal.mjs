// Turns the legal documents into pages of the website: /privacy/, /terms/ and
// /licenses/. The markdown stays the single source (it reads fine on GitHub too,
// and its history is the public record of every change). The pages are plain,
// script-free HTML in the site's colours, written into dist-site/ after Vite has
// built the landing page (`npm run build:site`).
import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const root = path.resolve(import.meta.dirname, '..');

export const PAGES = [
  { slug: 'privacy', src: 'docs/legal/privacy.md', title: 'Privacy policy', blurb: 'What CopyCam and this website do and do not collect.' },
  { slug: 'terms', src: 'docs/legal/terms.md', title: 'Terms of use', blurb: 'The terms for using CopyCam and this website.' },
  { slug: 'licenses', src: 'THIRD_PARTY_NOTICES.md', title: 'Third-party licences', blurb: 'The open-source software CopyCam is built on, and its licences.' },
  { slug: 'accessibility', src: 'docs/legal/accessibility.md', title: 'Accessibility statement', blurb: 'How accessible CopyCam and this website are, and how to report a problem.', alternate: 'he/accessibility' },
  { slug: 'he/accessibility', src: 'docs/legal/accessibility.he.md', lang: 'he', title: 'הצהרת נגישות', blurb: 'עד כמה CopyCam והאתר נגישים, ואיך לדווח על בעיה.', alternate: 'accessibility' },
];

const CSS = `
:root{--ink:#161616;--mid:#55554f;--soft:#6b6b64;--bg:#f1f0ec;--card:#fff;--accent:#CFFF3B}
@media (prefers-color-scheme:dark){:root{--ink:#f1f0ec;--mid:#c9c8c1;--soft:#9a9a92;--bg:#161616;--card:#1f1f1d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,'Helvetica Neue',system-ui,sans-serif}
a{color:var(--ink)}a:hover{color:var(--soft)}
.wrap{max-width:720px;margin:0 auto;padding:28px 20px 56px}
.logo{display:inline-block;font-weight:800;font-size:24px;letter-spacing:-.8px;text-decoration:none;color:var(--ink)}
.logo b{background:var(--accent);color:#161616;padding:1px 7px 3px;border-radius:8px;margin-left:2px}
main{background:var(--card);border-radius:18px;padding:8px 26px 26px;margin-top:22px}
h1{font-size:30px;letter-spacing:-1px;line-height:1.15;margin:24px 0 4px}
h2{font-size:20px;letter-spacing:-.4px;margin:30px 0 6px}
h3{font-size:16px;margin:22px 0 4px}
p,li{color:var(--mid)}
strong{color:var(--ink)}
em{color:var(--soft)}
code{font:13.5px ui-monospace,Menlo,monospace;background:var(--bg);border-radius:5px;padding:1px 5px;word-break:break-word}
pre{background:var(--bg);border-radius:10px;padding:12px 14px;overflow-x:auto}
pre code{background:none;padding:0;white-space:pre}
ul{padding-inline-start:22px}
code{unicode-bidi:isolate}
footer{margin-top:26px;display:flex;flex-wrap:wrap;gap:8px 20px;font:12px ui-monospace,Menlo,monospace;color:var(--soft)}
footer a{color:var(--mid)}
@media (max-width:520px){main{padding:4px 18px 22px}h1{font-size:26px}}
`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function renderPage({ slug, title, blurb, html, lang = 'en', alternate }) {
  const url = `https://copycam.app/${slug}/`;
  const other = lang === 'he' ? 'en' : 'he';
  const alt = alternate
    ? `<link rel="alternate" hreflang="${lang}" href="${url}">
<link rel="alternate" hreflang="${other}" href="https://copycam.app/${alternate}/">
`
    : '';
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'he' ? 'rtl' : 'ltr'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · CopyCam</title>
<meta name="description" content="${esc(blurb)}">
<meta name="theme-color" content="#f1f0ec">
<link rel="canonical" href="${url}">
${alt}<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<a class="logo" href="/" aria-label="CopyCam home">Copy<b>Cam</b></a>
<main>
${html}
</main>
<footer>
${PAGES.map((p) => `<a href="/${p.slug}/"${p.lang ? ` lang="${p.lang}"` : ''}>${esc(p.title)}</a>`).join('\n')}
<a href="https://github.com/copycam/copycam">GitHub</a>
<a href="mailto:hello@copycam.app">hello@copycam.app</a>
</footer>
</div>
</body>
</html>
`;
}

export function buildLegal({ outDir = path.join(root, 'dist-site'), srcRoot = root } = {}) {
  const written = [];
  for (const page of PAGES) {
    const md = fs.readFileSync(path.join(srcRoot, page.src), 'utf8');
    const html = marked.parse(md, { gfm: true });
    const dir = path.join(outDir, page.slug);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, renderPage({ ...page, html }));
    written.push(file);
  }
  return written;
}

if (process.argv[1]?.endsWith('build-legal.mjs')) {
  for (const f of buildLegal()) console.log(`wrote ${path.relative(root, f)}`);
}
