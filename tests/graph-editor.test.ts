import { describe, it } from 'vitest';
import { graphEditorChecks } from '../src/panels/graph-editor/selftest-checks';
import { makeRegistry } from './helpers';

// The same checks run inside the browser self-test page (src/selftest/tests.ts).
const reg = makeRegistry();
describe('Graph editor (pure logic: layout, culling, hit-testing, validity, annotations, clipboard)', () => {
  for (const c of graphEditorChecks(() => reg)) it(c.name, () => void c.run());
});
