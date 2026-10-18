import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Model files shipped inside the npm package (see scripts/fetch-models.mjs).
// A checkout that has not run `npm run models` has no such folder, and every
// model then downloads on first use exactly as before.
export const BUNDLED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');

// Swap each model URL for the bundled copy of the same file, where there is
// one. The library loads a path as a local file and a URL by downloading it, so
// a script whose files are bundled reads with no network at all.
export function withBundled(model, dir = BUNDLED_DIR) {
  const out = {};
  for (const [key, source] of Object.entries(model)) {
    const local = /^https?:\/\//.test(source) ? path.join(dir, path.basename(new URL(source).pathname)) : null;
    out[key] = local && fs.existsSync(local) ? local : source;
  }
  return out;
}
