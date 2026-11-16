import en from '../i18n/en.json';
import { FA } from './i18n-fa';
import { FA_NODE_DESC } from './i18n-fa-9b';
import { FA_TERMS, FA_TITLE_SUFFIX } from './i18n-fa-terms';

/**
 * Localization-ready string table (English first).
 *
 * Usage: `t('settings.title')`, `t('perf.fps', { n: 60 })` ("{n}" placeholders). New UI code MUST use keys from this table;
 * legacy panels still contain literal English strings.
 * To add a language: `registerLocale('fa', { 'settings.title': '...' })` then `setLocale('fa')`. Missing keys fall back to English,
 * unknown keys return the key itself (visible in the UI = easy to spot).
 */
export const EN: typeof en = en;

export type StringKey = keyof typeof EN;

type Table = Partial<Record<string, string>>;

const locales = new Map<string, Table>([['en', EN]]);
let current = 'en';
/** Display names of the locales (each in its own language). */
export const LANG_NAMES: Record<string, string> = { en: 'English', fa: 'فارسی', pseudo: 'Pseudo (long)' };

/** Digits setting: 'latin' (default) or 'fa' (Persian ۰–۹). Applies to DISPLAYED numbers (labels), never to stored values. */
let digitsMode: 'latin' | 'fa' = 'latin';
export const setDigitsMode = (m: 'latin' | 'fa'): void => {
  digitsMode = m;
  for (const fn of listeners) fn(current);
};
export const getDigitsMode = (): 'latin' | 'fa' => digitsMode;
export const toPersianDigits = (s: string): string => s.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
/** Format a number for display (labels / read-only values) honouring the digits setting. */
export const displayNumber = (v: number | string): string => (digitsMode === 'fa' ? toPersianDigits(String(v)) : String(v));

/** Pseudo-locale for layout testing: accented letters, ~40% longer, bracketed so untranslated text stands out. */
export function pseudoize(s: string): string {
  const map: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', A: 'Å', E: 'É', I: 'Î', O: 'Ö', U: 'Ü', c: 'ç', n: 'ñ', s: 'š', y: 'ý' };
  let inBrace = false;
  let out = '';
  for (const ch of s) {
    if (ch === '{') inBrace = true;
    out += inBrace ? ch : (map[ch] ?? ch);
    if (ch === '}') inBrace = false;
  }
  return `⟦${out}${'·'.repeat(Math.ceil(s.length * 0.4))}⟧`;
}

const RTL = new Set(['fa', 'ar', 'he', 'ur']);
const LS_KEY = 'kk.locale';
const listeners = new Set<(id: string) => void>();

export function registerLocale(id: string, table: Table): void {
  locales.set(id, table);
}
export const availableLocales = (): string[] => [...locales.keys()];
export const getLocale = (): string => current;
export const isRtl = (id = current): boolean => RTL.has(id);
export const onLocaleChange = (fn: (id: string) => void): (() => void) => (listeners.add(fn), () => listeners.delete(fn));

/** Apply `lang` / `dir` to the document root (RTL for Persian). Canvases, the graph, the timeline, curve editors and numeric fields stay LTR through CSS (ui/theme/perf.css). */
function applyDocument(id: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = id;
  document.documentElement.dir = isRtl(id) ? 'rtl' : 'ltr';
}

/** Switch language live (no reload; panels that rebuild pick it up). Persists the choice. NOT part of the undo stack. */
export function setLocale(id: string, persist = true): boolean {
  if (!locales.has(id)) return false;
  current = id;
  applyDocument(id);
  if (persist) {
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* private mode */
    }
  }
  for (const fn of listeners) fn(id);
  return true;
}

/** `{n}` interpolation and plurals: `{n:file|files}` picks the first form for Intl plural category "one", the second otherwise. */
export function format(s: string, vars?: Record<string, string | number>, locale = current): string {
  if (!vars) return s;
  if (digitsMode === 'fa') vars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'number' ? toPersianDigits(String(v)) : v]));
  // Bidi: Latin tokens (file names, node ids, units) interpolated into RTL text are wrapped in Unicode isolates (FSI ... PDI)
  // so they never reorder the surrounding sentence; this is the plain-text equivalent of <bdi>.
  if (isRtl(locale)) vars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' && /[A-Za-z]/.test(v) && !/[\u2066-\u2069]/.test(v) ? `\u2068${v}\u2069` : v]));
  const pr = new Intl.PluralRules(locale);
  return s
    .replace(/\{(\w+):([^}|]*)\|([^}]*)\}/g, (m, k: string, one: string, other: string) => (k in vars ? (pr.select(Number(vars[k])) === 'one' ? one : other) : m))
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Typed lookup of a table key; missing keys fall back to English, never to the raw key of a known string. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  return format(locales.get(current)?.[key] ?? EN[key] ?? key, vars);
}

/** Dynamic lookup with an English default (node definitions, generated labels): table value -> English table -> `fallback` (never the raw key). */
export function tr(key: string, fallback: string, vars?: Record<string, string | number>): string {
  return format(locales.get(current)?.[key] ?? (EN as Table)[key] ?? fallback, vars);
}

/** Stable, derived keys of node definitions: a node author only writes English defaults; translators add keys. */
export const nodeKeys = {
  label: (id: string): string => `node.${id}.label`,
  description: (id: string): string => `node.${id}.description`,
  param: (id: string, param: string): string => `node.${id}.param.${param}.label`,
  group: (id: string, group: string): string => `node.${id}.group.${group}`,
  option: (id: string, param: string, value: string): string => `node.${id}.param.${param}.option.${value}`,
  pin: (id: string, pin: string): string => `node.${id}.pin.${pin}.name`,
  tooltip: (id: string, param: string): string => `node.${id}.param.${param}.tooltip`,
};
/* ---- node UI text: English term -> translation (one entry per distinct phrase, see i18n-fa-terms.ts) */
const termTables = new Map<string, Record<string, string>>([['fa', FA_TERMS]]);
export const registerTerms = (id: string, table: Record<string, string>): void => void termTables.set(id, table);
/** Translates a node-definition phrase (title, pin, label, tab, group, option). Handles the "(Color)" / "(Points)" ... variants. English when unknown. */
export function trTerm(en: string): string {
  const tbl = termTables.get(current);
  if (!tbl || !en) return en;
  const hit = tbl[en];
  if (hit) return hit;
  const m = /^(.*) \((Color|Points|Gray|Mesh|Normal|UV|Import)\)$/.exec(en);
  if (m && tbl[m[1]] && current === 'fa') return `${tbl[m[1]]} (${FA_TITLE_SUFFIX[m[2]] ?? m[2]})`;
  return en;
}
/** Node description: specific key -> Persian table -> English. */
export const trNodeDesc = (id: string, en: string): string => tr(nodeKeys.description(id), current === 'fa' ? (FA_NODE_DESC[id] ?? en) : en);
export const trNodeLabel = (id: string, en: string): string => tr(nodeKeys.label(id), trTerm(en));
export const trNodeParam = (id: string, param: string, en: string): string => tr(nodeKeys.param(id, param), trTerm(en));
export const trNodeOption = (id: string, param: string, value: string, en: string): string => tr(nodeKeys.option(id, param, value), trTerm(en));
export const trNodePin = (id: string, pin: string, en: string): string => tr(nodeKeys.pin(id, pin), trTerm(en));
export const trNodeGroup = (id: string, group: string): string => tr(nodeKeys.group(id, group), trTerm(group));
/** Parameter / pin tooltip: specific key -> shared term table (tooltips used by several nodes) -> English. */
export const trNodeTip = (id: string, param: string, en: string): string => tr(nodeKeys.tooltip(id, param), trTerm(en));
export const trNodeTab = (tab: string): string => trTerm(tab);

/** Keys of `EN` that `locale` does not translate (reported by tests/i18n.test.ts). */
export const missingKeys = (locale: string): string[] => Object.keys(EN).filter((k) => !locales.get(locale)?.[k]);

registerLocale('fa', FA);
registerLocale('pseudo', Object.fromEntries(Object.entries(EN).map(([k, v]) => [k, pseudoize(v)])));

/**
 * The DEFAULT language is always English (product decision): the browser language is NEVER applied automatically.
 * `detectLocale()` only reports which supported language the browser prefers (used for an optional "Switch to ...?" suggestion).
 */
export function detectLocale(lang: string | undefined = typeof navigator !== 'undefined' ? navigator.language : undefined): string {
  const base = (lang ?? 'en').toLowerCase().split('-')[0];
  return locales.has(base) && base !== 'pseudo' ? base : 'en';
}
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  setLocale(saved && locales.has(saved) ? saved : 'en', false);
} catch {
  /* ignore */
}
