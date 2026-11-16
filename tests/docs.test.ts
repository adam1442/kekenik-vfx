import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildNodeReference, nodeToMarkdown, referenceToMarkdown, type RefNode } from '../src/engine/docs/node-reference';
import type { NodeRegistry } from '../src/engine/graph/registry';
import { makeRegistry } from './helpers';

/**
 * Node reference generator test. `GEN_DOCS=1 npx vitest run tests/docs.test.ts` (npm run docs:nodes) rewrites docs/NODE_REFERENCE.md.
 * Without the variable the same data is only validated, so a node without a description fails CI.
 */
let reg: NodeRegistry;
let nodes: RefNode[];
beforeAll(() => {
  reg = makeRegistry();
  nodes = buildNodeReference(reg);
});

describe('node reference', () => {
  it('documents every registered node with a description, unique id and at least one pin', () => {
    expect(nodes.length).toBe(reg.list().length);
    expect(nodes.length).toBeGreaterThan(150);
    const ids = new Set<string>();
    for (const n of nodes) {
      expect(ids.has(n.id), `duplicate ${n.id}`).toBe(false);
      ids.add(n.id);
      expect(n.title.length, n.id).toBeGreaterThan(1);
      expect(n.description.length, `${n.id} needs a description`).toBeGreaterThan(10);
      expect(n.inputs.length + n.outputs.length, `${n.id} has no pins`).toBeGreaterThan(0);
    }
  });
  it('renders markdown tables', () => {
    const md = nodeToMarkdown(nodes[0]);
    expect(md).toContain('| Direction | Pin | Type | Notes |');
    expect(referenceToMarkdown(nodes)).toContain('# Kekenik VFX — Node Reference');
  });
  it('generated params expose the automatic Texture / Blending tabs and modulation pins', () => {
    const blur = nodes.find((n) => n.id === 'utils.blur')!;
    expect(blur.params.some((p) => p.tab === 'Texture')).toBe(true);
    expect(blur.inputs.some((p) => p.role === 'modulation')).toBe(true);
  });
  it('identity hooks are exact for defaults and off for real work', () => {
    const blur = reg.get('utils.blur')!;
    expect(blur.identity?.({ radius: 0, stretch: [1, 1] })).toBe(true);
    expect(blur.identity?.({ radius: 0.02, stretch: [1, 1] })).toBe(false);
    expect(blur.identity?.({ radius: 0.02, stretch: [0, 0] })).toBe(true);
    const tr = reg.get('utils.transform')!;
    expect(tr.identity?.({ translate: [0, 0], rotation: 0, scale: [1, 1], skew: [0, 0] })).toBe(true);
    expect(tr.identity?.({ translate: [0.1, 0], rotation: 0, scale: [1, 1], skew: [0, 0] })).toBe(false);
    expect(reg.get('grayscale.curve')!.identity?.({ amount: 0 })).toBe(true);
    expect(reg.get('grayscale.curve')!.identity?.({ amount: 1 })).toBe(false);
  });
  it('regenerates docs/NODE_REFERENCE.md when GEN_DOCS=1', () => {
    const md = referenceToMarkdown(nodes);
    expect(md.length).toBeGreaterThan(1000);
    if (process.env.GEN_DOCS) writeFileSync(new URL('../docs/NODE_REFERENCE.md', import.meta.url), md);
  });
});

import { tipOf } from '../src/ui/widgets/param-tip';
describe('generated tooltips', () => {
  it('every parameter of every node gets a non-empty tooltip', () => {
    const r = makeRegistry();
    let n = 0;
    for (const def of r.list()) for (const p of r.expanded(def.id)!.params) (expect(tipOf(p).length, `${def.id}.${p.id}`).toBeGreaterThan(2), n++);
    expect(n).toBeGreaterThan(2000);
    expect(tipOf({ id: 'a', label: 'Radius', type: 'float', default: 0.5, min: 0, max: 1, display: 'percent', animatable: true } as never)).toBe('Radius — range 0% … 100%, default 50%, animatable');
    expect(tipOf({ id: 'a', label: 'X', type: 'bool', default: true, tooltip: 'Own' } as never)).toBe('Own');
  });
});
