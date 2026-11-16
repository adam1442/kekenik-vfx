import { v2, type V2, type ViewTransform } from './geom';

/**
 * Analytic hit testing (no picking buffers). Geometry is stored in image-pixel space; distances are returned in
 * SCREEN pixels so tolerances are constant regardless of zoom. `null` = miss.
 */
export type Hit =
  | { t: 'point'; p: V2; r: number }
  /** Thin ring (circle outline). `r` in ip. */
  | { t: 'ring'; c: V2; r: number; tol: number }
  | { t: 'segment'; a: V2; b: V2; tol: number }
  | { t: 'polyline'; pts: V2[]; closed?: boolean; tol: number }
  /** Filled disk (body drag). `r` in ip. */
  | { t: 'disk'; c: V2; r: number }
  /** Filled rotated rectangle (body drag): centre, half size (ip), rotation radians. */
  | { t: 'box'; c: V2; half: V2; rot: number }
  /** Everything inside the image rectangle (catch-all, lowest priority). */
  | { t: 'image'; w: number; h: number };

export function distToSegment(p: V2, a: V2, b: V2): number {
  const ab = v2.sub(b, a);
  const l2 = v2.dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, v2.dot(v2.sub(p, a), ab) / l2));
  return v2.dist(p, v2.add(a, v2.mul(ab, t)));
}

export function shiftHit(h: Hit, d: V2): Hit {
  if (d[0] === 0 && d[1] === 0) return h;
  switch (h.t) {
    case 'point':
      return { ...h, p: v2.add(h.p, d) };
    case 'ring':
    case 'disk':
      return { ...h, c: v2.add(h.c, d) };
    case 'box':
      return { ...h, c: v2.add(h.c, d) };
    case 'segment':
      return { ...h, a: v2.add(h.a, d), b: v2.add(h.b, d) };
    case 'polyline':
      return { ...h, pts: h.pts.map((p) => v2.add(p, d)) };
    case 'image':
      return h;
  }
}

/** Distance (screen px) from screen point `sp` to the hit shape, or null when outside its tolerance. */
export function hitDistance(h: Hit, sp: V2, view: ViewTransform): number | null {
  const z = view.zoom;
  switch (h.t) {
    case 'point': {
      const d = v2.dist(sp, view.toScreen(h.p));
      return d <= h.r ? d : null;
    }
    case 'ring': {
      const d = Math.abs(v2.dist(sp, view.toScreen(h.c)) - h.r * z);
      return d <= h.tol ? d : null;
    }
    case 'segment': {
      const d = distToSegment(sp, view.toScreen(h.a), view.toScreen(h.b));
      return d <= h.tol ? d : null;
    }
    case 'polyline': {
      let best = Infinity;
      const n = h.pts.length;
      const last = h.closed ? n : n - 1;
      let prev = view.toScreen(h.pts[0]);
      for (let i = 0; i < last; i++) {
        const nxt = view.toScreen(h.pts[(i + 1) % n]);
        best = Math.min(best, distToSegment(sp, prev, nxt));
        prev = nxt;
      }
      return best <= h.tol ? best : null;
    }
    case 'disk': {
      const d = v2.dist(sp, view.toScreen(h.c));
      return d <= h.r * z ? d : null;
    }
    case 'box': {
      const ip = view.toImage(sp);
      const l = v2.rot(v2.sub(ip, h.c), -h.rot);
      return Math.abs(l[0]) <= h.half[0] && Math.abs(l[1]) <= h.half[1] ? 0 : null;
    }
    case 'image': {
      const ip = view.toImage(sp);
      return ip[0] >= 0 && ip[1] >= 0 && ip[0] <= h.w && ip[1] <= h.h ? 0 : null;
    }
  }
}

/** Closest point on a polyline (ip) to `p`: segment index, parameter inside the segment, distance. */
export function closestOnPolyline(pts: V2[], p: V2, closed = false): { seg: number; t: number; dist: number } {
  let best = { seg: 0, t: 0, dist: Infinity };
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ab = v2.sub(b, a);
    const l2 = v2.dot(ab, ab);
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, v2.dot(v2.sub(p, a), ab) / l2));
    const d = v2.dist(p, v2.add(a, v2.mul(ab, t)));
    if (d < best.dist) best = { seg: i, t, dist: d };
  }
  return best;
}
