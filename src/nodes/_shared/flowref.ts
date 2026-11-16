/**
 * CPU reference of the Motion Vector Generate solver (pyramidal Horn-Schunck with warping): same update as `MODE 2` in
 * vector/motion_generate/shader.wgsl. Used by tests/motion-ref.test.ts (synthetic translations are recovered within tolerance).
 */
export interface GrayImage { w: number; h: number; d: Float32Array }
export const makeImage = (w: number, h: number, f: (x: number, y: number) => number): GrayImage => {
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = f(x, y);
  return { w, h, d };
};
const at = (im: GrayImage, x: number, y: number, wrap: boolean): number => {
  const ix = wrap ? ((x % im.w) + im.w) % im.w : Math.min(im.w - 1, Math.max(0, x));
  const iy = wrap ? ((y % im.h) + im.h) % im.h : Math.min(im.h - 1, Math.max(0, y));
  return im.d[iy * im.w + ix];
};
/** Bilinear sample at continuous pixel coordinates (centres at +0.5). */
export function bilinear(im: GrayImage, x: number, y: number, wrap: boolean): number {
  const qx = x - 0.5, qy = y - 0.5;
  const x0 = Math.floor(qx), y0 = Math.floor(qy);
  const fx = qx - x0, fy = qy - y0;
  return (at(im, x0, y0, wrap) * (1 - fx) + at(im, x0 + 1, y0, wrap) * fx) * (1 - fy) + (at(im, x0, y0 + 1, wrap) * (1 - fx) + at(im, x0 + 1, y0 + 1, wrap) * fx) * fy;
}
export const downsample = (im: GrayImage, wrap: boolean): GrayImage => {
  const w = Math.max(1, Math.ceil(im.w / 2)), h = Math.max(1, Math.ceil(im.h / 2));
  return makeImage(w, h, (x, y) => bilinear(im, ((x + 0.5) / w) * im.w, ((y + 0.5) / h) * im.h, wrap));
};
/** Largest change of the flow per iteration (px of the pyramid level); mirrored by `STEP_LIMIT` in vector/motion_generate/shader.wgsl. */
export const STEP_LIMIT = 0.75;
export interface FlowOptions { levels: number; iterations: number; smoothness: number; window: number; maxDisp: number; quality: boolean; wrap: boolean }
export interface Flow { w: number; h: number; u: Float32Array; v: Float32Array }

export function opticalFlow(a: GrayImage, b: GrayImage, o: FlowOptions): Flow {
  const pa: GrayImage[] = [a], pb: GrayImage[] = [b];
  for (let l = 1; l < o.levels; l++) { pa.push(downsample(pa[l - 1], o.wrap)); pb.push(downsample(pb[l - 1], o.wrap)); }
  let flow: Flow | null = null;
  for (let l = o.levels - 1; l >= 0; l--) {
    const A = pa[l], B = pb[l];
    let f: Flow = { w: A.w, h: A.h, u: new Float32Array(A.w * A.h), v: new Float32Array(A.w * A.h) };
    if (flow) {
      const sx = A.w / flow.w, sy = A.h / flow.h;
      const fu = makeImage(flow.w, flow.h, (x, y) => flow!.u[y * flow!.w + x]);
      const fv = makeImage(flow.w, flow.h, (x, y) => flow!.v[y * flow!.w + x]);
      for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
        const px = ((x + 0.5) / A.w) * flow.w, py = ((y + 0.5) / A.h) * flow.h;
        f.u[y * A.w + x] = bilinear(fu, px, py, o.wrap) * sx;
        f.v[y * A.w + x] = bilinear(fv, px, py, o.wrap) * sy;
      }
    }
    const lmax = Math.max(1, o.maxDisp / 2 ** l);
    const a2 = o.smoothness * o.smoothness;
    for (let it = 0; it < o.iterations; it++) {
      const nu = new Float32Array(A.w * A.h), nv = new Float32Array(A.w * A.h);
      for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
        const i = y * A.w + x;
        const fx = f.u[i], fy = f.v[i], cx = x + 0.5, cy = y + 0.5, h = Math.max(o.window, 1);
        const bw = (dx: number, dy: number): number => bilinear(B, cx + fx + dx, cy + fy + dy, o.wrap);
        const aa = (dx: number, dy: number): number => bilinear(A, cx + dx, cy + dy, o.wrap);
        const ix = (bw(h, 0) - bw(-h, 0) + aa(h, 0) - aa(-h, 0)) / (4 * h);
        const iy = (bw(0, h) - bw(0, -h) + aa(0, h) - aa(0, -h)) / (4 * h);
        const it0 = bw(0, 0) - aa(0, 0);
        const nb = (dx: number, dy: number): number => {
          const xx = o.wrap ? (x + dx + A.w) % A.w : Math.min(A.w - 1, Math.max(0, x + dx));
          const yy = o.wrap ? (y + dy + A.h) % A.h : Math.min(A.h - 1, Math.max(0, y + dy));
          return yy * A.w + xx;
        };
        const ub = 0.25 * (f.u[nb(1, 0)] + f.u[nb(-1, 0)] + f.u[nb(0, 1)] + f.u[nb(0, -1)]);
        const vb = 0.25 * (f.v[nb(1, 0)] + f.v[nb(-1, 0)] + f.v[nb(0, 1)] + f.v[nb(0, -1)]);
        const r0 = it0 + ix * (ub - fx) + iy * (vb - fy);
        const w = o.quality ? 0.05 / Math.sqrt(r0 * r0 + 0.0025) : 1; // Charbonnier weight, 1 at zero residual (same strength as Fast), < 1 for outliers
        const den = a2 + w * (ix * ix + iy * iy);
        let u = ub - (ix * w * r0) / den, v = vb - (iy * w * r0) / den;
        // trust region: one iteration moves the flow by at most STEP_LIMIT px of this level (stops the unrobust Fast mode from overshooting in flat regions)
        const dl = Math.hypot(u - fx, v - fy);
        if (dl > STEP_LIMIT) { u = fx + ((u - fx) * STEP_LIMIT) / dl; v = fy + ((v - fy) * STEP_LIMIT) / dl; }
        const l2 = Math.hypot(u, v);
        if (l2 > lmax) { u *= lmax / l2; v *= lmax / l2; }
        nu[i] = u; nv[i] = v;
      }
      f = { w: A.w, h: A.h, u: nu, v: nv };
    }
    flow = f;
  }
  return flow as Flow;
}
