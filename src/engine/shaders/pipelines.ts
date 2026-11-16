import { Emitter } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';
import type { GpuContext } from '../gpu/device';
import { PreprocessError, type SourceLoc } from './preprocess';

/**
 * Pipeline cache + compile diagnostics.
 *
 * Why the "pending" protocol: a pipeline with a compile error is INVALID, and recording a draw with an invalid
 * pipeline poisons the whole command buffer (one bad node would break the rest of the graph). So pipelines are
 * validated before first use: `getRender()` is synchronous; when the pipeline is not ready it starts the
 * async build (createShaderModule + getCompilationInfo + createRenderPipelineAsync) and throws PipelinePending;
 * the evaluator awaits it and retries the node. Compile failures become ShaderCompileError with diagnostics
 * mapped back to (file, line) of the ORIGINAL sources, and are logged to the Console with node id and name.
 */
export interface ShaderOwner {
  nodeId?: string;
  nodeName?: string;
  label?: string;
}

export interface ShaderDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Original file (e.g. "node:noise.wgsl", "hash", "prelude") and 1-based line inside it. */
  file: string;
  line: number;
  column: number;
  sourceLine?: string;
  /** Line number in the final, preprocessed source. */
  outLine: number;
}

export class ShaderCompileError extends Error {
  constructor(
    message: string,
    readonly diagnostics: ShaderDiagnostic[],
    readonly owner?: ShaderOwner,
  ) {
    super(message);
    this.name = 'ShaderCompileError';
  }
}

export class PipelinePending extends Error {
  constructor(readonly promise: Promise<void>) {
    super('pipeline not ready');
    this.name = 'PipelinePending';
  }
}

export interface AssembledShader {
  code: string;
  map: SourceLoc[];
  label: string;
}

type Entry = { state: 'pending'; promise: Promise<void> } | { state: 'ready'; value: unknown } | { state: 'error'; error: Error };

export class PipelineCache {
  private entries = new Map<string, Entry>();
  private layouts = new Map<string, { bgl: GPUBindGroupLayout; pl: GPUPipelineLayout }>();
  compiledCount = 0;
  /** fired after every pipeline build (success or failure) with the wall time from request to ready. */
  readonly onCompiled = new Emitter<{ label: string; ms: number; ok: boolean }>();
  /** Number of pipelines currently being built (HUD / warm-up). */
  pendingCount = 0;

  constructor(private gpu: GpuContext) {}

  /** Cached (bind group layout, pipeline layout) pair, created synchronously from our own (valid) descriptors. */
  layout(key: string, entries: GPUBindGroupLayoutEntry[]): { bgl: GPUBindGroupLayout; pl: GPUPipelineLayout } {
    let l = this.layouts.get(key);
    if (!l) {
      const dev = this.gpu.device;
      const bgl = dev.createBindGroupLayout({ entries, label: `bgl ${key}` });
      l = { bgl, pl: dev.createPipelineLayout({ bindGroupLayouts: [bgl], label: `pl ${key}` }) };
      this.layouts.set(key, l);
    }
    return l;
  }

  private getOrBuild<T>(key: string, build: () => Promise<T>, label = key.slice(0, 80)): T {
    const e = this.entries.get(key);
    if (e) {
      if (e.state === 'ready') return e.value as T;
      if (e.state === 'error') throw e.error;
      throw new PipelinePending(e.promise);
    }
    const t0 = performance.now();
    this.pendingCount++;
    const promise = build().then(
      (value) => {
        this.pendingCount--;
        this.entries.set(key, { state: 'ready', value });
        this.onCompiled.emit({ label, ms: performance.now() - t0, ok: true });
      },
      (error: Error) => {
        this.pendingCount--;
        this.entries.set(key, { state: 'error', error });
        this.onCompiled.emit({ label, ms: performance.now() - t0, ok: false });
      },
    );
    this.entries.set(key, { state: 'pending', promise });
    throw new PipelinePending(promise);
  }

  getRender(
    key: string,
    spec: {
      assemble: () => AssembledShader;
      owner: ShaderOwner;
      layout: GPUPipelineLayout;
      format: GPUTextureFormat;
      blend?: GPUBlendState;
      vertexEntry?: string;
      fragmentEntry?: string;
    },
  ): GPURenderPipeline {
    return this.getOrBuild(key, async () => {
      const asm = this.safeAssemble(spec.assemble, spec.owner);
      const module = await this.compile(asm, spec.owner);
      try {
        const pipeline = await this.gpu.device.createRenderPipelineAsync({
          label: asm.label,
          layout: spec.layout,
          vertex: { module, entryPoint: spec.vertexEntry ?? 'vs_main' },
          fragment: { module, entryPoint: spec.fragmentEntry ?? 'fs_main', targets: [{ format: spec.format, blend: spec.blend }] },
          primitive: { topology: 'triangle-list' },
        });
        this.compiledCount++;
        return pipeline;
      } catch (e) {
        throw this.pipelineError(e, asm, spec.owner);
      }
    }, spec.owner.label ?? spec.owner.nodeName ?? key.slice(0, 80));
  }

  getCompute(
    key: string,
    spec: { assemble: () => AssembledShader; owner: ShaderOwner; layout: GPUPipelineLayout; entry: string },
  ): GPUComputePipeline {
    return this.getOrBuild(key, async () => {
      const asm = this.safeAssemble(spec.assemble, spec.owner);
      const module = await this.compile(asm, spec.owner);
      try {
        const p = await this.gpu.device.createComputePipelineAsync({ label: asm.label, layout: spec.layout, compute: { module, entryPoint: spec.entry } });
        this.compiledCount++;
        return p;
      } catch (e) {
        throw this.pipelineError(e, asm, spec.owner);
      }
    }, spec.owner.label ?? spec.owner.nodeName ?? key.slice(0, 80));
  }

  private safeAssemble(assemble: () => AssembledShader, owner: ShaderOwner): AssembledShader {
    try {
      return assemble();
    } catch (e) {
      if (e instanceof PreprocessError) {
        const diag: ShaderDiagnostic = { severity: 'error', message: e.message, file: e.file, line: e.line, column: 0, outLine: 0 };
        this.report([diag], owner);
        throw new ShaderCompileError(`Shader preprocess error: ${e.message}`, [diag], owner);
      }
      throw e;
    }
  }

  private pipelineError(e: unknown, asm: AssembledShader, owner: ShaderOwner): ShaderCompileError {
    const msg = (e as Error).message ?? String(e);
    const diag: ShaderDiagnostic = { severity: 'error', message: `Pipeline creation failed: ${msg}`, file: asm.label, line: 0, column: 0, outLine: 0 };
    this.report([diag], owner);
    return new ShaderCompileError(diag.message, [diag], owner);
  }

  /** Compile a module and map getCompilationInfo messages to original file/line. Throws on errors. */
  async compile(asm: AssembledShader, owner: ShaderOwner): Promise<GPUShaderModule> {
    const module = this.gpu.device.createShaderModule({ code: asm.code, label: asm.label });
    const info = await module.getCompilationInfo();
    const srcLines = asm.code.split('\n');
    const diags: ShaderDiagnostic[] = info.messages.map((m) => {
      const loc = m.lineNum > 0 ? asm.map[m.lineNum - 1] : undefined;
      return {
        severity: m.type,
        message: m.message,
        file: loc?.file ?? asm.label,
        line: loc?.line ?? m.lineNum,
        column: m.linePos,
        sourceLine: m.lineNum > 0 ? srcLines[m.lineNum - 1] : undefined,
        outLine: m.lineNum,
      };
    });
    if (diags.length) this.report(diags, owner);
    const errors = diags.filter((d) => d.severity === 'error');
    if (errors.length) {
      throw new ShaderCompileError(`Shader "${asm.label}" failed to compile: ${errors[0].file}:${errors[0].line} ${errors[0].message}`, diags, owner);
    }
    return module;
  }

  private report(diags: ShaderDiagnostic[], owner: ShaderOwner): void {
    for (const d of diags) {
      const fn = d.severity === 'error' ? consoleBus.error : d.severity === 'warning' ? consoleBus.warn : consoleBus.info;
      fn(d.message, { source: 'shader', nodeId: owner.nodeId, nodeName: owner.nodeName, file: d.file, line: d.line, column: d.column, detail: d.sourceLine ? `  ${d.sourceLine.trim()}` : undefined });
    }
  }

  /** number of cached pipeline entries (Diagnostics). */
  get size(): number {
    return this.entries.size;
  }

  /** drop every pipeline whose key contains `fragment` (LRU eviction of fused modules). Returns the number removed. */
  deleteMatching(fragment: string): number {
    let n = 0;
    for (const k of [...this.entries.keys()]) {
      if (k.includes(fragment)) {
        this.entries.delete(k);
        n++;
      }
    }
    return n;
  }

  /** Device lost: drop everything. */
  clear(): void {
    this.entries.clear();
    this.layouts.clear();
  }
}
