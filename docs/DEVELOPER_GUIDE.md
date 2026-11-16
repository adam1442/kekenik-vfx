# Developer guide

Practical recipes for working on Kekenik VFX. Start with [ARCHITECTURE.md](ARCHITECTURE.md) for the big picture and
[CONTRACTS.md](CONTRACTS.md) for data formats and conventions.

## 1. Daily commands

| Command | What it does |
|---|---|
| `npm ci` | Install the exact dependency versions from the lockfile |
| `npm run dev` | Development server (also enables the dev-only pages, see §8) |
| `npm run build` | Production build into `dist/` (`KEKENIK_BASE` sets the base path, default `./`) |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (pure logic, CPU references, mocked device; no GPU needed) |
| `npm run check` | typecheck + lint + i18n audit + tests |
| `npm run format` / `format:check` | Prettier |
| `npm run docs:nodes` | Regenerate `docs/NODE_REFERENCE.md` from the node definitions |
| `npm run notices` | Regenerate `THIRD_PARTY_NOTICES.md` |
| `npm run size` | Bundle size report for `dist/` |
| `npm run samples:gen` / `samples:index` / `samples:validate` | Rebuild, re-index or validate the sample projects |

Requirements: Node.js 20.19 or newer (see `.nvmrc`) and a WebGPU-capable browser for manual testing.

## 2. Source map

See the layout in [ARCHITECTURE.md §2](ARCHITECTURE.md#2-repository-layout).

## 3. Adding a node

There is no scaffolding command. Copy a small existing node of the same kind (for example `src/nodes/utils/levels` for a
per-pixel filter, `src/nodes/grayscale/gradient` for a generator) to `src/nodes/<category>/<name>/` and edit it.
Files: `definition.ts`, `shader.wgsl`, optional `gizmo.ts`, and a `<name>.test.ts`.

Nodes are **auto-discovered** (`import.meta.glob`); never register them in a shared file. Rules:

1. `id` is `"<category>.<name>"` and stable. **Parameter ids are stored in project files**: never rename them; bump `version` and
   write `migrateParams` instead.
2. Describe everything in your own words: `description`, `keywords` and parameter `tooltip`s feed the node library, the help panel
   and the generated reference. `tests/docs.test.ts` fails when a node has no description.
3. Write `shade(uv)` in WGSL; the pass helper generates the bindings `F`, `P`, `t0..`, `s0..` and the entry points. Do not use
   reserved WGSL words as identifiers (`filter`, `mod`, `target`, `smooth`, `type`, `set`, `use`, `pass`, `ref`, ...) and never
   redeclare `F`, `P`, `t0..tN`, `s0..sN`, `Frame`, `Params`, `VsOut`, `shade`, `fs_main`, `vs_main`.
4. **Tiling**: respect `F.tile` (wrap-aware sampling from `sampling.wgsl`, periodic hashes and lattices from `hash.wgsl` and
   `noise.wgsl`) and `F.filter_mode`. Generators with an animated axis need a periodic Z so loops are seamless.
5. **Declare cost**: `cost: { gpu, tiling: 'pixel' | 'halo' | 'global', halo?, temporaries? }`. Tiled rendering and memory
   estimates depend on it.
6. **Identity**: if some parameter values make the node a no-op, add `identity(params)`; the evaluator then skips the pass.
7. **Gizmos**: nodes with spatial parameters declare gizmos (see §4).
8. Allocate only through `ctx.tex(...)`; never keep GPU resources outside the pools. Throwing inside `evaluate` gives the node an
   error badge and never breaks the graph. Heavy CPU work (more than about 10 ms) belongs in a worker.
9. Gray + Color variants: `variants((kind) => defineNode({...}))` from `nodes/_shared/variants.ts`.
10. Tests: pure logic and CPU references in Vitest (`tests/wgsl-dawn.test.ts` picks up every declared shader automatically), and
    optionally a GPU known-answer test in the dev harness (§8).
11. Add UI strings for Persian (see [I18N_GUIDE.md](I18N_GUIDE.md)) and run `npm run docs:nodes`.

## 4. Adding a gizmo

A gizmo is **declared** in the node definition and bound to parameters; the node never draws or touches undo.

```ts
gizmos: [
  { id: 'center', label: 'Center', type: 'point', viewport: '2d', space: 'uv', param: 'center' },
  { id: 'radius', label: 'Radius', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: { param: 'radius', map: { scale: 0.5 } } },
],
```

- 2D types: `point, line, circle, rect, angle, transform, path, range, brush, grid, falloff` (`engine/graph/gizmo-decl.ts`).
  3D types: `point3d, radius3d, axis3d, transform3d, box3d, spline3d, falloff3d`.
- `ParamMap` converts stored parameter units to gizmo units (`scale / offset / reciprocal / round` or `to / from`).
- New gizmo *kinds* go to `src/gizmos/models-*.ts` (a `GizmoModel`: shapes, handles, drag sessions) and are registered in
  `gizmos/registry.ts`. Test them in `tests/gizmos.test.ts`. Writes always go through `ParamGesture` (one undo step per drag).

## 5. Adding a panel

```ts
// src/panels/my-panel/panel.ts  (auto-discovered, one folder per panel)
import { registerPanel } from '../../ui/dock/panel-registry';
registerPanel({
  id: 'my-panel', title: 'My Panel', icon: 'info',
  multiple: false,                                  // true for viewports
  defaultDock: { zone: 'right', size: 0.25 },
  create(host, ctx) {
    const off = ctx.visible.subscribe((v) => ctx.scheduler.setTargets(ctx.instanceId, v ? targets : null)); // release when hidden
    return { dispose() { off(); }, resize(w, h) {}, serialize: () => ({}) };
  },
});
```

- The host element is **moved, never recreated**, when docking or floating. Use `observeSize(el, (w, h, dpr) => ...)` for canvases.
- Mutate the graph only through `ctx.editor` (undo and coalescing).
- Panel errors are caught by `ui/dock/panel-guard.ts`. Heavy or GPU-bound panels should be listed in `app/safe-mode.ts`
  (`HEAVY_PANELS`) so `?safe` can block them.
- Strings: add keys to `src/i18n/en.json` and `fa.json`, use `t('key')`. `npm run i18n:audit` flags new hard-coded UI text.

## 6. Adding an exporter

- *Image format*: implement `ImageFormat` (`src/export/encoders/types.ts`; a streaming `RowEncoder` that receives float rows and
  writes to a `ByteSink`), add it to `IMAGE_FORMATS` in `encoders/index.ts` and to the option lists in
  `nodes/_shared/exportparams.ts`, and add a round-trip test in `tests/export.test.ts`.
- *Mesh format*: add a builder in `export/mesh/formats.ts` and an entry of `mesh_format` in `nodes/export/mesh/definition.ts`.
- *Engine preset*: `export/engines.ts` and the recipes in `export/presets.ts`.
- *Export node*: jobs are dispatched in `export/queue.ts`. Never buffer a whole large image; stream strips (`export/image-job.ts`).

## 7. Performance and memory rules

- No GPU allocation outside `MemoryManager`. No `await` of a read-back in the render path (export, histogram and inspector only,
  via `mapAsync`).
- Per-pixel work is a fragment pass; use storage-texture compute only where it helps, after checking the format feature.
- Keep work cache friendly: derive everything from parameters and input versions, and use wall-clock time only in nodes marked
  `timeDependent`.
- Add statistics only through `PerfStats` (`engine/perf/stats.ts`); it costs nothing when no viewer is open.
- See [PERFORMANCE.md](PERFORMANCE.md) for targets and tuning knobs.

## 8. Development-only tools

These are compiled only by the development server (`import.meta.env.DEV`) and are absent from production builds:

- `http://localhost:5173/#selftest`: the GPU known-answer harness (`src/selftest`). It compiles every shader, checks tiling
  edge equality and output ranges, and compares GPU read-backs with CPU references. Needs a real or software WebGPU adapter.
- `#gizmo-test`: Canvas2D page for the gizmo framework (works without WebGPU).
- `#graph-stress`: graph editor stress page (hundreds of nodes).
- `window.kekenik`: the application services object, for the browser console.
- Help → *Run Self-test* appears in the menu only in development.

Utilities for contributors live in `tools/` (`samples/`, `i18n-audit.mjs`, `size-report.mjs`, `generate-notices.mjs`).

## 9. Do not duplicate

Reuse the existing helpers: `shared/util.ts`, `shared/emitter.ts`, `shared/log.ts` (`consoleBus`), `shared/worker-pool.ts`,
`ui/core/dom.ts` (`h`, `download`, `observeSize`, `dragPointer`), `ui/core/overlay.ts` (toasts, modals, tooltips),
`nodes/_shared/*` (blur, reduce, polar, islands kernels, variants, export params) and `engine/shaders/reference/*` (CPU mirrors of
the WGSL).

## 10. Contracts

A contract change must be backward compatible. The TypeScript is the source of truth; [CONTRACTS.md](CONTRACTS.md) explains it.

## 11. Release checklist

1. `npm run check` and `npm run build` are green.
2. If dependencies changed: `npm run notices`.
3. If nodes changed: `npm run docs:nodes`.
4. Update `CHANGELOG.md`, bump `version` in `package.json` and `APP_VERSION` in `src/shared/version.ts`.
5. Tag `vX.Y.Z` and push the tag; the release workflow builds and attaches a zip of `dist/`.
