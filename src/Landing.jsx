import { useState } from 'react';
import { useOnPhone } from './useOnPhone.js';

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

// On a phone: the way to get from here to the computer, which is to send the
// link there.
function PhoneVisitor({ accentColor }) {
  const [sent, setSent] = useState(false);
  const share = async () => {
    try {
      await navigator.share({ title: 'CopyCam', url: 'https://copycam.app/app/' });
      setSent(true);
    } catch {
      // dismissed, or no share sheet: the address is right there to type
    }
  };
  return (
    <div style={{ ...card, background: '#161616', color: '#fff', marginBottom: 16 }}>
      <p style={{ ...title, color: '#fff' }}>You&rsquo;re on your phone</p>
      <p style={{ ...body, color: '#d8d8d0' }}>
        CopyCam starts on your computer. Open <strong style={{ color: '#fff' }}>copycam.app</strong> there, then scan the
        code it shows with this phone&rsquo;s camera.
      </p>
      {typeof navigator !== 'undefined' && navigator.share && (
        <button
          type="button"
          onClick={share}
          style={{ alignSelf: 'flex-start', border: 'none', borderRadius: 999, padding: '10px 18px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, background: accentColor, color: '#161616', cursor: 'pointer' }}
        >
          {sent ? 'Sent ✓' : 'Send the link to your computer'}
        </button>
      )}
    </div>
  );
}

export function GetCopyCam({ accentColor }) {
  const onPhone = useOnPhone();
  return (
    <section id="get" style={section}>
      <h2 style={heading}>Get CopyCam</h2>
      {onPhone && <PhoneVisitor accentColor={accentColor} />}
      <div style={row}>
        <div style={{ ...card, flex: '1.4 1 320px' }}>
          <span style={tag}>IN YOUR BROWSER · NOTHING TO INSTALL</span>
          <p style={title}>Open CopyCam on your computer</p>
          <a
            href="/app/"
            style={{ alignSelf: 'flex-start', background: '#161616', color: '#fff', textDecoration: 'none', borderRadius: 999, padding: '11px 20px', fontSize: 14.5, fontWeight: 700 }}
          >
            Open copycam.app/app <span style={{ color: accentColor }}>&rarr;</span>
          </a>
          <p style={body}>
            It shows a QR code. Scan it with your phone&rsquo;s camera and open the link: the phone doesn&rsquo;t even need
            to be on the same Wi&#8209;Fi. Then frame the text, drag across the words you want, and tap Send.
          </p>
          <p style={note}>
            Photos are read in that tab, on your computer. On the way they pass through copycam.app sealed end to end, so
            it can&rsquo;t read them. The first visit downloads the text reader (44&nbsp;MB) once. Text lands on the clipboard
            while the tab is in front; otherwise it waits there for one click.
          </p>
        </div>
        <div style={card}>
          <span style={tag}>DESKTOP COMPANION</span>
          <p style={title}>Or run it on your own network</p>
          <CopyCommand command="npx copycam" accentColor={accentColor} />
          <p style={body}>
            Nothing leaves your Wi&#8209;Fi, the text goes straight onto the clipboard with no click, and it reads more
            scripts: Cyrillic, Arabic, Greek, Thai and Hindi among them.
          </p>
          <p style={note}>
            Needs <a href="https://nodejs.org/">Node.js</a> 20.19 or newer; tested on Windows, macOS and Linux with every
            change. The phone must be on the same Wi&#8209;Fi, and the first time its browser warns the connection
            isn&rsquo;t private: that&rsquo;s CopyCam&rsquo;s own certificate.{' '}
            <a href={`${HELP}#this-connection-is-not-private`}>Why that&rsquo;s expected</a>. On Linux, start it with{' '}
            <code>ONNXRUNTIME_NODE_INSTALL=skip npx copycam</code> to skip a 270&nbsp;MB add-on it doesn&rsquo;t use.
          </p>
        </div>
      </div>
      <p style={{ ...note, marginTop: 16 }}>
        A native iPhone and Android app is coming soon. Something not working? <a href={HELP}>Troubleshooting</a>
      </p>
    </section>
  );
}

const PROMISES = [
  ['End-to-end encrypted', 'Every photo and every word is sealed with AES-256-GCM. The key only travels inside the QR code on your screen, so not even copycam.app can read what it passes along.'],
  ['Read on your computer', 'Text recognition runs on your computer, in the browser tab or the companion. Nothing goes to a cloud reading service, and there is no account.'],
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
        What it protects against, and what it doesn&rsquo;t, is in{' '}
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
