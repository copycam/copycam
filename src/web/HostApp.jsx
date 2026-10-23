import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { fromB64u } from '../../shared/crypto.js';
import { createHost } from '../../shared/host.js';
import { loadPairing, newCode, phoneLink, computerName } from './pairing.js';
import { useOnPhone } from '../useOnPhone.js';

// copycam.app/app: the computer's side of CopyCam in a browser tab, for people
// who'd rather not install anything. The tab shows the pairing QR, reads the
// phone's photos itself (reader.js), and puts what the phone sends on the
// clipboard: straight away while the tab is in front, or on a click (or when
// the tab comes back to the front) otherwise, because a browser only lets the
// page you're looking at write the clipboard.

const ACC = '#CFFF3B';
const MONO = 'ui-monospace,Menlo,monospace';
const card = {
  background: '#fff',
  borderRadius: 18,
  padding: '22px 22px 20px',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
};
const h2 = { fontSize: 17, fontWeight: 750, margin: 0, letterSpacing: -0.3 };
const body = { fontSize: 14, lineHeight: 1.6, color: '#55554f', margin: 0 };
const note = { fontSize: 12.5, lineHeight: 1.55, color: '#6b6b64', margin: 0 };
const button = {
  border: 'none',
  borderRadius: 999,
  padding: '9px 16px',
  fontFamily: 'inherit',
  fontSize: 13.5,
  fontWeight: 700,
  background: '#161616',
  color: '#fff',
  cursor: 'pointer',
};
const quiet = { ...button, background: 'rgba(0,0,0,.06)', color: '#161616', fontWeight: 600 };
const link = { ...quiet, background: 'none', padding: '6px 0', textDecoration: 'underline', textUnderlineOffset: 3 };

const MAX_ITEMS = 20;
const mb = (n) => `${Math.round(n / 1e6)} MB`;

// The older way to copy, for browsers (and settings) that refuse the
// clipboard API. It only works during a click, which is when it's used.
function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    // refused
  }
  area.remove();
  return ok;
}

function Logo() {
  return (
    <a href="/" aria-label="CopyCam home" style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.8, textDecoration: 'none', color: '#161616' }}>
      Copy<span style={{ background: ACC, padding: '1px 7px 3px', borderRadius: 8, marginLeft: 2 }}>Cam</span>
    </a>
  );
}

function StatusPill({ online, phones, ready }) {
  const [dot, text] = !online
    ? ['#c9c9c0', 'Connecting…']
    : phones > 0
      ? [ACC, phones > 1 ? `${phones} phones linked` : 'Phone linked']
      : [ready ? '#9be36d' : '#e8d77a', 'Waiting for your phone'];
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 650 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: dot, boxShadow: phones > 0 ? `0 0 8px ${ACC}` : 'none' }} />
      {text}
    </div>
  );
}

function ReaderStatus({ progress, onRetry }) {
  if (progress.failed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ ...body, color: '#8a2a1b' }}>The text reader couldn’t load. Check your connection.</p>
        <button type="button" style={quiet} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (progress.ready) {
    return <p style={note}>Text reader ready. Photos are read here, in this tab.</p>;
  }
  const share = progress.total ? Math.min(1, progress.loaded / progress.total) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={note}>
        Getting the text reader ready{progress.total ? ` · ${mb(progress.loaded)} of ${mb(progress.total)}` : '…'} (once: this
        browser keeps it)
      </p>
      <div
        role="progressbar"
        aria-label="Text reader download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,.07)', overflow: 'hidden' }}
      >
        <div style={{ width: `${share * 100}%`, height: '100%', background: '#161616', transition: 'width .2s' }} />
      </div>
    </div>
  );
}

function Received({ items, onCopy, onClear }) {
  if (!items.length) {
    return (
      <p style={body}>
        Nothing yet. What you send from your phone shows up here, and goes straight onto the clipboard while this tab is in
        front.
      </p>
    );
  }
  return (
    <>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item) => (
          <li key={item.id} style={{ border: '1px solid rgba(0,0,0,.08)', borderRadius: 12, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: MONO, fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 150, overflowY: 'auto', color: '#161616' }}>
              {item.text}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#8a8a82' }}>
                {new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {item.copied ? (
                <span style={{ fontSize: 12, fontWeight: 700, background: ACC, borderRadius: 999, padding: '4px 10px' }}>Copied ✓</span>
              ) : (
                <button type="button" style={{ ...button, padding: '6px 14px', fontSize: 12.5 }} onClick={() => onCopy(item, true)}>
                  Copy
                </button>
              )}
            </div>
            {item.refused && !item.copied && (
              <p style={{ ...note, color: '#8a2a1b' }}>This browser won’t let the page copy. Select the text above and press Ctrl+C (⌘C on a Mac).</p>
            )}
          </li>
        ))}
      </ol>
      <div>
        <button type="button" style={link} onClick={onClear}>
          Clear the list
        </button>
      </div>
    </>
  );
}

// reader: from createReader(); connect: connectHost from relay-host.js. Both
// are passed in so the page can be tested without a worker or a relay.
export default function HostApp({ reader, connect, storage = globalThis.localStorage, nav = globalThis.navigator }) {
  const [pairing, setPairing] = useState(() => loadPairing(storage));
  const [qr, setQr] = useState(null);
  const [relay, setRelay] = useState({ online: false, phones: 0, replaced: false });
  const [progress, setProgress] = useState({ loaded: 0, total: 0, ready: false, failed: null });
  const [items, setItems] = useState([]);
  const [showCode, setShowCode] = useState(true);
  const [alerts, setAlerts] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const [announcement, setAnnouncement] = useState('');
  const [attempt, setAttempt] = useState(0); // bumps to reconnect after being replaced
  const waiting = useRef(null); // the item still to be copied when the tab comes back to the front
  const nextId = useRef(0);
  const name = useMemo(() => computerName(nav), [nav]);
  const touch = useOnPhone();

  useEffect(() => reader.onProgress(setProgress), [reader]);

  useEffect(() => {
    let live = true;
    phoneLink(pairing)
      .then((url) => QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#161616', light: '#ffffff' } }))
      .then((svg) => live && setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [pairing]);

  // The code collapses once a phone is linked, and comes back when none is.
  useEffect(() => {
    setShowCode(relay.phones === 0);
  }, [relay.phones]);

  const markCopied = useCallback((id) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, copied: true } : i)));
    if (waiting.current?.id === id) waiting.current = null;
    document.title = 'CopyCam';
  }, []);

  // `byHand`: the person clicked Copy, so the older method may be tried, and a
  // refusal is worth explaining
  const copy = useCallback(
    async (item, byHand = false) => {
      let ok = false;
      try {
        await nav.clipboard.writeText(item.text);
        ok = true;
      } catch {
        ok = byHand && legacyCopy(item.text);
      }
      if (ok) {
        markCopied(item.id);
        setAnnouncement('Copied to the clipboard');
      } else if (byHand) {
        setItems((list) => list.map((i) => (i.id === item.id ? { ...i, refused: true } : i)));
      }
      return ok;
    },
    [nav, markCopied],
  );

  const alert = useCallback(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      // never the text itself: it may well be a password
      const n = new Notification('Text from your phone', { body: 'Click to copy it.', tag: 'copycam', icon: '/favicon.svg' });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
  }, []);

  // Coming back to the tab finishes a copy that had to wait for it.
  useEffect(() => {
    const onFocus = () => {
      if (waiting.current) copy(waiting.current);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [copy]);

  // What answers the phone. Rebuilt when the key changes; the relay always
  // calls the current one.
  const handleRef = useRef(null);
  handleRef.current = useMemo(
    () =>
      createHost({
        key: fromB64u(pairing.k),
        name,
        info: { scripts: ['auto'] },
        deps: {
          ocr: (bytes, script) => reader.ocr(bytes, script),
          wifi: (bytes) => reader.wifi(bytes),
          clipboard: async (text) => {
            const item = { id: nextId.current++, text, at: Date.now(), copied: false };
            setItems((list) => [item, ...list].slice(0, MAX_ITEMS));
            if (document.hasFocus() && (await copy(item))) return { copied: true };
            waiting.current = item;
            document.title = '• Text ready · CopyCam';
            setAnnouncement('Text from your phone is ready to copy');
            alert();
            return { copied: false };
          },
        },
      }),
    [pairing.k, name, reader, copy, alert],
  );

  useEffect(() => {
    const line = connect({ secret: pairing.s, handle: (ep, box) => handleRef.current(ep, box), onStatus: setRelay });
    return () => line.close();
  }, [connect, pairing.s, attempt]);

  const rotate = () => {
    if (!window.confirm('Make a new pairing code? Phones linked now will need to scan the new one.')) return;
    setPairing((p) => newCode(p, storage));
    setShowCode(true);
  };

  const askAlerts = async () => {
    try {
      setAlerts(await Notification.requestPermission());
    } catch {
      setAlerts('denied');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f1f0ec' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '22px 20px 48px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Logo />
          <StatusPill online={relay.online} phones={relay.phones} ready={progress.ready} />
        </header>

        {touch && (
          <div style={{ ...card, background: '#161616', color: '#fff' }}>
            <p style={{ ...body, color: '#e7e7df' }}>
              This page belongs on your computer. Open <strong style={{ color: '#fff' }}>copycam.app</strong> there, then scan the code it
              shows with this phone.
            </p>
          </div>
        )}

        {relay.replaced && (
          <div role="alert" style={{ ...card, border: `2px solid #161616` }}>
            <h2 style={h2}>CopyCam is open in another tab</h2>
            <p style={body}>Only one tab can be linked at a time, and the other one took over.</p>
            <div>
              <button type="button" style={button} onClick={() => setAttempt((n) => n + 1)}>
                Use this tab instead
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <section aria-labelledby="pair-title" style={{ ...card, flex: '1 1 320px' }}>
            <h2 id="pair-title" style={h2}>
              {relay.phones > 0 ? 'Your phone is linked' : 'Scan this with your phone'}
            </h2>
            {showCode ? (
              <>
                <div style={{ alignSelf: 'center', width: 232, height: 232, borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {qr ? (
                    <img src={qr} width={216} height={216} alt="Pairing code: scan it with your phone’s camera" style={{ imageRendering: 'pixelated' }} />
                  ) : (
                    <span style={note}>Making a code…</span>
                  )}
                </div>
                <ol style={{ ...body, paddingLeft: 20, margin: 0 }}>
                  <li>Point your phone’s camera at the code, and open the link.</li>
                  <li>Point the phone at text, and tap the shutter.</li>
                  <li>Drag across the words you want, and tap Send.</li>
                </ol>
                <p style={note}>Your phone doesn’t need to be on this Wi-Fi. It stays linked: next time, just open the page on both.</p>
                {relay.phones > 0 && (
                  <div>
                    <button type="button" style={link} onClick={() => setShowCode(false)}>
                      Hide the code
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p style={body}>Point it at text and send: it lands here. Keep this tab open while you scan.</p>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <button type="button" style={link} onClick={() => setShowCode(true)}>
                    Link another phone
                  </button>
                  <button type="button" style={link} onClick={rotate}>
                    Unlink phones (new code)
                  </button>
                </div>
              </>
            )}
            <ReaderStatus progress={progress} onRetry={reader.retry} />
          </section>

          <section aria-labelledby="got-title" style={{ ...card, flex: '1 1 380px' }}>
            <h2 id="got-title" style={h2}>
              From your phone
            </h2>
            <Received
              items={items}
              onCopy={copy}
              onClear={() => {
                setItems([]);
                waiting.current = null;
                document.title = 'CopyCam';
              }}
            />
            {alerts === 'default' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderTop: '1px solid rgba(0,0,0,.07)', paddingTop: 12 }}>
                <p style={{ ...note, flex: '1 1 220px' }}>Working in another window? Get a notice when text arrives, and click it to copy.</p>
                <button type="button" style={quiet} onClick={askAlerts}>
                  Turn on notices
                </button>
              </div>
            )}
          </section>
        </div>

        <p style={{ ...note, maxWidth: 720 }}>
          Your photos are read here, in this tab. On the way they pass through copycam.app encrypted end to end: it can’t read them,
          and keeps nothing. Prefer the clipboard filled with no click at all, or to stay entirely on your own network?{' '}
          <a href="/#get">Install the desktop companion</a>.
        </p>
        <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
          <a href="/">About CopyCam</a>
          <a href="https://github.com/copycam/copycam/blob/main/docs/troubleshooting.md">Help</a>
          <a href="/privacy/">Privacy</a>
          <a href="https://github.com/copycam/copycam">Source code</a>
        </nav>
        <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {announcement}
        </div>
      </div>
    </div>
  );
}
