import { useRef, useState } from 'react';
import { IOSDevice } from './IOSDevice.jsx';
import CopyCamDemo from './CopyCamDemo.jsx';

const STEPS = [
  'Pair once — scan the QR on your computer',
  'Frame the text and tap — pick the words you want',
  "Send — it's on your PC's clipboard",
];

export default function App({ accentColor = '#CFFF3B', deviceName = 'My MacBook', autoSend = false }) {
  const [pulse, setPulse] = useState(false);
  const pulseTimer = useRef(null);

  const triggerPulse = () => {
    setPulse(false);
    clearTimeout(pulseTimer.current);
    // re-trigger the CSS keyframe by flipping off then on next frame
    requestAnimationFrame(() => setPulse(true));
    pulseTimer.current = setTimeout(() => setPulse(false), 720);
  };

  return (
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
        <div style={{ fontSize: 12, color: '#8a8a82', fontFamily: 'ui-monospace,Menlo,monospace' }}>interactive demo — try it →</div>
      </div>

      <div style={{ position: 'relative', flex: 'none' }}>
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
        <IOSDevice width={402} height={874}>
          <CopyCamDemo accentColor={accentColor} deviceName={deviceName} autoSend={autoSend} onPulse={triggerPulse} />
        </IOSDevice>
      </div>
    </div>
  );
}
