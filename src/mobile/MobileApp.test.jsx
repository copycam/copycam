import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const api = { loadKey: vi.fn(), forgetKey: vi.fn(), call: vi.fn() };
vi.mock('./api.js', async (importOriginal) => ({
  // keep the real error classifiers; only the network-facing calls are stubbed
  ...(await importOriginal()),
  loadKey: (...a) => api.loadKey(...a),
  forgetKey: (...a) => api.forgetKey(...a),
  call: (...a) => api.call(...a),
}));

import { CallError } from './api.js';

import MobileApp from './MobileApp.jsx';

const KEY = new Uint8Array(32).fill(1);

describe('MobileApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); // the script picker persists its choice
  });

  it('shows pairing instructions when no key is present', () => {
    api.loadKey.mockReturnValue(null);
    render(<MobileApp />);
    expect(screen.getByText(/scan the qr code it shows/i)).toBeInTheDocument();
  });

  it('links via hello and shows the idle camera screen', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    render(<MobileApp />);

    expect(await screen.findByText('MY-PC — linked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /take photo of text/i })).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(KEY, 'hello', {});
  });

  it('starts the live viewfinder when the camera is available', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    const stop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop }] };
    navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(fakeStream) };

    const { unmount } = render(<MobileApp />);
    await screen.findByText('MY-PC — linked');
    expect(await screen.findByText(/frame the text, then tap the shutter/i)).toBeInTheDocument();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({ video: expect.objectContaining({ facingMode: 'environment' }) }),
    );

    unmount();
    expect(stop).toHaveBeenCalled(); // stream released on unmount
    delete navigator.mediaDevices;
  });

  it('shows a flash toggle only when the camera exposes torch, and applies it', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    const applyConstraints = vi.fn().mockResolvedValue();
    const track = { stop: vi.fn(), getCapabilities: () => ({ torch: true }), applyConstraints };
    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] }),
    };

    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    const flash = await screen.findByRole('button', { name: /turn flash on/i });
    fireEvent.click(flash);
    await screen.findByRole('button', { name: /turn flash off/i });
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });

    delete navigator.mediaDevices;
  });

  it('offers the camera-app route instead when torch is unsupported (iOS)', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    const track = { stop: vi.fn(), getCapabilities: () => ({}) }; // no torch
    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] }),
    };

    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    expect(screen.queryByRole('button', { name: /turn flash on/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /open the camera app, which has flash/i })).toBeInTheDocument();

    delete navigator.mediaDevices;
  });

  it('sends the chosen script with the scan so mixed-language text works', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockImplementation(async (_key, endpoint) => {
      if (endpoint === 'ocr') return { words: [{ t: 'Пароль', x: 0, y: 0, w: 40, h: 20, li: 0, pi: 0 }] };
      return { name: 'MY-PC' };
    });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    fireEvent.click(screen.getByRole('button', { name: /change text language/i }));
    fireEvent.click(await screen.findByText('Cyrillic'));

    // the picker closes and the pill reflects the choice
    expect(await screen.findByRole('button', { name: /change text language/i })).toHaveTextContent('Cyrillic');

    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    const origImage = globalThis.Image;
    globalThis.Image = class {
      set src(_v) {
        this.naturalWidth = 100;
        this.naturalHeight = 50;
        setTimeout(() => this.onload());
      }
    };
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    };
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });

    fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'p.jpg')] } });

    await screen.findByRole('button', { name: /send to MY-PC/i });
    expect(api.call).toHaveBeenCalledWith(KEY, 'ocr', expect.objectContaining({ script: 'cyrillic' }));

    globalThis.Image = origImage;
  });

  it('parks the shutter on the right edge in landscape', async () => {
    const [w, h] = [window.innerWidth, window.innerHeight];
    window.innerWidth = 844;
    window.innerHeight = 390;
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    const shutter = screen.getByRole('button', { name: /take photo of text/i });
    expect(shutter.style.top).toBe('50%'); // vertically centred on the side
    expect(shutter.style.transform).toBe('translateY(-50%)');
    expect(shutter.style.left).toBe('');

    window.innerWidth = w;
    window.innerHeight = h;
  });

  it('keeps the shutter bottom-centre in portrait', async () => {
    const [w, h] = [window.innerWidth, window.innerHeight];
    window.innerWidth = 390;
    window.innerHeight = 844;
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    const shutter = screen.getByRole('button', { name: /take photo of text/i });
    expect(shutter.style.left).toBe('50%');
    expect(shutter.style.transform).toBe('translateX(-50%)');
    expect(shutter.style.top).toBe('');

    window.innerWidth = w;
    window.innerHeight = h;
  });

  it('swiping the language picker down closes it', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    fireEvent.click(screen.getByRole('button', { name: /change text language/i }));
    expect(await screen.findByText('Text language')).toBeInTheDocument();

    const handle = screen.getByLabelText('Drag down to close');
    fireEvent.pointerDown(handle, { clientY: 300 });
    fireEvent.pointerMove(handle, { clientY: 450 }); // 150px down, past the threshold
    fireEvent.pointerUp(handle, { clientY: 450 });

    expect(screen.queryByText('Text language')).not.toBeInTheDocument();
  });

  it('a small drag springs the picker back instead of closing it', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    fireEvent.click(screen.getByRole('button', { name: /change text language/i }));
    const handle = await screen.findByLabelText('Drag down to close');
    fireEvent.pointerDown(handle, { clientY: 300 });
    fireEvent.pointerMove(handle, { clientY: 330 }); // only 30px
    fireEvent.pointerUp(handle, { clientY: 330 });

    expect(screen.getByText('Text language')).toBeInTheDocument();
  });

  it('falls back to the photo picker when the camera is unavailable', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockResolvedValueOnce({ name: 'MY-PC' });
    // no navigator.mediaDevices in jsdom -> startCamera throws -> fallback
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');
    expect(await screen.findByText(/tap the shutter, then photograph the text/i)).toBeInTheDocument();

    const input = document.querySelector('input[type=file]');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /take photo of text/i }));
    await Promise.resolve();
    expect(click).toHaveBeenCalled();
  });

  it('shows an error screen when the server is unreachable', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockRejectedValueOnce(new CallError('unreachable', 'unreachable'));
    render(<MobileApp />);

    expect(await screen.findByText(/can’t reach your computer/i)).toBeInTheDocument();
    expect(screen.getByText(/rescanning the qr/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /scan the pairing code again/i }));
    expect(api.forgetKey).toHaveBeenCalled();
    expect(screen.getByText(/scan the qr code it shows/i)).toBeInTheDocument();
  });

  it('Try again re-attempts the hello and recovers', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call
      .mockRejectedValueOnce(new CallError('unreachable', 'unreachable'))
      .mockResolvedValueOnce({ name: 'MY-PC' });
    render(<MobileApp />);

    await screen.findByText(/can’t reach your computer/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('MY-PC — linked')).toBeInTheDocument();
  });

  it('scans, shows the overlay review, and sends the selected text', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockImplementation(async (_key, endpoint) => {
      if (endpoint === 'ocr') {
        return {
          words: [
            { t: 'SSID:', x: 0, y: 0, w: 40, h: 20, li: 0, pi: 0 },
            { t: 'X', x: 50, y: 0, w: 20, h: 20, li: 0, pi: 0 },
            { t: 'Pass:', x: 0, y: 40, w: 40, h: 20, li: 1, pi: 1 },
            { t: 'Y', x: 50, y: 40, w: 20, h: 20, li: 1, pi: 1 },
          ],
        };
      }
      if (endpoint === 'clip') return { ok: true };
      return { name: 'MY-PC' };
    });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    const input = document.querySelector('input[type=file]');
    const file = new File(['xx'], 'p.jpg', { type: 'image/jpeg' });
    // stub the downscale pipeline pieces jsdom lacks
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    const origImage = globalThis.Image;
    globalThis.Image = class {
      set src(_v) {
        this.naturalWidth = 100;
        this.naturalHeight = 50;
        setTimeout(() => this.onload());
      }
    };
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    };
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });

    fireEvent.change(input, { target: { files: [file] } });

    // overlay review renders with everything selected by default (two paragraphs)
    const sendBtn = await screen.findByRole('button', { name: /send to MY-PC/i });
    fireEvent.click(sendBtn);
    expect(await screen.findByText(/On MY-PC’s clipboard/)).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(KEY, 'clip', { text: 'SSID: X\n\nPass: Y' });

    globalThis.Image = origImage;
  });

  it('shows a friendly error when OCR finds nothing', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockImplementation(async (_key, endpoint) => {
      if (endpoint === 'ocr') return { words: [] };
      return { name: 'MY-PC' };
    });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    const origImage = globalThis.Image;
    globalThis.Image = class {
      set src(_v) {
        this.naturalWidth = 100;
        this.naturalHeight = 50;
        setTimeout(() => this.onload());
      }
    };
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    };
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });

    fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'p.jpg')] } });
    expect(await screen.findByText(/no text found/i)).toBeInTheDocument();

    // the way out is scanning again — not reconnecting to a computer that was fine
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    const hellos = api.call.mock.calls.filter(([, ep]) => ep === 'hello').length;
    fireEvent.click(screen.getByRole('button', { name: /scan again/i }));
    expect(await screen.findByRole('button', { name: /take photo of text/i })).toBeInTheDocument();
    expect(api.call.mock.calls.filter(([, ep]) => ep === 'hello').length).toBe(hellos);

    globalThis.Image = origImage;
  });

  it('a photo of only a Wi-Fi QR still reaches the review', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockImplementation(async (_key, endpoint) => {
      if (endpoint === 'ocr') return { words: [], wifi: { ssid: 'HOMEBASE_5G', password: 'pw', security: 'WPA', hidden: false } };
      return { name: 'MY-PC' };
    });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    const origImage = globalThis.Image;
    globalThis.Image = class { set src(_v) { this.naturalWidth = 100; this.naturalHeight = 50; setTimeout(() => this.onload()); } };
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['jpeg'], { type: 'image/jpeg' })); };
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });

    fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'p.jpg')] } });
    // no text was found, but the code is exact — not an error screen
    expect(await screen.findByRole('button', { name: /send password/i })).toBeInTheDocument();
    expect(screen.queryByText(/no text found/i)).not.toBeInTheDocument();

    globalThis.Image = origImage;
  });

  it('a pairing rejected by the computer says so, instead of blaming the Wi-Fi', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockRejectedValueOnce(new CallError('rejected', 'server said 400', 400));
    render(<MobileApp />);
    expect(await screen.findByText(/no longer recognises this phone/i)).toBeInTheDocument();
  });

  it('a failed send stays on the review so one more tap retries it', async () => {
    api.loadKey.mockReturnValue(KEY);
    let clipCalls = 0;
    api.call.mockImplementation(async (_key, endpoint) => {
      if (endpoint === 'ocr') {
        return { words: [{ t: 'hello', x: 0, y: 0, w: 40, h: 20, li: 0, pi: 0 }] };
      }
      if (endpoint === 'clip') {
        clipCalls++;
        if (clipCalls === 1) throw new CallError('unreachable', 'unreachable');
        return { ok: true };
      }
      return { name: 'MY-PC' };
    });
    render(<MobileApp />);
    await screen.findByText('MY-PC — linked');

    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    const origImage = globalThis.Image;
    globalThis.Image = class {
      set src(_v) {
        this.naturalWidth = 100;
        this.naturalHeight = 50;
        setTimeout(() => this.onload());
      }
    };
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    };
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });

    fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'p.jpg')] } });
    fireEvent.click(await screen.findByRole('button', { name: /send to MY-PC/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t reach your computer/i);
    fireEvent.click(screen.getByRole('button', { name: /try sending again/i }));
    expect(await screen.findByText(/On MY-PC’s clipboard/)).toBeInTheDocument();
    expect(clipCalls).toBe(2);

    globalThis.Image = origImage;
  });
});
