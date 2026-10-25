import { useCallback, useEffect, useRef, useState } from 'react';
import * as lan from './api.js';
import { isConnectionError, isPairingRejected } from './api.js';
import { downscalePhoto, blobToBytes, frameToJpeg, computeFrame, rotateBlob, CHROME } from './image.js';
import { toB64u } from '../../shared/crypto.js';
import ImageReview from './ImageReview.jsx';
import { HomeScreenTip, ScanToPair } from './HomeScreen.jsx';
import { shouldShowHomeTip } from './home.js';
import { SCRIPTS, scriptLabel } from './scripts.js';

const ACC = '#CFFF3B';

// What each failure tells the user — the same wording and the same ways out as
// the native app, so the two clients stay one product. A phone linked to a
// copycam.app tab ('web') reaches it through the internet, so the Wi-Fi isn't
// what to check there: the tab is.
const COPY = {
  lan: {
    unreachable:
      'Check CopyCam is still running on your computer and that both are on the same Wi-Fi. If its address changed, rescanning the QR it shows always re-links.',
    lostMidScan: 'The photo didn’t reach your computer. Check it’s still running and on the same Wi-Fi.',
    sendUnreachable: 'Couldn’t reach your computer. Check it’s running and on the same Wi-Fi.',
    unpaired: "Start CopyCam on your computer and scan the QR code it shows with your phone camera. That's the whole setup.",
    safety: 'end-to-end encrypted · use Wi-Fi you trust',
  },
  web: {
    unreachable:
      'Check copycam.app is still open on your computer. If you closed it, open it again: this phone reconnects by itself.',
    lostMidScan: 'The photo didn’t reach your computer. Check copycam.app is still open there.',
    sendUnreachable: 'Couldn’t reach your computer. Check copycam.app is still open there.',
    unpaired: "Open copycam.app on your computer and scan the QR code it shows with your phone camera. That's the whole setup.",
    safety: 'end-to-end encrypted',
  },
  pairingRejected:
    'Your computer no longer recognises this phone — its pairing code has changed. Scan the QR on its screen again.',
  noText: 'Nothing readable inside the frame. Move closer so the text fills it, and make sure it’s well lit.',
};

// A connection problem offers a retry and a rescan; a scan problem just goes
// back to the camera. Retrying the connection after a photo with no text in it
// was pointless, and that was the only button on offer.
const connectionProblem = (e, words) => ({
  kind: 'connection',
  message: isPairingRejected(e) ? COPY.pairingRejected : words.unreachable,
});


const ctaPrimary = {
  border: 'none',
  cursor: 'pointer',
  background: '#161616',
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  padding: '15px 22px',
  borderRadius: 999,
  fontFamily: 'inherit',
};
const ctaSecondary = { ...ctaPrimary, background: 'rgba(0,0,0,.05)', color: '#161616', fontWeight: 600 };
const SCRIPT_STORAGE = 'copycam:script';


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
  height: CHROME.pill,
  boxSizing: 'border-box',
  flex: 'none',
  padding: '0 14px',
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};

// The page's safe-area insets, which CSS knows and JS doesn't: measured off a
// hidden probe. Zero in an ordinary browser tab; non-zero full screen under a
// notch or a home indicator.
function readInsets() {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof document === 'undefined' || !document.body) return insets;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    insets[side] = parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0;
  }
  probe.remove();
  return insets;
}

const measureViewport = () => ({
  w: typeof window === 'undefined' ? 390 : window.innerWidth,
  h: typeof window === 'undefined' ? 844 : window.innerHeight,
  insets: readInsets(),
});

// Viewport size and safe-area insets, kept current across rotation. iOS Safari
// can't be orientation locked from the page, so instead every size that matters
// is derived from this and the layout stays proportional rather than breaking
// in landscape.
function useViewport() {
  const [vp, setVp] = useState(measureViewport);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      setVp(measureViewport());
      // iOS can report the new size a frame before the new insets
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVp(measureViewport()));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(frame);
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
//
// `transport` is how it reaches the computer: straight over the Wi-Fi to the
// companion (api.js, the default), or through copycam.app's relay to a browser
// tab (relay.js, with mode 'web').
export default function MobileApp({ transport = lan, mode = 'lan' }) {
  const { loadKey, forgetKey, call } = transport;
  const words = COPY[mode] ?? COPY.lan;
  const [phase, setPhase] = useState('connecting');
  const [pcName, setPcName] = useState('');
  // the scripts the computer's reader has, when it says (a copycam.app tab has
  // fewer than the companion); null means all of them
  const [readable, setReadable] = useState(null);
  // the computer has the text but is waiting for a click to copy it
  const [pending, setPending] = useState(false);
  // how the phone reaches the computer: 'direct' (on the Wi-Fi) or 'relay'
  // (through copycam.app); the companion's own page is always direct
  const [route, setRoute] = useState(mode === 'web' ? 'relay' : 'direct');
  const [homeTip, setHomeTip] = useState(false);
  const [scanning, setScanning] = useState(false);
  useEffect(() => transport.onRoute?.(setRoute), [transport]);
  // captured photo {url,width,height} + word geometry for the overlay review
  const [photo, setPhoto] = useState(null);
  const [geo, setGeo] = useState(null);
  const [wifi, setWifi] = useState(null);
  // { kind: 'connection', message } | { kind: 'scan', title, message }
  const [problem, setProblem] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [sendError, setSendError] = useState(null);
  // 'starting' -> 'live' (viewfinder running) | 'fallback' (photo-picker mode)
  const [cam, setCam] = useState('starting');
  // torch (camera flash) — only some browsers expose it; iOS Safari never does
  const [torchable, setTorchable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [script, setScript] = useState(() => {
    try {
      const stored = localStorage.getItem(SCRIPT_STORAGE);
      return SCRIPTS.some((s) => s.id === stored) ? stored : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerY, setPickerY] = useState(0);
  const [pickerDragging, setPickerDragging] = useState(false);
  const pickerDrag = useRef(null);
  const vp = useViewport();
  // the scan window, and where everything around it goes
  const FRAME = computeFrame(vp.w, vp.h, vp.insets);
  const keyRef = useRef(null);
  const fileInput = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  // The problem screens replace the whole camera view, so the viewfinder is a
  // fresh <video> each time it comes back; hand it the running stream then,
  // or it would stay black after a failed scan.
  const attachVideo = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      try {
        const p = el.play?.();
        if (p?.catch) p.catch(() => {});
      } catch {
        // autoplay hiccup — the video element will still render frames
      }
    }
  }, []);
  // held still on the shot while the PC reads it, as the native app does
  const frozen = useRef(false);
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

  // A code scanned from inside the page pairs it just as the camera's link does.
  const onScanned = useCallback((hash) => {
    history.replaceState(null, '', `${window.location.pathname}${hash}`);
    window.location.reload();
  }, []);

  const connect = useCallback(() => {
    setPhase('connecting');
    call(keyRef.current, 'hello', {})
      .then((ack) => {
        setPcName(ack.name);
        setReadable(Array.isArray(ack.scripts) ? ack.scripts : null);
        setPhase('idle');
        // once, after the first link: how to keep it on the Home Screen
        if (mode === 'web' && shouldShowHomeTip()) setHomeTip(true);
      })
      .catch((e) => {
        setProblem(connectionProblem(e, words));
        setPhase('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the transport is fixed for the page's life
  }, []);

  // Try again stays on the problem screen and shows progress on its own button,
  // matching the native app, instead of bouncing through the linking screen.
  const retryConnection = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const ack = await call(keyRef.current, 'hello', {});
      setPcName(ack.name);
      setReadable(Array.isArray(ack.scripts) ? ack.scripts : null);
      setProblem(null);
      setPhase('idle');
    } catch (e) {
      setProblem(connectionProblem(e, words));
    } finally {
      setRetrying(false);
    }
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the transport is fixed for the page's life
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

  // the stored choice, unless this computer's reader doesn't have it
  const usable = (id) => (!readable || readable.includes(id) ? id : (readable[0] ?? 'auto'));

  const submitJpeg = async ({ blob, width, height }) => {
    setPhase('scanning');
    clearPhoto();
    try {
      const bytes = await blobToBytes(blob);
      const ack = await call(keyRef.current, 'ocr', { img: toB64u(bytes), script: usable(script) });
      // a photo of just a Wi-Fi QR carries no text, and is still a good scan
      if (!ack.words?.length && !ack.wifi) {
        setProblem({ kind: 'scan', title: 'No text found', message: COPY.noText });
        setPhase('error');
        return;
      }
      setWifi(ack.wifi ?? null);
      // The server reads the text to decide which way up it was and reports the
      // turn it used; match it so the highlights land on the words.
      let shown = { blob, width, height };
      if (ack.rotation) {
        try {
          const turned = await rotateBlob(blob, ack.rotation);
          shown = { blob: turned.blob, width: turned.width, height: turned.height };
        } catch {
          // keep the unrotated photo rather than losing a good scan
        }
      }
      setPhoto({ url: URL.createObjectURL(shown.blob), width: shown.width, height: shown.height });
      setGeo({ words: ack.words ?? [] });
      setSendError(null);
      setPhase('review');
    } catch (e) {
      setProblem(
        isConnectionError(e) || isPairingRejected(e)
          ? { kind: 'connection', message: isPairingRejected(e) ? COPY.pairingRejected : words.lostMidScan }
          : { kind: 'scan', title: 'That scan didn’t work', message: 'Something went wrong reading the photo. Try again.' },
      );
      setPhase('error');
    }
  };

  const resumeViewfinder = () => {
    if (!frozen.current) return;
    frozen.current = false;
    try {
      const p = videoRef.current?.play?.();
      if (p?.catch) p.catch(() => {});
    } catch {
      // the next attach plays it
    }
  };
  // Live again as soon as the scan is over, however it ended. Keyed on the
  // phase alone: the shutter freezes while still idle, before the frame has
  // been encoded, and nothing may thaw it until the scan has come and gone.
  useEffect(() => {
    if (phase !== 'scanning') resumeViewfinder();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, [phase]);

  const shutter = async () => {
    if (phase !== 'idle') return;
    if (cam === 'live' && videoRef.current) {
      try {
        const el = videoRef.current;
        // Hold the viewfinder on this frame while the PC reads it, so the phone
        // can be lowered straight away — and the frame grabbed below is then
        // exactly the one left on screen.
        frozen.current = true;
        el.pause?.();
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
        resumeViewfinder();
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
      setProblem({ kind: 'scan', title: 'Couldn’t open that photo', message: 'Try taking it again.' });
      setPhase('error');
    }
  };

  const sendText = async (text) => {
    if (!text || phase !== 'review') return;
    setSendError(null);
    setPhase('sending');
    try {
      const ack = await call(keyRef.current, 'clip', { text });
      setPending(Boolean(ack?.pending));
      clearPhoto();
      setPhase('sent');
      resetTimer.current = setTimeout(() => setPhase('idle'), 2300);
    } catch (e) {
      // stay on the review: the photo, selection and any edits all survive, so
      // the fix is one more tap rather than a rescan
      setSendError(
        isPairingRejected(e)
          ? 'Your computer no longer recognises this phone. Retake, then rescan its QR.'
          : isConnectionError(e)
            ? words.sendUnreachable
            : 'Your computer couldn’t put that on its clipboard.',
      );
      setPhase('review');
    }
  };

  const rescan = () => {
    clearPhoto();
    setWifi(null);
    setSendError(null);
    setProblem(null);
    setPhase('idle');
  };

  const rePair = () => {
    forgetKey();
    setProblem(null);
    setPhase('unpaired');
  };

  const review = phase === 'review' || phase === 'sending';
  const sending = phase === 'sending';
  const choosable = readable ? SCRIPTS.filter((s) => readable.includes(s.id)) : SCRIPTS;

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
            {words.unpaired}
          </div>
        )}
        {/* a Home Screen app can't be opened by the camera's link, so it scans the code itself */}
        {phase === 'unpaired' && mode === 'web' && (
          <button onClick={() => setScanning(true)} style={ctaSecondary}>
            Scan the code with this page
          </button>
        )}
        {scanning && <ScanToPair onPaired={onScanned} onCancel={() => setScanning(false)} />}
        {phase === 'error' && problem && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 10, width: '100%', maxWidth: 320 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.4 }}>
              {problem.kind === 'connection' ? `Can’t reach ${pcName || 'your computer'}` : problem.title}
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.5, color: '#55554f', marginBottom: 14 }}>{problem.message}</div>
            {problem.kind === 'connection' ? (
              <>
                <button onClick={retryConnection} disabled={retrying} style={{ ...ctaPrimary, opacity: retrying ? 0.8 : 1 }}>
                  {retrying ? 'Reconnecting…' : 'Try again'}
                </button>
                <button onClick={rePair} style={ctaSecondary}>
                  Scan the pairing code again
                </button>
              </>
            ) : (
              <button onClick={rescan} style={ctaPrimary}>
                Scan again
              </button>
            )}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 'max(28px, env(safe-area-inset-bottom))', left: 0, right: 0 }}>
          <SafetyNote text={words.safety} />
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
        ref={attachVideo}
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

      {/* the sweep stays inside the window rather than crossing the pills */}
      {phase === 'scanning' && (
        <div style={{ position: 'absolute', left: FRAME.left + 10, right: FRAME.right + 10, top: FRAME.top, bottom: FRAME.bottom, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 3, background: ACC, boxShadow: `0 0 22px 4px ${ACC}`, animation: 'ccSweep 1.4s ease-in-out infinite alternate', top: '8%' }} />
        </div>
      )}

      {/* linked pill, then the capture controls: under it in portrait, beside
          it in landscape, where height is what the scan window is short of */}
      <div
        style={{
          position: 'absolute',
          top: FRAME.pillsTop,
          // over the window's centre, which landscape's shutter column moves left
          left: FRAME.landscape ? FRAME.left : vp.insets.left + 16,
          right: FRAME.landscape ? FRAME.right : vp.insets.right + 16,
          display: 'flex',
          flexDirection: FRAME.landscape ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: CHROME.pillGap,
          pointerEvents: 'none',
        }}
      >
        <div style={{ ...ctlPill, gap: 8, cursor: 'default', flex: '0 1 auto', minWidth: 0, maxWidth: FRAME.landscape ? 260 : '100%' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACC, flex: 'none', boxShadow: `0 0 8px ${ACC}` }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Linked · {route === 'direct' ? 'direct on Wi-Fi' : 'through copycam.app'}</span>
        </div>

        {/* capture controls: flash (where the browser allows it) + script */}
        {(phase === 'idle' || phase === 'scanning') && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: CHROME.pillGap, maxWidth: '100%', pointerEvents: 'auto' }}>
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
          {choosable.length > 1 && (
          <button
            onClick={() => {
              setPickerY(0);
              setPickerOpen(true);
            }}
            style={{ ...ctlPill, flex: '0 1 auto', minWidth: 0 }}
            aria-label="Change text language"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none' }}>
              <circle cx="8" cy="8" r="6.6" fill="none" stroke="#fff" strokeWidth="1.4" />
              <path d="M1.6 8h12.8M8 1.4c3.4 3.7 3.4 9.5 0 13.2M8 1.4c-3.4 3.7-3.4 9.5 0 13.2" fill="none" stroke="#fff" strokeWidth="1.4" />
            </svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{scriptLabel(usable(script))}</span>
          </button>
          )}
        </div>
        )}
      </div>

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
            {choosable.map((s) => (
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

      {/* The hint sits between the window and the shutter, in exactly the
          lines computeFrame made room for, centred under the window. It is
          still clipped to that room, so an unexpectedly wide font can't push
          it into the window. */}
      {(phase === 'idle' || phase === 'scanning') && FRAME.hintLines > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: FRAME.hintBottom,
            left: FRAME.left,
            right: FRAME.right,
            maxHeight: FRAME.hintLines > 1 ? CHROME.hintLine + CHROME.hintLine2 : CHROME.hintLine,
            overflow: 'hidden',
            textAlign: 'center',
            fontSize: 13,
            lineHeight: `${CHROME.hintLine}px`,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            color: 'rgba(255,255,255,.65)',
            textShadow: '0 1px 4px rgba(0,0,0,.6)',
          }}
        >
          {phase === 'scanning'
            ? 'Reading text…'
            : cam === 'live'
              ? 'Frame the text, then tap the shutter'
              : 'Tap the shutter, then photograph the text'}
          {phase === 'idle' && FRAME.hintLines > 1 && (
            <div style={{ marginTop: CHROME.hintLine2 - 16, fontSize: 11.5, lineHeight: '16px', color: 'rgba(255,255,255,.44)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {cam === 'live' ? 'Only what’s inside the frame is read' : 'Anything else in the photo is read too'}
            </div>
          )}
        </div>
      )}

      {/* under the shutter, where the linking screen keeps it too */}
      {(phase === 'idle' || phase === 'scanning') && FRAME.note && (
        <div style={{ position: 'absolute', bottom: FRAME.noteBottom, left: 0, right: 0, height: CHROME.note, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <SafetyNote text="end-to-end encrypted" color="rgba(255,255,255,.4)" />
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
              ? { right: FRAME.shutterEdge, top: '50%', transform: 'translateY(-50%)' }
              : { bottom: FRAME.shutterEdge, left: '50%', transform: 'translateX(-50%)' }),
            width: CHROME.shutter,
            height: CHROME.shutter,
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
          wifi={wifi}
          sending={sending}
          sendError={sendError}
          onSend={sendText}
          onRetake={rescan}
        />
      )}

      {homeTip && phase === 'idle' && <HomeScreenTip onDone={() => setHomeTip(false)} />}

      {phase === 'sent' && (
        <div style={{ position: 'absolute', top: 'max(90px, calc(env(safe-area-inset-top) + 60px))', left: '50%', transform: 'translateX(-50%)', animation: 'ccToast .35s cubic-bezier(.2,.9,.3,1.2) forwards', display: 'flex', alignItems: 'center', gap: 10, background: '#FAFAF7', borderRadius: 999, padding: '10px 18px 10px 12px', boxShadow: '0 10px 30px rgba(0,0,0,.4)', whiteSpace: 'nowrap' }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: ACC, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#161616', flex: 'none' }}>✓</span>
          <span style={{ fontSize: 13.5, fontWeight: 650, color: '#161616' }}>
            {pending ? `Sent · click Copy on ${pcName}` : `On ${pcName}’s clipboard`}
          </span>
        </div>
      )}
    </div>
  );
}
