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
});
