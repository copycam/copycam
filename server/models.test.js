import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withBundled } from './models.js';

const URL_DET = 'https://example.test/media/detection/ort/PP-OCRv6_small_det.ort';
const URL_DICT = 'https://example.test/raw/recognition/ppocrv6_dict.txt';
let dir;

afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

describe('withBundled', () => {
  it('points at a bundled file when one of that name exists, and keeps the URL when not', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-models-'));
    fs.writeFileSync(path.join(dir, 'PP-OCRv6_small_det.ort'), 'x');
    const out = withBundled({ detection: URL_DET, charactersDictionary: URL_DICT }, dir);
    expect(out.detection).toBe(path.join(dir, 'PP-OCRv6_small_det.ort'));
    expect(out.charactersDictionary).toBe(URL_DICT);
  });

  it('leaves everything as a download when the folder is missing (a plain checkout)', () => {
    const model = { detection: URL_DET, charactersDictionary: URL_DICT };
    expect(withBundled(model, path.join(os.tmpdir(), 'cc-no-such-models-dir'))).toEqual(model);
  });

  it('does not touch values that are already local paths', () => {
    const local = path.join(os.tmpdir(), 'somewhere', 'det.onnx');
    expect(withBundled({ detection: local }, os.tmpdir())).toEqual({ detection: local });
  });
});
