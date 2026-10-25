import { useEffect, useRef, useState } from 'react';
import { isIOS, canPromptInstall, promptInstall, markHomeTipDone, pairingHash } from './home.js';

// Keeping CopyCam one tap away on the phone: a one-time tip to add the page
// to the Home Screen, and a way to pair from inside the Home Screen app.
//
// An iPhone gives a Home Screen app storage of its own, apart from Safari's,
// so a pairing made in Safari doesn't come along: the app scans the
// computer's code once itself (ScanToPair). An Android phone shares the
// storage, so there's nothing to redo.

const ACC = '#CFFF3B';
const sheet = {
  position: 'absolute',
  left: 12,
  right: 12,
  bottom: 'max(14px, env(safe-area-inset-bottom))',
  zIndex: 30,
  background: '#FAFAF7',
  color: '#161616',
  borderRadius: 20,
  padding: '16px 18px',
  boxShadow: '0 12px 36px rgba(0,0,0,.45)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const button = {
  border: 'none',
  borderRadius: 999,
  padding: '11px 18px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  background: '#161616',
  color: '#fff',
  cursor: 'pointer',
};

function ShareIcon() {
  return (
    <svg width="13" height="16" viewBox="0 0 13 16" aria-label="Share" role="img" style={{ verticalAlign: '-2px' }}>
      <path d="M6.5 1v9M3.5 4l3-3 3 3" fill="none" stroke="#161616" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 7H2v8h9V7H9" fill="none" stroke="#161616" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Shown once, after the first link: how to add the page to the Home Screen.
export function HomeScreenTip({ onDone }) {
  const [canPrompt] = useState(canPromptInstall);
  const done = () => {
    markHomeTipDone();
    onDone();
  };
  const install = async () => {
    await promptInstall();
    done();
  };
  const ios = isIOS();
  return (
    <div role="dialog" aria-labelledby="home-tip-title" style={sheet}>
      <div id="home-tip-title" style={{ fontSize: 15.5, fontWeight: 750 }}>
        Keep CopyCam one tap away
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#3d3d38' }}>
        {ios ? (
          <>
            Tap <ShareIcon /> Share, then <b>Add to Home Screen</b>. The first time you open it from there, point it at your
            computer’s code once more: your iPhone keeps Home Screen apps separate from Safari.
          </>
        ) : canPrompt ? (
          <>Add it to your Home Screen, and it opens straight to the camera, linked.</>
        ) : (
          <>
            Open the browser menu (⋮) and choose <b>Add to Home screen</b>. It opens straight to the camera, linked.
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canPrompt && !ios && (
          <button type="button" style={{ ...button, background: ACC, color: '#161616' }} onClick={install}>
            Add to Home Screen
          </button>
        )}
        <button type="button" style={canPrompt && !ios ? { ...button, background: 'rgba(0,0,0,.06)', color: '#161616' } : button} onClick={done}>
          {canPrompt && !ios ? 'Not now' : 'Got it'}
        </button>
      </div>
    </div>
  );
}

// Reads the computer's pairing code with the camera, from inside the page:
// the only way a Home Screen app on an iPhone can be paired.
export function ScanToPair({ onPaired, onCancel }) {
  const video = useRef(null);
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    let stream = null;
    let timer = null;
    let live = true;
    (async () => {
      try {
        const { default: jsQR } = await import('jsqr');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!live) return;
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const look = () => {
          const v = video.current;
          if (!live || !v) return;
          if (v.videoWidth) {
            const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            const hash = code && pairingHash(code.data);
            if (hash) {
              live = false;
              onPaired(hash);
              return;
            }
            if (code) setProblem('That’s not a CopyCam code. Point at the code on copycam.app on your computer.');
          }
          timer = setTimeout(look, 250);
        };
        look();
      } catch {
        if (live) setProblem('The camera isn’t available. Allow it for this page, then try again.');
      }
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onPaired]);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#141518', zIndex: 40, display: 'flex', flexDirection: 'column' }}>
      <video ref={video} playsInline muted style={{ flex: 1, minHeight: 0, width: '100%', objectFit: 'cover' }} />
      <div style={{ padding: '16px 20px max(20px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12, color: '#fff' }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Point at the code on your computer</div>
        <div role="status" style={{ fontSize: 13, color: problem ? '#ffd0c4' : 'rgba(255,255,255,.65)', lineHeight: 1.45 }}>
          {problem || 'Open copycam.app on your computer: the code is on that page.'}
        </div>
        <button type="button" onClick={onCancel} style={{ ...button, background: 'rgba(255,255,255,.12)', alignSelf: 'flex-start' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
