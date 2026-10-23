import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CopyCamDemo from './CopyCamDemo.jsx';

// The demo is a timer-driven state machine:
// pair -(click, 1500ms)-> idle -(click, 1600ms)-> review -(send, 900ms)-> sent -(2300ms)-> idle
// and its review is the real app's drag-to-select: the first stroke replaces the
// suggestion, later ones add to it, and a stroke that starts on a picked word
// takes words away.

function advance(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function pairToIdle() {
  fireEvent.click(screen.getByRole('button', { name: /point at the qr code/i }));
  advance(1500);
}

function idleToReview() {
  fireEvent.click(screen.getByRole('button', { name: /scan text/i }));
  advance(1600);
}

// The words on the photographed label, by their data-w index.
const word = (i) => document.querySelector(`[data-w="${i}"]`);
const preview = () => screen.getByTestId('preview').getAttribute('aria-label');

// One stroke: press on a word, sweep over others, lift.
function stroke(from, ...over) {
  fireEvent.pointerDown(word(from));
  for (const i of over) fireEvent.pointerMove(word(i));
  fireEvent.pointerUp(word(over.length ? over[over.length - 1] : from));
}

describe('CopyCamDemo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts on the pairing screen, with the code on the computer and the phone to point at it', () => {
    render(<CopyCamDemo deviceName="Test PC" />);
    expect(screen.getByText('PAIR ONCE')).toBeInTheDocument();
    // the QR is shown by the computer; it is the phone that scans it
    expect(screen.getAllByText('copycam.app').length).toBeGreaterThan(0);
    expect(screen.getByText(/point your phone at the qr code it shows/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for scan/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/copycam\.app\/link/i)).not.toBeInTheDocument();
  });

  it('pairs and lands on the idle camera view', () => {
    render(<CopyCamDemo deviceName="Test PC" />);
    fireEvent.click(screen.getByRole('button', { name: /point at the qr code/i }));

    expect(screen.getByText(/linking to test pc/i)).toBeInTheDocument();

    advance(1500);
    expect(screen.queryByText('PAIR ONCE')).not.toBeInTheDocument();
    expect(screen.getByText('Test PC — linked')).toBeInTheDocument();
    expect(screen.getByText(/frame the text, then tap the shutter/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan text/i })).toBeInTheDocument();
  });

  it('scans and offers everything as a suggestion, ready to send as it is', () => {
    render(<CopyCamDemo deviceName="Test PC" />);
    pairToIdle();
    idleToReview();

    expect(screen.getByText('All text · tap or drag to choose')).toBeInTheDocument();
    expect(preview()).toContain('K7mq-Rv2p-90lx');
    expect(screen.getByRole('button', { name: 'Send to Test PC' })).toBeEnabled();
  });

  it('the first drag replaces the suggestion; later drags add to it', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    // word 3 is the password (words: Network: HOMEBASE_5G Password: K7mq… Guest: welcome-123)
    stroke(3);
    expect(preview()).toBe('K7mq-Rv2p-90lx');
    expect(screen.getByText('1 word selected')).toBeInTheDocument();

    // adding the network name from another line: separate pieces on separate lines
    stroke(1);
    expect(preview()).toBe('HOMEBASE_5G\n\nK7mq-Rv2p-90lx');
    expect(screen.getByText('2 words selected')).toBeInTheDocument();
  });

  it('a drag across words picks the run between them', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    stroke(2, 3);
    expect(preview()).toBe('Password: K7mq-Rv2p-90lx');
  });

  it('a stroke that starts on a picked word takes words away', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    stroke(2, 3); // Password: and its value
    stroke(3); // tap the value again to drop it
    expect(preview()).toBe('Password:');
  });

  it('marks look-alike characters in the preview, and says so', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    stroke(3);
    expect(screen.getByText(/look-alikes like 0 and o are underlined/i)).toBeInTheDocument();
    // the 0 and the l in the password are set apart from the rest
    const marked = [...screen.getByTestId('preview').querySelectorAll('span')].filter((s) => s.style.textDecoration.includes('underline'));
    // neighbouring risky characters share one marked run
    const text = marked.map((s) => s.textContent).join('');
    expect(text).toContain('0');
    expect(text).toContain('l');

    // a piece with nothing to doubt gets no warning
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    stroke(0);
    expect(preview()).toBe('Network:');
    expect(screen.queryByText(/look-alikes like 0 and o/i)).not.toBeInTheDocument();
  });

  it('All and Clear make a deliberate selection; send is off with nothing selected', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select text to send/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('6 words selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send to/i })).toBeEnabled();
  });

  it('sends, shows the toast, then resets to idle with the suggestion back', () => {
    render(<CopyCamDemo deviceName="Test PC" />);
    pairToIdle();
    idleToReview();
    stroke(3);

    fireEvent.click(screen.getByRole('button', { name: 'Send to Test PC' }));
    expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();

    advance(900);
    expect(screen.getByText('On Test PC’s clipboard')).toBeInTheDocument();

    advance(2300);
    expect(screen.queryByText('On Test PC’s clipboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scan text/i })).toBeInTheDocument();

    // a fresh scan starts from the suggestion again
    idleToReview();
    expect(screen.getByText('All text · tap or drag to choose')).toBeInTheDocument();
  });

  it('Retake returns to the camera and brings the suggestion back', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    idleToReview();

    stroke(3);
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));

    expect(screen.getByText(/frame the text, then tap the shutter/i)).toBeInTheDocument();

    idleToReview();
    expect(screen.getByText('All text · tap or drag to choose')).toBeInTheDocument();
  });

  it('ignores shutter clicks while already scanning', () => {
    render(<CopyCamDemo />);
    pairToIdle();

    const shutter = screen.getByRole('button', { name: /scan text/i });
    fireEvent.click(shutter);
    fireEvent.click(shutter); // second click mid-scan must not queue another transition
    advance(1600);

    expect(screen.getByText('All text · tap or drag to choose')).toBeInTheDocument();
    advance(1600); // no stray timer should fire
    expect(screen.getByRole('button', { name: /^send to/i })).toBeInTheDocument();
  });

  it('does not select words before the review (the photo is not yet a selection)', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    fireEvent.pointerDown(word(3));
    idleToReview();
    expect(screen.getByText('All text · tap or drag to choose')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /^send to/i }));
    advance(900);
    expect(onPulse).toHaveBeenCalledTimes(3);
  });

  it('keeps the review sheet out of reach while it is hidden below the screen', () => {
    render(<CopyCamDemo />);
    pairToIdle();
    expect(screen.getByTestId('preview').closest('[inert]')).not.toBeNull();
    idleToReview();
    expect(screen.getByTestId('preview').closest('[inert]')).toBeNull();
  });

  it('moves keyboard focus on to the next control when the one used disappears', () => {
    render(<CopyCamDemo />);
    const pair = screen.getByRole('button', { name: /point at the qr code/i });
    act(() => pair.focus());
    fireEvent.click(pair);
    advance(1500);
    const shutter = screen.getByRole('button', { name: /scan text/i });
    expect(document.activeElement).toBe(shutter);

    fireEvent.click(shutter);
    advance(1600);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^send to/i }));
  });
});
