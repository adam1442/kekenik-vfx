import { autoGrid, cellSize, type RowOrder } from '../engine/anim/flipbook-layout';
import type { GraphSettings } from '../engine/graph/graph';
import { IMAGE_FORMATS, type ImageFormatId, type SampleDepth, type ColorSpaceFlag } from './encoders';
import { ENGINE_PRESETS, type EngineId } from './engines';
import { DEFAULT_SEQUENCE_TEMPLATE, DEFAULT_TEMPLATE } from './naming';
import { depthBytes } from './pixels';
import type { NormalConvention, NormalLayout } from './pixels';

/**
 * Resolution of the raw node parameters of an Export node into concrete, validated settings.
 * Pure: no GPU. Everything the job runner, the Export panel's estimates and the validation warnings need.
 */
export type ImageKind = 'color' | 'mask' | 'multimask' | 'normal' | 'warp';
export type FrameMode = 'single' | 'sequence' | 'flipbook';
export type SizeMode = 'graph' | 'multiplier' | 'absolute';

export interface ImageExportSettings {
  kind: ImageKind;
  template: string;
  format: ImageFormatId;
  depth: SampleDepth;
  colorSpace: ColorSpaceFlag;
  premultiply: boolean;
  engine: EngineId;
  channels: 1 | 2 | 3 | 4;
  width: number;
  height: number;
  frameMode: FrameMode;
  frameStart: number;
  frameCount: number;
  fps: number;
  fbCols: number;
  fbRows: number;
  fbPadding: number;
  fbRowOrder: RowOrder;
  fbJson: boolean;
  fbFiles: boolean;
  edgePadding: number;
  exrCompression: 'zip' | 'none';
  normalConvention: NormalConvention;
  normalLayout: NormalLayout;
  /** Corrections applied while resolving (shown in the job log). */
  notes: string[];
}

export type IssueLevel = 'error' | 'warn' | 'info';
export interface ExportIssue {
  level: IssueLevel;
  message: string;
}

const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pair = (v: unknown, d: [number, number]): [number, number] => (Array.isArray(v) && v.length >= 2 ? [num(v[0], d[0]), num(v[1], d[1])] : d);

export const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));

/** Depth values a format can store; returns the nearest valid depth and a note when it had to change. */
export function coerceDepth(format: ImageFormatId, depth: SampleDepth, notes: string[]): SampleDepth {
  const f = IMAGE_FORMATS[format];
  if (f.depths.includes(depth)) return depth;
  const wantFloat = depth === 'half' || depth === 'float';
  let pick: SampleDepth;
  if (format === 'exr') pick = depth === 16 ? 'half' : depth === 8 ? 'half' : 'float';
  else if (format === 'hdr') pick = 'float';
  else if (format === 'tga') pick = 8;
  else pick = wantFloat ? 16 : 8; // png
  notes.push(`${f.label} cannot store ${String(depth)}-bit samples: using ${String(pick)}.`);
  return pick;
}

export function parseDepth(v: unknown): SampleDepth {
  const s = String(v);
  return s === '8' ? 8 : s === '16' ? 16 : s === 'half' ? 'half' : s === 'float' ? 'float' : 8;
}

export function resolveSize(mode: SizeMode, mul: [number, number], abs: [number, number], g: Pick<GraphSettings, 'width' | 'height'>): { w: number; h: number } {
  if (mode === 'absolute') return { w: clampInt(abs[0], 1, 16384), h: clampInt(abs[1], 1, 16384) };
  if (mode === 'multiplier') return { w: clampInt(g.width * mul[0], 1, 16384), h: clampInt(g.height * mul[1], 1, 16384) };
  return { w: g.width, h: g.height };
}

export function resolveImageSettings(kind: ImageKind, p: Record<string, unknown>, g: GraphSettings): ImageExportSettings {
  const notes: string[] = [];
  const engine = (ENGINE_PRESETS[str(p.engine, 'none') as EngineId] ? str(p.engine, 'none') : 'none') as EngineId;
  const preset = ENGINE_PRESETS[engine];
  let format = str(p.format, 'png') as ImageFormatId;
  if (!IMAGE_FORMATS[format]) format = 'png';
  const depth = coerceDepth(format, parseDepth(p.depth), notes);
  const fmt = IMAGE_FORMATS[format];

  // channels per kind
  let channels: 1 | 2 | 3 | 4;
  switch (kind) {
    case 'color': channels = p.alpha === false ? 3 : 4; break;
    case 'mask': channels = p.as_rgb === true ? 3 : 1; break;
    case 'multimask': channels = str(p.slots, 'rgba') === 'rgb' ? 3 : 4; break;
    case 'normal': channels = 3; break;
    default: channels = 3;
  }
  if (channels > fmt.maxChannels) {
    notes.push(`${fmt.label} stores at most ${fmt.maxChannels} channels: alpha dropped.`);
    channels = fmt.maxChannels;
  }
  if (format === 'tga' && channels === 2) channels = 3;

  // colour space: 'auto' -> sRGB for colour textures in 8/16 bit integer formats, linear for data
  const cs = str(p.color_space, 'auto');
  let colorSpace: ColorSpaceFlag;
  if (fmt.linearOnly) {
    colorSpace = 'linear';
    if (cs === 'srgb') notes.push(`${fmt.label} is always linear: the sRGB option is ignored.`);
  } else if (cs === 'srgb' || cs === 'linear') colorSpace = cs;
  else colorSpace = kind === 'color' && preset.colorSrgb && (depth === 8 || depth === 16) ? 'srgb' : 'linear';

  // mask textures: respect the engine; normals / warps are always linear data
  if ((kind === 'normal' || kind === 'warp') && colorSpace === 'srgb') notes.push(`${kind === 'normal' ? 'Normal' : 'Warp'} maps are data: sRGB encoding is usually wrong.`);

  const mode = str(p.size_mode, 'graph') as SizeMode;
  const size = resolveSize(mode, pair(p.size_mul, [1, 1]), pair(p.size_abs, [g.width, g.height]), g);
  const frameMode = (['single', 'sequence', 'flipbook'].includes(str(p.frame_mode, 'single')) ? str(p.frame_mode, 'single') : 'single') as FrameMode;
  const frameCount = frameMode === 'single' ? 1 : clampInt(num(p.frame_count, 0) || g.loopLength, 1, 4096);
  const frameStart = clampInt(num(p.frame_start, 0), -100000, 100000);
  let fbCols = clampInt(num(p.fb_cols, 0), 0, 256);
  let fbRows = clampInt(num(p.fb_rows, 0), 0, 256);
  if (frameMode === 'flipbook') {
    const auto = autoGrid(frameCount, size.w / size.h);
    if (!fbCols && !fbRows) ({ cols: fbCols, rows: fbRows } = auto);
    else if (!fbCols) fbCols = Math.ceil(frameCount / fbRows);
    else if (!fbRows) fbRows = Math.ceil(frameCount / fbCols);
  }
  const convention = str(p.convention, 'engine');
  const normalConvention: NormalConvention = convention === 'opengl' || convention === 'directx' ? convention : preset.normal;
  if (kind === 'warp' && depth === 8) void 0;
  if (depth === 'half' && format === 'dds') void 0;
  return {
    kind,
    template: str(p.file_name, frameMode === 'sequence' ? DEFAULT_SEQUENCE_TEMPLATE : DEFAULT_TEMPLATE) || DEFAULT_TEMPLATE,
    format,
    depth,
    colorSpace,
    premultiply: p.premultiply === true && channels === 4,
    engine,
    channels,
    width: size.w,
    height: size.h,
    frameMode,
    frameStart,
    frameCount,
    fps: g.fps,
    fbCols,
    fbRows,
    fbPadding: clampInt(num(p.fb_padding, 0), 0, 64),
    fbRowOrder: str(p.fb_row_order, 'top_down') === 'bottom_up' ? 'bottom_up' : 'top_down',
    fbJson: p.fb_json !== false,
    fbFiles: p.fb_files === true,
    edgePadding: clampInt(num(p.edge_padding, 0), 0, 64),
    exrCompression: str(p.exr_compression, 'zip') === 'none' ? 'none' : 'zip',
    normalConvention,
    normalLayout: (['xyz', 'reconstruct', 'rg'].includes(str(p.normal_layout, 'xyz')) ? str(p.normal_layout, 'xyz') : 'xyz') as NormalLayout,
    notes,
  };
}

/* ------------------------------------------------------------------------------------------------ estimates & validation */
export interface ImageEstimate {
  files: number;
  /** Peak GPU bytes of one evaluation at the working size (rough: 6 live RGBA16F textures per tile / frame). */
  gpuBytes: number;
  /** Peak CPU bytes held by the exporter (strip / band buffers, never the whole image when streaming). */
  cpuBytes: number;
  /** Approximate size of the written files. */
  fileBytes: number;
  tiled: boolean;
  tileSize: number;
  frames: number;
  outW: number;
  outH: number;
}

export interface EstimateEnv {
  maxDim: number;
  budgetBytes: number;
  hq: boolean;
}

/** Decide whether the export must render in tiles: the full-size working set would use > 35 % of the budget or exceed the device texture limit. */
export function planTiling(w: number, h: number, env: EstimateEnv): { tiled: boolean; tileSize: number } {
  const bpp = env.hq ? 16 : 8;
  const working = w * h * bpp * 6;
  const tiled = w > env.maxDim || h > env.maxDim || working > env.budgetBytes * 0.35;
  if (!tiled) return { tiled: false, tileSize: Math.max(w, h) };
  let size = 2048;
  while (size > 128 && (size * size * bpp * 6 > env.budgetBytes * 0.25 || size > env.maxDim)) size /= 2;
  return { tiled: true, tileSize: size };
}

export function estimateImageJob(s: ImageExportSettings, env: EstimateEnv): ImageEstimate {
  const flip = s.frameMode === 'flipbook';
  const frames = s.frameMode === 'single' ? 1 : s.frameCount;
  const cell = flip ? cellSize({ sheetW: s.width, sheetH: s.height, cols: s.fbCols, rows: s.fbRows }) : { w: s.width, h: s.height };
  const t = planTiling(cell.w, cell.h, env);
  const outBytes = s.width * s.height * s.channels * depthBytes(s.depth);
  const perFile = s.format === 'png' || s.format === 'exr' ? outBytes * 0.7 : outBytes;
  const bandRows = flip ? cell.h : t.tiled ? t.tileSize : 64;
  const cpu = (flip ? s.width : s.width) * bandRows * 4 * s.channels + 16 * 1024 * 1024 + (s.edgePadding ? s.width * (128 + 2 * s.edgePadding) * 16 : 0);
  const files = flip ? 1 + (s.fbJson ? 1 : 0) + (s.fbFiles ? frames : 0) : frames;
  return { files, gpuBytes: Math.min(cell.w, t.tileSize) * Math.min(cell.h, t.tileSize) * (env.hq ? 16 : 8) * 6, cpuBytes: cpu, fileBytes: flip ? perFile + (s.fbFiles ? frames * (cell.w * cell.h * s.channels * depthBytes(s.depth)) * 0.7 : 0) : perFile * frames, tiled: t.tiled, tileSize: t.tileSize, frames, outW: s.width, outH: s.height };
}

export interface ValidationEnv extends EstimateEnv {
  graphTiling: GraphSettings['tiling'];
  /** Pin type feeding the node (color export without alpha source etc.). */
  sourcePin?: string;
  hasInput: boolean;
  graphBitDepth: 16 | 32;
}

export function validateImageSettings(s: ImageExportSettings, env: ValidationEnv): ExportIssue[] {
  const out: ExportIssue[] = [];
  const add = (level: IssueLevel, message: string): void => void out.push({ level, message });
  const preset = ENGINE_PRESETS[s.engine];
  for (const n of s.notes) add('info', n);
  if (!env.hasInput) add('error', 'The export node has no input connected.');
  const flip = s.frameMode === 'flipbook';
  const cell = flip ? cellSize({ sheetW: s.width, sheetH: s.height, cols: s.fbCols, rows: s.fbRows }) : { w: s.width, h: s.height };
  if (flip) {
    if (s.fbCols * s.fbRows < s.frameCount) add('error', `${s.frameCount} frames do not fit a ${s.fbCols}×${s.fbRows} grid.`);
    if (cell.w < 1 || cell.h < 1 || cell.w - 2 * s.fbPadding < 1 || cell.h - 2 * s.fbPadding < 1) add('error', 'Cells are too small for the padding: enlarge the sheet or reduce the grid / padding.');
    if (s.width % s.fbCols || s.height % s.fbRows) add('warn', `Sheet ${s.width}×${s.height} is not divisible by the ${s.fbCols}×${s.fbRows} grid: cells are ${cell.w}×${cell.h} and ${s.width - cell.w * s.fbCols}/${s.height - cell.h * s.fbRows} px stay empty at the right / bottom.`);
  }
  const isPot = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
  if (preset.pot && (!isPot(s.width) || !isPot(s.height))) add('warn', `${preset.label}: ${s.width}×${s.height} is not a power of two (no mips / streaming for NPOT textures).`);
  else if (preset.multipleOf4 && (s.width % 4 || s.height % 4)) add('warn', `${preset.label}: block compression needs multiples of 4 (${s.width}×${s.height}).`);
  if (s.kind === 'color' && s.channels === 4 && env.sourcePin === 'gray') add('warn', 'Source has no alpha channel: the exported alpha will be fully opaque.');
  if (s.premultiply && s.colorSpace === 'srgb') add('info', 'Premultiplication happens in linear light before the sRGB encoding.');
  if (!flip && env.graphTiling === 'none' && s.kind !== 'warp') add('info', 'Graph tiling is off: this texture will not tile seamlessly.');
  if (s.depth === 16 && s.format === 'png' && env.graphBitDepth === 16) add('info', 'The graph computes in half float (≈11 significant bits): enable HQ (32-bit) in the graph settings for full 16-bit precision.');
  if (s.kind === 'warp' && s.format === 'png' && s.depth !== 8 && s.depth !== 16) add('warn', 'PNG cannot store the chosen depth.');
  if (s.edgePadding > 0 && s.channels !== 4) add('warn', 'Edge padding needs an alpha channel (4 channels): ignored.');
  const est = estimateImageJob(s, env);
  if (est.tiled) add('info', `Large output: rendered in ${est.tileSize}px tiles with halo, streamed in strips (GPU ≈ ${(est.gpuBytes / 1048576).toFixed(0)} MB).`);
  if (s.width * s.height > 64 * 1024 * 1024) add('warn', `Huge export (${s.width}×${s.height}): expect a long render; nodes that need the full image (blur radius, distance, islands) cannot be tiled and will report an error.`);
  if (flip && est.cpuBytes > 768 * 1024 * 1024) add('error', `A sheet band needs about ${(est.cpuBytes / 1048576).toFixed(0)} MB of RAM: reduce the sheet size or use more rows.`);
  if (est.fileBytes > 1.5 * 1024 * 1024 * 1024) add('warn', 'More than 1.5 GB of output: use a browser with the File System Access API (folder export); the ZIP fallback is capped.');
  if (s.frameMode === 'sequence' && !/\{frame/.test(s.template)) add('info', 'The file name template has no {frame}: "_{frame:4}" is appended.');
  return out;
}
