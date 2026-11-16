import type { Engine } from '../engine/engine';
import type { Graph } from '../engine/graph/graph';
import { Emitter } from '../shared/emitter';
import { consoleBus } from '../shared/log';
import { CancelledExport, JobGate, resolveNodeParams, type JobEnv } from './job-env';
import { KIND_OF, planImageFiles, runImageJob } from './image-job';
import { meshFileSet, resolveMeshSettings, runMeshJob } from './mesh-job';
import type { ExportTarget } from './targets';
import { estimateImageJob, resolveImageSettings, validateImageSettings, type ExportIssue } from './settings';
import { resolveViewportSettings, runViewportJob } from './viewport-job';

import { t } from '../shared/i18n';
/**
 * EXPORT QUEUE: scans the graph for export nodes (validation + estimates), runs a selection sequentially while owning
 * the evaluator (`scheduler.runExclusiveForce`), reports progress / log per job, supports pause, resume and cancel.
 */
export type JobState = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export interface LogLine {
  t: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}
export interface ExportEntry {
  nodeId: string;
  nodeName: string;
  type: string;
  label: string;
  enabled: boolean;
  summary: string;
  issues: ExportIssue[];
  gpuBytes: number;
  cpuBytes: number;
  fileBytes: number;
  files: number;
  frames: number;
  /** Rough render time (s) from the last measured evaluation, when known. */
  seconds?: number;
}
export interface JobRecord {
  nodeId: string;
  nodeName: string;
  state: JobState;
  progress: number;
  label: string;
  log: LogLine[];
  files: string[];
  bytes: number;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

const LABELS: Record<string, string> = { 'export.color': 'Color', 'export.mask': 'Mask', 'export.multimask': 'Multimask', 'export.normal': 'Normal', 'export.warp': 'Warp', 'export.motion_vector': 'Motion Vector', 'export.mesh': 'Mesh', 'export.viewport': 'Viewport' };
export const isExportNode = (type: string): boolean => type in LABELS;

const mb = (n: number): string => `${(n / 1048576).toFixed(n > 1e9 ? 0 : 1)} MB`;

/** Describe every export node of the graph: summary line, validation issues, memory / size estimates. */
export function scanExports(engine: Engine, graph: Graph, graphName: string): ExportEntry[] {
  const out: ExportEntry[] = [];
  const maxDim = engine.gpu.caps.limits.maxTextureDimension2D ?? 8192;
  const env = { maxDim, budgetBytes: engine.mm.budgetBytes, hq: graph.settings.bitDepth === 32 };
  for (const node of graph.nodes.values()) {
    if (!isExportNode(node.type)) continue;
    const p = resolveNodeParams({ engine, graph }, node.id);
    const base: ExportEntry = { nodeId: node.id, nodeName: node.name, type: node.type, label: LABELS[node.type], enabled: p.enabled !== false, summary: '', issues: [], gpuBytes: 0, cpuBytes: 0, fileBytes: 0, files: 1, frames: 1 };
    const srcPin = (pin: string): string | undefined => {
      const l = graph.inputLink(node.id, pin);
      const from = l ? graph.nodes.get(l.from.node) : undefined;
      return from ? engine.registry.expanded(from.type)?.outputs.find((o) => o.id === l!.from.pin)?.type : undefined;
    };
    if (KIND_OF[node.type]) {
      const s = resolveImageSettings(KIND_OF[node.type], p, graph.settings);
      const names = planImageFiles(s, graphName, node.name);
      const est = estimateImageJob(s, env);
      const hasInput = node.type === 'export.multimask' ? ['r', 'g', 'b', 'a'].some((c) => graph.inputLink(node.id, c)) : !!graph.inputLink(node.id, 'input');
      const issues = validateImageSettings(s, { ...env, graphTiling: graph.settings.tiling, hasInput, sourcePin: srcPin('input'), graphBitDepth: graph.settings.bitDepth });
      for (const w of names.warnings) issues.push({ level: 'warn', message: w });
      Object.assign(base, { summary: `${s.width}×${s.height} · ${s.format.toUpperCase()} ${String(s.depth)}${typeof s.depth === 'number' ? '-bit' : ''} · ${s.channels} ch · ${s.colorSpace}${s.frameMode === 'single' ? '' : s.frameMode === 'sequence' ? ` · ${s.frameCount} frames` : ` · flipbook ${s.fbCols}×${s.fbRows} (${s.frameCount})`}`, issues, gpuBytes: est.gpuBytes, cpuBytes: est.cpuBytes, fileBytes: est.fileBytes, files: names.frames.length + (s.frameMode === 'flipbook' ? (s.fbJson ? 1 : 0) + (s.fbFiles ? s.frameCount : 0) : 0) + (s.kind === 'warp' && s.frameMode !== 'flipbook' && p.write_json !== false ? 1 : 0), frames: est.frames });
    } else if (node.type === 'export.mesh') {
      const s = resolveMeshSettings(p, graph.settings);
      const issues: ExportIssue[] = [];
      if (!graph.inputLink(node.id, 'input')) issues.push({ level: 'error', message: t('queue.theExportNodeHas') });
      if ((s.mode === 'vat_soft' || s.mode === 'vat_rigid') && s.vatFormat === 'png8') issues.push({ level: 'warn', message: t('queue.8BitVatTexturesAre') });
      if ((s.mode === 'vat_soft' || s.mode === 'vat_rigid') && s.frameCount > 512) issues.push({ level: 'warn', message: t('queue.vatFramesMake', { frameCount: s.frameCount }) });
      if (s.format === 'obj' && s.custom) issues.push({ level: 'info', message: t('queue.objCannotStoreCustom') });
      if (s.mode === 'flipbook') issues.push({ level: 'info', message: t('queue.allFramesAreMerged', { frameCount: s.frameCount }) });
      const set = meshFileSet(s, 'x');
      Object.assign(base, { summary: `${s.mode.replace('_', ' ')} · ${s.format.toUpperCase()} · ${s.axis} · scale ${s.scale}${s.frameCount > 1 ? ` · ${s.frameCount} frames` : ''}`, issues, files: set.main.length + (s.mode === 'mesh' ? 0 : s.mode === 'vat_soft' ? (s.vatNormals ? 3 : 2) : s.mode === 'vat_rigid' ? 3 : 1), frames: s.frameCount, cpuBytes: 64 * 1024 * 1024 });
    } else {
      const s = resolveViewportSettings(p, graph.settings);
      const issues: ExportIssue[] = [];
      if (s.source === '2d' && !graph.inputLink(node.id, 'color')) issues.push({ level: 'error', message: t('queue.2dViewNeedsThe') });
      if (s.source === '3d' && !graph.inputLink(node.id, 'mesh') && !graph.inputLink(node.id, 'color')) issues.push({ level: 'error', message: t('queue.3dViewNeedsA') });
      if (s.source === '3d' && !graph.inputLink(node.id, 'camera')) issues.push({ level: 'info', message: s.frameMode === 'turntable' ? 'No Camera input: the mesh is framed automatically.' : 'No Camera input: the mesh is framed automatically (add a Camera node for a fixed shot).' });
      if (s.width * s.ss > 16384 || s.height * s.ss > 16384) issues.push({ level: 'info', message: `${s.width * s.ss}×${s.height * s.ss} supersampled pixels are rendered in tiles.` });
      if (s.source === '2d' && s.ss > 1) issues.push({ level: 'info', message: t('queue.supersamplingAppliesToThe') });
      if (s.tile3x3) issues.push({ level: 'info', message: `3x3 tiling preview: each tile is ${Math.floor(s.width / 3)}×${Math.floor(s.height / 3)}.` });
      Object.assign(base, { summary: `${s.source.toUpperCase()} · ${s.width}×${s.height} · ${s.format.toUpperCase()} · ss ${s.ss}×${s.frameMode === 'single' ? '' : ` · ${s.frameMode} ${s.frameCount}`}`, issues, files: s.frameCount, frames: s.frameCount, cpuBytes: Math.min(1024, s.width) * Math.min(1024, s.height) * 16 * 2, fileBytes: s.width * s.height * 4 * s.frameCount * 0.5 });
    }
    out.push(base);
  }
  return out;
}

export function formatEstimate(e: ExportEntry): string {
  return `GPU ≈ ${mb(e.gpuBytes)} · RAM ≈ ${mb(e.cpuBytes)} · ${e.files} file${e.files === 1 ? '' : 's'}${e.fileBytes ? ` ≈ ${mb(e.fileBytes)}` : ''}`;
}

export class ExportRunner {
  readonly onChange = new Emitter<void>();
  jobs: JobRecord[] = [];
  running = false;
  private gate: JobGate | null = null;
  constructor(private engine: Engine) {}

  get paused(): boolean {
    return !!this.gate?.isPaused;
  }
  pause(): void {
    this.gate?.pause();
    this.onChange.emit();
  }
  resume(): void {
    this.gate?.resume();
    this.onChange.emit();
  }
  cancel(): void {
    this.gate?.cancel();
  }

  /** Run the given export nodes one after another into `target`. Resolves with a summary line. */
  async run(graph: Graph, graphName: string, nodeIds: string[], target: ExportTarget): Promise<string> {
    if (this.running) throw new Error('An export is already running');
    this.running = true;
    const gate = (this.gate = new JobGate());
    this.jobs = nodeIds.filter((id) => graph.nodes.has(id)).map((id) => ({ nodeId: id, nodeName: graph.nodes.get(id)!.name, state: 'queued' as JobState, progress: 0, label: '', log: [], files: [], bytes: 0 }));
    this.onChange.emit();
    let ok = 0;
    try {
      await this.engine.scheduler.runExclusiveForce(async () => {
        for (const job of this.jobs) {
          if (gate.cancelled) {
            job.state = 'cancelled';
            continue;
          }
          const node = graph.nodes.get(job.nodeId);
          if (!node) continue;
          job.state = 'running';
          job.startedAt = performance.now();
          const log = (level: LogLine['level'], message: string): void => {
            job.log.push({ t: performance.now(), level, message });
            consoleBus[level](`[export] ${job.nodeName}: ${message}`, { source: 'io' });
            this.onChange.emit();
          };
          const env: JobEnv = {
            engine: this.engine,
            graph,
            graphName,
            target,
            gate,
            log,
            onProgress: (f, label) => {
              job.progress = Math.max(0, Math.min(1, f));
              if (label) job.label = label;
              this.onChange.emit();
            },
          };
          try {
            const res = node.type === 'export.mesh' ? await runMeshJob(env, job.nodeId) : node.type === 'export.viewport' ? await runViewportJob(env, job.nodeId) : await runImageJob(env, job.nodeId);
            job.files = res.files;
            job.bytes = res.bytes;
            job.state = 'done';
            job.progress = 1;
            ok++;
            log('info', `done: ${res.files.length} file(s), ${mb(res.bytes)}, ${((performance.now() - job.startedAt) / 1000).toFixed(1)} s`);
          } catch (e) {
            if (e instanceof CancelledExport) {
              job.state = 'cancelled';
              log('warn', 'cancelled');
            } else {
              job.state = 'error';
              job.error = (e as Error).message;
              log('error', (e as Error).message);
            }
          }
          job.endedAt = performance.now();
          this.onChange.emit();
        }
      });
      const done = await target.finish();
      return gate.cancelled ? `cancelled (${ok} of ${this.jobs.length} finished): ${done}` : done;
    } catch (e) {
      await target.abort().catch(() => undefined);
      throw e;
    } finally {
      this.running = false;
      this.gate = null;
      this.onChange.emit();
    }
  }
}
