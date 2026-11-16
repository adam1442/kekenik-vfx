/**
 * Fluid 2D GPU solver: an Eulerian incompressible smoke / fire solver built from fragment passes (see fluid.wgsl).
 * Everything is pooled (MemoryManager), nothing is allocated per frame, every pipeline stays inside the DEFAULT WebGPU limits
 * (<= 6 sampled textures per pass, one render target, no storage textures, no compute, 1 uniform buffer).
 *
 * Pass cost (N x N cells, one sub-step, Balanced quality, MacCormack): advection 6 passes (N^2 each), forces 1, vorticity 2,
 * divergence 1, mean removal ~4 (tiny), pressure: 2 V-cycles x ~(4 levels x ~9 passes) (level 0 dominates ~ 2 x 7 N^2),
 * gradient 1, combustion 2. About 30 full-resolution passes + ~70 small ones; ~60 ms at 1024^2 on a weak GPU is NOT expected,
 * target: 512^2 real time on mid-range GPUs, 1024^2 interactive on strong ones.
 */
import type { GpuContext } from '../../../engine/gpu/device';
import type { PassRunner } from '../../../engine/gpu/passes';
import type { GpuTexture, MemoryManager } from '../../../engine/resources/memory';
import { defineShader } from '../../../engine/shaders/library';
import { PipelinePending, type ShaderOwner } from '../../../engine/shaders/pipelines';
import { makeLayout, type UniformValue } from '../../../engine/shaders/uniforms';
import { cflSubsteps } from '../../../engine/sim/core';
import src from './fluid.wgsl?raw';

export const FLUID_SHADER = defineShader('sim_fluid2d.wgsl', src);
export const FLUID_LAYOUT = makeLayout([
  { name: 'bmode', type: 'u32' }, // 0 closed, 1 open, 2 periodic
  { name: 'flags', type: 'u32' },
  { name: 'seed', type: 'u32' },
  { name: 'rk', type: 'u32' },
  { name: 'adv_stage', type: 'u32' },
  { name: 'adv_is_b', type: 'u32' },
  { name: 'rb_color', type: 'u32' },
  { name: 'red_op', type: 'u32' },
  { name: 'op', type: 'u32' },
  { name: 'use_obst', type: 'u32' },
  { name: 'noslip', type: 'u32' },
  { name: 'obst_move', type: 'u32' },
  { name: 'blend_vec', type: 'u32' },
  { name: 'dt', type: 'f32' },
  { name: 'dt_frame', type: 'f32' },
  { name: 'time', type: 'f32' },
  { name: 'adv_dir', type: 'f32' },
  { name: 'adv_blend', type: 'f32' },
  { name: 'sgn', type: 'f32' },
  { name: 'rhs_scale', type: 'f32' },
  { name: 'blend_w', type: 'f32' },
  { name: 'turb_omega', type: 'f32' },
  { name: 'drag', type: 'f32' },
  { name: 'damp', type: 'f32' },
  { name: 'vort_eps', type: 'f32' },
  { name: 'vort_scale', type: 'f32' },
  { name: 'visc', type: 'f32' },
  { name: 'soot_decay', type: 'f32' },
  { name: 'vmax', type: 'f32' },
  { name: 'init_temp', type: 'f32' },
  { name: 'gravity', type: 'vec2f' },
  { name: 'wind', type: 'vec2f' },
  { name: 'buoy', type: 'vec4f' }, // alpha (density weight), beta (temperature lift), ambient, -
  { name: 'turb', type: 'vec4f' }, // strength, scale, -, -
  { name: 'swirl', type: 'vec4f' }, // x, y, radius, strength
  { name: 'in_gain', type: 'vec4f' }, // density, temperature, fuel, velocity emit gains
  { name: 'diss', type: 'vec4f' }, // density, temperature, fuel, velocity dissipation (1/s)
  { name: 'comb', type: 'vec4f' }, // ignition, burn rate, heat release, expansion
  { name: 'cool', type: 'vec4f' }, // cooling, smoke from burning, radiative cooling, soot from burning
  { name: 'cmax', type: 'vec4f' }, // clamp max: density, temperature, fuel, speed
  { name: 'em_a', type: 'vec4f', count: 4 },
  { name: 'em_b', type: 'vec4f', count: 4 },
  { name: 'em_c', type: 'vec4f', count: 4 },
  { name: 'em_d', type: 'vec4f', count: 4 },
  { name: 'em_e', type: 'vec4f', count: 4 },
]);

export type PassName =
  | 'ADV' | 'FORCES' | 'CURL' | 'CONF' | 'DIFF' | 'DIV' | 'RED' | 'SUBMEAN' | 'JAC' | 'GS' | 'RESID' | 'RESTR' | 'PROLONG' | 'GRAD' | 'CA' | 'CB'
  | 'AXPY' | 'SCAL' | 'MATVEC' | 'NEG' | 'ZERO' | 'INITA' | 'BLEND' | 'EXTRACTZ' | 'ONE';

/** id = `#define PASS`, t = number of bound textures, fmt = render-target class ('state' = rgba16/32float, 'r32' = r32float). */
export const PASS_DEFS: Record<PassName, { id: number; t: number; fmt: 'state' | 'r32' | 'both' }> = {
  ADV: { id: 0, t: 5, fmt: 'state' }, FORCES: { id: 1, t: 5, fmt: 'state' }, CURL: { id: 2, t: 1, fmt: 'r32' }, CONF: { id: 3, t: 2, fmt: 'state' },
  DIFF: { id: 4, t: 2, fmt: 'state' }, DIV: { id: 5, t: 3, fmt: 'r32' }, RED: { id: 6, t: 2, fmt: 'r32' }, SUBMEAN: { id: 7, t: 2, fmt: 'r32' },
  JAC: { id: 8, t: 3, fmt: 'r32' }, GS: { id: 9, t: 3, fmt: 'r32' }, RESID: { id: 10, t: 3, fmt: 'r32' }, RESTR: { id: 11, t: 1, fmt: 'r32' },
  PROLONG: { id: 12, t: 2, fmt: 'r32' }, GRAD: { id: 13, t: 4, fmt: 'state' }, CA: { id: 14, t: 6, fmt: 'state' }, CB: { id: 15, t: 6, fmt: 'state' },
  AXPY: { id: 16, t: 3, fmt: 'r32' }, SCAL: { id: 17, t: 2, fmt: 'r32' }, MATVEC: { id: 18, t: 2, fmt: 'r32' }, NEG: { id: 19, t: 1, fmt: 'r32' },
  ZERO: { id: 20, t: 0, fmt: 'both' }, INITA: { id: 21, t: 2, fmt: 'state' }, BLEND: { id: 22, t: 2, fmt: 'state' }, EXTRACTZ: { id: 23, t: 1, fmt: 'r32' },
  ONE: { id: 24, t: 0, fmt: 'r32' },
};

export type PressureMode = 'fast' | 'balanced' | 'accurate';
export interface FluidConfig {
  w: number;
  h: number;
  precision: 'half' | 'full';
  /** 0 closed, 1 open (outflow), 2 periodic / tileable */
  bmode: 0 | 1 | 2;
  pressure: PressureMode;
  iters: number;
  cycles: number;
  warmStart: boolean;
  maccormack: boolean;
  rk: 1 | 2 | 3;
  minSub: number;
  maxSub: number;
  cfl: number;
  adaptive: boolean;
  noslip: boolean;
  viscIters: number;
}

export interface FluidEmitterFrame {
  shape: number; // 0 circle, 1 rect, 2 line
  x: number;
  y: number;
  rx: number;
  ry: number;
  x2: number;
  y2: number;
  dens: number;
  temp: number;
  fuel: number;
  expand: number;
  vx: number;
  vy: number;
  noise: number;
  nscale: number;
  soft: number;
  active: boolean;
}

/** Everything that may be animated, resolved for ONE simulated frame (CPU side, pure). */
export interface FluidFrame {
  time: number;
  dtFrame: number;
  gravity: [number, number];
  wind: [number, number];
  buoy: [number, number, number];
  turb: [number, number];
  turbOmega: number;
  swirl: [number, number, number, number];
  drag: number;
  damp: number;
  vortEps: number;
  vortScale: number;
  visc: number;
  diss: [number, number, number, number];
  sootDecay: number;
  comb: [number, number, number, number];
  cool: [number, number, number, number];
  cmax: [number, number, number, number];
  gains: [number, number, number, number];
  emitters: FluidEmitterFrame[];
  seed: number;
  obstMove: boolean;
  vmax: number;
  initTemp: number;
}

export interface FluidInputs {
  dens?: GpuTexture | null;
  temp?: GpuTexture | null;
  fuel?: GpuTexture | null;
  vel?: GpuTexture | null;
  obst?: GpuTexture | null;
  force?: GpuTexture | null;
  kill?: GpuTexture | null;
  initDens?: GpuTexture | null;
  initVel?: GpuTexture | null;
}

interface Level {
  w: number;
  h: number;
  p: [GpuTexture, GpuTexture];
  cur: 0 | 1;
  rhs: GpuTexture;
  res: GpuTexture;
}

const FLAG = { dens: 1, temp: 2, fuel: 4, vel: 8, obst: 16, force: 32, kill: 64, initVel: 128 };

export const bytesPerCellEstimate = (precision: 'half' | 'full', pressure: PressureMode): number => (precision === 'full' ? 16 : 8) * 6 + 4 * (5 + 5.4 + (pressure === 'accurate' ? 8 : 0));

/** Number of multigrid levels for a w x h grid (every level keeps even sizes, coarsest >= 8). */
export function mgLevels(w: number, h: number): number {
  let l = 1;
  while (w % (1 << l) === 0 && h % (1 << l) === 0 && w >> l >= 8 && h >> l >= 8 && l < 7) l++;
  return l;
}

const MAC_FIELDS = ['dens', 'temp', 'fuel', 'vel', 'obst', 'force', 'kill'] as const;
void MAC_FIELDS;

export class FluidSolver {
  readonly w: number;
  readonly h: number;
  readonly stateFormat: GPUTextureFormat;
  readonly stateBytes: number;
  A!: GpuTexture;
  B!: GpuTexture;
  private A2!: GpuTexture;
  private B2!: GpuTexture;
  private R0!: GpuTexture;
  private R1!: GpuTexture;
  private W!: GpuTexture;
  private levels: Level[] = [];
  private chain: GpuTexture[] = [];
  private scalars: Record<'rz' | 'pq' | 'alpha' | 'beta' | 'tmp' | 'one' | 'res', GpuTexture> | null = null;
  private pcg: { x: [GpuTexture, GpuTexture]; r: [GpuTexture, GpuTexture]; d: [GpuTexture, GpuTexture]; q: GpuTexture; b: GpuTexture } | null = null;
  private readBuf: ReturnType<MemoryManager['buffers']['acquire']> | null = null;
  private owned: GpuTexture[] = [];
  private u: Record<string, UniformValue> = {};
  private obstPresent = false;
  /** Last measured values (HUD / adaptive sub-steps). */
  maxSpeed = 0;
  residual = 0;
  substepsUsed = 1;
  passCount = 0;

  constructor(
    private deps: { gpu: GpuContext; mm: MemoryManager; runner: PassRunner },
    readonly cfg: FluidConfig,
    private owner: ShaderOwner,
  ) {
    this.w = cfg.w;
    this.h = cfg.h;
    this.stateFormat = cfg.precision === 'full' ? 'rgba32float' : 'rgba16float';
    this.stateBytes = this.w * this.h * (cfg.precision === 'full' ? 16 : 8) * 2;
    this.allocate();
  }

  private tex(w: number, h: number, format: GPUTextureFormat, label: string): GpuTexture {
    const t = this.deps.mm.textures.acquire({ width: w, height: h, format, label: `fluid ${label}` });
    this.owned.push(t);
    return t;
  }

  private allocate(): void {
    const { w, h, cfg } = this;
    const sf = this.stateFormat;
    this.A = this.tex(w, h, sf, 'A');
    this.B = this.tex(w, h, sf, 'B');
    this.A2 = this.tex(w, h, sf, 'A2');
    this.B2 = this.tex(w, h, sf, 'B2');
    this.R0 = this.tex(w, h, sf, 'R0');
    this.R1 = this.tex(w, h, sf, 'R1');
    this.W = this.tex(w, h, 'r32float', 'curl');
    const n = cfg.pressure === 'fast' ? 1 : mgLevels(w, h);
    for (let l = 0; l < n; l++) {
      const lw = w >> l;
      const lh = h >> l;
      this.levels.push({
        w: lw,
        h: lh,
        p: [this.tex(lw, lh, 'r32float', `p${l}a`), this.tex(lw, lh, 'r32float', `p${l}b`)],
        cur: 0,
        rhs: this.tex(lw, lh, 'r32float', `rhs${l}`),
        res: this.tex(lw, lh, 'r32float', `res${l}`),
      });
    }
    let cw = w;
    let ch = h;
    do {
      cw = Math.ceil(cw / 8);
      ch = Math.ceil(ch / 8);
      this.chain.push(this.tex(cw, ch, 'r32float', `reduce${cw}`));
    } while (cw > 1 || ch > 1);
    const s = (name: string): GpuTexture => this.tex(1, 1, 'r32float', name);
    this.scalars = { rz: s('rz'), pq: s('pq'), alpha: s('alpha'), beta: s('beta'), tmp: s('tmp'), one: s('one'), res: s('resSq') };
    if (cfg.pressure === 'accurate') {
      const v = (name: string): GpuTexture => this.tex(w, h, 'r32float', name);
      this.pcg = { x: [v('cgx0'), v('cgx1')], r: [v('cgr0'), v('cgr1')], d: [v('cgd0'), v('cgd1')], q: v('cgq'), b: v('cgb') };
    }
    this.readBuf = this.deps.mm.buffers.acquire({ size: 512, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'fluid readback' });
  }

  dispose(): void {
    for (const t of this.owned) t.release();
    this.owned = [];
    this.levels = [];
    this.chain = [];
    this.pcg = null;
    this.scalars = null;
    this.readBuf?.release();
    this.readBuf = null;
  }

  /** Persistent GPU state = what checkpoints / the frame cache store. */
  state(): GpuTexture[] {
    return [this.A, this.B];
  }

  // ---- pass plumbing -----------------------------------------------------------------------------------------------
  private baseUniforms(f: FluidFrame, dtSub: number, inputs: FluidInputs): void {
    const cfg = this.cfg;
    let flags = 0;
    if (inputs.dens) flags |= FLAG.dens;
    if (inputs.temp) flags |= FLAG.temp;
    if (inputs.fuel) flags |= FLAG.fuel;
    if (inputs.vel) flags |= FLAG.vel;
    if (inputs.obst) flags |= FLAG.obst;
    if (inputs.force) flags |= FLAG.force;
    if (inputs.kill) flags |= FLAG.kill;
    if (inputs.initVel) flags |= FLAG.initVel;
    this.obstPresent = !!inputs.obst;
    const z4 = [0, 0, 0, 0];
    const arr = (get: (e: FluidEmitterFrame) => number[]): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 4; i++) out.push(...(f.emitters[i] ? get(f.emitters[i]) : z4));
      return out;
    };
    this.u = {
      bmode: cfg.bmode, flags, seed: f.seed >>> 0, rk: cfg.rk, adv_stage: 0, adv_is_b: 0, rb_color: 0, red_op: 0, op: 0, use_obst: this.obstPresent ? 1 : 0,
      noslip: cfg.noslip ? 1 : 0, obst_move: f.obstMove ? 1 : 0, blend_vec: 0,
      dt: dtSub, dt_frame: f.dtFrame, time: f.time, adv_dir: 1, adv_blend: 1, sgn: 1, rhs_scale: 1, blend_w: 0, turb_omega: f.turbOmega,
      drag: f.drag, damp: f.damp, vort_eps: f.vortEps, vort_scale: f.vortScale, visc: f.visc, soot_decay: f.sootDecay, vmax: f.vmax, init_temp: f.initTemp,
      gravity: f.gravity, wind: f.wind, buoy: [0, 0, 0, 0], turb: [f.turb[0], f.turb[1], 0, 0], swirl: f.swirl, in_gain: f.gains,
      diss: f.diss, comb: f.comb, cool: f.cool, cmax: f.cmax,
      em_a: arr((e) => [e.x, e.y, e.rx, e.ry]),
      em_b: arr((e) => [e.shape, e.dens, e.temp, e.fuel]),
      em_c: arr((e) => [e.vx, e.vy, e.noise, e.nscale]),
      em_d: arr((e) => [e.soft, e.active ? 1 : 0, e.x2, e.y2]),
      em_e: arr((e) => [e.active ? e.expand : 0, 0, 0, 0]),
    };
    this.u.buoy = [f.buoy[0], f.buoy[1], f.buoy[2], 0];
  }

  private run(enc: GPUCommandEncoder, pass: PassName, target: GpuTexture, tex: (GpuTexture | null | undefined)[], over: Record<string, UniformValue> = {}): void {
    const d = PASS_DEFS[pass];
    const tl: (GpuTexture | null)[] = [];
    for (let i = 0; i < d.t; i++) tl.push(tex[i] ?? null);
    this.passCount++;
    this.deps.runner.fullscreen(
      enc,
      { view: target.view, format: target.format, width: target.width, height: target.height },
      { width: target.width, height: target.height, time: 0, loopPhase: 0, tile: [false, false], seed: 0, ss: 1, filter: 0, hq: false },
      { label: `fluid:${pass}`, shader: FLUID_SHADER, defines: { PASS: d.id }, mode: 'raw', uniforms: { layout: FLUID_LAYOUT, values: { ...this.u, ...over } }, textures: tl },
      this.owner,
    );
  }

  /** Compile every pipeline up front (in parallel); resolves when none is pending. */
  async prewarm(): Promise<void> {
    const scratch = this.tex(4, 4, 'r32float', 'warm r32');
    const scratchS = this.tex(4, 4, this.stateFormat, 'warm state');
    this.baseUniforms(emptyFrame(), 1 / 60, {});
    for (let round = 0; round < 40; round++) {
      const pending: Promise<void>[] = [];
      const enc = this.deps.gpu.device.createCommandEncoder({ label: 'fluid prewarm' });
      for (const name of Object.keys(PASS_DEFS) as PassName[]) {
        const d = PASS_DEFS[name];
        const targets = d.fmt === 'both' ? [scratch, scratchS] : [d.fmt === 'r32' ? scratch : scratchS];
        for (const tg of targets) {
          try {
            this.run(enc, name, tg, []);
          } catch (e) {
            if (e instanceof PipelinePending) pending.push(e.promise);
            else throw e;
          }
        }
      }
      // the encoder is dropped on purpose: only the pipeline compilation matters
      if (!pending.length) break;
      await Promise.all(pending);
    }
    this.deps.runner.arena.endBatch();
  }

  // ---- reset / state copies --------------------------------------------------------------------------------------
  reset(enc: GPUCommandEncoder, frame: FluidFrame, inputs: FluidInputs): void {
    this.baseUniforms(frame, frame.dtFrame, { dens: inputs.initDens, vel: undefined, initVel: inputs.initVel });
    this.u.flags = (inputs.initDens ? FLAG.dens : 0) | (inputs.initVel ? FLAG.initVel : 0);
    this.run(enc, 'INITA', this.A, [inputs.initDens, inputs.initVel]);
    this.run(enc, 'ZERO', this.B, []);
    this.run(enc, 'ZERO', this.A2, []);
    this.run(enc, 'ZERO', this.B2, []);
    for (const l of this.levels) {
      this.run(enc, 'ZERO', l.p[0], []);
      this.run(enc, 'ZERO', l.p[1], []);
    }
  }

  copyState(enc: GPUCommandEncoder, from: GpuTexture[], to: GpuTexture[]): void {
    for (let i = 0; i < from.length; i++) enc.copyTextureToTexture({ texture: from[i].texture }, { texture: to[i].texture }, { width: this.w, height: this.h });
  }
  /** Blend two snapshots (loop cross-fade): out = lerp(a, b, w); velocity keeps the mixed direction and the mixed magnitude. */
  blend(enc: GPUCommandEncoder, a: GpuTexture[], b: GpuTexture[], w: number, out: GpuTexture[]): void {
    this.baseUniforms(emptyFrame(), 1 / 60, {});
    this.run(enc, 'BLEND', out[0], [a[0], b[0]], { blend_w: w, blend_vec: 1 });
    this.run(enc, 'BLEND', out[1], [a[1], b[1]], { blend_w: w, blend_vec: 0 });
  }

  // ---- one simulated frame ---------------------------------------------------------------------------------------
  /** Sub-steps for the next frame from the last measurement (CFL limited, deterministic: a pure function of the state). */
  plannedSubsteps(dtFrame: number): number {
    const c = this.cfg;
    if (!c.adaptive) return c.minSub;
    return cflSubsteps(this.maxSpeed, Math.max(this.w, this.h), dtFrame, c.cfl, c.minSub, c.maxSub);
  }

  stepFrame(enc: GPUCommandEncoder, f: FluidFrame, inputs: FluidInputs, substeps: number): void {
    const n = Math.max(1, Math.floor(substeps));
    this.substepsUsed = n;
    const dtSub = f.dtFrame / n;
    for (let s = 0; s < n; s++) {
      this.baseUniforms({ ...f, time: f.time + s * dtSub }, dtSub, inputs);
      this.substep(enc, inputs, s === n - 1);
    }
  }

  private swapA(): void {
    [this.A, this.A2] = [this.A2, this.A];
  }
  private swapB(): void {
    [this.B, this.B2] = [this.B2, this.B];
  }
  private obst(inputs: FluidInputs): GpuTexture | null {
    return inputs.obst ?? null;
  }

  private advect(enc: GPUCommandEncoder, src: GpuTexture, dst: GpuTexture, isB: boolean): void {
    const common = { adv_is_b: isB ? 1 : 0, adv_blend: 1 };
    const ob = this.obstPresentTex;
    if (!this.cfg.maccormack) {
      this.run(enc, 'ADV', dst, [src, this.A, null, null, ob], { ...common, adv_stage: 0, adv_dir: 1 });
      return;
    }
    this.run(enc, 'ADV', this.R0, [src, this.A, null, null, ob], { ...common, adv_stage: 0, adv_dir: 1 });
    this.run(enc, 'ADV', this.R1, [this.R0, this.A, null, null, ob], { ...common, adv_stage: 1, adv_dir: -1 });
    this.run(enc, 'ADV', dst, [src, this.A, this.R0, this.R1, ob], { ...common, adv_stage: 2, adv_dir: 1 });
  }
  private obstPresentTex: GpuTexture | null = null;

  private substep(enc: GPUCommandEncoder, inputs: FluidInputs, last: boolean): void {
    const cfg = this.cfg;
    const ob = this.obst(inputs);
    this.obstPresentTex = ob;
    // 1. advection: B first (it uses the OLD velocity A), then A itself
    this.advect(enc, this.B, this.B2, true);
    this.swapB();
    this.advect(enc, this.A, this.A2, false);
    this.swapA();
    // 2. forces + emitters' velocity
    this.run(enc, 'FORCES', this.A2, [this.A, this.B, ob, inputs.vel, inputs.force]);
    this.swapA();
    // 3. vorticity confinement
    if ((this.u.vort_eps as number) > 0) {
      this.run(enc, 'CURL', this.W, [this.A]);
      this.run(enc, 'CONF', this.A2, [this.A, this.W]);
      this.swapA();
    }
    // 4. viscosity (Jacobi diffusion)
    if ((this.u.visc as number) > 0 && cfg.viscIters > 0) {
      const dst = [this.A2, this.R0];
      let it = this.A;
      for (let i = 0; i < cfg.viscIters; i++) {
        const o = dst[i % 2];
        this.run(enc, 'DIFF', o, [it, this.A]);
        it = o;
      }
      if (it === this.A2) this.swapA();
      else [this.A, this.R0] = [this.R0, this.A];
    }
    // 5. divergence (+ expansion source), mean removal for Neumann / periodic problems
    const l0 = this.levels[0];
    this.run(enc, 'DIV', l0.rhs, [this.A, this.B, ob]);
    if (cfg.bmode !== 1) {
      const sum = this.reduce(enc, l0.rhs, null, 0);
      this.run(enc, 'SUBMEAN', l0.res, [l0.rhs, sum]);
      [l0.rhs, l0.res] = [l0.res, l0.rhs];
    }
    // 6. pressure
    this.solvePressure(enc, ob);
    // 7. projection
    const p = l0.p[l0.cur];
    this.run(enc, 'GRAD', this.A2, [this.A, p, ob, this.B]);
    this.swapA();
    // 8. combustion / scalars: fuel+soot first (reads the old A and B), then density+temperature
    this.run(enc, 'CB', this.B2, [this.A, this.B, inputs.fuel, p, ob, inputs.kill]);
    this.run(enc, 'CA', this.A2, [this.A, this.B, inputs.dens, inputs.temp, inputs.kill, ob]);
    this.swapA();
    this.swapB();
    if (last) {
      // residual of the pressure equation for the HUD (|rhs - L p|^2 summed)
      this.run(enc, 'RESID', l0.res, [p, l0.rhs, ob], { use_obst: this.obstPresent ? 1 : 0 });
      const sq = this.reduce(enc, l0.res, l0.res, 2);
      this.run(enc, 'NEG', this.scalars!.res, [sq], { sgn: 1 });
    }
  }

  // ---- pressure --------------------------------------------------------------------------------------------------
  private solvePressure(enc: GPUCommandEncoder, ob: GpuTexture | null): void {
    const cfg = this.cfg;
    const l0 = this.levels[0];
    const sc = this.scalars!;
    if (cfg.warmStart) this.run(enc, 'EXTRACTZ', l0.p[l0.cur], [this.B]);
    else this.run(enc, 'ZERO', l0.p[l0.cur], []);
    if (cfg.pressure === 'fast') {
      for (let i = 0; i < cfg.iters; i++) {
        this.run(enc, 'JAC', l0.p[1 - l0.cur], [l0.p[l0.cur], l0.rhs, ob], { use_obst: this.obstPresent ? 1 : 0 });
        l0.cur = (1 - l0.cur) as 0 | 1;
      }
      return;
    }
    if (cfg.pressure === 'balanced') {
      for (let c = 0; c < cfg.cycles; c++) this.vcycle(enc, 0, ob);
      return;
    }
    // accurate: preconditioned conjugate gradient on A = -L (SPD), M = one multigrid V-cycle, scalars stay on the GPU
    const g = this.pcg!;
    const one = sc.one;
    this.run(enc, 'ONE', one, []);
    const x = g.x;
    const r = g.r;
    const d = g.d;
    let xi = 0;
    let ri = 0;
    let di = 0;
    const useO = { use_obst: this.obstPresent ? 1 : 0 };
    this.run(enc, 'NEG', g.b, [l0.rhs], { sgn: -1 }); // b = -div
    this.run(enc, 'NEG', x[0], [l0.p[l0.cur]], { sgn: 1 }); // x0 = warm start
    this.run(enc, 'MATVEC', g.q, [x[0], ob], useO);
    this.run(enc, 'AXPY', r[0], [g.b, g.q, one], { op: 0, sgn: -1 }); // r = b - A x
    const precond = (): GpuTexture => {
      this.run(enc, 'NEG', l0.rhs, [r[ri]], { sgn: -1 }); // L z = -r  <=>  A z = r
      this.run(enc, 'ZERO', l0.p[l0.cur], []);
      this.vcycle(enc, 0, ob);
      return l0.p[l0.cur];
    };
    const dot = (a: GpuTexture, b: GpuTexture, into: GpuTexture): void => {
      const s = this.reduce(enc, a, b, 2);
      this.run(enc, 'NEG', into, [s], { sgn: 1 });
    };
    let z = precond();
    this.run(enc, 'NEG', d[0], [z], { sgn: 1 });
    dot(r[ri], z, sc.rz);
    for (let it = 0; it < cfg.iters; it++) {
      this.run(enc, 'MATVEC', g.q, [d[di], ob], useO);
      dot(d[di], g.q, sc.pq);
      this.run(enc, 'SCAL', sc.alpha, [sc.rz, sc.pq]);
      this.run(enc, 'AXPY', x[1 - xi], [x[xi], d[di], sc.alpha], { op: 0, sgn: 1 });
      xi = 1 - xi;
      this.run(enc, 'AXPY', r[1 - ri], [r[ri], g.q, sc.alpha], { op: 0, sgn: -1 });
      ri = 1 - ri;
      z = precond();
      dot(r[ri], z, sc.tmp);
      this.run(enc, 'SCAL', sc.beta, [sc.tmp, sc.rz]);
      this.run(enc, 'AXPY', d[1 - di], [d[di], z, sc.beta], { op: 1, sgn: 1 }); // d = z + beta d
      di = 1 - di;
      this.run(enc, 'NEG', sc.rz, [sc.tmp], { sgn: 1 });
    }
    this.run(enc, 'NEG', l0.p[l0.cur], [x[xi]], { sgn: 1 });
  }

  private smooth(enc: GPUCommandEncoder, lv: Level, sweeps: number, ob: GpuTexture | null, l: number): void {
    const o = { use_obst: l === 0 && this.obstPresent ? 1 : 0 };
    for (let s = 0; s < sweeps; s++) {
      for (let color = 0; color < 2; color++) {
        this.run(enc, 'GS', lv.p[1 - lv.cur], [lv.p[lv.cur], lv.rhs, l === 0 ? ob : null], { ...o, rb_color: color });
        lv.cur = (1 - lv.cur) as 0 | 1;
      }
    }
  }

  /** Geometric multigrid V-cycle (red-black Gauss-Seidel smoother, 2x2 restriction, bilinear prolongation). Obstacles live on level 0 only. */
  private vcycle(enc: GPUCommandEncoder, l: number, ob: GpuTexture | null): void {
    const lv = this.levels[l];
    if (l === this.levels.length - 1) {
      this.smooth(enc, lv, 10, ob, l);
      return;
    }
    const sw = l === 0 ? 2 : 1;
    this.smooth(enc, lv, sw, ob, l);
    this.run(enc, 'RESID', lv.res, [lv.p[lv.cur], lv.rhs, l === 0 ? ob : null], { use_obst: l === 0 && this.obstPresent ? 1 : 0 });
    const nx = this.levels[l + 1];
    this.run(enc, 'RESTR', nx.rhs, [lv.res], { rhs_scale: 4 });
    this.run(enc, 'ZERO', nx.p[nx.cur], []);
    this.vcycle(enc, l + 1, ob);
    this.run(enc, 'PROLONG', lv.p[1 - lv.cur], [lv.p[lv.cur], nx.p[nx.cur]]);
    lv.cur = (1 - lv.cur) as 0 | 1;
    this.smooth(enc, lv, sw, ob, l);
  }

  // ---- reductions + measurement -------------------------------------------------------------------------------------
  /** 8x8 block reduction chain down to 1x1; returns the 1x1 texture (valid until the next reduce). op 0 sum, 1 max, 2 dot, 3 max |v| of A. */
  private reduce(enc: GPUCommandEncoder, a: GpuTexture, b: GpuTexture | null, op: number): GpuTexture {
    let cur = a;
    this.chain.forEach((t, i) => {
      const first = i === 0;
      const o = first ? op : op === 1 || op === 3 ? 1 : 0;
      this.run(enc, 'RED', t, [cur, first ? b : null], { red_op: o });
      cur = t;
    });
    return cur;
  }

  /** Max |v| of the current state + last pressure residual, read back asynchronously (one tiny buffer, 8 bytes). */
  async measure(): Promise<void> {
    const dev = this.deps.gpu.device;
    this.baseUniforms(emptyFrame(), 1 / 60, {});
    const buf = this.readBuf!.buffer;
    const make = (): GPUCommandBuffer => {
      const enc = dev.createCommandEncoder({ label: 'fluid measure' });
      const m = this.reduce(enc, this.A, null, 3);
      enc.copyTextureToBuffer({ texture: m.texture }, { buffer: buf, offset: 0, bytesPerRow: 256 }, { width: 1, height: 1 });
      enc.copyTextureToBuffer({ texture: this.scalars!.res.texture }, { buffer: buf, offset: 256, bytesPerRow: 256 }, { width: 1, height: 1 });
      return enc.finish();
    };
    for (let attempt = 0; ; attempt++) {
      try {
        this.deps.runner.submit([make()]);
        break;
      } catch (e) {
        if (e instanceof PipelinePending && attempt < 64) {
          await e.promise;
          continue;
        }
        throw e;
      }
    }
    await buf.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(buf.getMappedRange().slice(0));
    buf.unmap();
    const sp = f[0];
    const rs = f[64];
    this.maxSpeed = isFinite(sp) ? sp : 0;
    this.residual = isFinite(rs) ? Math.sqrt(Math.max(0, rs)) : 0;
  }
}

/** A neutral frame (reductions / blends only need valid uniform values). */
export function emptyFrame(): FluidFrame {
  return {
    time: 0, dtFrame: 1 / 30, gravity: [0, 0], wind: [0, 0], buoy: [0, 0, 0], turb: [0, 4], turbOmega: 0, swirl: [0, 0, 0.1, 0], drag: 0, damp: 0, vortEps: 0, vortScale: 1,
    visc: 0, diss: [0, 0, 0, 0], sootDecay: 0, comb: [1, 0, 0, 0], cool: [0, 0, 0, 0], cmax: [8, 8, 8, 100], gains: [1, 1, 1, 1], emitters: [], seed: 1, obstMove: false, vmax: 5, initTemp: 0,
  };
}
