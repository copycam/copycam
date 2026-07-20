import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageReview from './ImageReview.jsx';

const words = [
  { t: 'SSID:', x: 0, y: 0, w: 40, h: 10 },
  { t: 'HOMEBASE_5G', x: 50, y: 0, w: 90, h: 10 },
  { t: 'Pass:', x: 0, y: 20, w: 40, h: 10 },
  { t: 'corgi-42', x: 50, y: 20, w: 70, h: 10 },
];
const rows = [
  [0, 1],
  [2, 3],
];

function setup(props = {}) {
  const onSend = vi.fn();
  const onRetake = vi.fn();
  render(
    <ImageReview
      photo={{ url: 'blob:x', width: 200, height: 100 }}
      words={words}
      rows={rows}
      pcName="MY-PC"
      sending={false}
      onSend={onSend}
      onRetake={onRetake}
      {...props}
    />,
  );
  return { onSend, onRetake };
}

const word = (i) => document.querySelector(`[data-widx="${i}"]`);
const tap = (el) => {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el.parentElement);
};

describe('ImageReview', () => {
  it('starts with everything selected and sends all text', () => {
    const { onSend } = setup();
    const btn = screen.getByRole('button', { name: /send 4 words → MY-PC/i });
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledWith('SSID: HOMEBASE_5G\nPass: corgi-42');
  });

  it('tap toggles a word off and updates the send label', () => {
    const { onSend } = setup();
    tap(word(1));
    fireEvent.click(screen.getByRole('button', { name: /send 3 words/i }));
    expect(onSend).toHaveBeenCalledWith('SSID:\nPass: corgi-42');
  });

  it('Clear then tap selects a single word', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: /select words to send/i })).toBeDisabled();
    tap(word(3));
    fireEvent.click(screen.getByRole('button', { name: /send 1 word/i }));
    expect(onSend).toHaveBeenCalledWith('corgi-42');
  });

  it('paragraph mode joins rows with spaces', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Paragraph' }));
    fireEvent.click(screen.getByRole('button', { name: /send 4 words/i }));
    expect(onSend).toHaveBeenCalledWith('SSID: HOMEBASE_5G Pass: corgi-42');
  });

  it('drag across words selects the continuous range in reading order', () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    const container = word(0).parentElement;

    // drag from word 1 to word 2 (crosses the row boundary)
    document.elementFromPoint = vi.fn(() => word(2));
    fireEvent.pointerDown(word(1));
    fireEvent.pointerMove(container, { clientX: 5, clientY: 25 });
    fireEvent.pointerUp(container);

    fireEvent.click(screen.getByRole('button', { name: /send 2 words/i }));
    expect(onSend).toHaveBeenCalledWith('HOMEBASE_5G\nPass:');
  });

  it('All button restores full selection; Retake fires', () => {
    const { onRetake } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /send 4 words/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retake/i }));
    expect(onRetake).toHaveBeenCalled();
  });
});
