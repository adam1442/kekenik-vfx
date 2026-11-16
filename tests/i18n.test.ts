import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN, format, getLocale, isRtl, missingKeys, nodeKeys, setLocale, t, tr, trNodeLabel, trNodeOption, trNodeParam } from '../src/shared/i18n';
import { FA } from '../src/shared/i18n-fa';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe('i18n table', () => {
  it('every key referenced as t(\'...\') in the code exists in English', () => {
    const missing: string[] = [];
    for (const f of walk('src').filter((x) => x.endsWith('.ts') && !x.includes('i18n'))) {
      const txt = readFileSync(f, 'utf8');
      for (const m of txt.matchAll(/\bt\(\s*'([a-z][\w.]+)'/g)) if (!(m[1] in EN)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('every English key has a Persian translation (report missing)', () => {
    expect(missingKeys('fa')).toEqual([]);
    expect(Object.keys(FA).filter((k) => !(k in EN))).toEqual([]);
  });

  it('no empty strings and no key-looking values; placeholders match between en and fa', () => {
    for (const [k, v] of [...Object.entries(EN), ...Object.entries(FA)]) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect(/^[a-z]+(\.[a-zA-Z]+)+$/.test(v), `${k} looks like a key`).toBe(false);
    }
    for (const k of Object.keys(EN) as (keyof typeof EN)[]) {
      const ph = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph(FA[k]), k).toBe(ph(EN[k]));
    }
  });

  it('interpolation and plurals', () => {
    expect(format('{n} fps', { n: 60 })).toBe('60 fps');
    expect(format('{n} {n:file|files}', { n: 1 }, 'en')).toBe('1 file');
    expect(format('{n} {n:file|files}', { n: 3 }, 'en')).toBe('3 files');
    expect(format('{x} stays', {})).toBe('{x} stays');
  });

  it('node-definition keys are derived and fall back to the English default (never a raw key)', () => {
    expect(nodeKeys.label('color.adjust')).toBe('node.color.adjust.label');
    expect(nodeKeys.param('noise', 'scale')).toBe('node.noise.param.scale.label');
    expect(nodeKeys.option('noise', 'type', 'perlin')).toBe('node.noise.param.type.option.perlin');
    setLocale('fa', false);
    expect(trNodeLabel('zz.unlisted', 'Zz Unlisted Node')).toBe('Zz Unlisted Node');
    expect(trNodeParam('x', 'p', 'Zz Param')).toBe('Zz Param');
    expect(trNodeOption('x', 'p', 'v', 'Zz Option')).toBe('Zz Option');
    expect(tr('does.not.exist', 'Default')).toBe('Default');
    setLocale('en', false);
  });

  it('fallback: a missing Persian key shows English, locale switch sets lang / dir and is reversible', () => {
    setLocale('fa', false);
    expect(getLocale()).toBe('fa');
    expect(isRtl()).toBe(true);
    expect(t('settings.title')).toBe(FA['settings.title']);
    expect(t('perf.fps', { n: 30 })).toContain('30');
    setLocale('en', false);
    expect(t('settings.title')).toBe('Settings');
    expect(isRtl()).toBe(false);
    expect(setLocale('xx')).toBe(false);
  });
});

describe('i18n audit script', () => {
  it('passes on the repository (no new hard-coded UI strings beyond the documented baseline)', () => {
    const r = spawnSync(process.execPath, ['tools/i18n-audit.mjs'], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});
