import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NOTHING, beginStroke, everything, selectionBars, selectionText, strokeTo, wordAt } from './selection.js';
import { IDENTITY, clampView, pinch, settle, toLayer, toggleZoom } from './view.js';
import { annotate, anyDoubtful } from './annotate.js';

const ACC = '#CFFF3B';
const COLLAPSED = 224; // bottom-sheet height when not expanded: two lines of preview

// Keep the photo (and so every selectable word) clear of the screen edges.
// Text touching the edge would otherwise force the drag to start inside the
// system's edge-swipe zone — which on iOS Safari and Android Chrome navigates
// back and leaves the app mid-selection. The horizontal inset is the one that
// matters for that; the vertical one is smaller and just for symmetry.
const EDGE_X = 24;
const EDGE_Y = 12;
// how far the top bar reaches down over the photo: its offset, a pill, a gap
const PILL_H = 32;
const TOP_BAR = 20 + PILL_H + 16;

// Google-Translate-style scan review: the captured photo with a native
// text-selection feel. Each drag across the words (a tap is a drag that stays
// on one word) adds them to the selection, or takes them away when it starts on
// a selected word; the opening everything-selected is a suggestion the first
// drag replaces (see selection.js). Highlights run along each line's slant. Two
// fingers zoom and pan the photo; a double tap zooms in or back out.
// The bottom sheet swipes up to preview exactly what will be sent, and the
// text can be edited before sending — the same behaviour as the native app's
// review.
export default function ImageReview({ photo, words, wifi = null, pcName, sending, sendError = null, onSend, onRetake }) {
  const containerRef = useRef(null);
  const sheetDrag = useRef(null);
  // selection is one contiguous range [anchor..focus]; default = everything
  const [sel, setSel] = useState(() => everything(words.length, true));
  const [map, setMap] = useState({ scale: 0, offX: 0, offY: 0, cw: 0, ch: 0 });
  const [sheetH, setSheetH] = useState(COLLAPSED);
  const [dragging, setDragging] = useState(false);

  // Track viewport height so rotating the phone re-derives the sheet size
  // instead of stranding it at a height taller than the new screen.
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  const expandedH = Math.max(COLLAPSED, Math.round(vh * 0.62));

  // object-fit: contain mapping from image pixels to screen coordinates.
  // The photo is fitted into the container minus EDGE_X/EDGE_Y, so it always
  // keeps at least that margin, and the offsets stay absolute within the
  // container (pointer mapping is unchanged). Vertically it centres below the
  // top bar where there's height to spare, rather than sliding its top edge
  // under Retake / All / Clear; a photo too tall for that keeps its size and
  // moves down only as far as the bottom margin allows.
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
      const h = photo.height * scale;
      const offY = Math.max(EDGE_Y, Math.min(TOP_BAR + (ch - TOP_BAR - EDGE_Y - h) / 2, ch - EDGE_Y - h));
      setMap({ scale, offX: (cw - photo.width * scale) / 2, offY, cw, ch });
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

  const indices = sel.picked;
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

  const bars = useMemo(() => selectionBars(words, indices), [words, indices]);

  // Zoom (the math is in view.js). The transform is written straight to the
  // layer while fingers move, so a pinch doesn't re-render the page; `zoom` —
  // what the highlights are sized for — is committed once a gesture ends.
  const layerRef = useRef(null);
  const viewRef = useRef(IDENTITY);
  const [zoom, setZoom] = useState(1);
  const photoRect = { x: map.offX, y: map.offY, w: photo.width * map.scale, h: photo.height * map.scale };
  const area = { width: map.cw, height: map.ch };
  const margin = { x: EDGE_X, top: TOP_BAR, bottom: EDGE_Y };
  const showView = (v, animate = false) => {
    viewRef.current = v;
    const el = layerRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform .24s cubic-bezier(.2,.8,.2,1)' : 'none';
    el.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.z})`;
  };
  // A layer marked will-change is painted once and its bitmap stretched while it
  // moves, which is smooth but blurs a zoomed photo; so the hint is only set for
  // the length of a pinch, and dropping it repaints the photo sharp.
  const smoothWhile = (on) => {
    if (layerRef.current) layerRef.current.style.willChange = on ? 'transform' : 'auto';
  };
  // a new layout (rotation, resize) starts unzoomed
  useEffect(() => {
    showView(IDENTITY);
    setZoom(1);
  }, [map.scale, map.cw, map.ch]);

  // a point in the review area -> the word under it, through the zoom
  const wordAtPoint = (x, y) => {
    if (!map.scale) return null;
    const [lx, ly] = toLayer(viewRef.current, x, y);
    return wordAt(words, (lx - map.offX) / map.scale, (ly - map.offY) / map.scale);
  };

  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(null);
  const local = (e) => {
    const r = containerRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  // the two fingers doing the zooming, and which two they are
  const fingers = () => {
    const [[ka, a], [kb, b]] = [...pointers.current.entries()];
    return {
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      dist: Math.hypot(a[0] - b[0], a[1] - b[1]),
      key: `${ka}:${kb}`,
    };
  };

  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, [x, y]);
    if (pointers.current.size === 1) {
      const g = { mode: 'stroke', before: sel, stroke: null, focus: null, moved: false, x, y, at: Date.now() };
      gesture.current = g;
      const idx = wordAtPoint(x, y);
      if (idx == null) return;
      g.stroke = beginStroke(sel, idx);
      g.focus = idx;
      setSel(strokeTo(g.stroke, idx));
      return;
    }
    const g = gesture.current;
    if (pointers.current.size === 2 && g && g.mode !== 'pinch') {
      // the second finger arrived: this was never a selection
      g.stroke = null;
      lastTap.current = null;
      setSel(g.before);
      g.mode = 'pinch';
      g.pinch = { view: viewRef.current, ...fingers() };
      smoothWhile(true);
    }
  };
  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    const [x, y] = local(e);
    pointers.current.set(e.pointerId, [x, y]);
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'pinch') {
      if (pointers.current.size < 2) return; // one finger left over: wait for it to lift
      const f = fingers();
      if (f.key !== g.pinch.key) {
        // a finger lifted and landed again, or a third joined: carry on from
        // where the photo is now, rather than jumping to where the new pair
        // would have put it had they started the pinch
        g.pinch = { view: viewRef.current, ...f };
        return;
      }
      showView(clampView(pinch(g.pinch.view, g.pinch.mid, g.pinch.dist, f.mid, f.dist), photoRect, area, margin));
      return;
    }
    if (Math.abs(x - g.x) + Math.abs(y - g.y) > 10) g.moved = true;
    if (!g.stroke) return;
    const idx = wordAtPoint(x, y);
    if (idx == null || idx === g.focus) return;
    g.focus = idx;
    setSel(strokeTo(g.stroke, idx));
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) return;
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.mode === 'pinch') {
      smoothWhile(false);
      const rest = settle(viewRef.current);
      if (rest !== viewRef.current) showView(rest, true);
      setZoom(rest.z);
      return;
    }
    if (g.moved || Date.now() - g.at > 300) return;
    const prev = lastTap.current;
    if (prev && g.at - prev.at < 350 && Math.hypot(g.x - prev.x, g.y - prev.y) < 40) {
      // a double tap zooms; whatever its two taps did to the selection is put back
      lastTap.current = null;
      setSel(prev.before);
      const v = toggleZoom(viewRef.current, g.x, g.y, photoRect, area, margin);
      showView(v, true);
      setZoom(v.z);
      return;
    }
    lastTap.current = { at: g.at, x: g.x, y: g.y, before: g.before };
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
    height: PILL_H,
    boxSizing: 'border-box',
    padding: '0 14px',
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
        <div ref={layerRef} style={{ position: 'absolute', inset: 0, transformOrigin: '0 0' }}>
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
              // makes the inset read as a deliberate frame, not a stray gap
              borderRadius: 10,
            }}
          />
          {/* dimmed so the highlights read, by a veil rather than a filter on
              the photo, which some browsers paint at its unzoomed size */}
          <div
            style={{
              position: 'absolute',
              left: map.offX,
              top: map.offY,
              width: photo.width * map.scale,
              height: photo.height * map.scale,
              borderRadius: 10,
              background: 'rgba(20,21,24,.38)',
              pointerEvents: 'none',
            }}
          />
          {map.scale > 0 &&
            bars.map((b, i) => {
              // Sized on screen, then divided by the zoom they're drawn under,
              // so a highlight keeps the same ring and margin at any zoom — and
              // stays proportional however small the photo renders (the same
              // page renders ~3.5x smaller in landscape, where fixed sizes
              // swelled to cover the whole line).
              const s = map.scale;
              const lineH = b.h * s * zoom;
              const px = (frac, lo, hi) => Math.max(lo, Math.min(hi, lineH * frac)) / zoom;
              const padX = px(0.2, 1.5, 5);
              const padY = px(0.08, 0.75, 2.5);
              const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * s + padX * 2;
              const barH = b.h * s + padY * 2;
              const cx = map.offX + ((b.x0 + b.x1) / 2) * s;
              const cy = map.offY + ((b.y0 + b.y1) / 2) * s;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: cx - len / 2,
                    top: cy - barH / 2,
                    width: len,
                    height: barH,
                    // along the line's own slant
                    transform: `rotate(${Math.atan2(b.y1 - b.y0, b.x1 - b.x0)}rad)`,
                    borderRadius: px(0.25, 2, 6),
                    // faint while it's only the opening suggestion; amber
                    // where the recogniser was unsure of a word in it
                    background: b.doubt
                      ? `rgba(255,193,7,${sel.soft ? 0.16 : 0.36})`
                      : `color-mix(in srgb, ${ACC} ${sel.soft ? 16 : 40}%, transparent)`,
                    boxShadow: `0 0 0 ${px(0.06, 0.5, 1.25)}px ${sel.soft ? 'rgba(207,255,59,.45)' : ACC}`,
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
        </div>
      </div>

      {/* top bar */}
      <div style={{ position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', left: 16, right: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 12 }}>
        <button onClick={onRetake} style={pill} aria-label="Retake photo">
          ← Retake
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {zoom > 1.05 && (
            <button
              onClick={() => {
                showView(IDENTITY, true);
                setZoom(1);
              }}
              style={pill}
              aria-label="Zoom out to the whole photo"
            >
              Fit
            </button>
          )}
          <button onClick={() => setSel(everything(words.length))} style={pill}>
            All
          </button>
          <button onClick={() => setSel(NOTHING)} style={pill}>
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
          style={{ padding: '14px 0 0', cursor: 'grab', touchAction: 'none', flex: 'none', userSelect: 'none' }}
          aria-label="Drag to preview"
        >
          <div style={{ width: 44, height: 5, borderRadius: 3, background: 'rgba(0,0,0,.18)', margin: '0 auto' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 18px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: edited || editing ? '#161616' : '#8a8a82', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {editing
                ? 'Editing text'
                : edited
                  ? `Edited · ${text.length} character${text.length === 1 ? '' : 's'}`
                  : n === 0
                    ? 'Nothing selected'
                    : sel.soft
                      ? 'All text · tap or drag to choose'
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
              <span style={{ color: '#b0afa8' }}>Drag across the photo to select text (pinch to zoom in), or tap Edit to type it yourself.</span>
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
