import '@testing-library/jest-dom/vitest';

// jsdom has no canvas implementation — the QR mock in CopyCamDemo only needs
// fillRect/fillStyle, so a stub context is enough. Server-side tests run in
// the plain node environment where HTMLCanvasElement doesn't exist.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => ({
    fillStyle: '',
    fillRect: () => {},
  });
}

// jsdom doesn't implement media playback; the viewfinder guards this already.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
}
