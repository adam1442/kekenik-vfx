import type { GpuContext } from '../../engine/gpu/device';
import type { GpuTexture, MemoryManager } from '../../engine/resources/memory';

const WGSL = /* wgsl */ `
struct U { mode: u32, a: u32, b: u32, c: u32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(src, vec2i(pos.xy), 0);
  if (u.mode == 1u) { return vec4f(c.r, c.r, c.r, 1.0); }      // gray
  if (u.mode == 2u) { return vec4f(c.r, c.g, 0.0, 1.0); }      // uv
  if (u.mode == 3u) { return vec4f(c.rgb, 1.0); }               // opaque colour / normal
  return c;                                                       // colour with alpha
}
`;

/** Texture kinds the bridge understands (mode index in the shader). */
export const BRIDGE_MODE = { color: 0, gray: 1, uv: 2, opaque: 3 } as const;

/**
 * TextureBridge: the 3D viewport's private, always-filterable copy of a graph texture.
 * Graph textures are owned by the scheduler (they return to the pool right after the next evaluation, and may be r16float /
 * 32-bit float), so three.js never samples them directly. Every result is blitted (one fullscreen pass, `textureLoad`,
 * channel mapping for gray / uv) into ONE rgba16float texture that this class owns through the MemoryManager pool.
 * three.js wraps that texture with `ExternalTexture` (zero copy); it only has to be re-wrapped when the size changes.
 */
export class TextureBridge {
  private dst: GpuTexture | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private ubo: GPUBuffer | null = null;
  private device: GPUDevice | null = null;
  private layout: GPUBindGroupLayout | null = null;
  constructor(
    private gpu: GpuContext,
    private mm: MemoryManager,
  ) {}

  private ensurePipeline(): void {
    const dev = this.gpu.device;
    if (this.device === dev && this.pipeline) return;
    this.dst = null; // textures died with the old device
    this.device = dev;
    // explicit layout: `unfilterable-float` accepts r16float AND 32-bit float graph textures (HQ mode) without float32-filterable
    this.layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const module = dev.createShaderModule({ code: WGSL, label: 'viewport3d bridge' });
    this.pipeline = dev.createRenderPipeline({
      label: 'viewport3d bridge',
      layout: dev.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.ubo = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'bridge u' });
  }

  /** Blit `src` into the bridge texture. Returns the destination and whether it was (re)allocated. */
  update(src: GpuTexture, mode: number): { texture: GPUTexture; changed: boolean } {
    this.ensurePipeline();
    const dev = this.gpu.device;
    let changed = false;
    if (!this.dst || this.dst.width !== src.width || this.dst.height !== src.height) {
      this.dst?.release();
      this.dst = this.mm.textures.acquire({ width: src.width, height: src.height, format: 'rgba16float', label: '3d material bridge' });
      changed = true;
    }
    dev.queue.writeBuffer(this.ubo!, 0, new Uint32Array([mode, 0, 0, 0]));
    const bind = dev.createBindGroup({ layout: this.layout!, entries: [{ binding: 0, resource: src.view }, { binding: 1, resource: { buffer: this.ubo! } }] });
    const enc = dev.createCommandEncoder({ label: 'viewport3d bridge' });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.dst.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    dev.queue.submit([enc.finish()]);
    return { texture: this.dst.texture, changed };
  }
  get size(): [number, number] | null {
    return this.dst ? [this.dst.width, this.dst.height] : null;
  }
  dispose(): void {
    this.dst?.release();
    this.dst = null;
    this.ubo?.destroy();
    this.ubo = null;
    this.pipeline = null;
  }
}
