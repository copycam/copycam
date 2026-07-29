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

// The on-screen scan window, as CSS-px insets from the viewport edges.
// Proportional (with clamps) so portrait and landscape both get a usable
// window instead of the layout collapsing when the phone is rotated.
// Shared by the corner brackets, the dim mask, and the capture crop.
export function computeFrame(vw, vh) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const side = Math.round(clamp(vw * 0.07, 16, 48));
  let top = Math.round(clamp(vh * 0.13, 64, 120)); // clears the "linked" pill
  let bottom = Math.round(clamp(vh * 0.26, 168, 230)); // clears hint + shutter
  // On short screens (landscape) shrink both insets proportionally rather than
  // letting the chrome eat the window — the scan area always survives.
  const minWindow = 96;
  const avail = vh - minWindow;
  if (top + bottom > avail) {
    const k = avail / (top + bottom);
    top = Math.max(24, Math.round(top * k));
    bottom = Math.max(60, Math.round(bottom * k));
  }
  return { side, top, bottom };
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
