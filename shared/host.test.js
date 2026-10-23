// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createHost } from './host.js';
import { seal, open, newKey, toB64u } from './crypto.js';

// The HTTP side of the host is covered through server/app.test.js; these are
// the parts only the browser tab uses.
const key = newKey();
const make = (deps = {}, info) =>
  createHost({
    key,
    name: 'your PC',
    info,
    deps: { ocr: vi.fn(), clipboard: vi.fn(), ...deps },
  });

describe('createHost', () => {
  it('tells the phone what the reader can read', async () => {
    const handle = make({}, { scripts: ['auto'] });
    const res = await handle('hello', seal(key, {}, 'hello'));
    expect(res.status).toBe(200);
    expect(open(key, res.body, 'hello-ack')).toMatchObject({ name: 'your PC', scripts: ['auto'] });
  });

  it('says when the text is waiting for a click on the computer', async () => {
    const onEvent = vi.fn();
    const handle = make({ clipboard: async () => ({ copied: false }), onEvent });
    const res = await handle('clip', seal(key, { text: 'hi' }, 'clip'));
    expect(open(key, res.body, 'clip-ack')).toMatchObject({ ok: true, pending: true });
    expect(onEvent).toHaveBeenCalledWith({ type: 'copied', chars: 2, pending: true });
  });

  it('hands the reader the photo as bytes', async () => {
    const ocr = vi.fn(async () => ({ words: [], lineCount: 0 }));
    const handle = make({ ocr });
    await handle('ocr', seal(key, { img: toB64u(new Uint8Array([1, 2, 3])) }, 'ocr'));
    expect(ocr.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect([...ocr.mock.calls[0][0]]).toEqual([1, 2, 3]);
  });

  it('turns away a replay, an unknown endpoint and a missing box', async () => {
    const handle = make();
    const box = seal(key, {}, 'hello');
    expect((await handle('hello', box)).status).toBe(200);
    expect((await handle('hello', box)).status).toBe(400);
    expect((await handle('steal', box)).status).toBe(404);
    expect((await handle('toString', box)).status).toBe(404);
    expect((await handle('clip', null)).status).toBe(400);
  });
});
