import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Application config (`npm run dev | build | preview`).
 *
 * - `base` comes from the `KEKENIK_BASE` environment variable (default `./`, i.e. relative URLs, so the build runs from any
 *   folder or sub-path). The GitHub Pages workflow sets `KEKENIK_BASE=/kekenik-vfx/`.
 * - Output is a normal multi-file, code-split, hashed build in `dist/` (no source maps).
 * - Development-only pages (GPU test harness, gizmo test, graph stress test) are behind `import.meta.env.DEV` and are not emitted.
 * - A small plugin writes `precache.json` and stamps the service worker with a per-build id, so every deployment installs a
 *   fresh cache and removes the old one.
 */
const base = process.env.KEKENIK_BASE || './';

function gitCommit(): string {
  const fromEnv = process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const built = new Date().toISOString();
const buildId = built.replace(/\D/g, '').slice(0, 14);

function pwaAssets(outDir: string): Plugin {
  return {
    name: 'kekenik-pwa-assets',
    apply: 'build',
    generateBundle(_o, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files.map((f) => `./${f}`)) });
    },
    closeBundle() {
      const sw = path.resolve(dir, outDir, 'sw.js');
      try {
        writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD_ID__', buildId));
      } catch {
        /* no service worker in the output */
      }
    },
  };
}

export default defineConfig({
  base,
  resolve: { alias: { '@': path.resolve(dir, 'src') } },
  define: { __KK_BUILD__: JSON.stringify({ built, commit: gitCommit() }) },
  esbuild: { pure: ['console.log', 'console.debug', 'console.info'], drop: ['debugger'] },
  plugins: [pwaAssets('dist')],
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/fflate')) return 'fflate';
          return undefined;
        },
      },
    },
  },
});
