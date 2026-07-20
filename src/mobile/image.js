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

// Grab the current frame of a live <video> as a JPEG blob, capped to maxEdge.
export function frameToJpeg(video, maxEdge = 2600, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return reject(new Error('no frame'));
    const scale = Math.min(1, maxEdge / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
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
