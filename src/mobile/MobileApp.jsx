import { useCallback, useEffect, useRef, useState } from 'react';
import { loadKey, forgetKey, call } from './api.js';
import { downscalePhoto, blobToBytes, frameToJpeg, computeFrame } from './image.js';
import { toB64u } from '../../shared/crypto.js';
import ImageReview from './ImageReview.jsx';

const ACC = '#CFFF3B';
const SCRIPT_STORAGE = 'copycam:script';

// Recognition scripts. There is no real script *detection* here — "Latin +
// CJK" is a fixed model, not a classifier, so it reads Arabic/Cyrillic/etc as
// garbage rather than switching to them automatically. The label says exactly
// what it covers so that isn't a surprise; picking the right script below is
// the reliable path for anything else. Every model also reads Latin, so mixed
// text (English + Russian, English + Greek…) works once the non-Latin script
// is picked. The choice is remembered, so a book only needs picking once.
const SCRIPTS = [
  { id: 'auto', label: 'Latin + CJK', hint: 'English, Spanish, French… plus Chinese, Japanese, Korean. Not Arabic, Hebrew, Cyrillic, or other scripts — pick those below.' },
  { id: 'small', label: 'Latin + CJK — more accurate', hint: 'same coverage as above, slower' },
  { id: 'cyrillic', label: 'Cyrillic', hint: 'Русский, Українська, Български + Latin' },
  { id: 'greek', label: 'Greek', hint: 'Ελληνικά + Latin' },
  { id: 'arabic', label: 'Arabic', hint: 'العربية, فارسی, اردو + Latin' },
  { id: 'devanagari', label: 'Devanagari', hint: 'हिन्दी, मराठी, नेपाली + Latin' },
  { id: 'korean', label: 'Korean', hint: '한국어 + Latin' },
  { id: 'japanese', label: 'Japanese', hint: '日本語 + Latin' },
  { id: 'thai', label: 'Thai', hint: 'ไทย + Latin' },
  { id: 'tamil', label: 'Tamil', hint: 'தமிழ் + Latin' },
  { id: 'telugu', label: 'Telugu', hint: 'తెలుగు + Latin' },
];
const scriptLabel = (id) => SCRIPTS.find((s) => s.id === id)?.label ?? 'Latin + CJK';

const ctlPill = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  border: 'none',
  cursor: 'pointer',
  background: 'rgba(20,21,24,.55)',
  backdropFilter: 'blur(10px)',
  boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.16)',
  color: '#fff',
  borderRadius: 999,
  padding: '8px 14px',
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

// Viewport size, kept current across rotation. iOS Safari can't be orientation
// locked from the page, so instead every size that matters is derived from this
// and the layout stays proportional rather than breaking in landscape.
function useViewport() {
  const [vp, setVp] = useState(() => ({
    w: typeof window === 'undefined' ? 390 : window.innerWidth,
    h: typeof window === 'undefined' ? 844 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return vp;
}

function Lock({ c = '#9a9a92' }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" style={{ flex: 'none' }} aria-hidden="true">
      <rect x="0.75" y="5" width="8.5" height="6.25" rx="1.5" fill="none" stroke={c} strokeWidth="1.5" />
      <path d="M2.5 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke={c} strokeWidth="1.5" />
    </svg>
  );
}

// Subtle reassurance line shown at trust-sensitive moments.
function SafetyNote({ text, color = '#9a9a92' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color }}>
      <Lock c={color} />
      {text}
    </div>
  );
}

// The real CopyCam phone app. Same visual language as the landing demo, but
// full-screen and driven by actual capture -> encrypted OCR -> clipboard send.
// Phases: unpaired | connecting | idle | scanning | review | sending | sent | error
export default function MobileApp() {
  const [phase, setPhase] = useState('connecting');
  const [pcName, setPcName] = useState('');
  // captured photo {url,width,height} + word geometry for the overlay review
  const [photo, setPhoto] = useState(null);
  const [geo, setGeo] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  // 'starting' -> 'live' (viewfinder running) | 'fallback' (photo-picker mode)
  const [cam, setCam] = useState('starting');
  // torch (camera flash) — only some browsers expose it; iOS Safari never does
  const [torchable, setTorchable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [script, setScript] = useState(() => {
    try {
      return localStorage.getItem(SCRIPT_STORAGE) || 'auto';
    } catch {
      return 'auto';
    }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerY, setPickerY] = useState(0);
  const [pickerDragging, setPickerDragging] = useState(false);
  const pickerDrag = useRef(null);
  const vp = useViewport();
  const FRAME = computeFrame(vp.w, vp.h);
  // The capture hint lives in the strip below the frame. Portrait has the
  // shutter down there too, so it sits above it; landscape's strip is only a
  // margin, so the hint centres in it. Either way it is clipped to the strip.
  const hintBottom = FRAME.landscape ? Math.max(10, Math.round(FRAME.bottom / 2) - 8) : 146;
  const hintMaxH = FRAME.bottom - hintBottom - 6;
  const keyRef = useRef(null);
  const fileInput = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const resetTimer = useRef(null);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks?.()[0];
      setTorchable(Boolean(track?.getCapabilities?.().torch));
      setTorchOn(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          const p = videoRef.current.play?.();
          if (p?.catch) p.catch(() => {});
        } catch {
          // autoplay hiccup — the video element will still render frames
        }
      }
      setCam('live');
    } catch {
      // no camera / permission denied / API unavailable -> photo-picker mode
      setCam('fallback');
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop()); // also kills the torch
    streamRef.current = null;
    setTorchOn(false);
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchable(false); // advertised but unusable — stop offering it
    }
  };

  const closePicker = () => {
    setPickerOpen(false);
    setPickerY(0);
  };

  const chooseScript = (value) => {
    setScript(value);
    closePicker();
    try {
      localStorage.setItem(SCRIPT_STORAGE, value);
    } catch {
      // private mode — the choice just won't persist
    }
  };

  // swipe the picker down from its header to dismiss
  const pickerDown = (e) => {
    pickerDrag.current = e.clientY;
    setPickerDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const pickerMove = (e) => {
    if (pickerDrag.current == null) return;
    setPickerY(Math.max(0, e.clientY - pickerDrag.current));
  };
  const pickerUp = () => {
    if (pickerDrag.current == null) return;
    pickerDrag.current = null;
    setPickerDragging(false);
    if (pickerY > 90) closePicker();
    else setPickerY(0);
  };

  const connect = useCallback(() => {
    setPhase('connecting');
    call(keyRef.current, 'hello', {})
      .then((ack) => {
        setPcName(ack.name);
        setPhase('idle');
      })
      .catch(() => {
        setErrorMsg('Can’t reach your computer. If CopyCam is running there and you’re on the same Wi-Fi, just rescan the QR it shows — that always re-links.');
        setPhase('error');
      });
  }, []);

  useEffect(() => {
    const key = loadKey();
    if (!key) {
      setPhase('unpaired');
      return;
    }
    keyRef.current = key;
    connect();
    return () => {
      clearTimeout(resetTimer.current);
      stopCamera();
    };
  }, [connect, stopCamera]);

  // Bring the viewfinder up as soon as we're linked.
  const linked = phase !== 'unpaired' && phase !== 'connecting' && phase !== 'error';
  useEffect(() => {
    if (linked) startCamera();
  }, [linked, startCamera]);

  const clearPhoto = useCallback(() => {
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setGeo(null);
  }, []);

  const submitJpeg = async ({ blob, width, height }) => {
    setPhase('scanning');
    clearPhoto();
    try {
      const bytes = await blobToBytes(blob);
      const ack = await call(keyRef.current, 'ocr', { img: toB64u(bytes), script });
      if (!ack.words?.length) {
        setErrorMsg('No text found in that photo — try again, closer and well-lit.');
        setPhase('error');
        return;
      }
      setPhoto({ url: URL.createObjectURL(blob), width, height });
      setGeo({ words: ack.words });
      setPhase('review');
    } catch {
      setErrorMsg('Scan failed. Check that your computer is still on the same Wi-Fi.');
      setPhase('error');
    }
  };

  const shutter = async () => {
    if (phase !== 'idle') return;
    if (cam === 'live' && videoRef.current) {
      try {
        const el = videoRef.current;
        // capture only the on-screen framing window, not the whole frame
        const cropCss = {
          left: FRAME.left,
          top: FRAME.top,
          width: el.clientWidth - FRAME.left - FRAME.right,
          height: el.clientHeight - FRAME.top - FRAME.bottom,
        };
        await submitJpeg(await frameToJpeg(el, cropCss));
        return;
      } catch {
        // frame grab failed (e.g. stream just died) — fall through to picker
      }
    }
    fileInput.current?.click();
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-capturing the same file
    if (!file) return;
    try {
      await submitJpeg(await downscalePhoto(file));
    } catch {
      setErrorMsg('Could not read that photo — try again.');
      setPhase('error');
    }
  };

  const sendText = async (text) => {
    if (!text || phase !== 'review') return;
    setPhase('sending');
    try {
      await call(keyRef.current, 'clip', { text });
      clearPhoto();
      setPhase('sent');
      resetTimer.current = setTimeout(() => setPhase('idle'), 2300);
    } catch {
      setErrorMsg('Sending failed — is CopyCam still running on your computer?');
      setPhase('error');
    }
  };

  const rescan = () => {
    clearPhoto();
    setPhase('idle');
  };

  const rePair = () => {
    forgetKey();
    setPhase('unpaired');
  };

  const review = phase === 'review' || phase === 'sending';
  const sending = phase === 'sending';

  // ---- full-screen instruction states -------------------------------------
  if (phase === 'unpaired' || phase === 'error' || phase === 'connecting') {
    return (
      <div style={{ minHeight: '100vh', background: '#FAFAF7', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '0 36px', textAlign: 'center', position: 'relative' }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1 }}>
          Copy<span style={{ background: ACC, padding: '2px 8px 4px', borderRadius: 10, marginLeft: 2 }}>Cam</span>
        </div>
        {phase === 'connecting' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
            <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2.5px solid rgba(0,0,0,.12)', borderTopColor: '#161616', animation: 'ccSpin .7s linear infinite', display: 'inline-block' }} />
            Linking…
          </div>
        )}
        {phase === 'unpaired' && (
          <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#55554f', maxWidth: 280 }}>
            Start CopyCam on your computer and scan the QR code it shows with your phone camera. That's the whole setup.
          </div>
        )}
        {phase === 'error' && (
          <>
            <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#55554f', maxWidth: 280 }}>{errorMsg}</div>
            <button onClick={connect} style={{ border: 'none', cursor: 'pointer', background: '#161616', color: '#fff', fontSize: 14, fontWeight: 600, padding: '13px 22px', borderRadius: 999, fontFamily: 'inherit' }}>
              Try again
            </button>
            <button onClick={rePair} style={{ border: 'none', cursor: 'pointer', background: 'none', color: '#8a8a82', fontSize: 13, fontWeight: 600, padding: 4, fontFamily: 'inherit' }}>
              Forget pairing
            </button>
          </>
        )}
        <div style={{ position: 'absolute', bottom: 'max(28px, env(safe-area-inset-bottom))', left: 0, right: 0 }}>
          <SafetyNote text="end-to-end encrypted · use Wi-Fi you trust" />
        </div>
      </div>
    );
  }

  // ---- camera / review ------------------------------------------------------
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#141518', overflow: 'hidden' }}>
      <input ref={fileInput} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />

      {/* live viewfinder; the gradient backdrop only shows in fallback mode */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: cam === 'live' ? 'block' : 'none' }}
      />
      {cam !== 'live' && (
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 50% 30%,#26282c 0%,#141518 70%)' }} />
      )}

      {/* scan window — only shown with the live camera, where we crop to it.
          In fallback (native camera) mode the whole photo is used, so we
          don't draw a frame that would falsely imply a crop. */}
      {cam === 'live' && (
        <>
          {/* dim everything outside the framed window */}
          <div style={{ position: 'absolute', left: FRAME.left, right: FRAME.right, top: FRAME.top, bottom: FRAME.bottom, borderRadius: 8, boxShadow: '0 0 0 9999px rgba(20,21,24,.5)', pointerEvents: 'none' }} />
          {/* corner brackets on the window edges */}
          <div style={{ position: 'absolute', left: FRAME.left, top: FRAME.top, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.85)', borderTop: '3px solid rgba(255,255,255,.85)', borderRadius: '6px 0 0 0' }} />
          <div style={{ position: 'absolute', right: FRAME.right, top: FRAME.top, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.85)', borderTop: '3px solid rgba(255,255,255,.85)', borderRadius: '0 6px 0 0' }} />
          <div style={{ position: 'absolute', left: FRAME.left, bottom: FRAME.bottom, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.85)', borderBottom: '3px solid rgba(255,255,255,.85)', borderRadius: '0 0 0 6px' }} />
          <div style={{ position: 'absolute', right: FRAME.right, bottom: FRAME.bottom, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.85)', borderBottom: '3px solid rgba(255,255,255,.85)', borderRadius: '0 0 6px 0' }} />
        </>
      )}

      {phase === 'scanning' && (
        <div style={{ position: 'absolute', left: '8%', right: '8%', height: 3, borderRadius: 3, background: ACC, boxShadow: `0 0 22px 4px ${ACC}`, animation: 'ccSweep 1.4s ease-in-out infinite alternate', top: '8%' }} />
      )}

      {/* linked pill */}
      <div style={{ position: 'absolute', top: 'max(24px, env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(20,21,24,.55)', backdropFilter: 'blur(10px)', border: '.5px solid rgba(255,255,255,.14)', borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACC, flex: 'none', boxShadow: `0 0 8px ${ACC}` }} />
        {pcName} — linked
      </div>

      {/* capture controls: flash (where the browser allows it) + script */}
      {(phase === 'idle' || phase === 'scanning') && (
        <div style={{ position: 'absolute', top: 'calc(max(24px, env(safe-area-inset-top)) + 46px)', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', padding: '0 16px' }}>
          {torchable && (
            <button onClick={toggleTorch} aria-label={torchOn ? 'Turn flash off' : 'Turn flash on'} aria-pressed={torchOn} style={{ ...ctlPill, background: torchOn ? ACC : ctlPill.background, color: torchOn ? '#161616' : '#fff' }}>
              <svg width="11" height="15" viewBox="0 0 11 15" aria-hidden="true" style={{ flex: 'none' }}>
                <path d="M6.5 1 1.5 8.2h3L4 14l5.5-7.4h-3L6.5 1z" fill={torchOn ? '#161616' : '#fff'} />
              </svg>
              Flash
            </button>
          )}
          {/* iOS Safari can't switch the torch on; its camera app can */}
          {cam === 'live' && !torchable && (
            <button onClick={() => fileInput.current?.click()} style={ctlPill} aria-label="Open the camera app, which has flash">
              <svg width="14" height="12" viewBox="0 0 16 14" aria-hidden="true" style={{ flex: 'none' }}>
                <path d="M1.4 4.2h3l1.2-2h4.8l1.2 2h3v8.4h-13V4.2z" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
                <circle cx="8" cy="8.4" r="2.6" fill="none" stroke="#fff" strokeWidth="1.4" />
              </svg>
              Camera app
            </button>
          )}
          <button
            onClick={() => {
              setPickerY(0);
              setPickerOpen(true);
            }}
            style={ctlPill}
            aria-label="Change text language"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none' }}>
              <circle cx="8" cy="8" r="6.6" fill="none" stroke="#fff" strokeWidth="1.4" />
              <path d="M1.6 8h12.8M8 1.4c3.4 3.7 3.4 9.5 0 13.2M8 1.4c-3.4 3.7-3.4 9.5 0 13.2" fill="none" stroke="#fff" strokeWidth="1.4" />
            </svg>
            {scriptLabel(script)}
          </button>
        </div>
      )}

      {/* script picker — tap the backdrop or swipe the header down to dismiss */}
      {pickerOpen && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,21,24,.55)', zIndex: 20, display: 'flex', alignItems: 'flex-end' }} onClick={closePicker}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FAFAF7',
              borderRadius: '22px 22px 0 0',
              width: '100%',
              maxHeight: '76%',
              display: 'flex',
              flexDirection: 'column',
              paddingBottom: 'calc(14px + env(safe-area-inset-bottom))',
              transform: `translateY(${pickerY}px)`,
              transition: pickerDragging ? 'none' : 'transform .25s cubic-bezier(.32,.72,.25,1)',
            }}
          >
            <div
              onPointerDown={pickerDown}
              onPointerMove={pickerMove}
              onPointerUp={pickerUp}
              onPointerCancel={pickerUp}
              aria-label="Drag down to close"
              style={{ flex: 'none', padding: '14px 0 0', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
            >
              <div style={{ width: 44, height: 5, borderRadius: 3, background: 'rgba(0,0,0,.16)', margin: '0 auto 12px' }} />
              <div style={{ padding: '0 20px 10px', fontSize: 15, fontWeight: 700 }}>Text language</div>
              <div style={{ padding: '0 20px 12px', fontSize: 12.5, lineHeight: 1.5, color: '#8a8a82' }}>
                Every option also reads Latin letters, so mixed text works — pick the non-Latin script in your photo.
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
            {SCRIPTS.map((s) => (
              <button
                key={s.id}
                onClick={() => chooseScript(s.id)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  gap: 12,
                  border: 'none',
                  cursor: 'pointer',
                  background: script === s.id ? 'rgba(0,0,0,.05)' : 'transparent',
                  padding: '12px 20px',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ width: 20, height: 20, borderRadius: 10, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, background: script === s.id ? ACC : 'transparent', color: script === s.id ? '#161616' : 'transparent', border: script === s.id ? `1.5px solid ${ACC}` : '1.5px solid rgba(0,0,0,.2)' }}>✓</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, color: '#161616' }}>{s.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8a8a82', marginTop: 2 }}>{s.hint}</span>
                </span>
              </button>
            ))}
            </div>
          </div>
        </div>
      )}

      {/* hidden outright when the strip below the frame is too short for text */}
      {phase === 'idle' && hintMaxH >= 16 && (
        // pinned to the strip below the frame's bottom edge, and clipped to
        // it, so the hint can never spill into the scan window
        <div
          style={{
            position: 'absolute',
            bottom: hintBottom,
            left: 0,
            right: 0,
            maxHeight: hintMaxH,
            overflow: 'hidden',
            textAlign: 'center',
            fontSize: 13,
            color: 'rgba(255,255,255,.65)',
            textShadow: '0 1px 4px rgba(0,0,0,.6)',
            // landscape keeps clear of the shutter now parked on the right
            padding: FRAME.landscape ? '0 116px 0 24px' : '0 24px',
          }}
        >
          {cam === 'live' ? 'Frame the text, then tap the shutter' : 'Tap the shutter, then photograph the text'}
          {/* the extra lines only appear where there is room for them */}
          {vp.h >= 520 && (
            <>
              <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.4, color: 'rgba(255,255,255,.44)' }}>
                {cam === 'live' ? 'Only what’s inside the frame is read' : 'Anything else in the photo is read too'}
              </div>
              <div style={{ marginTop: 6 }}>
                <SafetyNote text="end-to-end encrypted" color="rgba(255,255,255,.4)" />
              </div>
            </>
          )}
        </div>
      )}
      {phase === 'scanning' && (
        <div
          style={{
            position: 'absolute',
            bottom: hintBottom,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 13,
            color: 'rgba(255,255,255,.65)',
            textShadow: '0 1px 4px rgba(0,0,0,.6)',
            padding: FRAME.landscape ? '0 116px 0 24px' : '0 24px',
          }}
        >
          Reading text…
        </div>
      )}

      {(phase === 'idle' || phase === 'scanning') && (
        <button
          onClick={shutter}
          aria-label="Take photo of text"
          style={{
            position: 'absolute',
            // landscape puts the shutter under the thumb on the right edge;
            // portrait keeps it bottom-centre
            ...(FRAME.landscape
              ? { right: 'max(22px, env(safe-area-inset-right))', top: '50%', transform: 'translateY(-50%)' }
              : { bottom: 'max(64px, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)' }),
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
          <span style={{ flex: 1, borderRadius: '50%', background: ACC, display: 'block', boxShadow: '0 0 24px rgba(207,255,59,.35)', opacity: phase === 'scanning' ? 0.4 : 1 }} />
        </button>
      )}

      {/* image-overlay review with word-level drag selection */}
      {review && photo && geo && (
        <ImageReview
          photo={photo}
          words={geo.words}
          pcName={pcName}
          sending={sending}
          onSend={sendText}
          onRetake={rescan}
        />
      )}

      {phase === 'sent' && (
        <div style={{ position: 'absolute', top: 'max(90px, calc(env(safe-area-inset-top) + 60px))', left: '50%', transform: 'translateX(-50%)', animation: 'ccToast .35s cubic-bezier(.2,.9,.3,1.2) forwards', display: 'flex', alignItems: 'center', gap: 10, background: '#FAFAF7', borderRadius: 999, padding: '10px 18px 10px 12px', boxShadow: '0 10px 30px rgba(0,0,0,.4)', whiteSpace: 'nowrap' }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: ACC, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#161616', flex: 'none' }}>✓</span>
          <span style={{ fontSize: 13.5, fontWeight: 650, color: '#161616' }}>On {pcName}’s clipboard</span>
        </div>
      )}
    </div>
  );
}
