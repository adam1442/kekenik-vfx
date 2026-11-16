# Kekenik VFX — Performance, benchmarks and memory

Sources: `src/engine/perf/*` (stats, adaptive resolution, memory guard, warm-up), `src/panels/profiler/`,
`src/app/hud.ts`, `src/app/perf-wiring.ts`, GPU benchmarks in `src/selftest/perf.ts` (development harness), CPU tests in `tests/perf.test.ts`,
`tests/stress.test.ts`.

> **Note.** The GPU numbers below are **targets** (what the design budgets for a mid-range GPU) together with the **hard limits**
> that make the development GPU harness fail (`npm run dev`, open `/#selftest`, run the *BENCH* tests, which print measured values).
> The CPU-side numbers were measured with Vitest on Node, without a GPU.

## 1. Benchmark targets (GPU, run in the development harness)

| ID | Scenario | Target | Hard limit (test fails above) |
|---|---|---|---|
| B1 | Interactive drag, 20-node graph @1024², every node re-runs | **≤ 8 ms GPU** (timestamp queries), wall time reported too | 33 ms wall |
| B2 | Unchanged 20-node graph (pure cache hits) | ≤ 1 ms CPU | 8 ms |
| B3 | Pipeline warm-up of the 20-node graph | ≤ 3 s total | 12 s |
| B4 | 120 nodes @2048², full evaluation of 12 outputs | ≤ 100 ms CPU recording | 600 ms |
| B5 | 1024² readback (export path) | ≤ 15 ms | 120 ms |

Software renderers (SwiftShader, llvmpipe) are 10–100× slower; the hard limits are loose enough for them, the targets are not.

## 2. CPU-side measurements (vitest, Node 22, no GPU)

| Test | Result |
|---|---|
| 300-node graph: plan build (`tests/stress.test.ts`) | ≈ 40 ms (O(n)) |
| 2000 undo / redo cycles, graph identical afterwards | ≈ 45 ms |
| 50 000 pool acquire / release cycles, mixed sizes: baseline restored | ≈ 60 ms |
| 10 nested subgraph levels: flatten + same content hash as the inline graph | < 500 ms (asserted), typically a few ms |
| Graph editor: 500 nodes / ~1000 links, scene build + culling + hit-testing | ≈ 390 ms for the whole test (incl. building the graph) |
| `tests/robust.test.ts`: truncated / corrupted project recovery | 1–5 ms each |

## 3. What is optimised (and where)

| Area | Mechanism | Code |
|---|---|---|
| Async compile | `createRenderPipelineAsync` / `createComputePipelineAsync`; `PipelinePending` keeps the frame loop alive while compiling | `engine/shaders/pipelines.ts` |
| Warm-up | After project load, one idle-time 1/16-scale evaluation per node type, in small batches; yields, cancellable, retried while the user interacts | `engine/perf/warmup.ts` |
| Specialisation | Pipeline key = shader id + `#define`s + layout + format; nodes pass defines for modes (dead branches removed by the WGSL preprocessor) | `engine/shaders/preprocess.ts`, `gpu/passes.ts` |
| Skip identity | `NodeDefinition.identity(params)` → the evaluator forwards the input texture, no pass recorded (`evaluator.identitySkips`) | `graph/evaluator.ts` |
| Bind groups | Cached per (pipeline, resources); uniforms use dynamic offsets into the ring arena (`?nobgcache` turns it off) | `gpu/passes.ts`, `gpu/arena.ts` |
| Submits | One `GPUCommandEncoder` per node batch, a single `queue.submit` per evaluation; readback uses one small staging buffer at a time | `gpu/passes.ts`, `resources/readback.ts` |
| Precision | r16float / rg16float / rgba16float intermediates; 32-bit only in HQ | `resources/` |
| Large radii | Gaussian blur is a **pyramid hybrid** (box downsample → gaussian → bicubic up): cost nearly independent of the radius; Kawase option | `nodes/_shared/{blur,down,up,kawase}` |
| Static work during playback | Params of non-animated nodes keep object identity → same hash → cache hit; only time-dependent nodes re-run; bounded `FrameCache` replays loops | `anim/animator.ts`, `graph/scheduler.ts` |
| Adaptive preview | Preview scale chosen from a `cost ≈ c·scale²` model (GPU timestamps preferred): down immediately, up after 6 cheap samples | `engine/perf/adaptive.ts` |
| Thumbnails | Scheduled only when the scheduler is idle, never while dragging, blitted into an atlas | `panels/graph-editor/thumbnails.ts` |
| Worker offload | Big OBJ imports are parsed in a Worker (same `objParseCore` code as the sync path); falls back to the main thread without Workers. CPU mesh *nodes* are not offloaded  | `shared/worker-pool.ts`, `engine/io/model.ts` |

## 4. Memory model

- Everything GPU-side goes through `MemoryManager`: pools keyed by (w, h, format, usage), exact byte accounting, a budget
  (default derived from device limits; override in Settings), ref-counted outputs released after their last consumer,
  LRU `OutputCache` with eviction under pressure, hard caps from `maxTextureDimension2D` / `maxBufferSize`.
- `MemoryGuard` (`engine/perf/guard.ts`) reacts to `onPressure` (budget exceeded after eviction **or** a device
  out-of-memory error scope): level 1 drops frame cache + output cache + idle pools; level ≥ 2 (or a device OOM) also halves the
  preview resolution (floor 12.5 %) and shows a toast. Rate-limited (4 s), decays after 60 s of calm.
- Device loss: `GpuContext` re-requests adapter + device (3 attempts, back-off), bumps `generation`, pools / caches reset,
  the scheduler re-renders. The harness test "device-lost recovery" runs the real path (`simulateLoss`).
- Leak detection: `tests/stress.test.ts` (pool books balance after 50 k cycles, double release is harmless) and the GPU stress
  tests in the harness (120 nodes @2048 × 8 evaluations, 300-frame playback keeps memory flat, undo / redo while evaluating,
  repeated export (12 × PNG16 + 4 × tiled 2K EXR, stable sizes), tiny 96 MB budget degrades with typed errors, 4K chain, 8K degradation).

## 5. How to profile

1. **Performance HUD** (`F3`): fps, evaluation CPU / GPU ms, preview scale, memory used / budget / peak, pool + cache hit rates.
2. **Profiler panel** (Window → Profiler): *Nodes* (flame-style bars per node, GPU ms when `timestamp-query` exists, else CPU
   recording time; per-pass breakdown), *Memory* (timeline of used / live / idle / budget), *Caches* (pool, output cache, bind
   group cache hit rates), *Pipelines* (compile times). Sampling runs only while a viewer is open (reference-counted).
3. **GPU test harness** (development server, `/#selftest`): run the BENCH group.
4. **Console**: shader compile errors with node name and WGSL line numbers.

## 6. Tuning knobs

| Setting | Where | Effect |
|---|---|---|
| Preview quality | Settings → Quality & memory | Starting resolution while dragging |
| Adaptive preview + budget ms | same | Keeps drag evaluation under N ms |
| Memory budget | same | Hard cap for pools + cache |
| Shader warm-up | same | Pre-compile after project load |
| `?safe` | URL | No heavy panels, no warm-up, no thumbnails |
| `?nobgcache` | URL | Disable bind-group cache (driver workaround) |

## 7. Known gaps

- Only chains of simple per-pixel nodes are fused into one pass; `NodeDefinition.identity` removes work for Blur, Transform, Adjust and Curve.
- Only OBJ parsing runs in a Worker by default; other CPU mesh nodes run on the main thread.
