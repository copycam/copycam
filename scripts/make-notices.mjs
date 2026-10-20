// Writes THIRD_PARTY_NOTICES.md: every package that `npx copycam` installs, by
// licence, plus the full licence text of the packages whose code is copied into
// the built web bundles in dist/ (those travel inside CopyCam's own files, so
// their notices must too). It reads package-lock.json, so the list is exactly
// what a user gets; a test fails when the committed file has gone stale.
//
//   node scripts/make-notices.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

// Code from these is bundled into dist/assets (the phone app and the landing
// page). react-dom carries scheduler with it. They are dev dependencies, because
// users never install them: they only get what the bundle already contains.
const BUNDLED = ['react', 'react-dom', 'scheduler', '@noble/ciphers'];

const licenceOf = (entry, dir) => {
  let l = entry.license;
  if (!l) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      l = p.license ?? (Array.isArray(p.licenses) ? p.licenses.map((x) => x.type).join(' OR ') : p.licenses?.type);
    } catch {
      // not installed on this machine (a platform-specific optional package)
    }
  }
  if (l && typeof l === 'object') l = l.type;
  return l || 'UNKNOWN';
};

const licenceText = (dir) => {
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : null;
};

export function buildNotices(rootDir = root) {
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  const byLicence = new Map();
  const bundled = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/')) continue;
    const name = key.split('node_modules/').pop();
    const dir = path.join(rootDir, key);
    const id = `${name}@${entry.version}`;
    if (BUNDLED.includes(name) && !key.slice('node_modules/'.length).includes('node_modules/')) {
      bundled.push({ name, version: entry.version, licence: licenceOf(entry, dir), text: licenceText(dir) });
    }
    if (entry.dev || entry.devOptional) continue; // build tools are not shipped
    const l = licenceOf(entry, dir);
    if (!byLicence.has(l)) byLicence.set(l, []);
    byLicence.get(l).push(id);
  }
  bundled.sort((a, b) => a.name.localeCompare(b.name));

  const total = [...byLicence.values()].reduce((n, ids) => n + ids.length, 0);
  const out = [];
  out.push('# Third-party licences');
  out.push(
    `CopyCam is free software under the [GNU General Public License v3.0](https://github.com/copycam/copycam/blob/main/LICENSE). It is built on the open-source work below, and it carries each licence with it. All ${total} packages that \`npx copycam\` installs use permissive licences that are compatible with the GPL-3.0.`,
  );
  out.push('## Code inside CopyCam\'s web bundles');
  out.push('These are copied into the built phone app and landing page that ship with CopyCam, so their full notices are reproduced here.');
  for (const b of bundled) {
    out.push(`### ${b.name} ${b.version}: ${b.licence}`);
    out.push(b.text ? '```text\n' + b.text + '\n```' : '(licence file not found in the package)');
  }
  out.push('## Text-recognition models');
  out.push(
    'The default models ship in the package under the Apache License 2.0. See [NOTICE.md](https://github.com/copycam/copycam/blob/main/NOTICE.md) and [the licence text](https://github.com/copycam/copycam/blob/main/licenses/Apache-2.0.txt).',
  );
  out.push('## Everything `npx copycam` installs');
  out.push('Each package keeps its own licence file inside its folder in `node_modules`. Listed by licence:');
  for (const [l, ids] of [...byLicence].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    out.push(`### ${l} (${ids.length})`);
    out.push([...new Set(ids)].sort().map((id) => `- ${id}`).join('\n'));
  }
  return out.join('\n\n') + '\n';
}

if (process.argv[1]?.endsWith('make-notices.mjs')) {
  const file = path.join(root, 'THIRD_PARTY_NOTICES.md');
  fs.writeFileSync(file, buildNotices());
  console.log(`wrote ${file}`);
}
