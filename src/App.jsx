import { useEffect, useRef, useState } from 'react';
import { IOSDevice } from './IOSDevice.jsx';
import CopyCamDemo from './CopyCamDemo.jsx';
import { GetCopyCam, Promises, Footer } from './Landing.jsx';

const DEVICE_W = 402;
const DEVICE_H = 874;

// The demo phone is drawn at a real phone's size; on a narrower screen (most
// visitors arrive from a phone) it is scaled down to fit instead of being cut off.
function useDeviceScale() {
  const measure = () => (typeof window === 'undefined' ? 1 : Math.min(1, (window.innerWidth - 32) / DEVICE_W));
  const [scale, setScale] = useState(measure);
  useEffect(() => {
    const onResize = () => setScale(measure());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

const STEPS = [
  'Pair once — scan the QR on your computer',
  'Frame the text and tap — pick the words you want',
  "Send — it's on your PC's clipboard",
];

export default function App({ accentColor = '#CFFF3B', deviceName = 'My MacBook', autoSend = false }) {
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef(null);
  const scale = useDeviceScale();

  const triggerPulse = () => {
    setPulse(false);
    clearTimeout(pulseTimer.current);
    // re-trigger the CSS keyframe by flipping off then on next frame
    requestAnimationFrame(() => setPulse(true));
    pulseTimer.current = setTimeout(() => setPulse(false), 720);
  };

  return (
    <>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 72,
          padding: '48px 40px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ maxWidth: 270, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1 }}>
            Copy
            <span style={{ background: accentColor, padding: '2px 8px 4px', borderRadius: 10, marginLeft: 2 }}>Cam</span>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.55, color: '#55554f' }}>
            Point your phone at any text. It lands on your computer&rsquo;s clipboard, over Wi&#8209;Fi. Nothing else.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13.5, color: '#3a3a36' }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <span
                  style={{
                    fontFamily: 'ui-monospace,Menlo,monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#161616',
                    color: '#fff',
                    borderRadius: 6,
                    padding: '2px 7px',
                    flex: 'none',
                  }}
                >
                  {i + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a8a82', fontFamily: 'ui-monospace,Menlo,monospace' }}>
            <svg width="10" height="12" viewBox="0 0 10 12" style={{ flex: 'none' }} aria-hidden="true">
              <rect x="0.75" y="5" width="8.5" height="6.25" rx="1.5" fill="none" stroke="#8a8a82" strokeWidth="1.5" />
              <path d="M2.5 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke="#8a8a82" strokeWidth="1.5" />
            </svg>
            end-to-end encrypted · use Wi-Fi you trust
          </div>
          <a
            href="#get"
            style={{
              alignSelf: 'flex-start',
              background: '#161616',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: 999,
              padding: '11px 20px',
              fontSize: 14.5,
              fontWeight: 700,
            }}
          >
            Get CopyCam <span style={{ color: accentColor }}>&darr;</span>
          </a>
          <div style={{ fontSize: 12, color: '#8a8a82', fontFamily: 'ui-monospace,Menlo,monospace' }}>
            interactive demo &mdash; try it {scale < 1 ? '↓' : '→'}
          </div>
        </div>

        <div style={{ width: DEVICE_W * scale, height: DEVICE_H * scale, flex: 'none' }}>
          <div style={{ position: 'relative', width: DEVICE_W, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            {pulse && (
              <div
                style={{
                  position: 'absolute',
                  inset: -14,
                  borderRadius: 60,
                  border: `3px solid ${accentColor}`,
                  animation: 'ccRing .7s ease-out forwards',
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
            )}
            <IOSDevice width={DEVICE_W} height={DEVICE_H}>
              <CopyCamDemo accentColor={accentColor} deviceName={deviceName} autoSend={autoSend} onPulse={triggerPulse} />
            </IOSDevice>
          </div>
        </div>
      </div>
      <GetCopyCam accentColor={accentColor} />
      <Promises />
      <Footer />
    </>
  );
}
