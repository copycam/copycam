// @vitest-environment node
// Both phone clients offer the same script picker, and both send the chosen id
// to the server, which maps it to an OCR model. The native app can't import the
// browser build's list, so it keeps a copy — and a copy drifts silently: an id
// the server doesn't know falls back to the default model without any error,
// which would read as "the picker does nothing". Check all three agree.
import { describe, it, expect } from 'vitest';
import { SCRIPTS as webScripts } from '../src/mobile/scripts.js';
import { SCRIPTS as appScripts, DEFAULT_SCRIPT } from '../mobile/src/lib/scripts.ts';
import { SCRIPTS as serverModels } from '../server/ocr.js';

describe('script picker agreement', () => {
  it('the app offers exactly what the browser build offers', () => {
    expect(appScripts).toEqual(webScripts);
  });

  it('every script offered is a model the server has', () => {
    for (const { id } of appScripts) expect(serverModels).toContain(id);
  });

  it('both default to the unified model', () => {
    expect(DEFAULT_SCRIPT).toBe('auto');
    expect(appScripts[0].id).toBe('auto');
  });
});
