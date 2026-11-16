import type { MeshData } from '../../engine/mesh/mesh';

/* ------------------------------------------------------------------------------------------------
 * 3D THUMBNAILS: a tiny deterministic software rasteriser (z-buffer, flat Lambert, vertex colours) so Gallery tiles
 * and node previews of mesh nodes show the real geometry without touching the GPU (no device, no async). Pure function.
 * ---------------------------------------------------------------------------------------------- */

export interface ThumbImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const BG0 = [30, 33, 40], BG1 = [16, 18, 23];

export function renderMeshThumb(mesh: MeshData, size = 160, opts: { azimuth?: number; elevation?: number } = {}): ThumbImage {
  const W = size, H = size;
  const img = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    for (let x = 0; x < W; x++) img.set([BG0[0] + (BG1[0] - BG0[0]) * t, BG0[1] + (BG1[1] - BG0[1]) * t, BG0[2] + (BG1[2] - BG0[2]) * t, 255], (y * W + x) * 4);
  }
  const b = mesh.bounds();
  if (b.empty || mesh.pointCount === 0) return { width: W, height: H, data: img };
  const az = ((opts.azimuth ?? 38) * Math.PI) / 180, el = ((opts.elevation ?? 26) * Math.PI) / 180;
  // view basis (Z up, front view looks along +Y as in CONTRACTS §13): viewer direction, right and up vectors
  const ce = Math.cos(el), se = Math.sin(el);
  const cam = [ce * Math.sin(az), -ce * Math.cos(az), se];
  const rx = Math.cos(az), ry = Math.sin(az);
  const ux = -se * Math.sin(az), uy = se * Math.cos(az), uz = ce;
  const scale = (size * 0.42) / Math.max(b.radius, 1e-6);
  const P = mesh.positions;
  const n = mesh.pointCount;
  const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3] - b.center[0], y = P[i * 3 + 1] - b.center[1], z = P[i * 3 + 2] - b.center[2];
    sx[i] = W / 2 + (x * rx + y * ry) * scale;
    sy[i] = H / 2 - (x * ux + y * uy + z * uz) * scale;
    sz[i] = x * cam[0] + y * cam[1] + z * cam[2]; // larger = closer to the viewer
  }
  const zbuf = new Float32Array(W * H).fill(-Infinity);
  // colours: vertex Cd (vertex / point), alpha blended over the background
  const cd = mesh.resolveToVertex('Cd');
  const vp = mesh.topology.vertPoint;
  const light = [0.45, -0.35, 0.82];
  const ll = Math.hypot(light[0], light[1], light[2]);
  const put = (x: number, y: number, z: number, r: number, g: number, bl: number, a: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    if (z < zbuf[k]) return;
    zbuf[k] = z;
    const o = k * 4;
    const bg = (c: number, base: number): number => base + (c - base) * a;
    img[o] = bg(r, img[o]);
    img[o + 1] = bg(g, img[o + 1]);
    img[o + 2] = bg(bl, img[o + 2]);
  };
  const tris = mesh.topology.triangles();
  const nt = tris.prim.length;
  const stride = Math.max(1, Math.ceil(nt / 150000));
  for (let t = 0; t < nt; t += stride) {
    const va = tris.verts[t * 3], vb = tris.verts[t * 3 + 1], vc = tris.verts[t * 3 + 2];
    const a = vp[va], bb = vp[vb], c = vp[vc];
    // face normal in world space for shading
    const e1 = [P[bb * 3] - P[a * 3], P[bb * 3 + 1] - P[a * 3 + 1], P[bb * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-20) continue;
    nx /= nl; ny /= nl; nz /= nl;
    const lam = Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / ll);
    const facing = Math.abs(nx * cam[0] + ny * cam[1] + nz * cam[2]);
    const shade = 0.28 + 0.52 * lam + 0.2 * facing;
    const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[bb], sx[c]))), x1 = Math.min(W - 1, Math.ceil(Math.max(sx[a], sx[bb], sx[c])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[bb], sy[c]))), y1 = Math.min(H - 1, Math.ceil(Math.max(sy[a], sy[bb], sy[c])));
    const den = (sy[bb] - sy[c]) * (sx[a] - sx[c]) + (sx[c] - sx[bb]) * (sy[a] - sy[c]);
    if (Math.abs(den) < 1e-9) continue;
    const col = (v: number, k: number): number => (cd ? cd.data[v * cd.size + k] : [0.62, 0.74, 0.9, 1][k]);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((sy[bb] - sy[c]) * (px - sx[c]) + (sx[c] - sx[bb]) * (py - sy[c])) / den;
        const l2 = ((sy[c] - sy[a]) * (px - sx[c]) + (sx[a] - sx[c]) * (py - sy[c])) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -0.001 || l2 < -0.001 || l3 < -0.001) continue;
        const z = l1 * sz[a] + l2 * sz[bb] + l3 * sz[c];
        const mix = (k: number): number => l1 * col(va, k) + l2 * col(vb, k) + l3 * col(vc, k);
        const enc = (v: number): number => 255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
        put(x, y, z, enc(mix(0) * shade), enc(mix(1) * shade), enc(mix(2) * shade), cd && cd.size >= 4 ? Math.min(1, Math.max(0.12, mix(3))) : 1);
      }
    }
  }
  if (nt === 0) {
    // point cloud: 2x2 dots
    const pc = mesh.attr('point', 'Cd');
    const step = Math.max(1, Math.ceil(n / 60000));
    for (let i = 0; i < n; i += step) {
      const r = pc ? pc.data[i * pc.size] : 0.9, g = pc ? pc.data[i * pc.size + 1] : 0.75, bl = pc ? pc.data[i * pc.size + 2] : 0.4;
      const x = Math.round(sx[i]), y = Math.round(sy[i]);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(x + dx, y + dy, sz[i], 255 * Math.pow(r, 1 / 2.2), 255 * Math.pow(g, 1 / 2.2), 255 * Math.pow(bl, 1 / 2.2), 1);
    }
  }
  return { width: W, height: H, data: img };
}
