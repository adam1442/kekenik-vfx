import { perlin3, valueNoise3, type Vec3T } from '../../../engine/shaders/reference/noise';

/** CPU mirror of shader.wgsl (without modulation). */
export interface NoiseRefParams {
  type: 'value' | 'perlin';
  scale: [number, number];
  octaves: number;
  lacunarity: number;
  roughness: number;
  offset: [number, number];
  /** Degrees clockwise (optional, default 0). */
  rotation?: number;
  /** Full resolution, needed for free (non-tiling) rotation aspect correction (default square). */
  res?: [number, number];
  evolution: number;
  zCells: number;
  seed: number;
  contrast: number;
  brightness: number;
  invert: boolean;
  tile: [boolean, boolean];
}

export function noiseReference(p: NoiseRefParams, u: number, v: number): number {
  const rot = p.rotation ?? 0;
  const tile: [boolean, boolean] = [p.tile[0], p.tile[1]];
  let d: [number, number] = [u + p.offset[0] - 0.5, v + p.offset[1] - 0.5];
  if (tile[0] || tile[1]) {
    const q = (((Math.round(rot / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    if (q === 1) {
      d = [d[1], -d[0]];
      tile.reverse();
    } else if (q === 2) d = [-d[0], -d[1]];
    else if (q === 3) {
      d = [-d[1], d[0]];
      tile.reverse();
    }
  } else if (rot !== 0) {
    const a = (rot * Math.PI) / 180;
    const [rw, rh] = p.res ?? [1, 1];
    const px = d[0] * rw;
    const py = d[1] * rh;
    d = [(px * Math.cos(a) + py * Math.sin(a)) / rw, (-px * Math.sin(a) + py * Math.cos(a)) / rh];
  }
  const sc: [number, number] = [p.scale[0], p.scale[1]];
  const period: [number, number] = [0, 0];
  for (let a = 0; a < 2; a++) {
    if (tile[a]) {
      sc[a] = Math.max(Math.round(sc[a]), 1);
      period[a] = sc[a];
    }
  }
  const bx = (d[0] + 0.5) * sc[0];
  const by = (d[1] + 0.5) * sc[1];
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < p.octaves; i++) {
    if (f * Math.max(sc[0], sc[1]) > 16384) break;
    const zc = p.zCells * f;
    const pt: Vec3T = [bx * f, by * f, p.evolution * zc];
    const per: Vec3T = [period[0] * f, period[1] * f, zc];
    const seed = (p.seed + i * 1013) >>> 0;
    const n = p.type === 'value' ? valueNoise3(pt, per, seed) : Math.min(1, Math.max(0, perlin3(pt, per, seed) * 0.5 + 0.5));
    sum += amp * n;
    norm += amp;
    amp *= p.roughness;
    f *= p.lacunarity;
  }
  let val = sum / Math.max(norm, 1e-6);
  val = (val - 0.5) * p.contrast + 0.5 + p.brightness;
  if (p.invert) val = 1 - val;
  return Math.min(1, Math.max(0, val));
}
