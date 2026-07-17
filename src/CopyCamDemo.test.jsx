import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CopyCamDemo from './CopyCamDemo.jsx';

// The demo is a timer-driven state machine:
// pair -(click, 1500ms)-> idle -(click, 1600ms)-> review -(send, 900ms)-> sent -(2300ms)-> idle

function advance(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function pairToIdle() {
  fireEvent.click(screen.getByRole('button', { name: /simulate desktop scan/i }));
  advance(1500);
}

function idleToReview() {
  fireEvent.click(screen.getByRole('button', { name: /scan text/i }));
  advance(1600);
}

describe('CopyCamDemo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts on the pairing screen', () => {
    render(<CopyCamDemo />);
    expect(screen.getByText('PAIR ONCE')).toBeInTheDocument();
    expect(screen.getByText(/waiting for scan/i)).toBeInTheDocument();
  });

  it('pairs and lands on the idle camera view', () => {
    render(<CopyCamDemo deviceName="Test PC" />);
    fireEvent.click(screen.getByRole('button', { name: /simulate desktop scan/i }));

    expect(screen.getByText(/linking to test pc/i)).toBeInTheDocument();

    advance(1500);
    expect(screen.queryByText('PAIR ONCE')).not.toBeInTheDocument();
    expect(screen.getByText('Test PC — linked')).toBeInTheDocument();
    expect(screen.getByText(/frame the text, then tap/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan text/i })).toBeInTheDocument();
  });

  it('scans and shows the review sheet with all blocks selected', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    expect(screen.getByText('3 text blocks found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send 3 blocks/i })).toBeInTheDocument();
  });

  it('updates the send button as blocks are toggled off', () => {
    render(<CopyCamDemo deviceName="Test PC" />);
    pairToIdle();
    idleToReview();

    // Each block text appears twice (camera overlay + sheet row); the row is clickable.
    const row = screen.getAllByText('Guest: welcome-123')[1].parentElement;
    fireEvent.click(row);
    expect(screen.getByRole('button', { name: /send 2 blocks → Test PC/i })).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('SSID: HOMEBASE_5G')[1].parentElement);
    expect(screen.getByRole('button', { name: /send 1 block → Test PC/i })).toBeInTheDocument();
  });

  it('disables send when no blocks are selected', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    for (const text of ['SSID: HOMEBASE_5G', 'Pass: corgi-battery-42', 'Guest: welcome-123']) {
      fireEvent.click(screen.getAllByText(text)[1].parentElement);
    }
    const btn = screen.getByRole('button', { name: /select text to send/i });
    expect(btn).toBeDisabled();
  });

  it('sends, shows the toast, then resets to idle with blocks reselected', () => {
    render(<CopyCamDemo deviceName="Test PC" />);
    pairToIdle();
    idleToReview();

    fireEvent.click(screen.getByRole('button', { name: /send 3 blocks/i }));
    expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();

    advance(900);
    expect(screen.getByText('On Test PC’s clipboard')).toBeInTheDocument();

    advance(2300);
    expect(screen.queryByText('On Test PC’s clipboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan text/i })).toBeInTheDocument();

    // a fresh scan should have all 3 blocks selected again
    idleToReview();
    expect(screen.getByRole('button', { name: /send 3 blocks/i })).toBeInTheDocument();
  });

  it('rescan returns to idle and reselects all blocks', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    fireEvent.click(screen.getAllByText('Guest: welcome-123')[1].parentElement);
    fireEvent.click(screen.getByRole('button', { name: /rescan/i }));

    expect(screen.getByText(/frame the text, then tap/i)).toBeInTheDocument();

    idleToReview();
    expect(screen.getByRole('button', { name: /send 3 blocks/i })).toBeInTheDocument();
  });

  it('ignores shutter clicks while already scanning', () => {
    render(<CopyCamDemo />);
    pairToIdle();

    const shutter = screen.getByRole('button', { name: /scan text/i });
    fireEvent.click(shutter);
    fireEvent.click(shutter); // second click mid-scan must not queue another transition
    advance(1600);

    expect(screen.getByText('3 text blocks found')).toBeInTheDocument();
    advance(1600); // no stray timer should fire
    expect(screen.getByRole('button', { name: /send 3 blocks/i })).toBeInTheDocument();
  });

  it('auto-sends after review when autoSend is set', () => {
    render(<CopyCamDemo autoSend />);
    pairToIdle();
    idleToReview();

    advance(700); // autoSend delay
    expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();

    advance(900);
    expect(screen.getByText(/clipboard/i)).toBeInTheDocument();
  });

  it('fires onPulse for haptic moments (pair, scan result, sent)', () => {
    const onPulse = vi.fn();
    render(<CopyCamDemo onPulse={onPulse} />);

    pairToIdle();
    expect(onPulse).toHaveBeenCalledTimes(1);

    idleToReview();
    expect(onPulse).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /send 3 blocks/i }));
    advance(900);
    expect(onPulse).toHaveBeenCalledTimes(3);
  });
});
