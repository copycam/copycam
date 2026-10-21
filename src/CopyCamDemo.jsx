import { useCallback, useEffect, useRef, useState } from 'react';
import { beginStroke, everything, NOTHING, selectionText, strokeTo } from './mobile/selection.js';
import { annotate } from './mobile/annotate.js';

// The label the demo "photographs". Its words are selectable exactly as in the
// real phone app: that app's own selection and look-alike modules drive this
// demo, so a drag, the suggestion and the marks all behave the same way.
const LINES = [
  ['Network:', 'HOMEBASE_5G'],
  ['Password:', 'K7mq-Rv2p-90lx'],
  ['Guest:', 'welcome-123'],
];
const WORDS = LINES.flatMap((line, li) => line.map((t) => ({ t, li, pi: li })));
// the word index of each word, by line, for drawing
const INDEX = LINES.map((line, li) => line.map((_, k) => LINES.slice(0, li).reduce((n, l) => n + l.length, 0) + k));

const MONO = 'ui-monospace,Menlo,monospace';

function drawFakeQr(canvas) {
  const ctx = canvas.getContext('2d');
  const n = 25;
  const s = canvas.width / n;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#161616';

  let seed = 42;
  const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  const finder = (x, y) => {
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const ring = i === 0 || i === 6 || j === 0 || j === 6;
        const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        if (ring || core) ctx.fillRect((x + i) * s, (y + j) * s, s + 0.5, s + 0.5);
      }
    }
  };
  const inFinder = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);

  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      if (!inFinder(x, y) && rng() < 0.44) ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
    }
  }
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
}

function useBeep() {
  const acRef = useRef(null);
  return useCallback((f) => {
    try {
      const a = acRef.current || (acRef.current = new (window.AudioContext || window.webkitAudioContext)());
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.06, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.18);
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + 0.2);
    } catch {
      // audio unavailable (autoplay policy, unsupported browser) — silently skip
    }
  }, []);
}

// The word under a pointer event. In a browser the point is looked up; where
// that isn't available (a test DOM) the event's own target stands in.
function wordFromEvent(e) {
  const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
  const el = (hit ?? e.target)?.closest?.('[data-w]');
  return el ? Number(el.dataset.w) : null;
}

// Interactive CopyCam demo screen:
// pair -> connecting -> idle -> scanning -> review -> sending -> sent.
// Ported from the CopyCam design's embedded DC component logic, then brought in
// line with the real app: the QR is on the computer and the phone scans it, and
// the review is drag-to-select with look-alike marks and a preview of exactly
// what will be sent.
export default function CopyCamDemo({ accentColor = '#CFFF3B', deviceName = 'My MacBook', autoSend = false, onPulse }) {
  const [phase, setPhase] = useState('pair');
  const [sel, setSel] = useState(() => everything(WORDS.length, true));
  // Timers fire several steps later, after multiple renders — refs keep the
  // guard checks below reading the current phase/selection instead of a stale closure.
  const phaseRef = useRef(phase);
  const selRef = useRef(sel);
  const strokeRef = useRef(null);
  const rootRef = useRef(null);
  const shutterRef = useRef(null);
  const sendRef = useRef(null);
  const focusInside = useRef(false);
  const canvasRef = useRef(null);
  const qrDrawn = useRef(false);
  const pairTimer = useRef(null);
  const scanTimer = useRef(null);
  const autoSendTimer = useRef(null);
  const sendTimer = useRef(null);
  const resetTimer = useRef(null);
  const beep = useBeep();

  const updatePhase = (p) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const updateSel = (next) => {
    selRef.current = next;
    setSel(next);
  };
  const resetSel = () => updateSel(everything(WORDS.length, true));

  useEffect(() => {
    if (canvasRef.current && !qrDrawn.current) {
      qrDrawn.current = true;
      drawFakeQr(canvasRef.current);
    }
  }, []);

  useEffect(
    () => () => {
      clearTimeout(pairTimer.current);
      clearTimeout(scanTimer.current);
      clearTimeout(autoSendTimer.current);
      clearTimeout(sendTimer.current);
      clearTimeout(resetTimer.current);
    },
    [],
  );

  useEffect(() => {
    const active = document.activeElement;
    if (!focusInside.current || (active && active !== document.body && rootRef.current?.contains(active))) return;
    if (phase === 'idle') shutterRef.current?.focus({ preventScroll: true });
    if (phase === 'review') sendRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const haptic = useCallback(() => {
    onPulse?.();
  }, [onPulse]);

  const startPair = () => {
    if (phaseRef.current !== 'pair') return;
    updatePhase('connecting');
    pairTimer.current = setTimeout(() => {
      haptic();
      beep(760);
      updatePhase('idle');
    }, 1500);
  };

  const hasText = () => selectionText(WORDS, selRef.current.picked).trim().length > 0;

  const scan = () => {
    if (phaseRef.current !== 'idle') return;
    beep(520);
    updatePhase('scanning');
    scanTimer.current = setTimeout(() => {
      haptic();
      beep(880);
      updatePhase('review');
      if (autoSend) autoSendTimer.current = setTimeout(() => send(), 700);
    }, 1600);
  };

  // One stroke is a drag across words, or a tap, which is a drag that never
  // left its word: the first replaces the suggestion, later ones add to it, and
  // one that starts on a picked word takes words away.
  const onPointerDown = (e) => {
    if (phaseRef.current !== 'review') return;
    const i = wordFromEvent(e);
    if (i == null) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // a synthetic pointer can't be captured; the drag still works without
    }
    const stroke = beginStroke(selRef.current, i);
    strokeRef.current = { stroke, last: i };
    updateSel(strokeTo(stroke, i));
  };
  const onPointerMove = (e) => {
    const s = strokeRef.current;
    if (!s) return;
    const i = wordFromEvent(e);
    if (i == null || i === s.last) return;
    s.last = i;
    updateSel(strokeTo(s.stroke, i));
  };
  const endStroke = () => {
    strokeRef.current = null;
  };

  const send = () => {
    if (phaseRef.current !== 'review') return;
    if (!hasText()) return;
    updatePhase('sending');
    sendTimer.current = setTimeout(() => {
      haptic();
      beep(990);
      updatePhase('sent');
      resetTimer.current = setTimeout(() => {
        updatePhase('idle');
        resetSel();
      }, 2300);
    }, 900);
  };

  const retake = () => {
    clearTimeout(sendTimer.current);
    clearTimeout(resetTimer.current);
    updatePhase('idle');
    resetSel();
  };

  const review = phase === 'review' || phase === 'sending';
  const sending = phase === 'sending';
  const showPair = phase === 'pair' || phase === 'connecting';
  const showCam = !showPair;
  const text = selectionText(WORDS, sel.picked);
  const canSend = text.trim().length > 0;
  const n = sel.picked.length;
  const marks = annotate(text);
  const doubtful = marks.some((m) => m.mark === 'risky');
  const status = n === 0 ? 'Nothing selected' : sel.soft ? 'All text · tap or drag to choose' : `${n} word${n === 1 ? '' : 's'} selected`;
  const sheetY = review ? '0%' : '112%';

  const chip = {
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 600,
    color: '#fff',
    background: 'rgba(20,21,24,.6)',
    backdropFilter: 'blur(10px)',
    borderRadius: 999,
    padding: '7px 13px',
    boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.16)',
  };

  return (
    <div
      ref={rootRef}
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) focusInside.current = false;
      }}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      {showPair && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#FAFAF7',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 22,
            padding: '0 32px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: '#6b6b64' }}>PAIR ONCE</div>

          {/* what the computer shows: the command, then the code to scan */}
          <div style={{ width: 214, background: '#fff', borderRadius: 16, boxShadow: '0 2px 14px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.05)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '9px 12px', background: '#F1F0EC' }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#d6d5ce' }} />
              ))}
              <span style={{ marginLeft: 6, fontSize: 10.5, color: '#6b6b64', fontWeight: 600 }}>{deviceName}</span>
            </div>
            <div style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ alignSelf: 'flex-start', fontFamily: MONO, fontSize: 12.5, color: '#26261f' }}>
                <span style={{ color: '#6b6b64' }}>$ </span>npx copycam
              </div>
              <canvas ref={canvasRef} width={200} height={200} role="img" aria-label="QR code shown on the computer" style={{ width: 138, height: 138, display: 'block', imageRendering: 'pixelated' }} />
            </div>
          </div>

          <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#55554f', maxWidth: 270 }}>
            On your computer, run <b style={{ fontFamily: MONO, fontSize: 13 }}>npx copycam</b>. Point your phone at the QR code it shows. Same
            Wi‑Fi, no account.
          </div>
          {phase === 'connecting' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#161616', fontWeight: 600 }}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: '2.5px solid rgba(0,0,0,.12)',
                  borderTopColor: '#161616',
                  animation: 'ccSpin .7s linear infinite',
                  display: 'inline-block',
                }}
              />
              Linking to {deviceName}…
            </div>
          )}
          {phase === 'pair' && (
            <button
              onClick={startPair}
              style={{
                border: 'none',
                cursor: 'pointer',
                background: '#161616',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                padding: '13px 22px',
                borderRadius: 999,
                fontFamily: 'inherit',
              }}
            >
              Point at the QR code →
            </button>
          )}
        </div>
      )}

      {showCam && (
        <div style={{ position: 'absolute', inset: 0, background: '#141518' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 50% 30%,#26282c 0%,#141518 70%)' }} />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '44%',
              background: 'linear-gradient(180deg,rgba(88,74,58,.35),rgba(60,52,42,.5))',
            }}
          />
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            style={{
              position: 'absolute',
              left: '50%',
              top: '44%',
              transform: 'translate(-50%,-50%) rotate(-2deg)',
              width: 262,
              background: '#F6F5F0',
              borderRadius: 10,
              padding: '18px 20px',
              boxShadow: '0 18px 40px rgba(0,0,0,.5)',
              touchAction: review ? 'none' : 'auto',
              cursor: review ? 'text' : 'default',
              userSelect: 'none',
            }}
          >
            <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: 2, color: '#a6a49c', marginBottom: 10 }}>
              WIRELESS ROUTER — UNIT 04
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {LINES.map((line, li) => (
                <div key={li} style={{ fontFamily: MONO, fontSize: 12.5, color: '#26261f', whiteSpace: 'nowrap' }}>
                  {line.map((t, k) => {
                    const i = INDEX[li][k];
                    const picked = review && sel.picked.includes(i);
                    return (
                      <span key={i}>
                        {k > 0 && ' '}
                        <span
                          data-w={i}
                          style={{
                            padding: '2px 3px',
                            margin: '0 -3px',
                            borderRadius: 4,
                            transition: 'background .2s',
                            background: picked ? `color-mix(in srgb, ${accentColor} 45%, transparent)` : 'transparent',
                          }}
                        >
                          {t}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 12,
                height: 16,
                background: 'repeating-linear-gradient(90deg,#26261f 0 2px,transparent 2px 5px)',
                opacity: 0.55,
                borderRadius: 2,
              }}
            />
          </div>
          <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 120px rgba(0,0,0,.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: 26, top: 120, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.75)', borderTop: '3px solid rgba(255,255,255,.75)', borderRadius: '4px 0 0 0', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 26, top: 120, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.75)', borderTop: '3px solid rgba(255,255,255,.75)', borderRadius: '0 4px 0 0', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: 26, bottom: 170, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.75)', borderBottom: '3px solid rgba(255,255,255,.75)', borderRadius: '0 0 0 4px', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 26, bottom: 170, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.75)', borderBottom: '3px solid rgba(255,255,255,.75)', borderRadius: '0 0 4px 0', pointerEvents: 'none' }} />

          {phase === 'scanning' && (
            <div
              style={{
                position: 'absolute',
                left: '8%',
                right: '8%',
                height: 3,
                borderRadius: 3,
                background: accentColor,
                boxShadow: `0 0 22px 4px ${accentColor}`,
                animation: 'ccSweep 1.4s ease-in-out infinite alternate',
                top: '8%',
                pointerEvents: 'none',
              }}
            />
          )}

          <div
            style={{
              position: 'absolute',
              top: 66,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(20,21,24,.55)',
              backdropFilter: 'blur(10px)',
              border: '.5px solid rgba(255,255,255,.14)',
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 12.5,
              fontWeight: 600,
              color: '#fff',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: accentColor, flex: 'none', boxShadow: `0 0 8px ${accentColor}` }} />
            {deviceName} — linked
          </div>

          {review && (
            <div style={{ position: 'absolute', top: 154, left: 20, right: 20, display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={retake} disabled={sending} style={chip}>
                Retake
              </button>
              <span style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => updateSel(everything(WORDS.length))} disabled={sending} style={chip}>
                  All
                </button>
                <button onClick={() => updateSel(NOTHING)} disabled={sending} style={chip}>
                  Clear
                </button>
              </span>
            </div>
          )}

          {phase === 'idle' && (
            <div style={{ position: 'absolute', bottom: 186, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
              Frame the text, then tap the shutter
            </div>
          )}

          {(phase === 'idle' || phase === 'scanning') && (
            <button
              ref={shutterRef}
              onClick={scan}
              aria-label="Scan text"
              style={{
                position: 'absolute',
                bottom: 88,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 78,
                height: 78,
                borderRadius: '50%',
                border: '4px solid rgba(255,255,255,.85)',
                background: 'transparent',
                cursor: 'pointer',
                padding: 5,
                display: 'flex',
              }}
            >
              <span style={{ flex: 1, borderRadius: '50%', background: accentColor, display: 'block', boxShadow: '0 0 24px rgba(207,255,59,.35)' }} />
            </button>
          )}

          <div
            inert={!review}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              background: '#FAFAF7',
              borderRadius: '28px 28px 0 0',
              padding: '14px 18px 34px',
              transform: `translateY(${sheetY})`,
              transition: 'transform .5s cubic-bezier(.32,.72,.25,1)',
              boxShadow: '0 -8px 40px rgba(0,0,0,.35)',
            }}
          >
            <div style={{ width: 44, height: 5, borderRadius: 3, background: 'rgba(0,0,0,.18)', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6b6b64', marginBottom: 9 }}>{status}</div>
            <div
              data-testid="preview"
              aria-label={text}
              style={{
                minHeight: 88,
                padding: '10px 12px',
                background: '#fff',
                borderRadius: 12,
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)',
                fontFamily: MONO,
                fontSize: 13,
                lineHeight: 1.5,
                color: '#26261f',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                boxSizing: 'border-box',
              }}
            >
              {text.length === 0 ? (
                <span style={{ color: '#6b6b64' }}>Drag across the photo to select text.</span>
              ) : (
                marks.map((seg, i) =>
                  seg.mark === 'risky' ? (
                    <span
                      key={i}
                      style={{ textDecoration: 'underline dotted', textDecorationColor: '#c08a00', textUnderlineOffset: 3, background: 'rgba(207,255,59,.28)', borderRadius: 3 }}
                    >
                      {seg.t}
                    </span>
                  ) : seg.mark === 'space' ? (
                    <span key={i} style={{ color: '#c9c8c1' }} aria-hidden="true">
                      {'·'.repeat(seg.t.length)}
                    </span>
                  ) : (
                    <span key={i}>{seg.t}</span>
                  ),
                )
              )}
            </div>
            <div style={{ minHeight: 30, fontSize: 12, lineHeight: 1.4, color: '#6b6b64', padding: '7px 2px 9px' }}>
              {doubtful ? 'Look-alikes like 0 and O are underlined. Check them before you send.' : ''}
            </div>
            <button
              ref={sendRef}
              onClick={send}
              disabled={!canSend || sending}
              style={{
                width: '100%',
                border: 'none',
                cursor: canSend && !sending ? 'pointer' : 'default',
                borderRadius: 999,
                padding: '15px 20px',
                fontSize: 15,
                fontWeight: 700,
                fontFamily: 'inherit',
                transition: 'all .2s',
                background: sending ? '#161616' : !canSend ? 'rgba(0,0,0,.08)' : accentColor,
                color: sending ? '#fff' : !canSend ? 'rgba(0,0,0,.35)' : '#161616',
              }}
            >
              {sending ? 'Sending…' : !canSend ? 'Select text to send' : `Send to ${deviceName}`}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 9, fontFamily: MONO, fontSize: 11, color: '#6b6b64' }}>
              <svg width="10" height="12" viewBox="0 0 10 12" style={{ flex: 'none' }} aria-hidden="true">
                <rect x="0.75" y="5" width="8.5" height="6.25" rx="1.5" fill="none" stroke="#6b6b64" strokeWidth="1.5" />
                <path d="M2.5 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke="#6b6b64" strokeWidth="1.5" />
              </svg>
              end-to-end encrypted
            </div>
          </div>

          {phase === 'sent' && (
            <div
              style={{
                position: 'absolute',
                top: 120,
                left: '50%',
                transform: 'translateX(-50%)',
                animation: 'ccToast .35s cubic-bezier(.2,.9,.3,1.2) forwards',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: '#FAFAF7',
                borderRadius: 999,
                padding: '10px 18px 10px 12px',
                boxShadow: '0 10px 30px rgba(0,0,0,.4)',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: accentColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#161616',
                  flex: 'none',
                }}
              >
                ✓
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 650, color: '#161616' }}>On {deviceName}’s clipboard</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
