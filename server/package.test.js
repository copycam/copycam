import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// The package names the companion imports when it runs, tests excluded.
function runtimeImports() {
  const found = new Set();
  for (const dir of ['server', 'shared']) {
    for (const file of fs.readdirSync(path.join(root, dir))) {
      if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
      const src = fs.readFileSync(path.join(root, dir, file), 'utf8');
      for (const m of src.matchAll(/(?:from|import\()\s*['"]([^./'"][^'"]*)['"]/g)) {
        if (m[1].startsWith('node:')) continue;
        const parts = m[1].split('/');
        found.add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
      }
    }
  }
  return [...found].sort();
}

describe('published package', () => {
  it('lists every package the companion imports as a real dependency', () => {
    // a dev-only package would work from a checkout and fail under `npx copycam`
    const missing = runtimeImports().filter((name) => !pkg.dependencies?.[name]);
    expect(missing).toEqual([]);
  });

  it('has a CLI entry that starts with a shebang and keeps LF line endings', () => {
    expect(pkg.private).not.toBe(true);
    const entry = fs.readFileSync(path.join(root, pkg.bin.copycam), 'utf8');
    expect(entry.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(entry).not.toContain('\r');
  });

  it('ships the companion and the built phone app, and leaves the tests out', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['server/', 'shared/', 'dist/', 'models/', 'licenses/', 'LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md']));
    expect(pkg.files).toContain('!**/*.test.js');
    // dist/ and models/ are not committed, so every pack has to produce them
    expect(pkg.scripts.prepack).toContain('scripts/fetch-models.mjs');
    expect(pkg.scripts.prepack).toContain('npm run build');
  });

  it('has release notes for the version being published', () => {
    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('## ' + pkg.version + '\n');
    // newest first: the current version is the first entry
    expect(changelog.match(/^## (\S+)$/m)[1]).toBe(pkg.version);
  });

  it('declares the licence that the LICENSE file carries', () => {
    expect(pkg.license).toBe('GPL-3.0-only');
    expect(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE');
  });
});
