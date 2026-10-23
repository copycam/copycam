// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toFrames, createAssembler, roomFor, splitRouted, PART_CHARS, ADDRESS } from './relay.js';

describe('frames', () => {
  it('carries a small message in one frame', () => {
    const frames = toFrames({ id: 'a', ep: 'hello' }, { n: 'x', c: 'y' });
    expect(frames).toHaveLength(1);
    const done = createAssembler().push(frames[0]);
    expect(done.head).toEqual({ id: 'a', ep: 'hello' });
    expect(JSON.parse(done.body)).toEqual({ n: 'x', c: 'y' });
  });

  it('splits a photo-sized message and puts it back together in any order', () => {
    const body = 'x'.repeat(PART_CHARS * 3 + 17);
    const frames = toFrames({ id: 'b', st: 200 }, body);
    expect(frames).toHaveLength(4);
    const a = createAssembler();
    expect(a.push(frames[2])).toBeNull();
    expect(a.push(frames[0])).toBeNull();
    expect(a.push(frames[0])).toBeNull(); // a repeat changes nothing
    expect(a.push(frames[3])).toBeNull();
    const done = a.push(frames[1]);
    expect(done.head).toEqual({ id: 'b', st: 200 });
    expect(done.body).toBe(body);
    expect(a.pending).toBe(0);
  });

  it('refuses frames that cannot be part of a message', () => {
    const a = createAssembler();
    expect(() => a.push('not json')).toThrow();
    expect(() => a.push(JSON.stringify({ id: '', i: 0, n: 1, d: '' }))).toThrow();
    expect(() => a.push(JSON.stringify({ id: 'x', i: 2, n: 2, d: '' }))).toThrow();
    expect(() => a.push(JSON.stringify({ id: 'x', i: 0, n: 100000, d: '' }))).toThrow();
    expect(() => a.push(JSON.stringify({ id: 'x', i: 0, n: 1, d: 'y'.repeat(PART_CHARS + 1) }))).toThrow();
  });

  it('never holds more than its limit between unfinished messages', () => {
    const a = createAssembler({ maxChars: PART_CHARS * 2 });
    const frames = toFrames({ id: 'big' }, 'z'.repeat(PART_CHARS * 2));
    a.push(frames[0]);
    const other = toFrames({ id: 'more' }, 'z'.repeat(PART_CHARS * 2));
    a.push(other[0]);
    expect(() => a.push(frames[1])).toThrow(/too large/);
  });

  it('gives up on a message that stops arriving', () => {
    const a = createAssembler({ ttlMs: 1000 });
    const frames = toFrames({ id: 'slow' }, 'q'.repeat(PART_CHARS + 1));
    a.push(frames[0], 0);
    expect(a.pending).toBe(1);
    // the rest turns up too late: it starts a new message rather than finishing the old
    expect(a.push(frames[1], 5000)).toBeNull();
    expect(a.pending).toBe(1);
  });
});

describe('rooms', () => {
  it('derives a fixed, address-shaped room from the computer’s secret', async () => {
    const room = await roomFor('a'.repeat(43));
    expect(room).toBe(await roomFor('a'.repeat(43)));
    expect(room).not.toBe(await roomFor('b'.repeat(43)));
    expect(room).toMatch(ADDRESS);
    expect(room).toHaveLength(22);
  });

  it('reads the sender off a routed message', () => {
    expect(splitRouted('ab12cd34\n{"x":1}')).toEqual({ from: 'ab12cd34', frame: '{"x":1}' });
    expect(splitRouted('*\n{"pc":true}')).toEqual({ from: '*', frame: '{"pc":true}' });
    expect(splitRouted('no newline')).toBeNull();
    expect(splitRouted('\nleading')).toBeNull();
  });
});
