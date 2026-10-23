import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import HostApp from './HostApp.jsx';
import { seal, open, fromB64u } from '../../shared/crypto.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

function fakeReader() {
  let listener = () => {};
  return {
    onProgress(fn) {
      listener = fn;
      fn({ loaded: 0, total: 0, ready: false, failed: null });
      return () => {};
    },
    set: (state) => listener(state),
    ocr: vi.fn(async () => ({ words: [{ t: 'hi' }], lineCount: 1, rotation: 0 })),
    wifi: vi.fn(async () => null),
    retry: vi.fn(),
  };
}

// The relay, as the page sees it: we keep the handle it was given and push
// status updates as the relay would.
function fakeConnect() {
  const line = { close: vi.fn() };
  const connect = vi.fn((opts) => {
    connect.opts = opts;
    return line;
  });
  return connect;
}

const nav = (writeText) => ({ platform: 'MacIntel', userAgent: '', clipboard: { writeText } });

describe('HostApp', () => {
  let storage;
  beforeEach(() => {
    storage = memoryStorage();
    document.title = 'CopyCam';
  });

  it('shows the pairing code and the reader’s download progress', async () => {
    const reader = fakeReader();
    render(<HostApp reader={reader} connect={fakeConnect()} storage={storage} nav={nav(vi.fn())} />);
    expect(screen.getByText('Scan this with your phone')).toBeInTheDocument();
    expect(await screen.findByAltText(/pairing code/i)).toBeInTheDocument();
    act(() => reader.set({ loaded: 20e6, total: 44e6, ready: false, failed: null }));
    expect(screen.getByText(/20 MB of 44 MB/)).toBeInTheDocument();
    act(() => reader.set({ loaded: 44e6, total: 44e6, ready: true, failed: null }));
    expect(screen.getByText(/text reader ready/i)).toBeInTheDocument();
  });

  it('answers a linked phone with the computer’s name', async () => {
    const connect = fakeConnect();
    render(<HostApp reader={fakeReader()} connect={connect} storage={storage} nav={nav(vi.fn())} />);
    const key = fromB64u(JSON.parse(storage.getItem('copycam:host')).k);
    const res = await connect.opts.handle('hello', seal(key, {}, 'hello'));
    expect(open(key, res.body, 'hello-ack')).toMatchObject({ name: 'your Mac', scripts: ['auto'] });
  });

  it('copies at once while the tab is in front', async () => {
    const writeText = vi.fn(async () => {});
    const connect = fakeConnect();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    render(<HostApp reader={fakeReader()} connect={connect} storage={storage} nav={nav(writeText)} />);
    const key = fromB64u(JSON.parse(storage.getItem('copycam:host')).k);
    let res;
    await act(async () => {
      res = await connect.opts.handle('clip', seal(key, { text: 'hello there' }, 'clip'));
    });
    expect(writeText).toHaveBeenCalledWith('hello there');
    expect(open(key, res.body, 'clip-ack').pending).toBeUndefined();
    expect(screen.getByText('Copied ✓')).toBeInTheDocument();
    document.hasFocus.mockRestore();
  });

  it('holds the text for a click while the tab is behind, and copies when it comes back', async () => {
    const writeText = vi.fn(async () => {});
    const connect = fakeConnect();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    render(<HostApp reader={fakeReader()} connect={connect} storage={storage} nav={nav(writeText)} />);
    const key = fromB64u(JSON.parse(storage.getItem('copycam:host')).k);
    let res;
    await act(async () => {
      res = await connect.opts.handle('clip', seal(key, { text: 'later' }, 'clip'));
    });
    expect(open(key, res.body, 'clip-ack').pending).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(document.title).toMatch(/text ready/i);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();

    document.hasFocus.mockReturnValue(true);
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(writeText).toHaveBeenCalledWith('later');
    expect(screen.getByText('Copied ✓')).toBeInTheDocument();
    document.hasFocus.mockRestore();
  });

  it('explains when the browser refuses to copy', async () => {
    const connect = fakeConnect();
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    render(<HostApp reader={fakeReader()} connect={connect} storage={storage} nav={nav(vi.fn(async () => Promise.reject(new Error('no'))))} />);
    const key = fromB64u(JSON.parse(storage.getItem('copycam:host')).k);
    await act(async () => {
      await connect.opts.handle('clip', seal(key, { text: 'stuck' }, 'clip'));
    });
    document.execCommand = vi.fn(() => false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(screen.getByText(/won’t let the page copy/)).toBeInTheDocument();
    document.hasFocus.mockRestore();
  });

  it('offers to take over when CopyCam is opened in another tab', async () => {
    const connect = fakeConnect();
    render(<HostApp reader={fakeReader()} connect={connect} storage={storage} nav={nav(vi.fn())} />);
    act(() => connect.opts.onStatus({ online: false, phones: 0, replaced: true }));
    const button = screen.getByRole('button', { name: /use this tab instead/i });
    const calls = connect.mock.calls.length;
    fireEvent.click(button);
    expect(connect.mock.calls.length).toBe(calls + 1);
  });
});
