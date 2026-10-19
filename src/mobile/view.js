// Zoom and pan for the review photo, as pure math. The photo, and the
// highlights on it, sit in a layer the size of the review area; a view draws
// that layer scaled by `z` from its top-left corner, then shifted by (tx, ty):
//
//   screen = layer * z + t
//
// The native app keeps an identical copy; the two are
// held together by that app's own tests.
//
// Margins ({ x, top, bottom }) say how close the photo may come to each edge of
// the review area. `top` clears the buttons laid over the photo, so a zoomed
// photo's first line can always be brought down to where it can be touched.

export const IDENTITY = { z: 1, tx: 0, ty: 0 };
// enough to bring small print in a sideways shot up to a comfortable size
export const MAX_ZOOM = 6;
export const DOUBLE_TAP_ZOOM = 2.5;
// a gesture that ends below this goes back to the whole photo, rather than
// leaving it a hair's breadth zoomed and slightly off centre
export const SNAP_BELOW = 1.08;

const clampZ = (z) => Math.min(MAX_ZOOM, Math.max(1, z));

// a point on screen (in the review area) -> the same point in the layer
export function toLayer(v, x, y) {
  return [(x - v.tx) / v.z, (y - v.ty) / v.z];
}

// Keep the photo on screen, and otherwise let it go where it's pushed. Along
// each axis its leading edge may sit anywhere between two limits: against the
// near margin, and where its far edge meets the far margin. While the zoomed
// photo is smaller than the area that lets it slide freely inside it; once it's
// larger, the same two limits stop either edge coming in past its margin. The
// centred position is always allowed too, so the photo as first laid out (which
// only keeps the plain edge margin) never jumps when a pinch begins.
export function clampView(v, photo, area, margin) {
  const axis = (t, lo, size, extent, near, far) => {
    const scaled = size * v.z;
    const limits = [near, extent - far - scaled, (extent - scaled) / 2];
    const start = Math.min(Math.max(lo * v.z + t, Math.min(...limits)), Math.max(...limits));
    return start - lo * v.z;
  };
  return {
    z: v.z,
    tx: axis(v.tx, photo.x, photo.w, area.width, margin.x, margin.x),
    ty: axis(v.ty, photo.y, photo.h, area.height, margin.top, margin.bottom),
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

// Where a gesture comes to rest: back to the whole photo when barely zoomed.
export function settle(v) {
  return v.z < SNAP_BELOW ? IDENTITY : v;
}

// Double tap: in to a reading size around the tap, or back out to the whole photo.
export function toggleZoom(v, x, y, photo, area, margin) {
  if (v.z > 1.05) return IDENTITY;
  return clampView(zoomAbout(v, DOUBLE_TAP_ZOOM, x, y), photo, area, margin);
}
