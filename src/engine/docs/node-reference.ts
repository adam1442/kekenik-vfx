import type { NodeRegistry } from '../graph/registry';
import type { ParamDef } from '../params/schema';
import { CATEGORIES } from '../graph/categories';

/**
 * Node reference generator. Reads every NodeDefinition (through the registry's EXPANDED view, i.e. including the automatic
 * Texture / Blending params and the generated `<param> mod` pins) and produces plain data + Markdown.
 * Used by: `npm run docs:nodes` (writes docs/NODE_REFERENCE.md) and the in-app Help panel. Pure, no DOM, no GPU.
 */
export interface RefPin {
  id: string;
  name: string;
  type: string;
  optional: boolean;
  role?: string;
  tooltip?: string;
}
export interface RefParam {
  id: string;
  label: string;
  type: string;
  tab: string;
  group?: string;
  default: string;
  range?: string;
  options?: string[];
  animatable: boolean;
  tooltip?: string;
}
export interface RefNode {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  description: string;
  keywords: string[];
  inputs: RefPin[];
  outputs: RefPin[];
  params: RefParam[];
  gizmos: string[];
  timeDependent: boolean;
  /** Evaluation hint from `cost`. */
  cost?: string;
  /** true when the node declares an identity short-cut (skipped when it does nothing). */
  hasIdentity: boolean;
}

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
  if (typeof v === 'boolean' || typeof v === 'string') return String(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  const o = v as { keys?: unknown[]; stops?: unknown[] };
  if (o.keys) return `curve (${o.keys.length} keys)`;
  if (o.stops) return `gradient (${o.stops.length} stops)`;
  return '…';
};

function describeParam(p: ParamDef): RefParam {
  const q = p as ParamDef & { default?: unknown; min?: number; max?: number; softMin?: number; softMax?: number; options?: { value: string }[]; display?: string };
  const lo = q.min ?? q.softMin;
  const hi = q.max ?? q.softMax;
  return {
    id: p.id,
    label: p.label,
    type: p.type + (q.display && q.display !== 'number' ? ` (${q.display})` : ''),
    tab: p.tab ?? 'Main',
    group: p.group,
    default: fmt(q.default),
    range: lo !== undefined || hi !== undefined ? `${lo ?? '−∞'} … ${hi ?? '∞'}` : undefined,
    options: q.options?.map((o) => o.value),
    animatable: !!p.animatable,
    tooltip: p.tooltip,
  };
}

export function buildNodeReference(registry: NodeRegistry): RefNode[] {
  const out: RefNode[] = [];
  for (const def of registry.list()) {
    const ex = registry.expanded(def.id);
    if (!ex) continue;
    const pin = (p: (typeof ex.inputs)[number]): RefPin => ({ id: p.id, name: p.name, type: p.type, optional: !!p.optional, role: p.role, tooltip: p.tooltip });
    const timeDep = typeof def.timeDependent === 'function' ? true : !!def.timeDependent;
    out.push({
      id: def.id,
      title: def.title,
      category: def.category,
      categoryLabel: CATEGORIES[def.category]?.label ?? def.category,
      description: def.description,
      keywords: def.keywords ?? [],
      inputs: ex.inputs.map(pin),
      outputs: ex.outputs.map(pin),
      params: ex.params.map(describeParam),
      gizmos: (def.gizmos ?? []).map((g) => `${g.label ?? g.id} (${g.type}, ${g.viewport ?? '2d'})`),
      timeDependent: timeDep,
      cost: def.cost ? `GPU ${def.cost.gpu}, tiling ${def.cost.tiling}` : undefined,
      hasIdentity: !!def.identity,
    });
  }
  return out;
}

const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function nodeToMarkdown(n: RefNode): string {
  const L: string[] = [];
  L.push(`### ${n.title}`, '', `\`${n.id}\` · ${n.categoryLabel}${n.timeDependent ? ' · time dependent' : ''}${n.cost ? ` · ${n.cost}` : ''}${n.hasIdentity ? ' · identity short-cut' : ''}`, '', n.description, '');
  if (n.gizmos.length) L.push(`**Gizmos:** ${n.gizmos.join('; ')}`, '');
  L.push('**Pins**', '', '| Direction | Pin | Type | Notes |', '|---|---|---|---|');
  for (const p of n.inputs) L.push(`| in | ${esc(p.name)} (\`${p.id}\`) | ${p.type} | ${[p.optional ? 'optional' : 'required', p.role ?? '', p.tooltip ?? ''].filter(Boolean).map(esc).join(' · ')} |`);
  for (const p of n.outputs) L.push(`| out | ${esc(p.name)} (\`${p.id}\`) | ${p.type} | ${esc(p.tooltip ?? '')} |`);
  L.push('', '**Parameters**', '', '| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |', '|---|---|---|---|---|---|---|');
  for (const p of n.params) {
    const opt = p.options ? p.options.join(', ') : (p.range ?? '');
    L.push(`| ${esc([p.tab, p.group].filter(Boolean).join(' / '))} | ${esc(p.label)} (\`${p.id}\`) | ${p.type} | ${esc(p.default)} | ${esc(opt)} | ${p.animatable ? '●' : ''} | ${esc(p.tooltip ?? '')} |`);
  }
  L.push('');
  return L.join('\n');
}

export function referenceToMarkdown(nodes: RefNode[]): string {
  const L: string[] = ['# Kekenik VFX — Node Reference', '', `_Generated from the node definitions by \`npm run docs:nodes\` — ${nodes.length} nodes. Do not edit by hand._`, ''];
  const cats = new Map<string, RefNode[]>();
  for (const n of nodes) {
    if (!cats.has(n.categoryLabel)) cats.set(n.categoryLabel, []);
    cats.get(n.categoryLabel)!.push(n);
  }
  L.push('## Contents', '');
  for (const [c, list] of cats) L.push(`- **${c}** (${list.length}): ${list.map((n) => n.title).join(', ')}`);
  L.push('');
  for (const [c, list] of cats) {
    L.push(`## ${c}`, '');
    for (const n of list) L.push(nodeToMarkdown(n));
  }
  return L.join('\n');
}
