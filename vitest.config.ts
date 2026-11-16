import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Tests are pure logic: no GPU, node environment.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(dir, 'src') } },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // DOM smoke test needs jsdom (not a project dependency): `npm i --no-save jsdom && KK_JSDOM=1 npx vitest run`
    exclude: process.env.KK_JSDOM ? ['node_modules/**'] : ['node_modules/**', 'tests/**/*.jsdom.test.ts'],
  },
});
