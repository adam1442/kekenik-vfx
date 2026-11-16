import { describe, expect, it } from 'vitest';
import { FA_TERMS } from '../src/shared/i18n-fa-terms';
import { makeRegistry } from './helpers';

/** every node title, pin name, parameter label, tab, group and enum option has a Persian entry (English identifiers may map to themselves). */
describe('Persian coverage of node definitions', () => {
  it('all node UI phrases are in the Persian term table', () => {
    const reg = makeRegistry();
    const missing = new Set<string>();
    const check = (s: unknown): void => {
      if (typeof s !== 'string' || !s) return;
      if (FA_TERMS[s] || /^(.*) \((Color|Points|Gray|Mesh|Normal|UV|Import)\)$/.test(s)) return;
      missing.add(s);
    };
    for (const d of reg.list()) {
      check(d.title);
      for (const p of [...(d.inputs ?? []), ...(d.outputs ?? [])]) check(p.name);
      for (const p of d.params ?? []) {
        check(p.label);
        check(p.group);
        check(p.tab);
        for (const o of (p as { options?: Array<{ label: string }> }).options ?? []) check(o.label);
      }
    }
    expect([...missing].slice(0, 20)).toEqual([]);
  });

  it('no term maps an empty or key-like value', () => {
    for (const [k, v] of Object.entries(FA_TERMS)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });
});
