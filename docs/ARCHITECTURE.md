# Architecture

This document explains how Kekenik VFX is put together, for people who want to read or change the code. For step-by-step
recipes (new node, gizmo, panel, exporter) see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md); for the data formats and invariants the
engine relies on see [CONTRACTS.md](CONTRACTS.md).

## 1. Overview

Kekenik VFX is a single-page application written in vanilla TypeScript (no UI framework) that runs entirely in the browser.
All pixels are produced by WebGPU shaders written in WGSL. The 3D viewport uses [three.js](https://threejs.org/) on the **same
`GPUDevice`** as the engine, so textures never leave the GPU.

```
index.html → src/main.tsx → src/App.tsx (startApp)
                              ├─ GpuContext (adapter + device, loss recovery)  ── fails → GPU diagnostics screen
                              ├─ Engine (memory, pipelines, graph evaluator, scheduler)
                              └─ App shell (docking UI, panels, commands, project, settings)
```

`src/App.tsx` keeps the conventional entry name but contains no JSX. Routes are hash based and there are no server-side paths, so
the site works from any sub-folder (for example GitHub Pages).

## 2. Repository layout

```
src/
  engine/      GPU layer, resources, shaders, graph, params, commands, io, animation, mesh, simulation, performance, docs
  nodes/       one folder per node: definition.ts, shader.wgsl, optional gizmo.ts and tests (auto-discovered)
  gizmos/      2D gizmo framework (models, hit-testing, controller, renderer)
  gizmos3d/    3D gizmo framework
  panels/      one folder per dockable panel (auto-discovered): graph editor, viewports, properties, timeline, export, ...
  ui/          DOM helpers, docking, widgets, theme, icons, GPU diagnostics screen
  app/         application glue: project, commands, menus, settings, library, safe mode, HUD
  export/      image / mesh encoders, export jobs, queue, engine presets
  samples/     catalog of the bundled sample projects
  i18n/        en.json, fa.json (UI strings)
  shared/      small utilities: emitter, logging, i18n runtime, worker pool, version
  workers/     inlined web worker for CPU mesh work
  selftest/    GPU known-answer test harness (development server only)
samples/       sample projects (graph.kekenik.json + sample.json each) and index.json
tests/         Vitest suites (pure logic, CPU reference implementations, mocked devices)
tools/         contributor tooling (sample generator, i18n audit, size report, third-party notices)
docs/          public documentation
public/        static files copied as-is (icon, manifest, service worker, robots.txt)
```

## 3. GPU layer (`src/engine/gpu`)

- **`GpuContext`** requests every optional feature the adapter exposes (for example `shader-f16`, `float32-filterable`,
  `timestamp-query`, `texture-formats-tier1`) and the adapter's maximum limits, falling back to default limits when the request is
  rejected. `caps` (a `CapabilityReport`) is the single source for capability checks.
- **Acquire order**: a full-featured device first, then lower tiers (compatibility, software adapter). *Safe mode* (`?safe`) asks for
  a bare device with no optional features.
- **Error handling**: uncaptured errors go to the Console panel; code that needs attribution uses error scopes
  (`gpu.scope`). Out-of-memory scopes wrap allocations.
- **Device loss**: when the device is lost the context requests a new one (three attempts with back-off), bumps a generation
  counter and notifies the engine, which resets pools, pipelines and caches and re-evaluates the graph. CPU state (graphs, params,
  undo history) is never lost. When recovery fails the diagnostics screen is shown as an overlay with a retry button.
- **`PassRunner`**: full-screen fragment passes only need a `shade(uv)` function; bindings (`F` frame uniform, `P` params uniform,
  `t0..` textures, `s0..` storage buffers) and entry points are generated, including high-quality supersampling. Compute passes
  declare their own bindings.

## 4. Resources and memory (`src/engine/resources`)

- Everything GPU-side is allocated through **`MemoryManager`**: exact byte accounting, pooled textures and buffers keyed by size,
  format and usage, and a memory budget (default derived from device information; adjustable in Settings).
- Textures are **reference counted**; the last release returns them to the pool. Double release is logged, use-after-free throws.
- **Pressure policy**: trim idle pools → evict from the output cache (LRU) → trim again → throw a typed error. A node that cannot
  allocate gets an error badge; the application never crashes.
- **Tiled rendering** (`TileScheduler`): large exports (for example 8K) are rendered tile by tile with a halo, so peak GPU
  memory does not depend on the final resolution. Nodes declare how they behave under tiling through `cost.tiling`.
- Read-backs are asynchronous (`mapAsync`) and use one small staging buffer at a time. Nothing in the render path awaits a read-back.

## 5. Shader system (`src/engine/shaders`)

- A small **WGSL preprocessor** provides `#include`, `#define`/`#undef` and conditionals, and maps compiler messages back to the
  original file and line.
- The **shader library** (`wgsl/*.wgsl`, discovered with `import.meta.glob`) contains hashes, periodic noise, colour, blending,
  wrap-aware sampling, signed-distance helpers and modulation utilities.
- Sampling uses `textureLoad` only, so every float format works without `float32-filterable`, and tiling wraps exactly per axis.
- **Pipelines are validated before first use** (`createShaderModule` → `getCompilationInfo` → async pipeline creation). A compile
  error never poisons a command buffer; it becomes a diagnostic with node id, node name and the original WGSL line.
- Uniform buffers are laid out by `makeLayout`, which implements WGSL alignment rules, so shaders never hand-write offsets.

## 6. Graph engine (`src/engine/graph`)

- **Model**: nodes, links (one link per input pin, unlimited fan-out), settings (size, tiling, filtering, bit depth, frame rate,
  loop length, seed) and optional subgraphs. Types are checked (Gray → Color is the only implicit conversion) and cycles are rejected.
  Unknown node types survive load and save.
- **Plan**: a pure function that produces a topological order for the requested targets and a **version hash** per node (node type
  and version, resolved params, frame settings, input hashes). Equal hash ⇒ equal output, which drives all caching. Time only
  enters nodes that depend on it.
- **Evaluator**: target-driven partial evaluation (a node whose outputs are cached is skipped together with its inputs), one command
  encoder per node, reference-counted outputs, and a single `queue.submit` per evaluation inside a validation scope. After a
  validation error the evaluation is re-run in isolated mode to attribute the error to one node.
- **Scheduler**: at most one evaluation per animation frame for the union of visible targets; interaction lowers the preview
  resolution (adaptive preview) and evaluations are cancellable.
- **Fusion** (`engine/fusion`): chains of simple per-pixel nodes can be fused into a single pass.
- **Subgraphs** (`engine/subgraph`): reusable node groups with a declared interface, flattened for evaluation.
- **Nodes** are discovered automatically from `src/nodes/**/definition.ts`; nothing registers them by hand. Parameter ids are stored
  in project files and are never renamed; changes bump the node `version` and add a `migrateParams` step.

## 7. Parameters, commands, project files

- Params are described by a schema (`engine/params/schema.ts`): floats, ints, enums, colours, curves, gradients, vectors, splines and
  so on, with tooltips, ranges and modulation support.
- All edits go through **commands** (`engine/commands`) with undo/redo and coalescing, for example one undo step per drag.
- Projects are JSON (`.kvfx`/`.json`): graph, animation tracks and UI layout. Autosave keeps the last two good payloads in
  `localStorage`; a damaged file is recovered as far as possible rather than rejected.

## 8. Animation, simulation, meshes

- **Animation** (`engine/anim`): keyframe tracks per parameter, a timeline, flipbook baking (sheet layout, loops, frame cache) and
  particle attribute maths.
- **Simulation** (`engine/sim`, `nodes/simulation`): stateful nodes (2D fluid, reaction-diffusion, waves, vector-field advection,
  motion vectors) run through a deterministic service: the frame `k` depends only on the seed and the parameters, never on wall-clock
  time, so exports are reproducible.
- **Meshes** (`engine/mesh`, `engine/spline`): attribute-based CPU meshes (point / vertex / primitive / detail), splines and
  sweeps. CPU mesh work can run in a worker (`src/workers`, bundled inline so no extra URLs are needed).

## 9. UI shell

- **Docking** (`ui/dock`): a layout model (pure, unit-tested) rendered by `DockManager`; panels are discovered from
  `src/panels/*/panel.ts` and moved, not recreated, when docked or floated. A panel error boundary shows an error card instead
  of taking the app down.
- **Widgets, theme and icons**: custom DOM widgets (curve, gradient, histogram, colour, vector fields); dark and light themes with
  a user accent colour; an original inline SVG icon set.
- **Gizmos**: nodes *declare* gizmos bound to parameters; the framework draws and edits them and writes through parameter gestures
  (one undo step per drag).
- **Panels**: graph editor (Canvas2D, culled, thumbnail atlas), 2D and 3D viewports, properties, node library and gallery,
  timeline, curve and flipbook editors, assets, export, profiler, console and help.

## 10. Export (`src/export`)

Image formats are streaming encoders that receive float rows and write to a byte sink (PNG, TGA, OpenEXR, Radiance HDR, uncompressed DDS), so
large images are never buffered whole. Mesh formats (GLB, glTF, OBJ, PLY), vertex-animation textures, flipbook JSON sidecars
and engine presets (see [EXPORT_GUIDE.md](EXPORT_GUIDE.md)) are built on the same job queue. Folder export uses the File System
Access API where available and falls back to ZIP downloads.

## 11. Internationalisation

UI strings live in `src/i18n/en.json` (source of truth) and `src/i18n/fa.json`. Node titles, parameters and tooltips are
translated through key conventions and a Persian term table. Persian switches the whole interface to right-to-left, while the
graph canvas, timeline, curve editor, histogram, numeric fields and viewports stay left-to-right. See
[I18N_GUIDE.md](I18N_GUIDE.md).

## 12. Build, hosting and offline use

- Vite builds a code-split, hashed bundle into `dist/`; `three` and `fflate` are separate vendor chunks. No source maps are
  published and debug logging is removed in production.
- `base` is read from the `KEKENIK_BASE` environment variable (default `./`, relative URLs). The Pages workflow builds with
  `/kekenik-vfx/`.
- Development-only pages (GPU test harness, gizmo test page, graph stress test) are behind `import.meta.env.DEV`, so they are not
  part of the production bundle.
- `public/sw.js` is an optional service worker (stamped with a build id during the build). It only handles same-origin requests,
  is network-first for page loads and never calls third-party hosts.
- The app makes **no network requests at runtime** except loading its own static files. There is no analytics, telemetry,
  external font or CDN.

## 13. Persistence keys (`localStorage`)

Settings, workspace layouts, autosave slots and a few one-time flags use keys prefixed `kk-` / `kekenik`. Clearing site data resets
the application to its defaults.

## 14. Dependencies

| Package | Why |
|---|---|
| `three` | 3D viewport (WebGPU renderer sharing the engine device) and mesh preview |
| `fflate` | ZIP/deflate for export bundles and project/asset import |

Everything else (UI, docking, graph editor, widgets, encoders, simulation, i18n) is written in this repository. Development tools
are TypeScript, Vite, Vitest, ESLint and Prettier.
