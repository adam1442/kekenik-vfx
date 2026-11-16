import { hashString } from '../../shared/util';
import type { Defines } from '../shaders/preprocess';
import { makeLayout, type UField, type UniformLayout } from '../shaders/uniforms';

/**
 * fused WGSL generator (pure, unit tested). One module per distinct SEGMENT SIGNATURE (ordered node function sources +
 * binding layout), never per parameter value: parameters live in ONE flattened uniform block (`P`), so dragging a slider never
 * recompiles anything.
 *
 * Generated module (single file, handed to the normal fullscreen assembler in 'shade' mode):
 *   #include <hoisted library modules, each once>
 *   // ===== node 0 ... =====
 *   #define <node defines>      struct Params_n0 {...}      <namespaced body of the node's `// @fuse-begin .. // @fuse-end` region>      #undef ...
 *   fn shade(uv: vec2f) -> vec4f { var c = seed; c = n0_fuse(uv, c, Params_n0(P.n0_a, P.n0_b, ...), x...); ... return c; }
 * Namespacing: every module-scope declaration of a node region is prefixed with `n<index>_` and its `Params` type becomes
 * `Params_n<index>` — collisions between two instances (or two node types) are impossible. The chain value stays vec4<f32> inside the
 * shader; the pass writes it ONCE to the final format. An implicit Gray -> Color link is converted inline exactly like
 * `gray_to_color()` (r, r, r, 1).
 */

export const FUSE_BEGIN = '// @fuse-begin';
export const FUSE_END = '// @fuse-end';

export interface FuseNodeSpec {
  /** Node type id (e.g. 'color.adjust') — part of the signature. */
  type: string;
  /** Stable id of the node's shader source (ShaderSource.id): changes when the WGSL changes. */
  sourceId: string;
  /** WGSL file text (whole standalone shader). */
  code: string;
  /** File name for line attribution. */
  fileName: string;
  layout: UniformLayout;
  defines?: Defines;
  /** One flag per declared extra pin: true = connected (real binding), false = shared dummy binding. */
  extras: boolean[];
  /** Generator head: no main input. */
  head: boolean;
  /** Chain value is Gray but this node's main pin is Color: convert inline. */
  grayToColor: boolean;
}

export interface FuseRegion {
  includes: string[];
  body: string;
  /** 1-based line of the first body line inside the original file. */
  startLine: number;
}

/** Extract the `@fuse-begin/@fuse-end` region + every `#include` line of a node shader. Throws when the markers are missing. */
export function extractFuseRegion(code: string, fileName: string): FuseRegion {
  const lines = code.split('\n');
  const b = lines.findIndex((l) => l.trim() === FUSE_BEGIN);
  const e = lines.findIndex((l, i) => i > b && l.trim() === FUSE_END);
  if (b < 0 || e < 0) throw new Error(`${fileName}: missing "${FUSE_BEGIN}" / "${FUSE_END}" markers`);
  const includes: string[] = [];
  for (const l of lines) {
    const m = /^\s*#include\s+"([^"]+)"/.exec(l);
    if (m) includes.push(m[1]);
  }
  const body = lines.slice(b + 1, e).join('\n');
  return { includes, body, startLine: b + 2 };
}

const DECL_RE = /^\s*(?:fn|const|struct|alias|override)\s+([A-Za-z_]\w*)|^\s*var(?:<[^>]*>)?\s+([A-Za-z_]\w*)/;

/** Names declared at module scope (brace depth 0) of a WGSL snippet. */
export function topLevelNames(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '');
    if (depth === 0) {
      const m = DECL_RE.exec(line);
      if (m) names.push(m[1] ?? m[2]);
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  return [...new Set(names)];
}

/** Prefix every module-scope declaration of `body` (and its uses) with `prefix_`; `Params` -> `Params_<prefix>`. Line count is preserved. */
export function namespaceWgsl(body: string, prefix: string): string {
  const names = topLevelNames(body).filter((n) => n !== 'Params');
  const map = new Map<string, string>(names.map((n) => [n, `${prefix}_${n}`]));
  map.set('Params', `Params_${prefix}`);
  const re = new RegExp(`(?<![\\w.])(${[...map.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?!\\w)`, 'g');
  return body
    .split('\n')
    .map((line) => {
      const ci = line.indexOf('//');
      const code = ci >= 0 ? line.slice(0, ci) : line;
      const com = ci >= 0 ? line.slice(ci) : '';
      return code.replace(re, (m) => map.get(m) ?? m) + com;
    })
    .join('\n');
}

export interface LineRange {
  /** Index of the node inside the segment. */
  node: number;
  /** 1-based, inclusive range of the node's body inside the generated code. */
  genStart: number;
  genEnd: number;
  /** 1-based line of the body's first line inside the node's own shader file. */
  srcStart: number;
  fileName: string;
  type: string;
}

export interface TextureSlot {
  kind: 'seed' | 'extra' | 'dummy';
  /** Node index (extra) and extra index inside that node. */
  node?: number;
  extra?: number;
}

export interface FusedModule {
  /** Source text for the fullscreen assembler (mode 'shade'). */
  code: string;
  name: string;
  /** Flattened uniform layout: field `n<i>_<field>`. */
  layout: UniformLayout;
  slots: TextureSlot[];
  lineMap: LineRange[];
  /** Cache key: depends on structure only, NEVER on parameter values. */
  signature: string;
}

/** Deterministic signature of a segment (ordered node function ids + binding layout). */
export function segmentSignature(nodes: FuseNodeSpec[], seedGray: boolean): string {
  const parts = nodes.map(
    (n) => `${n.type}|${n.sourceId}|${n.layout.key}|${defineKey(n.defines)}|${n.extras.map((x) => (x ? 1 : 0)).join('')}|${n.head ? 'H' : ''}${n.grayToColor ? 'G' : ''}`,
  );
  parts.push(seedGray ? 'seedGray' : '');
  return hashString(parts.join('\n')).toString(36) + '.' + nodes.length;
}

const defineKey = (d?: Defines): string =>
  d
    ? Object.keys(d)
        .sort()
        .map((k) => `${k}=${String(d[k])}`)
        .join(';')
    : '';

export function generateFusedModule(nodes: FuseNodeSpec[], seedGray: boolean): FusedModule {
  if (nodes.length === 0) throw new Error('empty fused segment');
  const regions = nodes.map((n) => extractFuseRegion(n.code, n.fileName));
  const hoisted: string[] = [];
  for (const r of regions) for (const inc of r.includes) if (!hoisted.includes(inc)) hoisted.push(inc);

  const out: string[] = [];
  const lineMap: LineRange[] = [];
  // `push` splits multi-line strings so that `out.length` is always the number of generated LINES (line map correctness).
  const push = (s: string): void => {
    for (const l of s.split('\n')) out.push(l);
  };
  push('// KEKENIK fused pixel segment (generated — do not edit). Chain value stays f32; written once to the final format.');
  for (const inc of hoisted) push(`#include "${inc}"`);

  // Flattened uniform layout.
  const fields: UField[] = [];
  nodes.forEach((n, i) => {
    for (const f of n.layout.fields) fields.push({ ...f, name: `n${i}_${f.name}` });
  });
  const layout = makeLayout(fields.length ? fields : [{ name: 'unused', type: 'f32' }]);

  const slots: TextureSlot[] = [];
  const seedNeeded = !nodes[0].head;
  if (seedNeeded) slots.push({ kind: 'seed' });
  const slotOf: number[][] = nodes.map(() => []);
  let dummySlot = -1;
  nodes.forEach((n, i) => {
    n.extras.forEach((connected, j) => {
      if (connected) {
        slotOf[i][j] = slots.length;
        slots.push({ kind: 'extra', node: i, extra: j });
      }
    });
  });
  if (nodes.some((n) => n.extras.some((c) => !c))) {
    dummySlot = slots.length;
    slots.push({ kind: 'dummy' });
  }
  nodes.forEach((n, i) => n.extras.forEach((c, j) => (slotOf[i][j] = c ? slotOf[i][j] : dummySlot)));

  nodes.forEach((n, i) => {
    const prefix = `n${i}`;
    push('');
    push(`// ===== node ${i}: ${n.type} =====`);
    for (const [k, v] of Object.entries(n.defines ?? {})) if (v !== undefined && v !== false) push(`#define ${k} ${v === true ? 1 : String(v)}`);
    push(n.layout.wgsl(`Params_${prefix}`));
    const body = namespaceWgsl(regions[i].body, prefix);
    const genStart = out.length + 1;
    push(body);
    lineMap.push({ node: i, genStart, genEnd: out.length, srcStart: regions[i].startLine, fileName: n.fileName, type: n.type });
    for (const [k, v] of Object.entries(n.defines ?? {})) if (v !== undefined && v !== false) push(`#undef ${k}`);
  });

  push('');
  push('fn shade(uv: vec2f) -> vec4f {');
  push(seedNeeded ? '  var c = tex_sample(t0, uv, F.tile, F.filter_mode);' : '  var c = vec4f(0.0);');
  if (seedNeeded && seedGray && nodes[0].grayToColor) push('  c = vec4f(c.r, c.r, c.r, 1.0);');
  nodes.forEach((n, i) => {
    const prefix = `n${i}`;
    if (i > 0 && n.grayToColor) push('  c = vec4f(c.r, c.r, c.r, 1.0);');
    const args = n.layout.fields.map((f) => `P.${prefix}_${f.name}`).join(', ');
    const xs = n.extras.map((_, j) => `t${slotOf[i][j]}`).join(', ');
    push(`  c = ${prefix}_fuse(uv, c, Params_${prefix}(${args})${xs ? ', ' + xs : ''});`);
  });
  push('  return c;');
  push('}');

  const signature = segmentSignature(nodes, seedGray);
  return { code: out.join('\n') + '\n', name: `fused_${signature}.wgsl`, layout, slots, lineMap, signature };
}

/** Map a line of the generated module back to the originating node (index + line inside the node's own shader). */
export function attributeLine(lineMap: LineRange[], genLine: number): { node: number; type: string; fileName: string; line: number } | null {
  for (const r of lineMap) {
    if (genLine >= r.genStart && genLine <= r.genEnd) return { node: r.node, type: r.type, fileName: r.fileName, line: r.srcStart + (genLine - r.genStart) };
  }
  return null;
}
