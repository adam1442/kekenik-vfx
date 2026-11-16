/**
 * File name templates. Tokens: {graph} {node} {frame} {frame:4} (zero padded) {index} {w} {h} {date} {time}
 * {engine} {format} {channel}. Unknown tokens are reported (and kept verbatim, sanitised). Output is always a safe relative
 * path: no `..`, no drive letters, no reserved characters, no Windows reserved device names, bounded length.
 */
export interface NameContext {
  graph: string;
  node: string;
  frame?: number;
  index?: number;
  w?: number;
  h?: number;
  engine?: string;
  format?: string;
  channel?: string;
  now?: Date;
}

export const KNOWN_TOKENS = ['graph', 'node', 'frame', 'index', 'w', 'h', 'date', 'time', 'engine', 'format', 'channel'] as const;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeSegment(s: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what we strip from file names
  let t = s.replace(/[\u0000-\u001f<>:"|?*\\]/g, '_').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!t) t = '_';
  if (RESERVED.test(t.split('.')[0])) t = `_${t}`;
  return t.length > 120 ? t.slice(0, 120) : t;
}

const pad = (n: number, w: number): string => String(Math.trunc(n)).padStart(w, '0');

export interface ExpandResult {
  /** Relative path WITHOUT extension. */
  path: string;
  unknown: string[];
  /** True when the template uses {frame}. */
  usesFrame: boolean;
}

export function expandTemplate(template: string, ctx: NameContext): ExpandResult {
  const now = ctx.now ?? new Date();
  const unknown: string[] = [];
  let usesFrame = false;
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
  const time = `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
  const raw = template.replace(/\{([a-zA-Z]+)(?::(\d{1,2}))?\}/g, (m, name: string, width?: string) => {
    const w = width ? Math.min(12, parseInt(width, 10)) : 0;
    switch (name) {
      case 'graph': return ctx.graph;
      case 'node': return ctx.node;
      case 'frame': usesFrame = true; return pad(ctx.frame ?? 0, w || 4);
      case 'index': return pad(ctx.index ?? 0, w || 1);
      case 'w': return String(ctx.w ?? 0);
      case 'h': return String(ctx.h ?? 0);
      case 'date': return date;
      case 'time': return time;
      case 'engine': return ctx.engine ?? '';
      case 'format': return ctx.format ?? '';
      case 'channel': return ctx.channel ?? '';
      default:
        unknown.push(name);
        return m;
    }
  });
  const segs = raw.split('/').map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').map(sanitizeSegment);
  return { path: segs.length ? segs.join('/') : '_', unknown, usesFrame };
}

/** Make a list of relative paths unique by appending _2, _3 ... before the extension (case-insensitive: Windows / macOS). */
export function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.map((p) => {
    const dot = p.lastIndexOf('.');
    const slash = p.lastIndexOf('/');
    const hasExt = dot > slash + 1;
    const stem = hasExt ? p.slice(0, dot) : p;
    const ext = hasExt ? p.slice(dot) : '';
    let cand = p;
    let n = 2;
    while (seen.has(cand.toLowerCase())) cand = `${stem}_${n++}${ext}`;
    seen.add(cand.toLowerCase());
    return cand;
  });
}

/** Default templates. */
export const DEFAULT_TEMPLATE = '{graph}_{node}';
export const DEFAULT_SEQUENCE_TEMPLATE = '{graph}_{node}_{frame:4}';
