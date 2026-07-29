import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rangeIndices, selectionText } from './selection.js';

const ACC = '#CFFF3B';
const COLLAPSED = 196; // bottom-sheet height when not expanded

// Google-Translate-style scan review: the captured photo with a native
// text-selection feel. Drag across the words to select a contiguous run
// (a tap selects one word); the selection highlights as merged per-line bars.
// The bottom sheet swipes up to preview exactly what will be sent.
export default function ImageReview({ photo, words, pcName, sending, onSend, onRetake }) {
  const containerRef = useRef(null);
  const drag = useRef(null);
  const sheetDrag = useRef(null);
  // selection is one contiguous range [anchor..focus]; default = everything
  const [sel, setSel] = useState(() => (words.length ? { anchor: 0, focus: words.length - 1 } : null));
  const [map, setMap] = useState({ scale: 0, offX: 0, offY: 0 });
  const [sheetH, setSheetH] = useState(COLLAPSED);
  const [dragging, setDragging] = useState(false);

  // Track viewport height so rotating the phone re-derives the sheet size
  // instead of stranding it at a height taller than the new screen.
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  const expandedH = Math.max(COLLAPSED, Math.round(vh * 0.62));

  // object-fit: contain mapping from image pixels to screen coordinates
  useLayoutEffect(() => {
    const measure = () => {
      setVh(window.innerHeight);
      const el = containerRef.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const scale = Math.min(cw / photo.width, ch / photo.height);
      setMap({ scale, offX: (cw - photo.width * scale) / 2, offY: (ch - photo.height * scale) / 2 });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [photo.width, photo.height]);

  // Rotating to a shorter screen must never leave the sheet covering the photo.
  useEffect(() => {
    setSheetH((h) => Math.min(h, expandedH));
  }, [expandedH]);

  const indices = rangeIndices(sel?.anchor, sel?.focus);
  const n = indices.length;
  const text = selectionText(words, indices);

  // one merged highlight bar per line covering its selected span
  const bars = useMemo(() => {
    const byLine = new Map();
    for (const i of indices) {
      const w = words[i];
      const e = byLine.get(w.li);
      if (!e) byLine.set(w.li, { x0: w.x, x1: w.x + w.w, y: w.y, h: w.h });
      else {
        e.x0 = Math.min(e.x0, w.x);
        e.x1 = Math.max(e.x1, w.x + w.w);
        e.y = Math.min(e.y, w.y);
        e.h = Math.max(e.h, w.h);
      }
    }
    return [...byLine.values()];
  }, [words, indices]);

  // find the word nearest a screen point, weighting the vertical axis so a
  // drag snaps to the row under the finger (like sweeping a text cursor)
  const wordAt = (clientX, clientY) => {
    const el = containerRef.current;
    if (!el || !map.scale) return null;
    const rect = el.getBoundingClientRect();
    const ix = (clientX - rect.left - map.offX) / map.scale;
    const iy = (clientY - rect.top - map.offY) / map.scale;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (ix >= w.x && ix <= w.x + w.w && iy >= w.y && iy <= w.y + w.h) return i;
      const dx = Math.abs(ix - (w.x + w.w / 2));
      const dy = Math.abs(iy - (w.y + w.h / 2));
      const d = dy * 3 + dx;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const onDown = (e) => {
    const idx = wordAt(e.clientX, e.clientY);
    if (idx == null) return;
    drag.current = idx;
    setSel({ anchor: idx, focus: idx });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (drag.current == null) return;
    const idx = wordAt(e.clientX, e.clientY);
    if (idx != null) setSel({ anchor: drag.current, focus: idx });
  };
  const onUp = () => {
    drag.current = null;
  };

  // draggable bottom sheet
  const sheetDown = (e) => {
    sheetDrag.current = { y: e.clientY, h: sheetH, moved: false };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const sheetMove = (e) => {
    if (!sheetDrag.current) return;
    const dy = sheetDrag.current.y - e.clientY;
    if (Math.abs(dy) > 4) sheetDrag.current.moved = true;
    setSheetH(Math.max(COLLAPSED, Math.min(expandedH, sheetDrag.current.h + dy)));
  };
  const sheetUp = () => {
    if (!sheetDrag.current) return;
    const { moved } = sheetDrag.current;
    sheetDrag.current = null;
    setDragging(false);
    setSheetH((h) => {
      if (!moved) return h > COLLAPSED + 10 ? COLLAPSED : expandedH; // tap toggles
      return h > (COLLAPSED + expandedH) / 2 ? expandedH : COLLAPSED;
    });
  };

  const pill = {
    border: 'none',
    cursor: 'pointer',
    borderRadius: 999,
    padding: '8px 14px',
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: 'inherit',
    background: 'rgba(20,21,24,.55)',
    backdropFilter: 'blur(10px)',
    color: '#fff',
    boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.14)',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#141518', zIndex: 10 }}>
      {/* photo + selection overlay (fixed height above the collapsed sheet) */}
      <div
        ref={containerRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: COLLAPSED, touchAction: 'none', overflow: 'hidden' }}
      >
        <img
          src={photo.url}
          alt="scanned"
          draggable={false}
          style={{
            position: 'absolute',
            left: map.offX,
            top: map.offY,
            width: photo.width * map.scale,
            height: photo.height * map.scale,
            userSelect: 'none',
            filter: 'brightness(.62)',
          }}
        />
        {map.scale > 0 &&
          bars.map((b, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: map.offX + b.x0 * map.scale - 3,
                top: map.offY + b.y * map.scale - 2,
                width: (b.x1 - b.x0) * map.scale + 6,
                height: b.h * map.scale + 4,
                borderRadius: 5,
                background: 'color-mix(in srgb, ' + ACC + ' 40%, transparent)',
                boxShadow: `0 0 0 1.5px ${ACC}`,
                pointerEvents: 'none',
              }}
            />
          ))}
      </div>

      {/* top bar */}
      <div style={{ position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', left: 16, right: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 12 }}>
        <button onClick={onRetake} style={pill} aria-label="Retake photo">
          ← Retake
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSel({ anchor: 0, focus: words.length - 1 })} style={pill}>
            All
          </button>
          <button onClick={() => setSel(null)} style={pill}>
            Clear
          </button>
        </div>
      </div>

      {/* bottom sheet: drag the grabber to preview the full text */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: sheetH,
          background: '#FAFAF7',
          borderRadius: '22px 22px 0 0',
          boxShadow: '0 -8px 40px rgba(0,0,0,.35)',
          zIndex: 12,
          display: 'flex',
          flexDirection: 'column',
          transition: dragging ? 'none' : 'height .28s cubic-bezier(.32,.72,.25,1)',
        }}
      >
        {/* the entire header — grabber and the status row — is the drag handle */}
        <div
          onPointerDown={sheetDown}
          onPointerMove={sheetMove}
          onPointerUp={sheetUp}
          onPointerCancel={sheetUp}
          style={{ padding: '10px 0 2px', cursor: 'grab', touchAction: 'none', flex: 'none', userSelect: 'none' }}
          aria-label="Drag to preview"
        >
          <div style={{ width: 38, height: 5, borderRadius: 3, background: 'rgba(0,0,0,.16)', margin: '0 auto' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 18px 8px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#8a8a82' }}>
              {n === 0 ? 'Nothing selected' : `${n} word${n === 1 ? '' : 's'} selected`}
            </span>
            <span style={{ fontSize: 12, color: '#b0afa8' }}>{sheetH > COLLAPSED + 10 ? 'swipe down to collapse' : 'swipe up for full preview'}</span>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            margin: '0 14px 10px',
            padding: '10px 12px',
            background: '#fff',
            borderRadius: 12,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)',
            fontFamily: 'ui-monospace,Menlo,monospace',
            fontSize: 13,
            lineHeight: 1.5,
            color: '#26261f',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {n === 0 ? <span style={{ color: '#b0afa8' }}>Drag across the photo to select text.</span> : text}
        </div>

        <div style={{ padding: '0 18px calc(14px + env(safe-area-inset-bottom))', flex: 'none' }}>
          <button
            onClick={() => n > 0 && !sending && onSend(text)}
            disabled={n === 0}
            style={{
              width: '100%',
              border: 'none',
              cursor: n === 0 ? 'default' : 'pointer',
              borderRadius: 999,
              padding: '14px 20px',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: 'inherit',
              transition: 'all .2s',
              background: n === 0 ? 'rgba(0,0,0,.08)' : sending ? '#161616' : ACC,
              color: n === 0 ? 'rgba(0,0,0,.35)' : sending ? '#fff' : '#161616',
            }}
          >
            {sending ? 'Sending…' : n === 0 ? 'Select text to send' : `Send to ${pcName}`}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color: '#9a9a92' }}>
            <svg width="10" height="12" viewBox="0 0 10 12" style={{ flex: 'none' }} aria-hidden="true">
              <rect x="0.75" y="5" width="8.5" height="6.25" rx="1.5" fill="none" stroke="#9a9a92" strokeWidth="1.5" />
              <path d="M2.5 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke="#9a9a92" strokeWidth="1.5" />
            </svg>
            sent encrypted — only your computer can read it
          </div>
        </div>
      </div>
    </div>
  );
}
