import { useState } from 'react';

// The sections under the hero: how to get CopyCam, what it promises, and the
// footer. Every claim here is one the code and SECURITY.md back up.
const REPO = 'https://github.com/copycam/copycam';
const HELP = `${REPO}/blob/main/docs/troubleshooting.md`;
const MONO = 'ui-monospace,Menlo,monospace';

const section = { maxWidth: 920, margin: '0 auto', padding: '56px 24px 0', boxSizing: 'border-box' };
const heading = { fontSize: 26, fontWeight: 800, letterSpacing: -0.8, margin: '0 0 20px' };
const row = { display: 'flex', gap: 16, flexWrap: 'wrap' };
const card = {
  background: '#fff',
  borderRadius: 18,
  padding: '22px 22px 20px',
  flex: '1 1 260px',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  boxSizing: 'border-box',
};
const tag = {
  fontFamily: MONO,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: 0.6,
  background: '#161616',
  color: '#fff',
  borderRadius: 6,
  padding: '3px 8px',
  alignSelf: 'flex-start',
};
const title = { fontSize: 16, fontWeight: 700, margin: 0 };
const body = { fontSize: 14, lineHeight: 1.6, color: '#55554f', margin: 0 };
const note = { fontSize: 12.5, lineHeight: 1.55, color: '#6b6b64', margin: 0 };

function CopyCommand({ command, accentColor }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // no clipboard permission: the command is still selectable by hand
    }
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: '#161616',
        color: '#fff',
        borderRadius: 12,
        padding: '8px 8px 8px 16px',
        fontFamily: MONO,
        fontSize: 15,
      }}
    >
      <code style={{ flex: 1, minWidth: 0, userSelect: 'all' }}>{command}</code>
      <button
        type="button"
        onClick={copy}
        style={{
          border: 'none',
          borderRadius: 8,
          padding: '7px 11px',
          fontFamily: MONO,
          fontSize: 12,
          fontWeight: 700,
          background: copied ? accentColor : '#2e2e2b',
          color: copied ? '#161616' : '#fff',
          cursor: 'pointer',
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function GetCopyCam({ accentColor }) {
  return (
    <section id="get" style={section}>
      <h2 style={heading}>Get CopyCam</h2>
      <div style={row}>
        <div style={card}>
          <span style={tag}>1 · YOUR COMPUTER</span>
          <p style={title}>Run one command</p>
          <CopyCommand command="npx copycam" accentColor={accentColor} />
          <p style={body}>
            It shows a QR code and keeps running while you scan. No account, nothing to sign up for.
          </p>
          <p style={note}>
            Needs <a href="https://nodejs.org/">Node.js</a> 20.19 or newer. Runs on Windows, macOS and Linux; it
            is tested most on Windows.
          </p>
        </div>
        <div style={card}>
          <span style={tag}>2 · YOUR PHONE</span>
          <p style={title}>Scan the QR code</p>
          <p style={body}>
            On the same Wi&#8209;Fi, point the camera at the code and open the link. It runs in the phone&rsquo;s
            browser, so there is nothing to install.
          </p>
          <p style={note}>
            The first time, the browser warns the connection isn&rsquo;t private. That is CopyCam&rsquo;s own
            certificate: tap Show Details (or Advanced), then Visit Website.{' '}
            <a href={`${HELP}#this-connection-is-not-private`}>Why that&rsquo;s expected</a>
          </p>
        </div>
        <div style={card}>
          <span style={tag}>3 · ANY TEXT</span>
          <p style={title}>Point, pick, send</p>
          <p style={body}>
            Frame the text, drag across the words you want and tap Send. It&rsquo;s on your computer&rsquo;s
            clipboard.
          </p>
          <p style={note}>
            A native iPhone and Android app is coming soon. Something not working?{' '}
            <a href={HELP}>Troubleshooting</a>
          </p>
        </div>
      </div>
    </section>
  );
}

const PROMISES = [
  ['End-to-end encrypted', 'Every photo and every word is sealed with AES-256-GCM. The key only travels inside the QR code on your screen.'],
  ['Read on your computer', 'Text recognition runs on your PC. Nothing goes to a cloud service, and there is no account.'],
  ['No ads. Not a single one.', 'Not in the app, not on the pairing page, not here.'],
  ['Open source', 'GPL-3.0. Every line is on GitHub, so every claim on this page can be checked.'],
];

export function Promises() {
  return (
    <section style={section}>
      <h2 style={heading}>Private by design</h2>
      <div style={row}>
        {PROMISES.map(([t, b]) => (
          <div key={t} style={{ ...card, flex: '1 1 200px' }}>
            <p style={title}>{t}</p>
            <p style={body}>{b}</p>
          </div>
        ))}
      </div>
      <p style={{ ...note, marginTop: 16 }}>
        Use it on Wi&#8209;Fi you trust. What it protects against, and what it doesn&rsquo;t, is in{' '}
        <a href={`${REPO}/blob/main/SECURITY.md`}>SECURITY.md</a>.
      </p>
    </section>
  );
}

export function Footer() {
  const link = { color: '#55554f' };
  return (
    <footer style={{ ...section, padding: '56px 24px 40px' }}>
      <div
        style={{
          borderTop: '1px solid #dddcd6',
          paddingTop: 20,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px 20px',
          fontFamily: MONO,
          fontSize: 12,
          color: '#6b6b64',
        }}
      >
        <a style={link} href={REPO}>GitHub</a>
        <a style={link} href={HELP}>Help</a>
        <a style={link} href={`${REPO}/blob/main/SECURITY.md`}>Security</a>
        <a style={link} href="/privacy/">Privacy</a>
        <a style={link} href="/terms/">Terms</a>
        <a style={link} href="/licenses/">Licences</a>
        <a style={link} href="/accessibility/">Accessibility</a>
        <a style={link} href="/he/accessibility/" lang="he" hrefLang="he">הצהרת נגישות</a>
        <a style={link} href="mailto:hello@copycam.app">hello@copycam.app</a>
        <span style={{ marginLeft: 'auto' }}>CopyCam · GPL-3.0</span>
      </div>
    </footer>
  );
}
