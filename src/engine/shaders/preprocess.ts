/**
 * WGSL preprocessor: #include / #define / #undef / #ifdef / #ifndef / #if / #elif / #else / #endif.
 *
 *  - `#include "name"` pulls a file from the `files` map (first inclusion wins, later ones are skipped: implicit
 *    include guard). The `.wgsl` extension is optional.
 *  - `#define NAME value` creates an object-like macro; occurrences of NAME as a whole word are replaced in
 *    emitted lines (macros are NOT expanded recursively). `#define NAME` alone means value 1.
 *  - `#if` supports: numbers, identifiers (macro value, undefined = 0), defined(X), ! && || == != < > <= >= ( ).
 *  - Directive lines produce no output; the returned `map` maps every OUTPUT line back to (file, line) so
 *    compiler messages can be reported against original sources.
 */
export type DefineValue = string | number | boolean;
export type Defines = Record<string, DefineValue | undefined>;

export interface SourceLoc {
  file: string;
  line: number;
}
export interface PreprocessResult {
  code: string;
  /** map[i] = origin of output line i+1. */
  map: SourceLoc[];
  includes: string[];
}

export class PreprocessError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line: number,
  ) {
    super(`${file}:${line}: ${message}`);
    this.name = 'PreprocessError';
  }
}

interface Cond {
  parentActive: boolean;
  active: boolean;
  taken: boolean;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function preprocess(root: string, files: Record<string, string>, defines: Defines = {}): PreprocessResult {
  const macros = new Map<string, string>();
  for (const [k, v] of Object.entries(defines)) {
    if (v === undefined || v === false) continue;
    macros.set(k, v === true ? '1' : String(v));
  }
  const out: string[] = [];
  const map: SourceLoc[] = [];
  const included = new Set<string>();
  let macroRe: RegExp | null = null;
  let macroReDirty = true;

  const subst = (line: string): string => {
    if (macros.size === 0) return line;
    if (macroReDirty) {
      const names = [...macros.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
      macroRe = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
      macroReDirty = false;
    }
    return line.replace(macroRe!, (m) => macros.get(m) ?? m);
  };

  const evalExpr = (expr: string, file: string, line: number): boolean => {
    const re = /\s*(&&|\|\||==|!=|<=|>=|<|>|!|\(|\)|[A-Za-z_]\w*|-?\d+(?:\.\d+)?)/y;
    const toks: string[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while (re.lastIndex < expr.length && (m = re.exec(expr))) toks.push(m[1]);
    if (re.lastIndex < expr.trimEnd().length) throw new PreprocessError(`bad #if expression "${expr}"`, file, line);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const primary = (): number => {
      const t = next();
      if (t === undefined) throw new PreprocessError(`unexpected end of #if expression "${expr}"`, file, line);
      if (t === '(') {
        const v = or();
        if (next() !== ')') throw new PreprocessError(`missing ) in "${expr}"`, file, line);
        return v;
      }
      if (t === '!') return primary() ? 0 : 1;
      if (/^-?\d/.test(t)) return Number(t);
      if (t === 'defined') {
        const paren = peek() === '(';
        if (paren) next();
        const name = next();
        if (paren) next();
        return macros.has(name) ? 1 : 0;
      }
      const val = macros.get(t);
      if (val === undefined) return 0;
      const n = Number(val);
      return Number.isNaN(n) ? 1 : n;
    };
    const rel = (): number => {
      let a = primary();
      while (['<', '>', '<=', '>='].includes(peek())) {
        const op = next();
        const b = primary();
        a = (op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b) ? 1 : 0;
      }
      return a;
    };
    const eq = (): number => {
      let a = rel();
      while (peek() === '==' || peek() === '!=') {
        const op = next();
        const b = rel();
        a = (op === '==' ? a === b : a !== b) ? 1 : 0;
      }
      return a;
    };
    const and = (): number => {
      let a = eq();
      while (peek() === '&&') {
        next();
        const b = eq();
        a = a && b ? 1 : 0;
      }
      return a;
    };
    const or = (): number => {
      let a = and();
      while (peek() === '||') {
        next();
        const b = and();
        a = a || b ? 1 : 0;
      }
      return a;
    };
    const v = or();
    if (p < toks.length) throw new PreprocessError(`trailing tokens in #if "${expr}"`, file, line);
    return v !== 0;
  };

  const processFile = (name: string, from: { file: string; line: number }): void => {
    const key = name in files ? name : name.replace(/\.wgsl$/, '') in files ? name.replace(/\.wgsl$/, '') : name;
    if (included.has(key)) return;
    const src = files[key];
    if (src === undefined) throw new PreprocessError(`#include "${name}" not found`, from.file, from.line);
    included.add(key);
    const stack: Cond[] = [];
    const isActive = () => (stack.length === 0 ? true : stack[stack.length - 1].active);
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const t = raw.trim();
      const lineNo = i + 1;
      if (t.startsWith('#')) {
        const m = /^#\s*(\w+)\s*(.*)$/.exec(t);
        if (!m) throw new PreprocessError(`malformed directive "${t}"`, key, lineNo);
        const [, dir, rest] = m;
        switch (dir) {
          case 'include': {
            if (!isActive()) break;
            const im = /^["<]([^">]+)[">]/.exec(rest);
            if (!im) throw new PreprocessError('#include needs "name"', key, lineNo);
            processFile(im[1], { file: key, line: lineNo });
            break;
          }
          case 'define': {
            if (!isActive()) break;
            const dm = /^(\w+)\s*(.*)$/.exec(rest);
            if (!dm) throw new PreprocessError('#define needs a name', key, lineNo);
            macros.set(dm[1], dm[2].trim() || '1');
            macroReDirty = true;
            break;
          }
          case 'undef':
            if (isActive()) {
              macros.delete(rest.trim());
              macroReDirty = true;
            }
            break;
          case 'ifdef':
          case 'ifndef': {
            const pa = isActive();
            const d = macros.has(rest.trim());
            const v = pa && (dir === 'ifdef' ? d : !d);
            stack.push({ parentActive: pa, active: v, taken: v });
            break;
          }
          case 'if': {
            const pa = isActive();
            const v = pa && evalExpr(rest, key, lineNo);
            stack.push({ parentActive: pa, active: v, taken: v });
            break;
          }
          case 'elif': {
            const c = stack[stack.length - 1];
            if (!c) throw new PreprocessError('#elif without #if', key, lineNo);
            if (c.taken || !c.parentActive) c.active = false;
            else {
              c.active = evalExpr(rest, key, lineNo);
              c.taken = c.active;
            }
            break;
          }
          case 'else': {
            const c = stack[stack.length - 1];
            if (!c) throw new PreprocessError('#else without #if', key, lineNo);
            c.active = c.parentActive && !c.taken;
            c.taken = true;
            break;
          }
          case 'endif':
            if (!stack.pop()) throw new PreprocessError('#endif without #if', key, lineNo);
            break;
          default:
            throw new PreprocessError(`unknown directive #${dir}`, key, lineNo);
        }
        continue;
      }
      if (isActive()) {
        out.push(subst(raw));
        map.push({ file: key, line: lineNo });
      }
    }
    if (stack.length) throw new PreprocessError('unterminated #if', key, lines.length);
  };

  processFile(root, { file: '<root>', line: 0 });
  return { code: out.join('\n'), map, includes: [...included] };
}
