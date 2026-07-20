import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const api = { loadKey: vi.fn(), forgetKey: vi.fn(), call: vi.fn() };
vi.mock('./api.js', () => ({
  loadKey: (...a) => api.loadKey(...a),
  forgetKey: (...a) => api.forgetKey(...a),
  call: (...a) => api.call(...a),
}));

import MobileApp from './MobileApp.jsx';

const KEY = new Uint8Array(32).fill(1);

describe('MobileApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    api.call.mockRejectedValueOnce(new Error('down'));
    render(<MobileApp />);

    expect(await screen.findByText(/can’t reach your computer/i)).toBeInTheDocument();
    expect(screen.getByText(/rescan the qr/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /forget pairing/i }));
    expect(api.forgetKey).toHaveBeenCalled();
    expect(screen.getByText(/scan the qr code it shows/i)).toBeInTheDocument();
  });

  it('Try again re-attempts the hello and recovers', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ name: 'MY-PC' });
    render(<MobileApp />);

    await screen.findByText(/can’t reach your computer/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('MY-PC — linked')).toBeInTheDocument();
  });

  it('sends selected blocks and shows the sent toast', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockImplementation(async (_key, endpoint) => {
      if (endpoint === 'ocr') return { blocks: ['SSID: X', 'Pass: Y'] };
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

    expect(await screen.findByText('2 text blocks found')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /send 2 blocks → MY-PC/i }));
    expect(await screen.findByText(/On MY-PC’s clipboard/)).toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(KEY, 'clip', { text: 'SSID: X\nPass: Y' });

    globalThis.Image = origImage;
  });

  it('shows a friendly error when OCR finds nothing', async () => {
    api.loadKey.mockReturnValue(KEY);
    api.call.mockImplementation(async (_key, endpoint) => {
      if (endpoint === 'ocr') return { blocks: [] };
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

    globalThis.Image = origImage;
  });
});
