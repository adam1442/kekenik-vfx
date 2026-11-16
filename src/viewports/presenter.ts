import type { Engine } from '../engine/engine';
import type { FrameParams } from '../engine/gpu/passes';
import type { TextureValue } from '../engine/resources/values';
import { PRESENT, PRESENT_LAYOUT } from '../engine/shaders/builtin';
import { PipelinePending } from '../engine/shaders/pipelines';
import { consoleBus } from '../shared/log';

export type ChannelView = 'rgb' | 'r' | 'g' | 'b' | 'a' | 'luma';
const CHANNEL_INDEX: Record<ChannelView, number> = { rgb: 0, r: 1, g: 2, b: 3, a: 4, luma: 5 };

export interface PresentOptions {
  /** 1 = single image, 3 = 3x3 tiling preview. */
  tiles: 1 | 3;
  channel: ChannelView;
  /** Exposure in stops. */
  exposure: number;
  /** Apply the sRGB transfer function (use for Color; Gray/Normal/UV are data and shown linearly). */
  srgb: boolean;
  /** 0 point, 1 linear, 2 cubic. */
  filter: 0 | 1 | 2;
}

export const defaultPresentOptions = (): PresentOptions => ({ tiles: 1, channel: 'rgb', exposure: 0, srgb: false, filter: 1 });

/**
 * Draws a TextureValue to a canvas through the shared device (tiling preview, channel isolate, exposure, checker
 * behind alpha). builds the real 2D viewport (zoom/pan/gizmos) on top of the same present shader.
 */
export class TexturePresenter {
  private ctx: GPUCanvasContext;
  private last: { value: TextureValue; opts: PresentOptions } | null = null;
  private format: GPUTextureFormat;

  constructor(
    private engine: Engine,
    readonly canvas: HTMLCanvasElement,
  ) {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('Canvas does not support WebGPU');
    this.ctx = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.configure();
    engine.onRestored.on(() => {
      this.configure();
    });
  }

  private configure(): void {
    this.ctx.configure({ device: this.engine.gpu.device, format: this.format, alphaMode: 'opaque' });
  }

  /** Match the backing store to the CSS size (device pixels). */
  resizeToDisplay(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  redraw(): void {
    if (this.last) this.draw(this.last.value, this.last.opts);
  }

  draw(value: TextureValue, opts: PresentOptions): void {
    this.last = { value, opts };
    this.resizeToDisplay();
    const { runner, gpu } = this.engine;
    const dev = gpu.device;
    const c = this.canvas;
    const frame: FrameParams = { width: c.width, height: c.height, time: 0, loopPhase: 0, tile: [false, false], seed: 0, ss: 1, filter: opts.filter, hq: false };
    try {
      const enc = dev.createCommandEncoder({ label: 'present' });
      const view = this.ctx.getCurrentTexture().createView();
      runner.fullscreen(
        enc,
        { view, format: this.format, width: c.width, height: c.height },
        frame,
        {
          label: 'present',
          shader: PRESENT,
          mode: 'raw',
          textures: [value.tex],
          uniforms: {
            layout: PRESENT_LAYOUT,
            values: {
              tiles: opts.tiles,
              wrap: opts.tiles > 1 ? 1 : 0,
              channel: CHANNEL_INDEX[opts.channel],
              exposure: opts.exposure,
              srgb: opts.srgb,
              is_gray: value.pin === 'gray',
              is_uv: value.pin === 'uv',
              filter_mode: opts.filter,
            },
          },
        },
        { label: 'present' },
      );
      runner.submit([enc.finish()]);
    } catch (e) {
      if (e instanceof PipelinePending) void e.promise.then(() => this.redraw());
      else consoleBus.error(`Present failed: ${(e as Error).message}`, { source: 'gpu' });
    }
  }
}
