import type { Engine } from '../../engine/engine';
import type { FrameParams } from '../../engine/gpu/passes';
import type { GpuTexture } from '../../engine/resources/memory';
import { defineShader } from '../../engine/shaders/library';
import { PipelinePending } from '../../engine/shaders/pipelines';
import { makeLayout } from '../../engine/shaders/uniforms';
import { consoleBus } from '../../shared/log';
import type { ViewTransform } from '../../gizmos/geom';
import src from './display.wgsl?raw';
import { hexToRgb, type ViewportSettings } from './settings';
import { themeColor } from '../../ui/theme/ui-store';

/** `#rrggbb` design token -> linear-agnostic 0..1 triple (the display pass writes straight to the unorm canvas). */
const cssRgb = (c: string): [number, number, number] => (/^#[0-9a-f]{6}$/i.test(c.trim()) ? hexToRgb(c.trim()) : [0.1, 0.1, 0.1]);

export const DISPLAY = defineShader('viewport2d_display.wgsl', src);

export const DISPLAY_LAYOUT = makeLayout([
  { name: 'res', type: 'vec2f' },
  { name: 'center', type: 'vec2f' },
  { name: 'inv', type: 'vec4f' },
  { name: 'fwd', type: 'vec4f' },
  { name: 'img', type: 'vec2f' },
  { name: 'tex_size', type: 'vec2f' },
  { name: 'reg_lo', type: 'vec2f' },
  { name: 'reg_hi', type: 'vec2f' },
  { name: 'sub', type: 'vec4f' },
  { name: 'bg_color', type: 'vec4f' },
  { name: 'outside_color', type: 'vec4f' },
  { name: 'chk_a', type: 'vec4f' },
  { name: 'chk_b', type: 'vec4f' },
  { name: 'light', type: 'vec4f' },
  { name: 'sphere_rect', type: 'vec4f' },
  { name: 'wrap', type: 'vec2u' },
  { name: 'zoom', type: 'f32' },
  { name: 'exposure', type: 'f32' },
  { name: 'gamma', type: 'f32' },
  { name: 'range_lo', type: 'f32' },
  { name: 'range_hi', type: 'f32' },
  { name: 'arrow_cell', type: 'f32' },
  { name: 'arrow_gain', type: 'f32' },
  { name: 'lic_step', type: 'f32' },
  { name: 'lic_grain', type: 'f32' },
  { name: 'cmp_pos', type: 'f32' },
  { name: 'sphere_tile', type: 'f32' },
  { name: 'dpr', type: 'f32' },
  { name: 'ov_gain', type: 'f32' },
  { name: 'channel', type: 'u32' },
  { name: 'viz', type: 'u32' },
  { name: 'filter_mode', type: 'u32' },
  { name: 'a_kind', type: 'u32' },
  { name: 'b_kind', type: 'u32' },
  { name: 'srgb', type: 'u32' },
  { name: 'alpha_mode', type: 'u32' },
  { name: 'bg_mode', type: 'u32' },
  { name: 'grid', type: 'u32' },
  { name: 'seam', type: 'u32' },
  { name: 'flip_g', type: 'u32' },
  { name: 'auto_nearest', type: 'u32' },
  { name: 'cmp_mode', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
  { name: 'heat_pal', type: 'u32' },
  { name: 'ov_mode', type: 'u32' },
]);

export type PixelKind = 0 | 1 | 2 | 3 | 4; // color, gray, uv, normal, vector
export const KIND_NAMES = ['Color', 'Gray', 'UV', 'Normal', 'Vector'];

export interface ImageSource {
  tex: GpuTexture;
  kind: PixelKind;
  /** Sub-rectangle of the texture shown (flipbook frame): x0,y0,w,h in uv. */
  sub?: [number, number, number, number];
}

export interface DisplayFrame {
  a: ImageSource;
  b: ImageSource | null;
  /** simulation overlay field (velocity for arrows / streamlines, a Gray field for the heat overlay) drawn over `a`. */
  o?: ImageSource | null;
  view: ViewTransform;
  /** CSS px -> device px. */
  dpr: number;
  s: ViewportSettings;
  regionLo: [number, number];
  regionHi: [number, number];
  wrap: [boolean, boolean];
  /** Compare divider position in CSS px (x for 'v', y for 'h'). */
  comparePx: number;
  /** Lit-sphere inset rectangle in CSS px (x,y,w,h); null = hidden. */
  sphere: [number, number, number, number] | null;
}

/** Draws the image into a WebGPU canvas with all display options (single fullscreen pass). */
export class DisplayRenderer {
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;
  onPending: (() => void) | null = null;

  constructor(
    private engine: Engine,
    readonly canvas: HTMLCanvasElement,
  ) {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('Canvas does not support WebGPU');
    this.ctx = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.configure();
    engine.onRestored.on(() => this.configure());
  }
  private configure(): void {
    this.ctx.configure({ device: this.engine.gpu.device, format: this.format, alphaMode: 'opaque' });
  }

  /** Match the backing store to the CSS size. Returns the dpr used. */
  resize(cssW: number, cssH: number): number {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return dpr;
  }

  draw(f: DisplayFrame): void {
    const { runner, gpu } = this.engine;
    const c = this.canvas;
    const s = f.s;
    const d = f.dpr;
    const v = f.view;
    const bgc = s.bg === 'black' ? [0, 0, 0] : s.bg === 'mid' ? [0.5, 0.5, 0.5] : s.bg === 'white' ? [1, 1, 1] : hexToRgb(s.bgColor);
    const ch = { rgb: 0, r: 1, g: 2, b: 3, a: 4, luma: 5 }[s.channel];
    const viz = { none: 0, heat: 1, arrows: 2, lic: 3 }[s.viz];
    const sub = f.a.sub ?? [0, 0, 1, 1];
    const az = (s.light[0] * Math.PI) / 180;
    const el = (s.light[1] * Math.PI) / 180;
    const sp = f.sphere;
    const values = {
      res: [c.width, c.height],
      center: [v.s.cx * d, v.s.cy * d],
      inv: v.inverseMatrix(),
      fwd: v.forwardMatrix(),
      img: [v.s.imgW, v.s.imgH],
      tex_size: [f.a.tex.width, f.a.tex.height],
      reg_lo: f.regionLo,
      reg_hi: f.regionHi,
      sub,
      bg_color: [bgc[0], bgc[1], bgc[2], 1],
      outside_color: [...cssRgb(themeColor('canvas-bg', '#0b0c0e')), 1],
      chk_a: [...cssRgb(themeColor('checker-b', '#262a30')), 1],
      chk_b: [...cssRgb(themeColor('checker-a', '#1c1f25')), 1],
      light: [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el), 1.0],
      sphere_rect: sp ? [sp[0] * d, sp[1] * d, sp[2] * d, sp[3] * d] : [0, 0, 0, 0],
      wrap: [f.wrap[0] ? 1 : 0, f.wrap[1] ? 1 : 0],
      zoom: v.s.zoom * d,
      exposure: s.exposure,
      gamma: s.gamma,
      range_lo: s.rangeLo,
      range_hi: s.rangeHi,
      arrow_cell: s.arrowCell,
      arrow_gain: s.arrowGain,
      lic_step: s.licStep,
      lic_grain: s.licGrain,
      cmp_pos: f.comparePx * d,
      sphere_tile: 1,
      dpr: d,
      channel: ch,
      viz,
      filter_mode: s.filter,
      a_kind: f.a.kind,
      b_kind: f.b?.kind ?? 0,
      srgb: f.a.kind === 0 ? 1 : 0,
      alpha_mode: { straight: 0, premult: 1, opaque: 2 }[s.alpha],
      bg_mode: s.bg === 'checker' ? 0 : 1,
      grid: s.pixelGrid ? 1 : 0,
      seam: s.seam && !f.a.sub ? 1 : 0,
      flip_g: s.flipG ? 1 : 0,
      auto_nearest: s.autoNearest ? 1 : 0,
      cmp_mode: f.b ? (s.compareDir === 'v' ? 1 : 2) : 0,
      uv_mode: { absolute: 0, offset: 1, flowmap: 2 }[s.uvMode],
      heat_pal: s.heatPal,
      ov_gain: s.overlayGain,
      ov_mode: f.o ? { none: 0, arrows: 1, lic: 2, pressure: 3, divergence: 3, curl: 3 }[s.overlay] : 0,
    };
    const frame: FrameParams = { width: c.width, height: c.height, time: 0, loopPhase: 0, tile: [false, false], seed: 0, ss: 1, filter: s.filter, hq: false };
    try {
      const dev = gpu.device;
      const enc = dev.createCommandEncoder({ label: 'viewport2d' });
      const view = this.ctx.getCurrentTexture().createView();
      runner.fullscreen(
        enc,
        { view, format: this.format, width: c.width, height: c.height },
        frame,
        { label: 'viewport2d', shader: DISPLAY, mode: 'raw', textures: [f.a.tex, f.b?.tex ?? f.a.tex, f.o?.tex ?? f.a.tex], uniforms: { layout: DISPLAY_LAYOUT, values } },
        { label: '2D viewport' },
      );
      runner.submit([enc.finish()]);
    } catch (e) {
      if (e instanceof PipelinePending) void e.promise.then(() => this.onPending?.());
      else consoleBus.error(`2D viewport draw failed: ${(e as Error).message}`, { source: 'gpu' });
    }
  }

  /** Clear to the outside colour (no image yet). */
  clear(): void {
    const dev = this.engine.gpu.device;
    try {
      const enc = dev.createCommandEncoder({ label: 'viewport2d clear' });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.045, g: 0.048, b: 0.055, a: 1 } }] });
      pass.end();
      dev.queue.submit([enc.finish()]);
    } catch {
      /* canvas not ready */
    }
  }
}
