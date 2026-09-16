import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rangeIndices, selectionText } from './selection.js';
import { annotate, anyDoubtful, isDoubtful } from './annotate.js';

const ACC = '#CFFF3B';
const COLLAPSED = 216; // bottom-sheet height when not expanded

// Keep the photo (and so every selectable word) clear of the screen edges.
// Text touching the edge would otherwise force the drag to start inside the
// system's edge-swipe zone — which on iOS Safari and Android Chrome navigates
// back and leaves the app mid-selection. The horizontal inset is the one that
// matters for that; the vertical one is smaller and just for symmetry.
const EDGE_X = 24;
const EDGE_Y = 12;

// Google-Translate-style scan review: the captured photo with a native
// text-selection feel. Drag across the words to select a contiguous run
// (a tap selects one word); the selection highlights as merged per-line bars.
// The bottom sheet swipes up to preview exactly what will be sent, and the
// text can be edited before sending — the same behaviour as the native app's
// review (mobile/src/screens/ReviewScreen.tsx).
export default function ImageReview({ photo, words, wifi = null, pcName, sending, sendError = null, onSend, onRetake }) {
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

  // object-fit: contain mapping from image pixels to screen coordinates.
  // The photo is fitted into the container minus EDGE_X/EDGE_Y, then centred
  // in the full container — so it always keeps at least that margin, and the
  // offsets stay absolute within the container (pointer mapping is unchanged).
  useLayoutEffect(() => {
    const measure = () => {
      setVh(window.innerHeight);
      const el = containerRef.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const availW = Math.max(1, cw - EDGE_X * 2);
      const availH = Math.max(1, ch - EDGE_Y * 2);
      const scale = Math.min(availW / photo.width, availH / photo.height);
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

  const indices = useMemo(() => rangeIndices(sel?.anchor, sel?.focus), [sel]);
  const n = indices.length;
  const selected = useMemo(() => selectionText(words, indices), [words, indices]);

  // Editing. `draft` is null until the editor opens; while it differs from the
  // selection it is what gets sent, and later selection changes don't
  // overwrite it — silently discarding typed corrections would be worse than
  // stale text. "Discard edits" is the one way back to the selection.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const doubtful = useMemo(() => anyDoubtful(indices.map((i) => words[i]).filter(Boolean)), [words, indices]);
  const edited = draft !== null && draft !== selected;
  const text = edited ? draft : selected;
  const canSend = text.trim().length > 0 && !sending;

  const startEditing = () => {
    setDraft((d) => d ?? selected);
    setEditing(true);
    setSheetH(expandedH); // give the editor room
  };
  const finishEditing = () => {
    setEditing(false);
    setDraft((d) => (d === null || d === selected ? null : d));
  };
  const discardEdits = () => setDraft(editing ? selected : null);
  // buttons inside the draggable header must not start a sheet drag, or the
  // pointer capture it takes swallows their click
  const noDrag = (e) => e.stopPropagation();

  // one merged highlight bar per line covering its selected span
  const bars = useMemo(() => {
    const byLine = new Map();
    for (const i of indices) {
      const w = words[i];
      const e = byLine.get(w.li);
      if (!e) byLine.set(w.li, { x0: w.x, x1: w.x + w.w, y: w.y, h: w.h, doubt: isDoubtful(w) });
      else {
        e.doubt = e.doubt || isDoubtful(w);
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

  const riskyStyle = {
    textDecoration: 'underline dotted',
    textDecorationColor: '#c08a00',
    textUnderlineOffset: 3,
    background: 'rgba(207,255,59,.28)',
    borderRadius: 3,
  };

  const wifiCard = {
    margin: '0 14px 10px',
    padding: '10px 12px',
    borderRadius: 12,
    background: '#fff',
    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  };

  const chip = {
    border: 'none',
    cursor: 'pointer',
    borderRadius: 999,
    padding: '7px 13px',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'inherit',
    background: 'rgba(0,0,0,.06)',
    color: '#161616',
  };

  const previewBox = {
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
            // makes the inset read as a deliberate frame, not a stray gap
            borderRadius: 10,
          }}
        />
        {map.scale > 0 &&
          bars.map((b, i) => {
            // Sit *inside* the OCR line box rather than padding past it: line
            // boxes include leading, so a bar that overhangs collides with the
            // next line on tightly-set text.
            //
            // Every dimension scales with the line's *rendered* height, not the
            // source pixels — the same page renders ~3.5x smaller in landscape
            // (the sheet leaves a short review area), where a fixed 1px ring
            // and 3px side padding swelled to nearly the whole line. Clamps
            // keep it sane at both extremes.
            const lineH = b.h * map.scale;
            const px = (frac, lo, hi) => Math.max(lo, Math.min(hi, lineH * frac));
            const padX = px(0.16, 0.5, 3);
            const ring = px(0.07, 0.4, 1.25);
            // Guarantee a visible gap between stacked bars. Taking 78% of the
            // line is fine when it renders large, but on a small render (a
            // landscape review area is ~3.5x shorter) that left barely 1px
            // between neighbours and the highlights read as one solid slab.
            const minGap = px(0.2, 2.5, 7);
            const barH = Math.max(3, Math.min(lineH * 0.78, lineH - minGap - ring * 2));
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: map.offX + b.x0 * map.scale - padX,
                  top: map.offY + (b.y + b.h / 2) * map.scale - barH / 2,
                  width: (b.x1 - b.x0) * map.scale + padX * 2,
                  height: barH,
                  borderRadius: px(0.22, 2, 5),
                  // amber where the recogniser was unsure of the words on this line
                  background: b.doubt ? 'rgba(255,193,7,.36)' : 'color-mix(in srgb, ' + ACC + ' 40%, transparent)',
                  boxShadow: `0 0 0 ${ring}px ${ACC}`,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
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
          style={{ padding: '18px 0 4px', cursor: 'grab', touchAction: 'none', flex: 'none', userSelect: 'none' }}
          aria-label="Drag to preview"
        >
          <div style={{ width: 44, height: 5, borderRadius: 3, background: 'rgba(0,0,0,.18)', margin: '0 auto' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 18px 12px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: edited || editing ? '#161616' : '#8a8a82', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {editing
                ? 'Editing text'
                : edited
                  ? `Edited · ${text.length} character${text.length === 1 ? '' : 's'}`
                  : n === 0
                    ? 'Nothing selected'
                    : `${n} word${n === 1 ? '' : 's'} selected`}
            </span>
            <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
              {edited && (
                <button onPointerDown={noDrag} onClick={discardEdits} style={chip}>
                  {editing ? 'Reset' : 'Discard edits'}
                </button>
              )}
              {editing ? (
                <button onPointerDown={noDrag} onClick={finishEditing} style={{ ...chip, background: '#161616', color: '#fff' }}>
                  Done
                </button>
              ) : (
                <button onPointerDown={noDrag} onClick={startEditing} style={chip} aria-label="Edit the text before sending">
                  Edit
                </button>
              )}
            </span>
          </div>
        </div>

        {wifi && !editing && (
          <div style={wifiCard}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13.5 }}>Wi-Fi code</strong>
              <span style={{ fontSize: 12, color: '#55554f' }}>read exactly, not guessed</span>
            </div>
            <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 13, wordBreak: 'break-all' }}>{wifi.ssid}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => !sending && onSend(wifi.ssid)} style={chip}>
                Send network name
              </button>
              {wifi.password && (
                <button onClick={() => !sending && onSend(wifi.password)} style={{ ...chip, background: ACC }}>
                  Send password
                </button>
              )}
            </div>
          </div>
        )}

        {doubtful && !editing && (
          <div style={{ margin: '0 14px 8px', fontSize: 12, color: '#8a6d00' }}>
            Some of this was hard to read — check the underlined characters.
          </div>
        )}

        {editing ? (
          <textarea
            // dir="auto": a right-to-left result (e.g. Arabic) must read and
            // align correctly while being edited, same as in the preview
            dir="auto"
            autoFocus
            value={draft ?? ''}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type or fix the text to send"
            aria-label="Text to send"
            style={{ ...previewBox, resize: 'none', border: 'none', outline: 'none', boxShadow: 'inset 0 0 0 1.5px rgba(22,22,22,.35)' }}
          />
        ) : (
          <div
            // dir="auto" lets the browser resolve paragraph direction (and
            // apply correct bidi shaping/alignment) from the text's own
            // content -- needed so a right-to-left result (e.g. Arabic) reads
            // and aligns correctly instead of being forced left-aligned by the
            // page's default LTR direction.
            dir="auto"
            onClick={text ? startEditing : undefined}
            style={previewBox}
            // the marks are decoration; a screen reader should hear the text
            aria-label={text}
          >
            {text.length === 0 ? (
              <span style={{ color: '#b0afa8' }}>Drag across the photo to select text, or tap Edit to type it yourself.</span>
            ) : (
              annotate(text).map((seg, i) =>
                seg.mark === 'risky' ? (
                  <span key={i} style={riskyStyle}>
                    {seg.t}
                  </span>
                ) : seg.mark === 'space' ? (
                  <span key={i} style={{ color: '#c9c8c1' }} aria-hidden="true">
                    {'·'.repeat(seg.t.length)}
                  </span>
                ) : (
                  <span key={i}>{seg.t}</span>
                ),
              )
            )}
          </div>
        )}

        <div style={{ padding: '0 18px calc(14px + env(safe-area-inset-bottom))', flex: 'none' }}>
          {sendError && !sending && (
            <div role="alert" style={{ color: '#D93F3F', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
              {sendError}
            </div>
          )}
          <button
            onClick={() => canSend && onSend(text)}
            disabled={!canSend}
            style={{
              width: '100%',
              border: 'none',
              cursor: canSend ? 'pointer' : 'default',
              borderRadius: 999,
              padding: '15px 20px',
              fontSize: 15,
              fontWeight: 700,
              fontFamily: 'inherit',
              transition: 'all .2s',
              background: sending ? '#161616' : !canSend ? 'rgba(0,0,0,.08)' : ACC,
              color: sending ? '#fff' : !canSend ? 'rgba(0,0,0,.35)' : '#161616',
            }}
          >
            {sending
              ? 'Sending…'
              : text.trim().length === 0
                ? 'Select text to send'
                : sendError
                  ? 'Try sending again'
                  : `Send to ${pcName}`}
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
