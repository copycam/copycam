// Downscale a captured photo before upload: phone photos are 5–12 MB, but
// OCR doesn't need more than ~2200px on the long edge. Uses <img> + canvas
// (works in insecure contexts and every mobile browser).
export function downscalePhoto(file, maxEdge = 2200, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve({ blob, width: w, height: h }) : reject(new Error('encode failed'))),
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read photo'));
    };
    img.src = url;
  });
}

export async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// Turn a captured blob by a right angle. The server tells us which way up the
// text actually was — a phone held flat over a page can't — and the displayed
// photo has to match, or the highlight boxes land in the wrong place.
export function rotateBlob(blob, degrees) {
  return new Promise((resolve, reject) => {
    if (!degrees) return resolve({ blob, width: 0, height: 0 });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const swap = degrees === 90 || degrees === 270 || degrees === -90;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      canvas.toBlob(
        (out) =>
          out
            ? resolve({ blob: out, width: canvas.width, height: canvas.height })
            : reject(new Error('encode failed')),
        'image/jpeg',
        0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read photo'));
    };
    img.src = url;
  });
}

// The camera screen's chrome, in CSS px. The scan window is sized to clear
// exactly these, and the screen draws them from the same numbers, so nothing
// placed around the window can touch it or be clipped by it.
export const CHROME = {
  pill: 32, // height of every pill
  pillGap: 8, // between pills, and between the two rows of them in portrait
  clear: 20, // open space between any control and the scan window
  shutter: 78,
  hintLine: 17, // "Frame the text, then tap the shutter"
  hintLine2: 20, // the smaller line under it, with its margin
  hintGap: 16, // between the hint and the shutter
  note: 14, // the "end-to-end encrypted" line
  noteBottom: 28, // as on the linking screen
};

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

// The on-screen scan window, as CSS-px insets from the viewport edges
// ({ left, right, top, bottom }), plus the orientation it was derived for and
// where the chrome around it goes. Shared by the corner brackets, the dim
// mask, the capture crop, and every control placed around the window.
//
// The two orientations reserve space on different axes, because that's where
// the shutter lives: bottom-centre in portrait, right-centre in landscape.
// Landscape therefore spends width on the right rather than height at the
// bottom, and lays its pills out in a single row, which keeps the scan window
// tall on the short axis — text lines run horizontally, so height is the
// scarce dimension there.
//
// `insets` are the page's safe-area insets (non-zero when the page runs full
// screen under a notch or a home indicator); they are added to the chrome.
export function computeFrame(vw, vh, insets = NO_INSETS) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const minWindow = 96;

  // Shrink the two insets on an axis proportionally rather than letting the
  // chrome eat the window, so the scan area always survives a small screen.
  const fit = (a, b, extent, minA, minB) => {
    const avail = extent - minWindow;
    if (a + b <= avail) return [a, b];
    const k = avail / (a + b);
    return [Math.max(minA, Math.round(a * k)), Math.max(minB, Math.round(b * k))];
  };

  if (vw > vh) {
    // landscape: shutter sits centred on the right edge; pills in one row
    const pillsTop = insets.top + 16;
    const right = Math.round(clamp(vw * 0.15, 104, 168)) + insets.right; // clears the shutter
    const left = Math.round(clamp(vw * 0.05, 16, 48)) + insets.left;
    const [top, bottom] = fit(
      pillsTop + CHROME.pill + CHROME.clear,
      // a margin holding one line of hint, centred in it
      Math.round(clamp(vh * 0.12, 44, 88)) + insets.bottom,
      vh,
      20,
      20,
    );
    return {
      left,
      right,
      top,
      bottom,
      landscape: true,
      pillsTop,
      shutterEdge: Math.max(22, insets.right),
      hintBottom: insets.bottom + Math.max(6, Math.round((bottom - insets.bottom - CHROME.hintLine) / 2)),
      hintLines: bottom - insets.bottom >= CHROME.hintLine + 12 ? 1 : 0,
      note: false,
    };
  }

  // portrait, from the bottom edge up: the encrypted note, the shutter, the
  // hint, then the window — and from the top down, the linked pill, the
  // flash/language row, then the window
  const side = Math.round(clamp(vw * 0.07, 16, 48));
  const pillsTop = insets.top + 24;
  const noteBottom = Math.max(CHROME.noteBottom, insets.bottom);
  const shutterEdge = Math.max(64, noteBottom + CHROME.note + CHROME.clear);
  const hintBottom = shutterEdge + CHROME.shutter + CHROME.hintGap;
  // the smaller second line only where the window can spare the height
  const hintLines = vh >= 600 ? 2 : vh >= 420 ? 1 : 0;
  const hintHeight = [0, CHROME.hintLine, CHROME.hintLine + CHROME.hintLine2][hintLines];
  const [top, bottom] = fit(
    pillsTop + CHROME.pill * 2 + CHROME.pillGap + CHROME.clear,
    hintBottom + hintHeight + (hintLines ? CHROME.clear : CHROME.hintGap),
    vh,
    24,
    60,
  );
  return {
    left: side + insets.left,
    right: side + insets.right,
    top,
    bottom,
    landscape: false,
    pillsTop,
    shutterEdge,
    hintBottom,
    hintLines,
    note: vh >= 420,
    noteBottom,
  };
}

// Map a crop rectangle given in the video element's CSS-pixel box to source
// pixels of the underlying frame, accounting for object-fit: cover (which
// scales the video to fill the box and centre-crops the overflow). Pure and
// clamped to the frame bounds so callers get a valid drawImage source rect.
export function coverCropRect(cropCss, { cw, ch, vw, vh }) {
  const scale = Math.max(cw / vw, ch / vh);
  const offX = (cw - vw * scale) / 2;
  const offY = (ch - vh * scale) / 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sx = clamp((cropCss.left - offX) / scale, 0, vw);
  const sy = clamp((cropCss.top - offY) / scale, 0, vh);
  const sw = clamp(cropCss.width / scale, 1, vw - sx);
  const sh = clamp(cropCss.height / scale, 1, vh - sy);
  return { sx, sy, sw, sh };
}

// Grab a frame of a live <video> as a JPEG blob, capped to maxEdge. When
// cropCss (a rect in the video's CSS box) is given, only that region — the
// on-screen framing window — is captured, so OCR sees only the framed text.
export function frameToJpeg(video, cropCss = null, maxEdge = 2600, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return reject(new Error('no frame'));
    const src =
      cropCss && video.clientWidth && video.clientHeight
        ? coverCropRect(cropCss, { cw: video.clientWidth, ch: video.clientHeight, vw, vh })
        : { sx: 0, sy: 0, sw: vw, sh: vh };
    const outScale = Math.min(1, maxEdge / Math.max(src.sw, src.sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(src.sw * outScale));
    canvas.height = Math.max(1, Math.round(src.sh * outScale));
    canvas.getContext('2d').drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve({ blob, width: canvas.width, height: canvas.height })
          : reject(new Error('encode failed')),
      'image/jpeg',
      quality,
    );
  });
}
