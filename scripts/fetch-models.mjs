#!/usr/bin/env node
// Put the default OCR model into ./models so it ships inside the npm package and
// a first scan makes no network connection. Runs from `prepack`; run it by hand
// with `npm run models`. The folder is git-ignored: 31 MB of binaries do not
// belong in the history, and every file is checked against scripts/model-hashes.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { V6_SMALL_MODEL } from 'ppu-paddle-ocr';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'models');
const cache = path.join(os.homedir(), '.cache', 'ppu-paddle-ocr');
const pinned = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'model-hashes.json'), 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

fs.mkdirSync(dir, { recursive: true });
for (const url of Object.values(V6_SMALL_MODEL)) {
  const name = path.basename(new URL(url).pathname);
  const want = pinned[name];
  if (!want) throw new Error(`No pinned hash for ${name}: check the file, then add it to scripts/model-hashes.json`);
  const matches = (file) => fs.existsSync(file) && sha256(fs.readFileSync(file)) === want;

  const dest = path.join(dir, name);
  if (matches(dest)) {
    console.log(`${name}: already in models/`);
  } else if (matches(path.join(cache, name))) {
    fs.copyFileSync(path.join(cache, name), dest);
    console.log(`${name}: copied from the model cache`);
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: ${res.status} from ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== want) throw new Error(`${name} does not match its pinned hash; not shipping it`);
    fs.writeFileSync(dest, buf);
    console.log(`${name}: downloaded`);
  }
}
