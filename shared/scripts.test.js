// @vitest-environment node
// The browser build's script picker sends an id to the server, which maps it to
// an OCR model. An id the server doesn't know falls back to the default model
// without any error, which would read as "the picker does nothing", so check
// that every id on offer is a model the server has.
import { describe, it, expect } from 'vitest';
import { SCRIPTS as webScripts } from '../src/mobile/scripts.js';
import { SCRIPTS as serverModels } from '../server/ocr.js';

describe('script picker agreement', () => {
  it('every script offered is a model the server has', () => {
    for (const { id } of webScripts) expect(serverModels).toContain(id);
  });

  it('defaults to the unified model', () => {
    expect(webScripts[0].id).toBe('auto');
  });
});
