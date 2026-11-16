import { describe, it } from 'vitest';
import { uiLogicChecks } from '../src/selftest/ui-logic';

// The same checks run inside the browser self-test page (src/selftest/tests.ts).
describe('UI logic (docking layout, keymap)', () => {
  for (const c of uiLogicChecks) it(c.name, () => void c.run());
});
