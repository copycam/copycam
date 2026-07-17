import '@testing-library/jest-dom/vitest';

// jsdom has no canvas implementation — the QR mock in CopyCamDemo only needs
// fillRect/fillStyle, so a stub context is enough.
HTMLCanvasElement.prototype.getContext = () => ({
  fillStyle: '',
  fillRect: () => {},
});
