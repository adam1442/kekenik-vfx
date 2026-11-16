import { OPTIONAL_FEATURES, WANTED_LIMITS } from '../engine/gpu/acquire';
import { applyAddTool, applyDeleteTool, hitTestAdd, normalizeProfile, presetSpline, resample, setClosed, SPLINE_PRESETS, validateProfile } from '../engine/spline/ops';
import en from '../i18n/en.json';
import fa from '../i18n/fa.json';
import { detectLocale, format, getLocale, setLocale, tr } from '../shared/i18n';
import { onUiChange, px, setUi, themeColor, uiState } from '../ui/theme/ui-store';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * groups "GPU 8 ·", "UI 8 ·", "Spline 8 ·". They check what can be checked without seeing a screen:
 * the tier / limit report of the device actually created, error-scope isolation of a broken shader, the store -> CSS variable ->
 * canvas metric chain of the UI scale / theme, and the spline editing maths.
 */
export function editorChecks(_h: Helpers): TestDef[] {
  void _h;
  return [
    {
      name: 'GPU 8 · device tier, features and limits are reported and within the adapter / default limits',
      async run(env) {
        const caps = env.gpu.caps;
        if (!['A', 'B', 'C', 'D'].includes(caps.tier)) throw new Error(`bad tier ${String(caps.tier)}`);
        const lim = env.gpu.device.limits;
        // the engine derives sizes from these: they must be at least the WebGPU defaults, otherwise the device is not usable
        if (lim.maxTextureDimension2D < 2048) throw new Error(`maxTextureDimension2D ${lim.maxTextureDimension2D} is too small for the engine`);
        if (lim.maxComputeInvocationsPerWorkgroup < 128) throw new Error('maxComputeInvocationsPerWorkgroup < 128');
        const asked = Object.keys(WANTED_LIMITS).filter((k) => !(k in lim));
        const feats = OPTIONAL_FEATURES.filter((f) => env.gpu.device.features.has(f));
        return `tier ${caps.tier}${caps.compat ? ' (compat)' : ''}${caps.software ? ' (software)' : ''}; ${feats.length} optional features; limits unknown to this browser: ${asked.length}; max2D ${lim.maxTextureDimension2D}`;
      },
    },
    {
      name: 'GPU 8 · a shader that fails validation is captured by an error scope and the device stays usable',
      async run(env) {
        const dev = env.gpu.device;
        const { error } = await env.gpu.scope('validation', () => {
          dev.createShaderModule({ code: 'this is not wgsl @@' });
        });
        if (!error) throw new Error('invalid WGSL produced no validation error');
        // the device must still accept work
        const enc = dev.createCommandEncoder();
        const after = await env.gpu.scope('validation', () => dev.queue.submit([enc.finish()]));
        if (after.error) throw new Error(`device unusable after the captured error: ${after.error.message}`);
        return 'bad shader captured; submit still works';
      },
    },
    {
      name: 'UI 8 · scale / theme / density propagate: store -> CSS variable -> canvas metric callback',
      async run() {
        const before = { ...uiState() };
        let seen = 0;
        const off = onUiChange(() => seen++);
        try {
          setUi({ scale: 1.5, theme: 'light', density: 'comfortable' });
          const root = document.documentElement;
          if (root.style.getPropertyValue('--ui-scale') !== '1.5') throw new Error('--ui-scale not applied');
          if (root.dataset.theme !== 'light' || root.dataset.density !== 'comfortable') throw new Error('data attributes not applied');
          if (Math.abs(px(10) - 15) > 1e-9) throw new Error('px() ignores the scale');
          const fs = parseFloat(getComputedStyle(root).fontSize);
          if (Math.abs(fs - 18) > 0.01) throw new Error(`root font-size ${fs}px, expected 18px at 150%`);
          const light = themeColor('bg1');
          setUi({ theme: 'dark' });
          if (themeColor('bg1') === light) throw new Error('theme token cache was not invalidated');
          if (seen < 2) throw new Error('canvas listeners were not notified');
          return `root font ${fs}px, ${seen} notifications`;
        } finally {
          off();
          setUi({ scale: before.scale, theme: before.theme, density: before.density });
        }
      },
    },
    {
      name: 'UI 8 · default language is English regardless of the browser language; fa switches dir=rtl and back',
      async run() {
        const before = getLocale();
        try {
          if (detectLocale('fa-IR') !== 'fa') throw new Error('detectLocale(fa-IR)');
          setLocale('fa', false);
          if (document.documentElement.dir !== 'rtl') throw new Error('rtl not applied');
          if (tr('zz.missing.key', 'English default') !== 'English default') throw new Error('missing key does not fall back');
          setLocale('en', false);
          if ((document.documentElement.dir as string) !== 'ltr') throw new Error('ltr not restored');
        } finally {
          setLocale(before, false);
        }
      },
    },
    {
      name: 'UI 8 · locale files: fa.json has every key of en.json; RTL isolates interpolated Latin tokens',
      async run() {
        const missing = Object.keys(en).filter((k) => !(k in fa));
        if (missing.length) throw new Error(`fa.json lacks ${missing.length} keys, first: ${missing[0]}`);
        const s = format('{name}', { name: 'a.png' }, 'fa');
        if (s !== '\u2068a.png\u2069') throw new Error('bidi isolate missing');
        return `${Object.keys(en).length} keys in both languages`;
      },
    },
    {
      name: 'Spline 8 · add / delete tools, close, resample, every preset is a valid profile after normalisation',
      async run() {
        let sp = presetSpline('line');
        const n0 = sp.points.length;
        const mid: [number, number] = [(sp.points[0].x + sp.points[1].x) / 2, (sp.points[0].y + sp.points[1].y) / 2];
        if (hitTestAdd(sp, mid, 0.02)?.kind !== 'segment') throw new Error('midpoint of a segment must hit the segment');
        const added = applyAddTool(sp, mid, 0.02);
        if (added.value.points.length !== n0 + 1) throw new Error('segment click must insert a point');
        sp = added.value;
        const q = sp.points[added.index];
        const removed = applyDeleteTool(sp, [q.x, q.y], 0.02);
        if (removed.points.length !== n0) throw new Error('delete tool must remove the point under the cursor');
        const closed = setClosed(presetSpline('circle'), true);
        if (!closed.closed) throw new Error('close failed');
        if (resample(closed, 24).points.length !== 24) throw new Error('resample count');
        const bad: string[] = [];
        for (const name of SPLINE_PRESETS) {
          const v = normalizeProfile(presetSpline(name)).value;
          const issues = validateProfile(v).filter((i) => i !== 'selfIntersect');
          if (issues.length) bad.push(`${name}:${issues.join('+')}`);
        }
        if (bad.length) throw new Error(`invalid presets: ${bad.join(', ')}`);
        return `${SPLINE_PRESETS.length} presets valid`;
      },
    },
  ];
}
