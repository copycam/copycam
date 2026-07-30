import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageReview from './ImageReview.jsx';
import { selectionText } from './selection.js';

// two lines in paragraph 0, one line in paragraph 1
const WORDS = [
  { t: 'one', x: 0, y: 0, w: 40, h: 20, li: 0, pi: 0 },
  { t: 'two', x: 50, y: 0, w: 40, h: 20, li: 0, pi: 0 },
  { t: 'three', x: 0, y: 40, w: 60, h: 20, li: 1, pi: 0 },
  { t: 'four', x: 0, y: 70, w: 40, h: 20, li: 2, pi: 1 },
];

function setup(props = {}) {
  const onSend = vi.fn();
  const onRetake = vi.fn();
  render(
    <ImageReview
      photo={{ url: 'blob:x', width: 200, height: 100 }}
      words={WORDS}
      pcName="MY-PC"
      sending={false}
      onSend={onSend}
      onRetake={onRetake}
      {...props}
    />,
  );
  return { onSend, onRetake };
}

// give the overlay real dimensions so the pixel↔screen mapping resolves
function primeGeometry() {
  const canvas = screen.getByAltText('scanned').parentElement;
  Object.defineProperty(canvas, 'clientWidth', { value: 200, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: 100, configurable: true });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 });
  fireEvent(window, new Event('resize'));
  return canvas;
}

describe('ImageReview', () => {
  it('defaults to everything selected and sends the full flowed text', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenCalledWith(selectionText(WORDS, [0, 1, 2, 3]));
    expect(onSend).toHaveBeenCalledWith('one two three\n\nfour');
  });

  it('Clear empties the selection and disables send', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: /select text to send/i })).toBeDisabled();
    expect(screen.getByText(/drag across the photo to select/i)).toBeInTheDocument();
  });

  it('All restores the full selection after Clear', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenCalledWith('one two three\n\nfour');
  });

  it('drag across words selects a contiguous range in reading order', () => {
    const { onSend } = setup();
    const canvas = primeGeometry();
    // drag from "one" (0,0-40,20) to "three" (0,40-60,60)
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 50 });
    fireEvent.pointerUp(canvas);
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenCalledWith('one two three');
  });

  it('a tap selects a single word', () => {
    const { onSend } = setup();
    const canvas = primeGeometry();
    fireEvent.pointerDown(canvas, { clientX: 70, clientY: 10 }); // "two"
    fireEvent.pointerUp(canvas);
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenCalledWith('two');
  });

  it('the grabber toggles the preview sheet open and closed', () => {
    setup();
    expect(screen.getByText(/swipe up for full preview/i)).toBeInTheDocument();
    const grabber = screen.getByLabelText('Drag to preview');
    fireEvent.pointerDown(grabber, { clientY: 500 });
    fireEvent.pointerUp(grabber, { clientY: 500 });
    expect(screen.getByText(/swipe down to collapse/i)).toBeInTheDocument();
  });

  it('the whole header row drags the sheet, not just the grabber pill', () => {
    setup();
    // press on the status text (well away from the little grabber pill)
    const status = screen.getByText(/words selected/i);
    fireEvent.pointerDown(status, { clientY: 600 });
    fireEvent.pointerMove(status, { clientY: 380 }); // drag upward
    fireEvent.pointerUp(status, { clientY: 380 });
    expect(screen.getByText(/swipe down to collapse/i)).toBeInTheDocument();
  });

  it('rotating to a shorter screen never leaves the sheet taller than the viewport', () => {
    setup();
    const sheet = screen.getByLabelText('Drag to preview').parentElement;
    // expand while tall (portrait)
    window.innerHeight = 844;
    fireEvent(window, new Event('resize'));
    const grabber = screen.getByLabelText('Drag to preview');
    fireEvent.pointerDown(grabber, { clientY: 500 });
    fireEvent.pointerUp(grabber, { clientY: 500 });
    const tallH = parseInt(sheet.style.height, 10);
    expect(tallH).toBeGreaterThan(300);

    // rotate to landscape — the sheet must shrink with the viewport
    window.innerHeight = 390;
    fireEvent(window, new Event('orientationchange'));
    const shortH = parseInt(sheet.style.height, 10);
    expect(shortH).toBeLessThan(tallH);
    expect(shortH).toBeLessThanOrEqual(390);
  });

  it('Retake fires', () => {
    const { onRetake } = setup();
    fireEvent.click(screen.getByRole('button', { name: /retake/i }));
    expect(onRetake).toHaveBeenCalled();
  });

  it('insets the photo so edge words are clear of the system back-swipe zone', () => {
    // a photo the same aspect as the container would otherwise fill it
    // edge-to-edge, putting words at x=0 right under the edge gesture
    setup({ photo: { url: 'blob:x', width: 200, height: 100 } });
    primeGeometry(); // container is 200x100

    const img = screen.getByAltText('scanned');
    const left = parseFloat(img.style.left);
    const top = parseFloat(img.style.top);
    const width = parseFloat(img.style.width);
    const height = parseFloat(img.style.height);

    expect(left).toBeGreaterThanOrEqual(20); // clears iOS/Android edge zones
    expect(top).toBeGreaterThan(0);
    // and symmetric: the photo stays fully inside the container
    expect(left + width).toBeLessThanOrEqual(200 - 20);
    expect(top + height).toBeLessThanOrEqual(100);
  });

  it('still maps pointers to the right word once the photo is inset', () => {
    const { onSend } = setup();
    const canvas = primeGeometry();
    // tap over "two" — coordinates must account for the new inset internally
    fireEvent.pointerDown(canvas, { clientX: 70, clientY: 10 });
    fireEvent.pointerUp(canvas);
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenCalledWith('two');
  });

  it('keeps highlight bars separated even when the photo renders small', () => {
    // three stacked lines, 20px pitch in source pixels
    const stacked = [
      { t: 'a', x: 0, y: 0, w: 100, h: 20, li: 0, pi: 0 },
      { t: 'b', x: 0, y: 20, w: 100, h: 20, li: 1, pi: 0 },
      { t: 'c', x: 0, y: 40, w: 100, h: 20, li: 2, pi: 0 },
    ];
    // a wide, short review area (the landscape case) renders the photo small
    setup({ words: stacked, photo: { url: 'blob:x', width: 400, height: 60 } });
    const canvas = screen.getByAltText('scanned').parentElement;
    Object.defineProperty(canvas, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 120, configurable: true });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 120, width: 800, height: 120 });
    fireEvent(window, new Event('resize'));

    const bars = [...canvas.querySelectorAll('div')].filter((d) => d.style.height && d.style.borderRadius);
    expect(bars.length).toBe(3);

    const rects = bars
      .map((b) => ({ top: parseFloat(b.style.top), h: parseFloat(b.style.height) }))
      .sort((a, b) => a.top - b.top);
    for (let i = 1; i < rects.length; i++) {
      const gap = rects[i].top - (rects[i - 1].top + rects[i - 1].h);
      expect(gap).toBeGreaterThan(0); // never overlap or touch
    }
  });

  it('the text preview lets the browser resolve bidi direction from content', () => {
    setup();
    const preview = screen.getByText(/one two three/).closest('[dir]');
    expect(preview).toHaveAttribute('dir', 'auto');
  });
});
