import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageReview from './ImageReview.jsx';

// Four detected lines: two standalone, then a 2-line wrapped paragraph.
const lines = [
  { t: 'SSID: HOMEBASE_5G', x: 0, y: 0, w: 140, h: 20 },
  { t: 'Pass: corgi-42', x: 0, y: 40, w: 120, h: 20 },
  { t: 'a wrapped paragraph', x: 0, y: 120, w: 160, h: 20 },
  { t: 'onto two lines', x: 0, y: 148, w: 120, h: 20 },
];
const paras = [[0], [1], [2, 3]];

function setup(props = {}) {
  const onSend = vi.fn();
  const onRetake = vi.fn();
  render(
    <ImageReview
      photo={{ url: 'blob:x', width: 200, height: 200 }}
      lines={lines}
      paras={paras}
      pcName="MY-PC"
      sending={false}
      onSend={onSend}
      onRetake={onRetake}
      {...props}
    />,
  );
  return { onSend, onRetake };
}

const tile = (i) => document.querySelector(`[data-lidx="${i}"]`);
const tap = (el) => {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el.parentElement);
};

describe('ImageReview', () => {
  it('starts with every line selected and sends all text', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: /send 4 lines → MY-PC/i }));
    expect(onSend).toHaveBeenCalledWith('SSID: HOMEBASE_5G\nPass: corgi-42\na wrapped paragraph\nonto two lines');
  });

  it('tap toggles a line off and updates the send label', () => {
    const { onSend } = setup();
    tap(tile(1));
    fireEvent.click(screen.getByRole('button', { name: /send 3 lines/i }));
    expect(onSend).toHaveBeenCalledWith('SSID: HOMEBASE_5G\na wrapped paragraph\nonto two lines');
  });

  it('Clear then tap selects a single line', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: /select lines to send/i })).toBeDisabled();
    tap(tile(0));
    fireEvent.click(screen.getByRole('button', { name: /send 1 line/i }));
    expect(onSend).toHaveBeenCalledWith('SSID: HOMEBASE_5G');
  });

  it('Paragraph mode flows a wrapped paragraph into one line', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    tap(tile(2));
    tap(tile(3));
    fireEvent.click(screen.getByRole('button', { name: 'Paragraph' }));
    fireEvent.click(screen.getByRole('button', { name: /send 2 lines/i }));
    expect(onSend).toHaveBeenCalledWith('a wrapped paragraph onto two lines');
  });

  it('drag across lines selects the continuous range in reading order', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const container = tile(0).parentElement;

    document.elementFromPoint = vi.fn(() => tile(2));
    fireEvent.pointerDown(tile(1));
    fireEvent.pointerMove(container, { clientX: 5, clientY: 125 });
    fireEvent.pointerUp(container);

    fireEvent.click(screen.getByRole('button', { name: /send 2 lines/i }));
    expect(onSend).toHaveBeenCalledWith('Pass: corgi-42\na wrapped paragraph');
  });

  it('All restores full selection; Retake fires', () => {
    const { onRetake } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /send 4 lines/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retake/i }));
    expect(onRetake).toHaveBeenCalled();
  });
});
