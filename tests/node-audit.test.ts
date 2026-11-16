import { describe, expect, it } from 'vitest';
import { buildNodeReference } from '../src/engine/docs/node-reference';
import { makeRegistry } from './helpers';

/** Every registered node must appear in the generated node reference. */
describe('node reference coverage', () => {
  it('covers every registered node', () => {
    const reg = makeRegistry();
    expect(buildNodeReference(reg).length).toBe(reg.list().length);
  });
});
