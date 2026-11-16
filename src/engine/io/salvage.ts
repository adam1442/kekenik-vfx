import type { GraphData, GraphSettings } from '../graph/graph';

/**
 * Corrupted-project recovery. `salvageGraphData` takes whatever was parsed from a damaged file and returns a structurally valid
 * GraphData (so `Graph.fromData` cannot throw) plus a list of human-readable repairs. It never throws.
 *
 * What is repaired: non-object nodes / links are dropped, duplicate ids renamed, missing names / params / positions defaulted,
 * links to missing nodes dropped, non-finite numbers in params replaced by null (the param coercion then restores defaults).
 * What is NOT possible: recovering node *content* that is not in the file (truncated JSON). `salvageTruncatedJson` can still close a
 * truncated document in simple cases.
 */
export interface SalvageReport {
  repairs: string[];
  droppedNodes: number;
  droppedLinks: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (depth > 12) return null;
  if (Array.isArray(v)) return v.map((x) => cleanValue(x, depth + 1));
  if (isObj(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== '__proto__') o[k] = cleanValue(x, depth + 1);
    return o;
  }
  return v;
}

export function salvageGraphData(raw: unknown, defaults: GraphSettings): { data: GraphData; report: SalvageReport } {
  const report: SalvageReport = { repairs: [], droppedNodes: 0, droppedLinks: 0 };
  const src = isObj(raw) ? raw : {};
  if (!isObj(raw)) report.repairs.push('graph block was missing: started with an empty graph');
  const settings = { ...defaults, ...(isObj(src.settings) ? (src.settings as Partial<GraphSettings>) : {}) } as GraphSettings;
  if (!isObj(src.settings)) report.repairs.push('graph settings were missing: defaults used');

  const nodes: GraphData['nodes'] = [];
  const ids = new Set<string>();
  (Array.isArray(src.nodes) ? src.nodes : []).forEach((n, i) => {
    if (!isObj(n) || typeof n.type !== 'string' || !n.type) {
      report.droppedNodes++;
      report.repairs.push(`node #${i} is not a valid node: dropped`);
      return;
    }
    let id = typeof n.id === 'string' && n.id ? n.id : `salvaged_${i}`;
    if (ids.has(id)) {
      const old = id;
      id = `${id}_dup${i}`;
      report.repairs.push(`duplicate node id "${old}" renamed to "${id}"`);
    }
    ids.add(id);
    const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    nodes.push({
      ...(n as object),
      id,
      type: n.type,
      typeVersion: Math.max(1, Math.round(num(n.typeVersion, 1))),
      name: typeof n.name === 'string' ? n.name : n.type,
      x: num(n.x, 0),
      y: num(n.y, 0),
      params: isObj(n.params) ? (cleanValue(n.params) as Record<string, never>) : {},
    } as GraphData['nodes'][number]);
  });

  const links: GraphData['links'] = [];
  const linkIds = new Set<string>();
  (Array.isArray(src.links) ? src.links : []).forEach((l, i) => {
    const ok =
      isObj(l) && isObj(l.from) && isObj(l.to) && typeof l.from.node === 'string' && typeof l.from.pin === 'string' && typeof l.to.node === 'string' && typeof l.to.pin === 'string';
    if (!ok || !ids.has((l as { from: { node: string } }).from.node) || !ids.has((l as { to: { node: string } }).to.node)) {
      report.droppedLinks++;
      return;
    }
    const link = l as unknown as GraphData['links'][number];
    let id = typeof link.id === 'string' && link.id ? link.id : `salvaged_link_${i}`;
    if (linkIds.has(id)) id = `${id}_dup${i}`;
    linkIds.add(id);
    links.push({ ...link, id });
  });
  if (report.droppedLinks) report.repairs.push(`${report.droppedLinks} link(s) pointed to missing nodes or were malformed: dropped`);

  const data: GraphData = { settings, nodes, links };
  if (isObj(src.timeline)) data.timeline = src.timeline as unknown as GraphData['timeline'];
  if (isObj(src.annotations)) data.annotations = src.annotations as unknown as GraphData['annotations'];
  return { data, report };
}

/**
 * Best effort for a TRUNCATED JSON text (file cut off while writing): drop the incomplete tail and close the open brackets.
 * Returns null when nothing sensible can be produced. The result must still go through `salvageGraphData`.
 */
export function salvageTruncatedJson(text: string): unknown | null {
  const s = text.trim();
  if (!s.startsWith('{')) return null;
  // Walk once to find the last position where a value/member just ended at a known bracket depth.
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastGood = -1;
  let lastStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      lastGood = i + 1;
      lastStack = [...stack];
    } else if (c === ',') {
      lastGood = i;
      lastStack = [...stack];
    }
  }
  if (lastGood < 0) return null;
  const cut = s.slice(0, lastGood).replace(/,\s*$/, '');
  try {
    return JSON.parse(cut + lastStack.reverse().join(''));
  } catch {
    return null;
  }
}
