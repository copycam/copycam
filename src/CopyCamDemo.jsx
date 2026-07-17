import { useCallback, useEffect, useRef, useState } from 'react';

const INITIAL_BLOCKS = [
  { text: 'SSID: HOMEBASE_5G', sel: true },
  { text: 'Pass: corgi-battery-42', sel: true },
  { text: 'Guest: welcome-123', sel: true },
];

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

// Interactive CopyCam demo screen: pair -> connecting -> idle -> scanning -> review -> sending -> sent.
// Ported from the CopyCam design's embedded DC component logic.
export default function CopyCamDemo({ accentColor = '#CFFF3B', deviceName = 'My MacBook', autoSend = false, onPulse }) {
  const [phase, setPhase] = useState('pair');
  const [blocks, setBlocks] = useState(INITIAL_BLOCKS);
  // Timers fire several steps later, after multiple renders — refs keep the
  // guard checks below reading the current phase/blocks instead of a stale closure.
  const phaseRef = useRef(phase);
  const blocksRef = useRef(blocks);
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
  const updateBlocks = (updater) => {
    setBlocks((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      blocksRef.current = next;
      return next;
    });
  };

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

  const toggle = (i) => {
    if (phaseRef.current !== 'review') return;
    updateBlocks((prev) => prev.map((b, j) => (j === i ? { ...b, sel: !b.sel } : b)));
  };

  const send = () => {
    if (phaseRef.current !== 'review') return;
    if (!blocksRef.current.some((b) => b.sel)) return;
    updatePhase('sending');
    sendTimer.current = setTimeout(() => {
      haptic();
      beep(990);
      updatePhase('sent');
      resetTimer.current = setTimeout(() => {
        updatePhase('idle');
        updateBlocks((prev) => prev.map((b) => ({ ...b, sel: true })));
      }, 2300);
    }, 900);
  };

  const rescan = () => {
    clearTimeout(sendTimer.current);
    clearTimeout(resetTimer.current);
    updatePhase('idle');
    updateBlocks((prev) => prev.map((b) => ({ ...b, sel: true })));
  };

  const review = phase === 'review' || phase === 'sending';
  const sending = phase === 'sending';
  const showPair = phase === 'pair' || phase === 'connecting';
  const showCam = !showPair;
  const n = blocks.filter((b) => b.sel).length;
  const sendLabel = sending ? 'Sending…' : n === 0 ? 'Select text to send' : `Send ${n} ${n === 1 ? 'block' : 'blocks'} → ${deviceName}`;
  const sheetY = review ? '0%' : '112%';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
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
            padding: '0 36px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, fontWeight: 700, letterSpacing: 2, color: '#9a9a92' }}>
            PAIR ONCE
          </div>
          <div style={{ background: '#fff', borderRadius: 24, padding: 20, boxShadow: '0 2px 14px rgba(0,0,0,.07),0 0 0 1px rgba(0,0,0,.05)' }}>
            <canvas ref={canvasRef} width={200} height={200} style={{ width: 172, height: 172, display: 'block', imageRendering: 'pixelated' }} />
          </div>
          <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#55554f', maxWidth: 250 }}>
            Open <b style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 13 }}>copycam.app/link</b> on your computer and scan this code. Same
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#9a9a92' }}>
                Waiting for scan
                <span style={{ animation: 'ccDot 1.2s infinite' }}>&bull;</span>
                <span style={{ animation: 'ccDot 1.2s .2s infinite' }}>&bull;</span>
                <span style={{ animation: 'ccDot 1.2s .4s infinite' }}>&bull;</span>
              </div>
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
                Simulate desktop scan →
              </button>
            </div>
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
            }}
          >
            <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 9.5, fontWeight: 700, letterSpacing: 2, color: '#a6a49c', marginBottom: 10 }}>
              WIRELESS ROUTER — UNIT 04
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {blocks.map((b, i) => (
                <div
                  key={i}
                  style={
                    review
                      ? {
                          padding: '1px 6px',
                          margin: '0 -6px',
                          borderRadius: 6,
                          transition: 'all .25s',
                          background: b.sel ? `color-mix(in srgb, ${accentColor} 30%, transparent)` : undefined,
                          boxShadow: b.sel ? `0 0 0 1.5px ${accentColor}` : '0 0 0 1.5px rgba(0,0,0,.16)',
                          opacity: b.sel ? 1 : 0.45,
                        }
                      : { padding: '1px 6px', margin: '0 -6px', borderRadius: 6, transition: 'all .25s' }
                  }
                >
                  <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12.5, color: '#26261f', whiteSpace: 'nowrap' }}>{b.text}</span>
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
          <div style={{ position: 'absolute', left: 26, top: 120, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.75)', borderTop: '3px solid rgba(255,255,255,.75)', borderRadius: '4px 0 0 0' }} />
          <div style={{ position: 'absolute', right: 26, top: 120, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.75)', borderTop: '3px solid rgba(255,255,255,.75)', borderRadius: '0 4px 0 0' }} />
          <div style={{ position: 'absolute', left: 26, bottom: 170, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.75)', borderBottom: '3px solid rgba(255,255,255,.75)', borderRadius: '0 0 0 4px' }} />
          <div style={{ position: 'absolute', right: 26, bottom: 170, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.75)', borderBottom: '3px solid rgba(255,255,255,.75)', borderRadius: '0 0 4px 0' }} />

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

          {phase === 'idle' && (
            <div style={{ position: 'absolute', bottom: 186, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
              Frame the text, then tap
            </div>
          )}

          {(phase === 'idle' || phase === 'scanning') && (
            <button
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
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              background: '#FAFAF7',
              borderRadius: '28px 28px 0 0',
              padding: '14px 20px 40px',
              transform: `translateY(${sheetY})`,
              transition: 'transform .5s cubic-bezier(.32,.72,.25,1)',
              boxShadow: '0 -8px 40px rgba(0,0,0,.35)',
            }}
          >
            <div style={{ width: 38, height: 5, borderRadius: 3, background: 'rgba(0,0,0,.14)', margin: '0 auto 14px' }} />
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#161616' }}>{blocks.length} text blocks found</div>
              <button
                onClick={rescan}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#8a8a82', fontFamily: 'inherit', padding: 4 }}
              >
                Rescan
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
              {blocks.map((b, i) => (
                <div
                  key={i}
                  onClick={() => toggle(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    background: b.sel ? 'rgba(0,0,0,.045)' : 'transparent',
                    opacity: b.sel ? 1 : 0.5,
                    transition: 'all .2s',
                    userSelect: 'none',
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 800,
                      transition: 'all .2s',
                      background: b.sel ? accentColor : 'transparent',
                      color: b.sel ? '#161616' : 'transparent',
                      border: b.sel ? `1.5px solid ${accentColor}` : '1.5px solid rgba(0,0,0,.22)',
                    }}
                  >
                    ✓
                  </span>
                  <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 13, color: '#26261f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.text}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={send}
              disabled={n === 0}
              style={{
                width: '100%',
                border: 'none',
                cursor: n === 0 ? 'default' : 'pointer',
                borderRadius: 999,
                padding: '15px 20px',
                fontSize: 15,
                fontWeight: 700,
                fontFamily: 'inherit',
                transition: 'all .2s',
                background: n === 0 ? 'rgba(0,0,0,.08)' : sending ? '#161616' : accentColor,
                color: n === 0 ? 'rgba(0,0,0,.35)' : sending ? '#fff' : '#161616',
              }}
            >
              {sendLabel}
            </button>
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
