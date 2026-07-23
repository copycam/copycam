import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { rangeSelect, selectionText } from './selection.js';

const ACC = '#CFFF3B';

// Google-Translate-style scan review: the captured photo with each recognized
// line highlighted. Tap a line to toggle it; drag across lines to select a
// continuous run in reading order (paragraphs!). All/Clear for batch moves.
export default function ImageReview({ photo, lines, paras, pcName, sending, onSend, onRetake }) {
  const containerRef = useRef(null);
  const drag = useRef(null);
  const [selected, setSelected] = useState(() => new Set(lines.map((_, i) => i)));
  const [mode, setMode] = useState('lines');
  const [map, setMap] = useState({ scale: 0, offX: 0, offY: 0 });

  // object-fit: contain mapping from image pixels to screen coordinates
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (!cw || !ch) return;
    const scale = Math.min(cw / photo.width, ch / photo.height);
    setMap({ scale, offX: (cw - photo.width * scale) / 2, offY: (ch - photo.height * scale) / 2 });
  }, [photo.width, photo.height]);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const lineIndexAt = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const idx = el?.closest?.('[data-lidx]')?.dataset?.lidx;
    return idx === undefined ? null : Number(idx);
  };

  const onPointerDown = (e) => {
    const idx = e.target.closest?.('[data-lidx]')?.dataset?.lidx;
    if (idx === undefined) return;
    drag.current = { anchor: Number(idx), base: new Set(selected), moved: false };
  };

  const onPointerMove = (e) => {
    if (!drag.current) return;
    const idx = lineIndexAt(e.clientX, e.clientY);
    if (idx !== null && idx !== drag.current.anchor) drag.current.moved = true;
    if (drag.current.moved && idx !== null) {
      const merged = new Set(drag.current.base);
      for (const k of rangeSelect(paras, drag.current.anchor, idx)) merged.add(k);
      setSelected(merged);
    }
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    if (!drag.current.moved) {
      const a = drag.current.anchor;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(a)) next.delete(a);
        else next.add(a);
        return next;
      });
    }
    drag.current = null;
  };

  const n = selected.size;
  const text = selectionText(lines, paras, selected, mode);
  const pillBtn = {
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
      {/* photo + word overlays; touch-action none so drags don't scroll */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ position: 'absolute', inset: '0 0 158px 0', touchAction: 'none', overflow: 'hidden' }}
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
            filter: 'brightness(.75)',
          }}
        />
        {lines.map((l, i) => {
          const sel = selected.has(i);
          return (
            <div
              key={i}
              data-lidx={i}
              style={{
                position: 'absolute',
                left: map.offX + l.x * map.scale - 3,
                top: map.offY + l.y * map.scale - 2,
                width: l.w * map.scale + 6,
                height: l.h * map.scale + 4,
                borderRadius: 5,
                background: sel ? 'color-mix(in srgb, ' + ACC + ' 42%, transparent)' : 'rgba(255,255,255,.18)',
                boxShadow: sel ? `0 0 0 1.5px ${ACC}` : '0 0 0 1px rgba(255,255,255,.32)',
                transition: 'background .12s, box-shadow .12s',
              }}
            />
          );
        })}
      </div>

      {/* top bar */}
      <div style={{ position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', left: 16, right: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 12 }}>
        <button onClick={onRetake} style={pillBtn} aria-label="Retake photo">
          ← Retake
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSelected(new Set(lines.map((_, i) => i)))} style={pillBtn}>
            All
          </button>
          <button onClick={() => setSelected(new Set())} style={pillBtn}>
            Clear
          </button>
        </div>
      </div>

      {/* bottom bar */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#FAFAF7', borderRadius: '22px 22px 0 0', padding: '12px 18px calc(16px + env(safe-area-inset-bottom))', boxShadow: '0 -8px 40px rgba(0,0,0,.35)', zIndex: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontFamily: 'ui-monospace,Menlo,monospace', color: '#55554f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {n === 0 ? 'tap or drag over the lines you need' : text.replaceAll('\n\n', ' · ').replaceAll('\n', ' · ')}
          </div>
          <div style={{ display: 'flex', flex: 'none', background: 'rgba(0,0,0,.06)', borderRadius: 999, padding: 2 }}>
            {[
              ['lines', 'Lines'],
              ['flow', 'Paragraph'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  background: mode === value ? '#161616' : 'transparent',
                  color: mode === value ? '#fff' : '#55554f',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
          {sending ? 'Sending…' : n === 0 ? 'Select lines to send' : `Send ${n} ${n === 1 ? 'line' : 'lines'} → ${pcName}`}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 9, fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color: '#9a9a92' }}>
          <svg width="10" height="12" viewBox="0 0 10 12" style={{ flex: 'none' }} aria-hidden="true">
            <rect x="0.75" y="5" width="8.5" height="6.25" rx="1.5" fill="none" stroke="#9a9a92" strokeWidth="1.5" />
            <path d="M2.5 5V3.5a2.5 2.5 0 015 0V5" fill="none" stroke="#9a9a92" strokeWidth="1.5" />
          </svg>
          sent encrypted — only your computer can read it
        </div>
      </div>
    </div>
  );
}
