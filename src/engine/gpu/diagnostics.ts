import { describeAdapter, describeEnv, readEnv, type GpuAttempt, type GpuEnvInfo, type GpuUnavailableError } from './acquire';
import { MAX_LIMIT_NAMES, type CapabilityReport } from './caps';

/** Plain-text diagnostics the user pastes back to the developer. PURE (unit-tested). */
export function buildDiagnosticsText(opts: { version?: string; message?: string; error?: GpuUnavailableError | Error | null; caps?: CapabilityReport | null; env?: GpuEnvInfo; attempts?: GpuAttempt[] }): string {
  const env = opts.env ?? (opts.error && 'env' in opts.error ? (opts.error as GpuUnavailableError).env : readEnv());
  const attempts = opts.attempts ?? (opts.error && 'attempts' in opts.error ? (opts.error as GpuUnavailableError).attempts : (opts.caps?.attempts ?? []));
  const L: string[] = [];
  L.push(`Kekenik VFX ${opts.version ?? ''}`.trim());
  if (opts.message ?? opts.error?.message) L.push(`Message: ${opts.message ?? opts.error?.message}`);
  L.push('', '== Environment ==', ...describeEnv(env, []));
  L.push('', '== Acquisition attempts ==');
  if (!attempts.length) L.push('(none recorded)');
  for (const a of attempts) L.push(`[tier ${a.tier}] ${a.step}: ${a.ok ? 'ok' : 'FAILED'}${a.message ? ` — ${a.message}` : ''}`);
  const c = opts.caps;
  if (c) {
    L.push('', '== Device ==', `Tier: ${c.tier}${c.compat ? ' (compatibility mode)' : ''}${c.software ? ' (software adapter)' : ''}`, `Device request: ${c.rungLabel || 'n/a'}`);
    L.push(`Adapter: ${describeAdapter(c.adapter)}${c.adapter.isFallback ? ' [fallback]' : ''}`);
    L.push(`Features: ${c.features.join(', ') || 'none'}`);
    L.push('Limits:', ...[...MAX_LIMIT_NAMES, 'maxStorageBuffersInVertexStage'].filter((n) => c.limits[n] !== undefined).map((n) => `  ${n} = ${c.limits[n]}`));
    for (const d of c.diagnostics) L.push(`Note: ${d}`);
  }
  return L.join('\n');
}

export type BrowserKind = 'chromium' | 'firefox' | 'safari' | 'other';
export type OsKind = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'other';

export function detectBrowser(ua: string): { browser: BrowserKind; os: OsKind } {
  const browser: BrowserKind = /firefox\//i.test(ua) ? 'firefox' : /chrome\/|chromium\/|edg\/|opr\//i.test(ua) ? 'chromium' : /safari\//i.test(ua) ? 'safari' : 'other';
  const os: OsKind = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : /windows/i.test(ua) ? 'windows' : /mac os x|macintosh/i.test(ua) ? 'mac' : /linux|x11/i.test(ua) ? 'linux' : 'other';
  return { browser, os };
}

/** i18n keys of the instructions that apply to this browser / OS (always starts with the generic hardware hint). */
export function hintKeys(ua: string): Array<'diag.hint.hw' | 'diag.hint.chromeGpu' | 'diag.hint.flags' | 'diag.hint.vulkan' | 'diag.hint.firefox' | 'diag.hint.safari' | 'diag.hint.driver'> {
  const { browser, os } = detectBrowser(ua);
  const out: ReturnType<typeof hintKeys> = ['diag.hint.hw'];
  if (browser === 'chromium') out.push('diag.hint.chromeGpu', 'diag.hint.flags');
  if (browser === 'chromium' && os === 'linux') out.push('diag.hint.vulkan');
  if (browser === 'firefox') out.push('diag.hint.firefox');
  if (browser === 'safari') out.push('diag.hint.safari');
  if (browser === 'other') out.push('diag.hint.flags', 'diag.hint.firefox', 'diag.hint.safari');
  out.push('diag.hint.driver');
  return out;
}
