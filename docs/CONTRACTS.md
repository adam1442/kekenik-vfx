# Engine contracts

Source of truth is the TypeScript; this file explains it. Changing any contract: keep it backward compatible.

## 1. Pin types (`src/engine/types.ts`, `graph/pins.ts`)
`gray | color | normal | uv | mesh | points | scalar | vector | curve | gradient | flipbook`. Texture pins: gray (r16float), uv (rg16float), color & normal (rgba16float); `bitDepth: 32` graph setting → r32float/rg32float/rgba32float. Normal textures store the *encoded* normal (xyz·0.5+0.5). **Only Gray→Color is implicit** (`canConnect`); the evaluator inserts the conversion. Pin colors: `PIN_COLORS`. Category colors: `CATEGORIES`.

Values flowing on links (`resources/values.ts`): `TextureValue {kind:'texture', pin, tex: GpuTexture, width, height}` or `DataValue {kind:'data', pin, data, resources?: RefCounted[]}` (mesh/points/flipbook/curve...; owned GPU resources must implement `RefCounted`).

## 2. ParamSchema (`params/schema.ts`)
```ts
P.float('scale', 4, { min, max /*hard*/, softMin, softMax /*slider*/, step, display:'percent'|'angle'|'number', unit, modulatable, animatable, group, tab, tooltip, visibleIf, showWhenConnected })
P.int / P.bool / P.enum(id, def, options) / P.vec2 / P.vec3 / P.color / P.seed / P.curve / P.gradient / P.string / P.asset(id, kind)
```
- Values are JSON data (`ParamValue`); `coerceParam(def, any)` is applied on every write (clamp hard range, round ints, validate enums, fix array lengths).
- `percent` params are stored as fractions (1 = 100%).
- `modulatable: true` (float): engine adds input pin `<id>_mod` (Gray, optional) and param `<id>_mod_k` (percent −100…100%). In `evaluate`: `const m = ctx.mod('<id>')` → `{tex, k}`; bind `m.tex?.tex ?? null` as a texture and pass `m.k`; in WGSL `modulate(value, tex_sample(tN, uv, F.tile, F.filter_mode).r, P.<id>_mod_k)`.
- Reserved ids: `tex_*` (common), `blend_mode|blend_cross|blend_smooth`, `*_mod_k`, input pin `background` (when `common.blending`), `*_mod` input pins.
- Param ids are persisted: never rename (bump `version` + `migrateParams`).
- Read params in `evaluate` through `ctx.params` (`num/int/bool/str/vec2/vec3/rgba/seed/curve/gradient/enumIndex/modK`); getters throw on typos. Enum shaders receive `enumIndex` (order of `options`).
- Curves/gradients: bake with `bakeCurveLut(curve, n)` / `bakeGradientLut(gradient, n)` (CPU), upload as storage buffer (`storageBuffers: [..]`, `s0: array<f32>`) or texture.

## 3. NodeDefinition (`graph/node.ts`)
```ts
export default defineNode({
  id: 'grayscale.noise',            // "<category>.<name>", stable
  version: 1, category: 'grayscale', title, description, keywords, icon,
  inputs: PinDef[], outputs: PinDef[], params: ParamSchema,
  common: { texture?: boolean /* default: true if texture output */, blending?: boolean /* default false; generators: true */ },
  gizmos?: GizmoDecl[], shaders?: ShaderDecl[], timeDependent?: boolean | ((params)=>boolean),
  cost?: { gpu, tiling: 'pixel'|'halo'|'global', halo?, temporaries? },
  evaluate(ctx: EvalContext): Record<outputPinId, PinValue>,
  migrateParams?(old, fromVersion)
})
```
- **Common tabs (engine-provided)**: *Texture* (Size From Graph|From Parent|Absolute with W/H multipliers or pixels; Filtering and Tiling sources; HQ supersampling `tex_ss`) and *Blending* (only while the Background pin is connected: blend type, cross mix, smoothness). The engine resolves them into `ctx.frame` and, after `evaluate`, blends the node's primary texture output with `background` (all done in `Evaluator`; the node does nothing).
- Reading the frame: `ctx.frame` = `{width,height, tileX,tileY, filter(0|1|2), hq, supersample, time, loopPhase, seed, fullWidth/Height, originX/Y}`. In WGSL the same data is `F` (`F.tile`, `F.filter_mode`, `F.res`, `F.ss`, `F.time`, `F.loop_phase`, `F.seed`, ...).
- `ctx` API: `inputs`, `texInput(pin)`, `mod(paramId)`, `tex(pinType, w?, h?)` (allocate; auto-released unless returned), `result(tex, pin)`, `pass({target, shader, uniforms:{layout,values}, textures, storageBuffers, mode:'shade'|'raw', ss, defines})`, `compute({shader, bindings, workgroups})`, `uniformBinding(layout, values)`, `encoder`, `gpu`.
- **Generators**: omit `ss` (uses the node's HQ setting), set `common:{blending:true}`, use `frame_uv` via `shade(uv)`, wrap with `F.tile` / periodic lattices. **Filters**: pass `ss: 1`, sample inputs with `tex_sample(t0, uv, F.tile, F.filter_mode)`.
- Throwing inside `evaluate` = error badge with the message; `OutOfBudgetError` degrades the same way. Never keep GPU resources outside `ctx.tex`/pools.
- `shaders: [{source, uniforms, textures, mode?, defines?}]` must mirror what `evaluate` passes to `ctx.pass`; unit tests assemble them and (with `WGSL_REFLECT=…`) parse them as WGSL.
- **Shader authoring rules** — you write `fn shade(uv: vec2f) -> vec4f` (gray: `vec4f(v,0,0,1)`; uv: `vec4f(u,v,0,1)`; color: rgba). Generated: `F`, `P`, `t0…`, `s0…`, `Frame`, `Params`, `VsOut`, `vs_main`, `fs_main`. Includes: `common frame hash noise color blend sampling sdf util`.
- **Gizmos** (declaration only; framework by ): `{id, label?, viewport:'2d'|'3d'|'both', space:'uv'|'pixel'|'world', visibleIf?} & (point{param} | circle{center?,radius} | rect{center,size,rotation?} | line{from,to} | angle{center?,angle} | transform{position?,rotation?,scale?} | path{param} | box3d{position,size})`. Every referenced id must be a param (validated). Viewports write changes through `GraphEditor.setParam` (coalesced undo).

## 4. Graph & commands
- `Graph` (`graph/graph.ts`): `nodes: Map<id,NodeData>`, `links: Map<id,LinkData>`, `settings: GraphSettings`, `revision`, `events` (`{type, dirty:Set<nodeId>}`), mutation primitives (`addNode/removeNode/restoreNode/setParam/connect/disconnect/restoreLink/moveNode/setNodeField/setSettings`), queries (`inputLink/linksFrom/linksTo/downstream/upstream/wouldCreateCycle/checkConnection/expandedOf`), `toData()` / `Graph.fromData(registry, data)`.
- **UI must mutate through `GraphEditor`** (`commands/graph-commands.ts`): `addNode, removeNodes, connect, disconnect, setParam, moveNodes, setSettings, setNodeField, duplicate`, plus `editor.stack` (`undo/redo/begin/commit/abort/transaction/sealTop/markSaved/isDirty/onChange`). Call `stack.sealTop()` on pointer-up of a drag. `Command {label, do, undo, mergeKey?, mergeWith?}`.
- Subgraphs: `NodeData.subgraph?: GraphData` is part of the model/serialization; evaluation of subgraphs is 's.
- Animation hook: `evaluator.animator = (node, rawParams, time) => params`. Time-dependent nodes: `def.timeDependent`.

## 5. Evaluation API
```ts
engine.scheduler.attach(graph); engine.scheduler.setTargets('viewport-1', [{nodeId, pinId?}]); engine.scheduler.setTime(t);
engine.scheduler.onResult.on(({result, scale, final}) => { const v = result.values.get(targetKey({nodeId})); draw(v); /* result owned by scheduler */ });
// Direct (export / tests): const res = await engine.evaluator.evaluate(graph, targets, {time, scale, region?, isolate?, token?}); ...; res.release();
```
`EvalResult {values, errors (nodeId→message), stats, cancelled, release()}`; per-node `NodeStat {status: ok|cached|error|blocked|bypassed, cpuMs, gpuMs?, error?}` → drives error badges and timing readouts. Always `release()` direct results. `renderTiled(gpu, mm, evaluator, graph, target, {tileSize?, halo?, onTile})` for 8K+.

## 6. Panel registration (UI contract for — so that panels stay consistent)
```ts
interface PanelDefinition {
  id: string;                       // 'graph-editor', '2d-viewport', ...
  title: string; icon: string;
  multiple?: boolean;               // several instances allowed (viewports)
  defaultDock?: { zone: 'left'|'right'|'bottom'|'center'; size?: number };
  create(host: HTMLElement, ctx: PanelContext): PanelInstance;
}
interface PanelContext { engine: Engine; editor: GraphEditor; scheduler: EvalScheduler; instanceId: string; state: Store<unknown> /* persisted in workspace */; }
interface PanelInstance { dispose(): void; resize?(w: number, h: number): void; focus?(): void; serialize?(): unknown; }
```
owns the registry implementation (`src/ui/panels`); Panels register evaluation targets with `scheduler.setTargets(instanceId, …)` (null when hidden) and never call the evaluator directly except for export.

## 7. Project file schema (`io/project.ts`)
```jsonc
{ "format": "kekenik-vfx", "version": 1,
  "app": {"name":"Kekenik VFX","version":"0.1.0"}, "name": "...", "created": "ISO", "modified": "ISO",
  "graph": { "settings": {width,height,tiling,filtering,bitDepth,fps,loopLength,seed},
             "nodes": [{ "id","type","typeVersion","name","x","y","params":{...},"bypass?","comment?","subgraph?" }],
             "links": [{ "id", "from":{"node","pin"}, "to":{"node","pin"} }] },
  "assets": [{ "id","name","mime","size" }],   // blobs live in AssetStore (IndexedDB) / bundle
  "ui": { }, "animation": { } }                // owned by the UI / animation modules
```
Load: `deserializeProject(registry, json)` → migrations (`MIGRATIONS`) → `Graph.fromData` (param migration + coercion, unknown types kept, invalid links dropped with warnings). Autosave: `Autosaver(IndexedDbAutosave, () => projectToJson(serializeProject(...)))`.

## 8. Console / diagnostics
`consoleBus` (`shared/log.ts`): `info/warn/error(message, {source, nodeId, nodeName, file, line, column, detail})`, `entries`, `onEntry`. Shader errors arrive with `source:'shader'`, `nodeId`, `nodeName`, `file` (`node:<shader name>` or a library module name), `line` inside that file, `column`, `detail` = offending source line. `MemoryManager.stats()` feeds the GPU memory meter.

## 9. UV pin convention
A **UV field** is an `rg16float` texture (`rg32float` with `bitDepth: 32`) that holds a *warp*: "where does this pixel read from".

| | Absolute (canonical, default) | Offset |
|---|---|---|
| stored value `rg` | lookup coordinate `L(uv)` | `L(uv) − uv` (the *delta*) |
| neutral field | the pixel's own `uv` (identity) | `0` |
| consumers | `utils.transform` / `utils.directional_blur` / `grayscale.noise` UV pins read it directly | must be converted (`UV Blend`, `UV Blur`, `UV Transform`, `UV Flow`, `UV to Color`, `UV Split` have an input-mode param) |

- **Mode flag.** Every UV *producer* has the enum param `uv_out` = `absolute` (default) | `offset`; every UV *consumer* in the UV / Utils categories has `uv_in` (or `uv_in_a` / `uv_in_b`). The **pin itself carries no mode** — wiring an Offset field into a node that expects Absolute is the user's choice (the mode names are in the param tooltips). All UV nodes work on **deltas internally**, so their results do not depend on the storage mode.
- **Units: tile space.** `1.0` = one full image width / height; `(0,0)` = top-left pixel corner, `(1,1)` = bottom-right, **+u right, +v DOWN** (same as `frame_uv()` and the gizmo space). Lengths given as "fraction of the smaller side" are converted with `asp = res / min(res)` (`delta_uv = iso / asp`), so a 10 % strength is the same *visual* distance on non-square images.
- **Sign convention (lookup semantics).** `out(uv) = image(field(uv))`. A positive `strength` along an angle moves the **content** along that angle, so the stored lookup delta is `−dir * strength`. Radial `+` pushes content away from the centre, Rotational `+` rotates content clockwise on screen, Spline flows content along the spline direction, From Grayscale *downhill* moves content to lower heights. Sampling an image through `uv.transform` equals `utils.transform` with the same parameters.
- **Never wrapped.** Absolute coordinates are not wrapped into `0..1` (a sampler wraps with its own Tiling), so bilinear interpolation of the field is valid across the seam. Distances inside nodes use the minimum image on tiling axes.
- **Precision.** `rg16float` gives ~`2⁻¹¹` relative precision: in absolute mode that is ~0.5 px at 1024 and ~1 px at 2048 for coordinates near 1 (the same limit as `utils.distance`'s *Nearest UV*). Offset mode is more precise for small warps. Use `bitDepth: 32` for pixel-exact absolute fields.
- **Engine codecs**:

| codec | rg | b | typical use |
|---|---|---|---|
| `absolute` | lookup coordinate | 0 | UV-distortion lookup tables (float / 16-bit) |
| `offset` | signed lookup delta | 0 | EXR / float flowmaps and distortion (neutral 0) |
| `biased` | `v / range · 0.5 + 0.5` (neutral 0.5) | 0 | 8 / 16-bit flowmaps: **Unreal** (uncompressed, *sRGB off*, shader `uv − flow·time`), **Unity** (`Flip Y` on: bottom-up UV), **Godot** (as Unreal) |
| `direction` | unit direction `· 0.5 + 0.5` | `\|v\| / range` | direction + speed flowmaps |

  `flow_sign` = `flow` (default for `biased` / `direction`): the stored vector is the direction the **content moves** (= `−lookup delta`, what engine flowmap shaders expect: `uv − flow * time`); `lookup`: the raw delta. `absolute` / `offset` are always raw lookup values. `range` = tile-space offset of a fully saturated channel (default 10 %). *Export checklist for 6B:* linear (non-sRGB) texture, no mips across the range, premultiply off, choose `Flip Y` for Unity / OpenGL.
- **Two-phase flow.** `uv.flow` outputs `uv_a`, `uv_b` (offsets `d · S · (phase − 0.5)`, phase B = phase A + 0.5) and `weight` = `1 − |2·fract(t) − 1|` (0 exactly at the reset of A). The shader formula engines use is `mix(tex(uv_b), tex(uv_a), weight)`. Periodic in `t` with period 1; the *graph loop* drives `t = loopPhase · cycles` (integer cycles = seamless loops).

## 10. Island data format
Produced by `islands.generate`, consumed by `islands.*`. Implementation + CPU mirrors: `nodes/_shared/islands.ts`, `engine/shaders/wgsl/island.wgsl`.
- **Island Map** (Color pin, `rgba16float`): `rgba = (bbox min x, bbox min y, bbox width, bbox height)` in UV units; every pixel of an island holds the same value, `width = height = 0` = background. `min` may be `< 0` or `> 1` for an island that wraps around the seam of a tiling graph (its pixels sit at `uv − min` wrapped into `[0,1)`; `island_local()` / `islandLocal()` do that). Precision: half floats (≈ 1 px at 2048²); use `bitDepth: 32` for exact boxes.
- **Island ID** = `island_hash(map, seed)` (GPU) = `islandHash(mapValues, seed)` (CPU, feed it the half-rounded values `fromHalf(...)`) → `u01` = uniform `[0,1)`. Identical in every Islands node and in the `ID` output; two islands collide only if all four rounded box values are identical.
- **Labels** (Color pin, exact): `(xhi, xlo, yhi, ylo)` of the island **root** = its first pixel in raster order (`x = xhi·1024 + xlo`), `−1` on background. Same pixel ⇔ same island. Use Labels (not the hash) whenever an exact partition matters (mesh pivots, readback grouping): `root = y·W + x`.
- **Centre** (UV pin, absolute): centre of mass, wrapped into `0..1` on tiling axes. **Size** (Gray): `pixelCount / (W·H) / Size reference`, clamped.
- **Generation algorithm:** union-find in compute shaders (`hook` = `atomicMin(parent[max(rootA, rootB)], min)` over every neighbour pair, `compress` = full path compression, 4 / 8 connectivity, wraps on tiling axes), `Rounds` = `log2(side) + 4` by default (measured convergence on serpentine / spiral / noise masks: 2–5 rounds; capped at 64, never unbounded). Statistics (bbox relative to the root so wrapped islands work, count, centre of mass) by atomics into an open-addressing hash table keyed by the root (`Max islands` slots × 96 B; overflow degrades to one-pixel boxes, never fails). The parent buffer is 4 B / pixel, so Generate throws a clear error above `maxStorageBufferBindingSize` (≈ 5800² on default limits).
- **Padding** keeps the contract: padded pixels get their island's map value (bbox optionally expanded by the padding so ids stay identical inside the island and its padding).

## 11. Normal map convention
`normal` pins hold the **encoded** unit normal `n·0.5 + 0.5` in `rgba16float` (a = 1). `normal.create`: `n = normalize(−∂h/∂x·k, ±∂h/∂y·k, 1)`, `k = strength · height_scale / e_iso` (height 0→100 % = `height_scale` × smaller side; resolution independent); image y points down; **OpenGL** (+Y up; Unity, Godot) `n.y = +∂h/∂y_down·k`, **DirectX** (Unreal) `n.y = −…`. 4-way central, 8-way Sobel and Scharr kernels are normalised to the same slope. `normal.combine` modes: RNM, UDN, whiteout, linear, partial derivative (all on decoded unit vectors, y-flip symmetric). Export (6B): `normal.normal_to_color` offers encoded / signed-float / two-channel / DXT5nm layouts and a Y flip.

## 12. Texture-space polar mapping
`utils.cartesian_to_polar` / `utils.polar_to_cartesian` (+ Color variants) and `uv.cartesian_to_polar` share `nodes/_shared/polar.wgsl` (CPU mirror `polarC2P` / `polarP2C` in `polar.ts`, inverse-tested). C2P: `r_n = metric(p − centre) / (0.5·scale)`, `θ = atan2 − rotation − spiral·r_n·τ`, `u = fract(θ/τ)/aperture`, `v = (persp(r_nᵖ) − 0.5)·radial_scaling + 0.5 + radial_centering`, then out-of-range (clamp / repeat / transparent), angular and radial tiling, and the seam **overlap** (`x = u·(1 − ov)`; for `x < ov·scale` cross-fade `source(x + 1 − ov)` into `source(x)`, so the seam is continuous without tiling input). P2C is the exact inverse (Overlap only exists on C2P: a disc sampled around a circle has no seam).

## 13. Mesh / Points / Camera data model
**World**: right-handed, **Z up**, +X right, +Y forward (front view looks along +Y). Mesh UVs are **v up** (origin bottom-left); graph textures are y-down, so the viewport / exporters flip v. Euler angles are degrees, order X then Y then Z (`q = qz*qy*qx`). Quaternions `[x,y,z,w]`. Source: `src/engine/mesh/{mesh,builder,ops,shapes,points,accounting,camera,math3}.ts`.

**Elements**: `point | vertex | primitive | detail`. Topology (`Topology`, immutable, shared): `vertPoint[v]` = point of vertex v; primitive p owns the CONTIGUOUS vertices `primStart[p] .. primStart[p+1]-1` (attribute-based model; a vertex belongs to ONE primitive, points are shared). Triangulation (`topology.triangles()` -> `{verts (VERTEX indices, 3 per tri), prim}`) is a lazy cache (fan; exact for tris / quads / convex n-gons). `topology.edges()` = unique n-gon boundary edges as point pairs. A **point cloud** is a MeshData with 0 primitives and travels on the `points` pin; meshes on `mesh`. Both are `DataValue{pin, data: MeshData, resources:[MeshResource]}`; create with `meshValue(mesh, 'mesh'|'points')`, read with `asMesh(ctx.inputs.x)`.

**Attributes** (`Attribute {name, element, size 1..4, kind 'f32'|'i32', data}`; key = element + name; `STD` names): `P` point vec3 · `N` point|vertex vec3 · `uv`, `uv1..` vertex vec2 (or point) · `Cd` point|vertex vec4 RGBA (alpha is ordinary) · `pscale` float · `scale` vec3 · `orient` vec4 quaternion · `pivot` vec3 · `id` int (point|primitive) · `island` int (primitive) · `age` float · any custom float/int/vec. Defaults on merge: orient identity, scale / pscale 1, Cd white, else 0. `resolveToVertex(name)` expands point / primitive / detail attributes to per-vertex.

**Copy-on-write**: arrays are shared between meshes. `clone()` shares everything and owns nothing; `writable(el,name)` copies a shared array once and returns an array you may mutate; `setAttr` adopts (owns) an array; `shareAttr` adopts without owning. `freeze()` (done by `meshValue`) makes a mesh immutable: nodes MUST `clone()` an input before editing. `version` is globally unique per content state (cache key for viewport geometry / GPU mirrors); `bounds()` is cached per version; `bytes` counts the arrays.
**Memory**: `MeshResource` (ref-counted, starts at refCount 0 = floating; the evaluator retains outputs) accounts CPU bytes ONCE per distinct typed array through `MemoryManager.addExternal('mesh', …)` (same budget, shown in the meter, `ensureRoom` first => `OutOfBudgetError` -> error badge). Viewport display buffers are accounted as `'viewport'`. GPU mirror (`resource.gpu()`): lazily uploads `positions` (array<vec4f> per point), `vertPoint`, `triangles` (u32) and any attribute (`attribute(name, element)`) into pooled buffers (STORAGE | VERTEX | INDEX | COPY), released with the resource.
**CPU vs GPU decision** (v1): all geometry operations are CPU TypedArray loops (point-wise math, topology edits, scatter); measured / targeted ~1M points per op in the low hundreds of ms, interactive for <= 250k. No Web Worker yet (hook: ops are pure functions of frozen inputs; see STATUS "Remaining"). GPU is used for the buffer mirror and rendering; compute-based point math is future work. **Hard caps** (`MESH_LIMITS`, `checkMeshLimits`, MeshBuilder): 4M points, 16M vertices, 8M primitives, 768 MB per mesh -> `MeshLimitError` (error badge) BEFORE allocating.
**Camera pin** (`camera`, new PinType): `CameraData {position, target, up, fovY, ortho, orthoSize, near, far, roll}` as `DataValue` (`cameraValue`, `asCamera`, `cameraBasis`).
**Nodes** (category `geometry` / `camera`, no Texture tab: `common.texture:false`): `geometry.shapes`, `.points_shape`, `.transform` (+ `.transform_points`), `.merge` (+ `.merge_points`), `.copy_to_points`, `.copy_transform`, `.uv`; `camera.camera`, `camera.look_at`. Param conventions: positions in world units (vec3), rotations Euler degrees (vec3), seeds `P.seed`.
**3D gizmo declarations** (additions to `GizmoDecl`, backward compatible): `point3d{param}`, `radius3d{center?,radius}`, `axis3d{origin?,direction,length?}`, `transform3d{position?,rotation?,scale?,uniform?,pivot?}`, `box3d{position,size}` (existing), `spline3d{param}` (SplineValue: x, y + `attrs.z/scale/twist/hinz/houtz`), `falloff3d{center?,inner,outer}`. All bind to params; the viewport writes through `ParamGesture` (one undo step per drag). Implementation: `src/gizmos3d/` (pure core + models + controller + Canvas2D overlay renderer).

## 14. Mesh nodes
**Texture sampling in mesh nodes**: `NodeDefinition.cpuTextureInputs?: string[]` (texture input pin ids), `EvalContext.cpuTexture?(pin): CpuTexture | null`, `cpuTexturePending?(pin)`. `CpuTexture {width, height, channels 1|2|3|4, data Float32Array}` (<= 512 px), sample with `sampleTex / sampleChannel` (mesh v UP, wraps). Null = pending: return a neutral result, the node is re-run automatically.
**Attributes written by the mesh nodes** (conventions used by animation and export): Sweep -> point `Cd`, `age` (0..1 along length), `pscale` (profile scale); Noise -> optional point `noise`; Extract Points -> `id`, `orient` (from N), optional `pscale`, `age` (islands); Bake pivots -> point `pivot`, `pivot_offset`, `id`, primitive `island`, optional vertex `uv<n>` (pivot xy) / `uv<n+1>` (pivot z, island id) normalised to the mesh bounds; Normals -> vertex `tangent` vec4; Bake animation -> detail `bake_frames` (i32) + `recorderOf(nodeId)`.
**Param ids** (stored in projects, never rename): see each `definition.ts`; Sweep `spline` = SplineValue with 3D points (`x`, `y`, `attrs.z / scale / twist / hinz / houtz`), `profile_spline` = 2D SplineValue in the UV unit square.


## 12. Subgraphs, assets, presets
- **Instance node type** `subgraph.<defId>` (defId matches `sg_[a-z0-9_]+`). Pins = boundary nodes of the definition (pin id = boundary node id, order = `order` param). Params = `exposed[]` (`ExposedParam{id,node,param,label,group,min,max,default,tooltip}`), cloned from the inner `ParamDef`. All input pins are optional.
- **Flattening** (`Evaluator.preprocess`): inner ids are `<instance>~<inner>` (nested `a~b~c`); ordinary node ids are unchanged; results are also stored under the user's original target keys; `EvalResult.errors / stats` contain the instance id for inner failures.
- **Project v2**: `subgraphs: SubgraphDefData[]`, `assets: AssetRecord[]` (`{id,name,mime,size,kind,width?,height?,triangles?}`), `assetBlobs: {id: base64}`. Param type `asset` stores `{assetId, name}` and is read with `ctx.params.asset(id)`.
- **Presets / libraries**: `NodePreset` (see `engine/presets/presets.ts`); bundle `{format:'kekenik-library', version:1, presets, subgraphs, curves?, gradients?}` (`.kvlib`); subgraph file `{format:'kekenik-subgraph', version:1, root, defs}` (`.kvsg`).
- **Samples** are `SampleDef`s (`src/samples/index.ts`); regression fixtures: `tests/fixtures/samples.json`.

## 15. Vector pin
- `PinType 'vector'` (texture pin, `TexturePin`): a **signed, unclamped, 2-channel float field**. Unit = **tile fractions per second** (1.0 = one full tile width / height per second; x right, y DOWN like image space). Neutral value = `(0, 0)`: an unconnected optional Vector pin means "no vector". It is NOT a UV warp (UV pins are absolute / offset lookups in [0,1]).
- Metadata: `TextureValue.vecScale?` (default 1). `1` = tile fractions / second; **Motion vectors** carry `1 / fps` (tile fractions per FRAME). Conversion nodes read it.
- Storage: `rg16float` (default); `rg32float` when the graph bit depth is 32 / High precision. rg32float is not filterable: every Vector consumer uses `textureLoad` + manual bilinear (never `textureSample` on a vector texture).
- **Only Vector -> Vector connects** (`canConnect` unchanged: Gray -> Color is still the only implicit conversion). Explicit nodes (all stateless, tiling-aware, `src/nodes/utils/*`): `utils.uv_to_vector` (UV absolute / offset -> Vector, `amount` = tile fraction of a saturated offset), `utils.vector_to_uv` (inverse, `uv_out` absolute / offset), `utils.vector_visualize` (Vector -> Color: colour wheel, angle = hue, magnitude = value; arrows variant), `utils.vector_magnitude` (-> Gray), `utils.vector_direction` (-> Gray, angle / 360), `utils.divergence` and `utils.curl` (Vector -> Gray, central differences with wrap).
- Pin colour `PIN_COLORS.vector`; graph editor pins, thumbnails (`kind 1` = rg), Node Gallery, project files (`"vector"` is just the pin string) and i18n (pin names / tooltips, Persian terms in `shared/i18n-fa-sim.ts`) know the type.
- 2D viewport: Vector display = colour wheel (angle = hue, |v| / range = value) with arrows and streamline (line integral convolution) overlays; the pixel inspector shows `Vx Vy |V| angle`. A simulation node's other outputs can be overlaid on any displayed image (settings `overlay`: arrows / streamlines of `velocity`, heat of `pressure` / `divergence` / `curl`).

## 16. Simulation framework
Nodes stay pure functions of (params, inputs, time) for the evaluator. A **simulation node** (`NodeDefinition.simulation = true`, usually `timeDependent` + `lazyOutputs`) only ASKS `SimulationService` (`engine.sims`, found by nodes through `simFor(ctx.gpu)`) for the snapshot of the frame it must show: `svc.request(spec: SimSpec, frame, encoder) -> SimView`.
- **`SimSpec`**: `key` (hash of everything that invalidates: sim params, animation, upstream signatures, resolution), optional `staticKey` + `signatures()` (animated-param signature per simulated frame, for partial invalidation), `cfg: SimConfig` (fps, speed, warmup, loop mode / length / blend, cache bytes, input scale), `lazy` (producer of every connected lazy input pin), `create(deps) -> SimulationBackend`, `size` (resolved sim resolution for the readout).
- **`SimulationBackend`** (the contract an implementation provides; Fluid 2D is the first): `stateBytes`, `state(): GpuTexture[]` (the persistent ping-pong state, pooled via `MemoryManager`, counted in the memory budget), `reset(enc, inputs)`, `step(enc, k, forcing, inputs)` (ONE simulated frame = `substeps` fixed steps; `k < 0` during warm-up), `settle()` (async measurement, a pure function of the state), `copyState`, `blend` (loop crossfade of two snapshots), `hud()`, `dispose()`. `outputs` are produced by the node's `evaluate()` from the returned snapshot as normal pins (Gray, Color, Vector, Normal ...), only for pins that are linked or targeted (`ctx.wants(pin)`).
- **Determinism**: `dt = (1/fps) * speed / substeps` (`stepDt`), seeded hashes only, sub-steps chosen from the previous state (CFL) — never from wall-clock, frame rate or interaction. Frame `k` depends only on `S(k-1)` and the params / inputs AT frame `k`. Same project + same frame = same result (tests: `tests/sim-core.test.ts`, selftest `9A · ... re-simulation == first run`).
- **Timeline**: output frame `f` exists only after `0..f` were simulated. Playback needs one new frame per frame. Scrubbing forward simulates the missing frames in time-sliced exclusive chunks (`chunkMs`, status `Simulating n%`, `cancel()`); scrubbing backward restores the **nearest cached snapshot <= target** and re-simulates. Nothing is simulated for a node nobody evaluates (only `request()` queues work) unless **Bake** was pressed.
- **Cache** (`SimCache`, one per node): an entry is BOTH an output frame and a full-state snapshot, i.e. a restart point. Entries whose index is a multiple of `K` (and the initial state, index -1) are **pinned checkpoints**; `K = chooseCheckpointInterval(totalFrames, stateBytes, budget)` is chosen automatically so pinned entries use at most half the budget. Budget = `min(node param cache_mb, 30 % of the global memory budget share)`. **Eviction order**: (1) unpinned, unprotected frames, least recently used first; (2) unpinned protected frames (loop blend frames `0..B-1`), highest index first; (3) thin the checkpoints (`K` doubles, non-multiples dropped); (4) refuse the newcomer ("Over budget"). The frames on screen (`hold`) are never evicted. `usedBytes <= budgetBytes` always. Memory pressure (`MemoryManager` evictor) drops unpinned frames of all simulations first. Per-node usage is shown in the node UI, the HUD and the Console (`Simulation "<name>": cache a / b MB, n frames (checkpoint every K), e evictions`).
- **Invalidation**: a changed `key` is applied after a debounce (`debounceMs`, and never while the user drags); meanwhile the last valid cache is shown with a "Resimulating..." badge. Changes that only touch ANIMATED params invalidate from the first simulated frame whose animated values differ (`planInvalidation`; S(k) depends on frames <= k); changes inside the warm-up or in static params invalidate everything. **Bake** simulates every loop frame and LOCKS the cache (no eviction, upstream edits no longer trigger re-simulation, live solver state is freed); **Unbake** unlocks. Reset / Resimulate drop everything.
- **Housekeeping** (`SimulationService.trim`, every 10 s): a node that does not exist in the graph any more is forgotten after 30 s (baked: 5 min, undo window); a node nobody evaluated for 30 s frees its live solver state (cache stays; the next request restores the nearest snapshot and re-simulates deterministically).
- **Looping** (`loopPlan`): `None`; `Crossfade` with loop length L and blend B simulates frames `0..L+B-1`, output frame `t < B` = `lerp(sim(L+t), sim(t), t/B)` (scalar fields lerp, vectors blend direction and magnitude separately, `blendVector`), `B..L-1` plain `sim(t)`; `Periodic forcing`: emitters / forces see `forcingFrame(k) = k mod L` and the boundary should be periodic. `verifySeam(nodeId)` reports the mean absolute difference between output frame L-1 and 0 and its ratio to a normal frame step.
- **Warm-up**: `warmup` frames (negative `k`) before frame 0, not shown, snapshot at index -1.
- **Failure safety**: any pipeline / memory failure sets the badge to `Error` / `Over budget`, logs to the Console and the node keeps showing its last valid frame (or black); nothing throws into the render loop. Device loss -> `sims.clear()` (state dropped, specs kept, re-simulated on demand).
- **Export hook**: `sims.prepareFrame(graph, targets, time, {token})` (called by image / viewport jobs) and `sims.settle(frame)` (flipbook baker) advance simulations in order inside the cache budget before the real evaluation; frames are produced sequentially with checkpoint restarts, never beyond the budget. No-op for graphs without simulation nodes.
- **Limits**: only fragment passes, <= 6 sampled textures per pass, one render target, 1 uniform buffer, no storage textures / compute: default WebGPU limits. Sim resolution is independent from the graph resolution (`limitSimResolution`: device `maxTextureDimension2D`, memory share) and the output is resampled with a quality filter (`out_filter`).

## 17. vector fields, motion vectors, grid simulations (normative; all additions are backward compatible)
- **Vector units**: generators write **tile fractions per second** (`vecScale` 1). Motion vectors (`vector.motion_generate`, Fluid 2D `motion`) carry `vecScale = 1 / fps` and are **tile fractions of ONE cell per flipbook frame** (x right, y down). Consumers that integrate (`vector.advect`, `vector.particles`, `vector.lic`, `vector.streamlines`) read `vecScale` and convert (`perSecond = 1 / vecScale`).
- **Flipbook value** (`TextureValue`-independent `DataValue`, `dataValue('flipbook', meta, textures)`): `FlipbookMeta { tex, cols, rows, frames, fps?, padding?, rowOrder?, cellW?, cellH?, loop?, ready? }` plus the motion extras `motionScale?` (max displacement / cell size, the encoding scale), `occ?` (Gray sheet, same layout: forward / backward inconsistency, 1 = occluded) and `kind?: 'motion'`. A motion flipbook has the **same sheet size and cell grid as its colour flipbook**, so one `rect` addresses both. Reader: `asFlipbook()` in `vector/motion_generate/definition.ts`.
- **Motion encoding** (`vector.motion_encode`, `export.motion_vector`, CPU mirror `encodeMotion` / `decodeMotion` in `_shared/vectorref.ts`): `e = (v.x, v.y * (flipY ? -1 : 1)) / scale`; neutral encoding `0.5 + 0.5 * e` clamped to [0, 1], signed encoding `e`; quantisation (8 / 16 bit) is applied inside the shader so a file equals what the node shows. `MOTION_CONVENTIONS` (`unreal.flipY = true`, others false) are starting values; see EXPORT_GUIDE section 9.
- **Sidecar** `*.motion.json` / the `motionVectors` block of the flipbook JSON (`motionVectorMeta`, `export/image-job.ts`): `{ scale, encoding: 'neutral-0.5' | 'signed', convention, yDown, units, channels, sheet?: { grid, frames, fps, loop, frameOrder } }`.
- **Grid simulations** (`_shared/simgrid.ts`, `gridSimNode(spec)`): a `GridSimSpec` supplies `params`, lazy input pins, `outs`, `simSource` / `outSource` (WGSL, `#if PASS == n` / `#if OUT == n`) and `init` / `step` recorders. Built-in uniform fields of the sim shader (always present, in this order): `seed_b, frame, k, sub, nsub, dt, dt_frame, time, periodic_b, sim_res, has_<lazy pin>...` then every non-`out_` param; the output shader gets `wrap, filt, sim_res, fps`, the `out_*` params and `outExtra`. **Every pass must receive a value for every field** (`packUniforms` throws `Missing uniform "<name>"`); where a pass is only compiled (prewarm) use `zeroUniforms(layout)`.
- **Spline set output** (`simulation.lightning`, `engine/spline/lightning.ts` `boltToSplines`): one open, corner-mode spline per channel, points `{ x, y, w }` in tile space (`w` = per-point width), main channel first; the hard point cap is `MAX_SEGMENTS` (192) segments in the mask shader and a bounded generator. Flicker seeds repeat with the loop length (`flickerSeed`).
- **Points output** (`vector.particles`): a `Points` mesh value identical in attributes to `particle.emitter` (shared look params), count <= `max_points`, total integration work <= `MAX_TOTAL_STEPS` (16 M steps).
- New ids (version 1, param ids are stable): see `docs/NODE_REFERENCE.md` for the full list. No existing node id, param id or pin type changed.
