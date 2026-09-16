// Zoom and pan for the review photo, as pure math. The photo, and the
// highlights on it, sit in a layer the size of the review area; a view draws
// that layer scaled by `z` from its top-left corner, then shifted by (tx, ty):
//
//   screen = layer * z + t
//
// The native app keeps an identical copy (mobile/src/lib/view.ts); the two are
// held together by shared/selection-compat.test.js.

export const IDENTITY = { z: 1, tx: 0, ty: 0 };
// enough to bring small print in a sideways shot up to a comfortable size
export const MAX_ZOOM = 6;
export const DOUBLE_TAP_ZOOM = 2.5;

const clampZ = (z) => Math.min(MAX_ZOOM, Math.max(1, z));

// a point on screen (in the review area) -> the same point in the layer
export function toLayer(v, x, y) {
  return [(x - v.tx) / v.z, (y - v.ty) / v.z];
}

// Keep the photo in view: centred along an axis where it fits, and where it
// doesn't, its edges come no further in than `margin` from the area's edges.
export function clampView(v, photo, area, margin) {
  const axis = (t, lo, size, extent, m) => {
    const scaled = size * v.z;
    if (scaled <= extent - 2 * m) return (extent - scaled) / 2 - lo * v.z;
    return Math.min(m - lo * v.z, Math.max(extent - m - (lo + size) * v.z, t));
  };
  return {
    z: v.z,
    tx: axis(v.tx, photo.x, photo.w, area.width, margin.x),
    ty: axis(v.ty, photo.y, photo.h, area.height, margin.y),
  };
}

// Zoom to `z`, keeping whatever is under the screen point (x, y) where it is.
export function zoomAbout(v, z, x, y) {
  const [lx, ly] = toLayer(v, x, y);
  const nz = clampZ(z);
  return { z: nz, tx: x - lx * nz, ty: y - ly * nz };
}

// A two-finger gesture, from the view it started on: scaled by how far the
// fingers spread, and moved so the point that started under their midpoint
// stays under it — which is also how two fingers pan without pinching.
export function pinch(start, mid0, dist0, mid, dist) {
  const [lx, ly] = toLayer(start, mid0[0], mid0[1]);
  const z = clampZ(start.z * (dist / Math.max(1, dist0)));
  return { z, tx: mid[0] - lx * z, ty: mid[1] - ly * z };
}

// Double tap: in to a reading size around the tap, or back out to the whole photo.
export function toggleZoom(v, x, y, photo, area, margin) {
  if (v.z > 1.05) return IDENTITY;
  return clampView(zoomAbout(v, DOUBLE_TAP_ZOOM, x, y), photo, area, margin);
}
