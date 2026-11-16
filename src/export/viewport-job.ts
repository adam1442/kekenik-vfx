import { targetKey } from '../engine/graph/evaluator';
import type { CameraData } from '../engine/mesh/camera';
import { asCamera } from '../engine/mesh/camera';
import { asMesh } from '../engine/mesh/accounting';
import type { MeshData } from '../engine/mesh/mesh';
import type { ViewportScene } from '../panels/viewport-3d/scene';
import { frameSphere, orbitCamera, turntableAngles } from './camera-path';
import { imageFormat } from './encoders';
import { CancelledExport, graphAtSize, producerTarget, releaseGraphCopy, resolveNodeParams, type JobEnv, type JobResult } from './job-env';
import { expandTemplate, uniquePaths } from './naming';
import { convertPixels, srgbDecode, srgbEncode } from './pixels';
import { renderNodeRows } from './image-job';
import { planTiling } from './settings';

/**
 * VIEWPORT EXPORT JOB. 2D: the Color input as a picture (optional 3x3 tiling preview, background, safe frames).
 * 3D: the Mesh input rendered by the 3D viewport renderer (three.js WebGPURenderer on the shared device) with the Camera input,
 * or a turntable around it. Supersampling = rendering in tiles at N x resolution through `setViewOffset` and box-filtering in
 * linear light, so a 16K x 16K image with 4x supersampling never needs a canvas larger than one tile.
 */
export interface ViewportSettings {
  source: '2d' | '3d';
  format: 'png' | 'tga';
  width: number;
  height: number;
  ss: 1 | 2 | 3 | 4;
  transparent: boolean;
  background: [number, number, number];
  tile3x3: boolean;
  safeFrames: boolean;
  display: string;
  blend: 'opaque' | 'alpha' | 'additive';
  frameMode: 'single' | 'sequence' | 'turntable';
  frameStart: number;
  frameCount: number;
  turnDegrees: number;
  turnElevation: number;
  template: string;
}

export function resolveViewportSettings(p: Record<string, unknown>, g: { loopLength: number }): ViewportSettings {
  const size = Array.isArray(p.size) ? (p.size as number[]) : [1920, 1080];
  const bg = Array.isArray(p.background) ? (p.background as number[]) : [0.08, 0.09, 0.1, 1];
  const frameMode = (['single', 'sequence', 'turntable'].includes(String(p.frame_mode)) ? String(p.frame_mode) : 'single') as ViewportSettings['frameMode'];
  const ss = Math.max(1, Math.min(4, parseInt(String(p.ss), 10) || 1)) as 1 | 2 | 3 | 4;
  return {
    source: p.source === '2d' ? '2d' : '3d',
    format: p.format === 'tga' ? 'tga' : 'png',
    width: Math.max(16, Math.min(16384, Math.round(size[0] || 1920))),
    height: Math.max(16, Math.min(16384, Math.round(size[1] || 1080))),
    ss,
    transparent: p.transparent !== false,
    background: [bg[0] ?? 0, bg[1] ?? 0, bg[2] ?? 0],
    tile3x3: p.tile3x3 === true,
    safeFrames: p.safe_frames === true,
    display: String(p.display ?? 'unlit'),
    blend: (['opaque', 'alpha', 'additive'].includes(String(p.blend)) ? String(p.blend) : 'additive') as ViewportSettings['blend'],
    frameMode,
    frameStart: typeof p.frame_start === 'number' ? p.frame_start : 0,
    frameCount: frameMode === 'single' ? 1 : Math.max(1, Math.min(4096, typeof p.frame_count === 'number' && p.frame_count > 0 ? p.frame_count : g.loopLength)),
    turnDegrees: typeof p.turn_degrees === 'number' ? p.turn_degrees : 360,
    turnElevation: typeof p.turn_elevation === 'number' ? p.turn_elevation : 0,
    template: typeof p.file_name === 'string' && p.file_name ? p.file_name : '{graph}_{node}_{frame:4}',
  };
}

/** Safe-frame overlay (90 % action / 80 % title) drawn into straight-alpha RGBA rows. */
export function drawSafeFrames(rows: Float32Array, y0: number, n: number, W: number, H: number): void {
  const lines = [0.05, 0.1].map((m) => ({ x0: Math.round(W * m), x1: Math.round(W * (1 - m)) - 1, y0: Math.round(H * m), y1: Math.round(H * (1 - m)) - 1 }));
  const put = (x: number, y: number): void => {
    const i = ((y - y0) * W + x) * 4;
    rows[i] = rows[i + 1] = rows[i + 2] = rows[i + 3] = 1;
  };
  for (const l of lines) {
    for (let y = Math.max(l.y0, y0); y <= Math.min(l.y1, y0 + n - 1); y++) {
      if (y === l.y0 || y === l.y1) for (let x = l.x0; x <= l.x1; x++) put(x, y);
      else (put(l.x0, y), put(l.x1, y));
    }
  }
}

/** Box-filter k x k RGBA8 (straight alpha, sRGB encoded) samples to one float pixel, averaging in linear light with alpha weights. */
const DECODE = Float32Array.from({ length: 256 }, (_, i) => srgbDecode(i / 255));
export function downsampleTile(src: Uint8ClampedArray, sw: number, ow: number, oh: number, k: number, out: Float32Array, outStride: number, ox: number, oy: number): void {
  const inv = 1 / (k * k);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
      const i = ((y * k + sy) * sw + (x * k + sx)) * 4;
      const al = src[i + 3] / 255;
      r += DECODE[src[i]] * al;
      g += DECODE[src[i + 1]] * al;
      b += DECODE[src[i + 2]] * al;
      a += al;
    }
    const o = ((oy + y) * outStride + (ox + x)) * 4;
    if (a > 0) {
      out[o] = srgbEncode(r / a);
      out[o + 1] = srgbEncode(g / a);
      out[o + 2] = srgbEncode(b / a);
    } else out[o] = out[o + 1] = out[o + 2] = 0;
    out[o + 3] = a * inv;
  }
}

function paths(s: ViewportSettings, env: JobEnv, nodeName: string, ext: string): string[] {
  let t = s.template;
  const multi = s.frameCount > 1;
  if (multi && !/\{frame/.test(t)) t = `${t}_{frame:4}`;
  const out = Array.from({ length: s.frameCount }, (_, i) => `${expandTemplate(multi ? t : t.replace(/_?\{frame(:\d+)?\}/g, ''), { graph: env.graphName, node: nodeName, frame: s.frameStart + i, index: i, w: s.width, h: s.height, now: env.now }).path}.${ext}`);
  return uniquePaths(out);
}

export async function runViewportJob(env: JobEnv, nodeId: string): Promise<JobResult> {
  const node = env.graph.nodes.get(nodeId);
  if (!node) throw new Error('Export node no longer exists');
  const p = resolveNodeParams(env, nodeId);
  const s = resolveViewportSettings(p, env.graph.settings);
  const fmt = imageFormat(s.format);
  const names = paths(s, env, node.name, fmt.ext);
  const gs = env.graph.settings;
  const files: string[] = [];
  const channels = s.transparent ? 4 : 3;
  const timeOf = (i: number): number => (s.frameStart + (s.frameMode === 'turntable' ? 0 : i)) / gs.fps;
  const maxDim = env.engine.gpu.caps.limits.maxTextureDimension2D ?? 8192;
  const bg = s.background;

  /* ------------------------------------------------------------------------------------------ 2D */
  if (s.source === '2d') {
    const colorT = producerTarget(env.graph, nodeId, 'color');
    if (!colorT) throw new Error('Export Viewport (2D) needs a Color input');
    const tw = s.tile3x3 ? Math.floor(s.width / 3) : s.width;
    const th = s.tile3x3 ? Math.floor(s.height / 3) : s.height;
    const OW = s.tile3x3 ? tw * 3 : s.width;
    const OH = s.tile3x3 ? th * 3 : s.height;
    const g = graphAtSize(env, tw, th);
    try {
      for (let i = 0; i < s.frameCount; i++) {
        await env.gate.checkpoint();
        const src = new Float32Array(tw * th * 4);
        const plan = planTiling(tw, th, { maxDim, budgetBytes: env.engine.mm.budgetBytes, hq: gs.bitDepth === 32 });
        await renderNodeRows(env, g.graph, nodeId, timeOf(i), plan, async (y0, rows, data, ch) => {
          src.set(convertPixels(data, tw * rows, { srcChannels: ch as 1 | 4, outChannels: 4, colorSpace: 'srgb', premultiply: false, clamp01: true }), y0 * tw * 4);
        }, (f) => env.onProgress((i + f * 0.5) / s.frameCount));
        const sink = await env.target.openFile(names[i], fmt.mime);
        const enc = await fmt.create({ width: OW, height: OH, channels, depth: 8, colorSpace: 'srgb', software: 'Kekenik VFX' }, sink);
        try {
          const BAND = 64;
          for (let y0 = 0; y0 < OH; y0 += BAND) {
            await env.gate.checkpoint();
            const n = Math.min(BAND, OH - y0);
            const rgba = new Float32Array(OW * n * 4);
            for (let y = 0; y < n; y++) {
              const sy = (y0 + y) % th;
              for (let x = 0; x < OW; x++) rgba.set(src.subarray((sy * tw + (x % tw)) * 4, (sy * tw + (x % tw)) * 4 + 4), (y * OW + x) * 4);
            }
            if (s.safeFrames) drawSafeFrames(rgba, y0, n, OW, OH);
            const out = new Float32Array(OW * n * channels);
            for (let px = 0; px < OW * n; px++) {
              const a = rgba[px * 4 + 3];
              if (s.transparent) out.set(rgba.subarray(px * 4, px * 4 + 4), px * 4);
              else for (let c = 0; c < 3; c++) out[px * 3 + c] = rgba[px * 4 + c] * a + srgbEncode(bg[c]) * (1 - a);
            }
            await enc.writeRows(out, n);
          }
          await enc.finish();
        } catch (e) {
          await enc.abort().catch(() => undefined);
          throw e;
        }
        files.push(names[i]);
        env.onProgress((i + 1) / s.frameCount);
      }
    } finally {
      releaseGraphCopy(env, g);
    }
    return { files, bytes: env.target.files.reduce((n, f) => n + f.bytes, 0) };
  }

  /* ------------------------------------------------------------------------------------------ 3D */
  if (typeof document === 'undefined') throw new Error('3D viewport export needs a browser');
  const meshT = producerTarget(env.graph, nodeId, 'mesh');
  const camT = producerTarget(env.graph, nodeId, 'camera');
  const colT = producerTarget(env.graph, nodeId, 'color');
  const canvas = document.createElement('canvas');
  const { ViewportScene: VS } = await import('../panels/viewport-3d/scene');
  const scene: ViewportScene = await VS.create(env.engine.gpu, env.engine.mm, canvas, { alpha: true });
  const k = s.ss;
  const tileOut = Math.max(64, Math.min(1024, Math.floor(maxDim / k)));
  const scratch = document.createElement('canvas');
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('2D canvas is not available for readback');
  const targets = [meshT, camT, colT].filter((t): t is NonNullable<typeof t> => !!t);
  let baseCam: CameraData | null = null;
  try {
    scene.beginExport({ transparent: s.transparent, background: bg });
    scene.setOptions({ display: s.display as 'unlit' });
    scene.setMaterial({ enabled: !!colT, blend: s.blend, softFade: 0, doubleSided: true, depthWrite: s.blend === 'opaque' });
    for (let i = 0; i < s.frameCount; i++) {
      await env.gate.checkpoint();
      const time = timeOf(i);
      if (targets.length && !(await env.engine.sims.prepareFrame(env.graph, targets, time, { token: env.gate }))) throw new CancelledExport();
      const res = targets.length ? await env.engine.evaluator.evaluate(env.graph, targets, { time, scale: 1, token: env.gate, useCache: true }) : null;
      try {
        if (res?.cancelled) throw new CancelledExport();
        const err = res ? [...res.errors.values()][0] : undefined;
        if (err) throw new Error(err);
        let mesh: MeshData | null = null;
        if (meshT && res) mesh = asMesh(res.values.get(targetKey(meshT))) ?? null;
        scene.setMesh(mesh, mesh ? null : 'plane');
        const colV = colT && res ? res.values.get(targetKey(colT)) : undefined;
        scene.setTexture(colV && colV.kind === 'texture' ? colV.tex.texture : null, true);
        let cam = camT && res ? asCamera(res.values.get(targetKey(camT))) : undefined;
        if (!cam) {
          if (!baseCam) {
            const b = mesh?.bounds();
            baseCam = b && !b.empty ? frameSphere(b.center, b.radius) : frameSphere([0, 0, 0.5], 1.2);
          }
          cam = baseCam;
        }
        if (s.frameMode === 'turntable') cam = orbitCamera(cam, turntableAngles(s.frameCount, s.turnDegrees)[i], s.turnElevation);
        const fullW = s.width * k, fullH = s.height * k;
        const sink = await env.target.openFile(names[i], fmt.mime);
        const enc = await fmt.create({ width: s.width, height: s.height, channels, depth: 8, colorSpace: 'srgb', software: 'Kekenik VFX' }, sink);
        try {
          for (let ty = 0; ty < s.height; ty += tileOut) {
            const oh = Math.min(tileOut, s.height - ty);
            const band = new Float32Array(s.width * oh * 4);
            for (let tx = 0; tx < s.width; tx += tileOut) {
              await env.gate.checkpoint();
              const ow = Math.min(tileOut, s.width - tx);
              const rw = ow * k, rh = oh * k;
              scene.setSize(rw, rh, 1);
              scene.setExportView({ fullW, fullH, x: tx * k, y: ty * k, w: rw, h: rh });
              scene.render(cam, time);
              scratch.width = rw;
              scratch.height = rh;
              sctx.clearRect(0, 0, rw, rh);
              sctx.drawImage(canvas, 0, 0, rw, rh); // same task as the render: the swap-chain texture is still valid
              const px = sctx.getImageData(0, 0, rw, rh).data;
              downsampleTile(px, rw, ow, oh, k, band, s.width, tx, 0);
            }
            const out = new Float32Array(s.width * oh * channels);
            for (let q = 0; q < s.width * oh; q++) {
              const a = band[q * 4 + 3];
              if (s.transparent) out.set(band.subarray(q * 4, q * 4 + 4), q * 4);
              else for (let c = 0; c < 3; c++) out[q * 3 + c] = band[q * 4 + c] * a + srgbEncode(bg[c]) * (1 - a);
            }
            await enc.writeRows(out, oh);
            env.onProgress((i + (ty + oh) / s.height) / s.frameCount, `frame ${s.frameStart + i}`);
          }
          await enc.finish();
        } catch (e) {
          await enc.abort().catch(() => undefined);
          throw e;
        }
        files.push(names[i]);
        env.log('info', `wrote ${names[i]} (${s.width}×${s.height}, ${k}×${k} supersampling)`);
      } finally {
        res?.release();
      }
    }
  } finally {
    scene.setTexture(null);
    scene.setMesh(null);
    scene.dispose();
  }
  return { files, bytes: env.target.files.reduce((n, f) => n + f.bytes, 0) };
}
