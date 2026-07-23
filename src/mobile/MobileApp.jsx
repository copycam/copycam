import { useCallback, useEffect, useRef, useState } from 'react';
import { loadKey, forgetKey, call } from './api.js';
import { downscalePhoto, blobToBytes, frameToJpeg } from './image.js';
import { toB64u } from '../../shared/crypto.js';
import ImageReview from './ImageReview.jsx';

const ACC = '#CFFF3B';
// On-screen scan window (CSS px insets from the viewport edges). Shared by the
// corner brackets, the dim mask, and the capture crop so they always agree.
const FRAME = { side: 26, top: 96, bottom: 176 };

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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

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
      const ack = await call(keyRef.current, 'ocr', { img: toB64u(bytes) });
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
          left: FRAME.side,
          top: FRAME.top,
          width: el.clientWidth - FRAME.side * 2,
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
          <div style={{ position: 'absolute', left: FRAME.side, right: FRAME.side, top: FRAME.top, bottom: FRAME.bottom, borderRadius: 8, boxShadow: '0 0 0 9999px rgba(20,21,24,.5)', pointerEvents: 'none' }} />
          {/* corner brackets on the window edges */}
          <div style={{ position: 'absolute', left: FRAME.side, top: FRAME.top, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.85)', borderTop: '3px solid rgba(255,255,255,.85)', borderRadius: '6px 0 0 0' }} />
          <div style={{ position: 'absolute', right: FRAME.side, top: FRAME.top, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.85)', borderTop: '3px solid rgba(255,255,255,.85)', borderRadius: '0 6px 0 0' }} />
          <div style={{ position: 'absolute', left: FRAME.side, bottom: FRAME.bottom, width: 26, height: 26, borderLeft: '3px solid rgba(255,255,255,.85)', borderBottom: '3px solid rgba(255,255,255,.85)', borderRadius: '0 0 0 6px' }} />
          <div style={{ position: 'absolute', right: FRAME.side, bottom: FRAME.bottom, width: 26, height: 26, borderRight: '3px solid rgba(255,255,255,.85)', borderBottom: '3px solid rgba(255,255,255,.85)', borderRadius: '0 0 6px 0' }} />
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

      {phase === 'idle' && (
        <div style={{ position: 'absolute', bottom: 178, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,.65)', textShadow: '0 1px 4px rgba(0,0,0,.6)' }}>
          {cam === 'live' ? 'Frame the text, then tap the shutter' : 'Tap the shutter, then photograph the text'}
          <div style={{ marginTop: 8 }}>
            <SafetyNote text="end-to-end encrypted" color="rgba(255,255,255,.4)" />
          </div>
        </div>
      )}
      {phase === 'scanning' && (
        <div style={{ position: 'absolute', bottom: 186, left: 0, right: 0, textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,.65)' }}>
          Reading text…
        </div>
      )}

      {(phase === 'idle' || phase === 'scanning') && (
        <button
          onClick={shutter}
          aria-label="Take photo of text"
          style={{ position: 'absolute', bottom: 'max(64px, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', width: 78, height: 78, borderRadius: '50%', border: '4px solid rgba(255,255,255,.85)', background: 'transparent', cursor: 'pointer', padding: 5, display: 'flex' }}
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
