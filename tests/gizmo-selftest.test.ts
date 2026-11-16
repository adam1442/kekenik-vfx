import { describe, it } from 'vitest';
import { gizmoChecks } from '../src/gizmos/selftest-checks';
import { makeRegistry } from './helpers';

// the same checks run in the in-browser self-test page (src/selftest/tests.ts)
const reg = makeRegistry();
describe('gizmo self-test checks (shared with the development GPU harness)', () => {
  for (const c of gizmoChecks(() => reg)) it(c.name, () => void c.run());
});
