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

// the touch surface: the photo sits in a zoom layer inside it
const surface = () => screen.getByAltText('scanned').parentElement.parentElement;

// give the overlay real dimensions so the pixel↔screen mapping resolves
function primeGeometry() {
  const canvas = surface();
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

  const sheetHeight = () => parseInt(screen.getByLabelText('Drag to preview').parentElement.style.height, 10);

  it('the grabber toggles the preview sheet open and closed', () => {
    setup();
    const collapsed = sheetHeight();
    const grabber = screen.getByLabelText('Drag to preview');
    fireEvent.pointerDown(grabber, { clientY: 500 });
    fireEvent.pointerUp(grabber, { clientY: 500 });
    expect(sheetHeight()).toBeGreaterThan(collapsed);
    fireEvent.pointerDown(grabber, { clientY: 500 });
    fireEvent.pointerUp(grabber, { clientY: 500 });
    expect(sheetHeight()).toBe(collapsed);
  });

  it('the whole header row drags the sheet, not just the grabber pill', () => {
    setup();
    const collapsed = sheetHeight();
    // press on the status text (well away from the little grabber pill)
    const status = screen.getByText(/words selected/i);
    fireEvent.pointerDown(status, { clientY: 600 });
    fireEvent.pointerMove(status, { clientY: 380 }); // drag upward
    fireEvent.pointerUp(status, { clientY: 380 });
    expect(sheetHeight()).toBeGreaterThan(collapsed);
  });

  it('edits the text before sending, and sends the edit', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: /edit the text/i }));
    const editor = screen.getByLabelText('Text to send');
    expect(editor).toHaveValue('one two three\n\nfour');
    fireEvent.change(editor, { target: { value: 'one TWO three' } });
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.getByText(/edited · 13 characters/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenCalledWith('one TWO three');
  });

  it('keeps an edit when the selection changes, until the edit is discarded', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: /edit the text/i }));
    fireEvent.change(screen.getByLabelText('Text to send'), { target: { value: 'typed by hand' } });
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    // changing the selection must not silently throw the typing away
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenLastCalledWith('typed by hand');

    fireEvent.click(screen.getByRole('button', { name: /discard edits/i }));
    expect(screen.getByRole('button', { name: /select text to send/i })).toBeDisabled();
  });

  it('opening the editor and closing it unchanged is not an edit', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /edit the text/i }));
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.queryByRole('button', { name: /discard edits/i })).not.toBeInTheDocument();
    expect(screen.getByText(/4 words selected/i)).toBeInTheDocument();
  });

  it('marks look-alike characters in codes, and spaces beside them', () => {
    const WORDS2 = [
      { t: 'SSID:', x: 0, y: 0, w: 40, h: 20, li: 0, pi: 0 },
      { t: 'HOMEBASE_5G', x: 50, y: 0, w: 90, h: 20, li: 0, pi: 0 },
    ];
    setup({ words: WORDS2 });
    const preview = screen.getByLabelText('SSID: HOMEBASE_5G');
    // the risky characters carry a mark; the plain label does not
    expect(preview.textContent).toBe('SSID:·HOMEBASE_5G');
    const marked = [...preview.querySelectorAll('span')].filter((el) => el.style.textDecoration.includes('dotted'));
    expect(marked.map((el) => el.textContent).join('')).toMatch(/[0O5S_]/);
  });

  it('warns when the recogniser was unsure, and ambers those highlights', () => {
    const unsure = WORDS.map((w, i) => (i === 0 ? { ...w, c: 0.62 } : { ...w, c: 0.99 }));
    setup({ words: unsure });
    expect(screen.getByText(/hard to read/i)).toBeInTheDocument();
  });

  it('says nothing about doubt when every word read cleanly', () => {
    setup({ words: WORDS.map((w) => ({ ...w, c: 0.99 })) });
    expect(screen.queryByText(/hard to read/i)).not.toBeInTheDocument();
  });

  it('offers a Wi-Fi code exactly, without going through the text', () => {
    const { onSend } = setup({ wifi: { ssid: 'HOMEBASE_5G', password: 'corgi-battery_42', security: 'WPA', hidden: false } });
    fireEvent.click(screen.getByRole('button', { name: /send password/i }));
    expect(onSend).toHaveBeenCalledWith('corgi-battery_42');
    fireEvent.click(screen.getByRole('button', { name: /send network name/i }));
    expect(onSend).toHaveBeenLastCalledWith('HOMEBASE_5G');
  });

  it('offers no password button for an open network', () => {
    setup({ wifi: { ssid: 'Cafe', password: '', security: 'nopass', hidden: false } });
    expect(screen.queryByRole('button', { name: /send password/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send network name/i })).toBeInTheDocument();
  });

  it('shows a failed send inline and offers to send again', () => {
    const { onSend } = setup({ sendError: 'Couldn’t reach your computer.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t reach/i);
    fireEvent.click(screen.getByRole('button', { name: /try sending again/i }));
    expect(onSend).toHaveBeenCalledWith('one two three\n\nfour');
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
    // three closely set lines: ink 14px tall at a 20px pitch in source pixels
    const stacked = [
      { t: 'a', x: 0, y: 3, w: 100, h: 14, li: 0, pi: 0 },
      { t: 'b', x: 0, y: 23, w: 100, h: 14, li: 1, pi: 0 },
      { t: 'c', x: 0, y: 43, w: 100, h: 14, li: 2, pi: 0 },
    ];
    // a wide, short review area (the landscape case) renders the photo small
    setup({ words: stacked, photo: { url: 'blob:x', width: 400, height: 60 } });
    const canvas = surface();
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

  it('two fingers zoom the photo without disturbing the selection, and Fit zooms back out', () => {
    const { onSend } = setup();
    const canvas = primeGeometry();
    const layer = screen.getByAltText('scanned').parentElement;
    expect(screen.queryByRole('button', { name: /zoom out/i })).toBeNull();

    // the first finger lands on a word, then a second joins and they spread
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 70, clientY: 30 });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 90, clientY: 30 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 120, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 2 });

    expect(layer.style.transform).toContain('scale(4)');
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenLastCalledWith(selectionText(WORDS, [0, 1, 2, 3])); // still everything

    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(layer.style.transform).toContain('scale(1)');
    expect(screen.queryByRole('button', { name: /zoom out/i })).toBeNull();
  });

  it('a double tap zooms in, and picks nothing', () => {
    const { onSend } = setup();
    const canvas = primeGeometry();
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 70, clientY: 30 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }
    expect(screen.getByAltText('scanned').parentElement.style.transform).toContain('scale(2.5)');
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenLastCalledWith(selectionText(WORDS, [0, 1, 2, 3]));
  });

  it('maps a tap through the zoom to the word under it', () => {
    const { onSend } = setup();
    const canvas = primeGeometry();
    // zoom in around "one", then tap where "two" now sits
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 50, clientY: 30 });
      fireEvent.pointerUp(canvas, { pointerId: 1 });
    }
    const img = screen.getByAltText('scanned');
    const [tx, ty, z] = img.parentElement.style.transform.match(/-?[\d.]+/g).map(Number);
    const scale = parseFloat(img.style.width) / 200;
    const at = (ix, iy) => [tx + (parseFloat(img.style.left) + ix * scale) * z, ty + (parseFloat(img.style.top) + iy * scale) * z];
    const [x, y] = at(70, 10); // the middle of "two" in image pixels
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: x, clientY: y });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: /send to MY-PC/i }));
    expect(onSend).toHaveBeenLastCalledWith('two');
  });

  it('the text preview lets the browser resolve bidi direction from content', () => {
    setup();
    const preview = screen.getByText(/one two three/).closest('[dir]');
    expect(preview).toHaveAttribute('dir', 'auto');
  });
});
