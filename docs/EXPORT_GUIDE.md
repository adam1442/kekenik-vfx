# Kekenik VFX — Export Guide

Everything leaves the app through **Export nodes** that you run from the **Export panel** (*Export checked*, *Export all*,
*Export selected*, per-node *Run*). The code lives in `src/export/` (encoders, jobs, queue, targets) and `src/nodes/export/*`
(one node per kind). Parameter ids are stored in project files and are stable.

## 1. Export nodes

| Node | Input | Writes |
|---|---|---|
| `export.color` | Color | PNG / TGA / EXR / HDR / DDS, single frame, image sequence or **flipbook sheet** |
| `export.mask` | Gray | 8 / 16-bit gray PNG, TGA, EXR, HDR; sequences / flipbooks |
| `export.multimask` | up to 4 Gray (+ optional Color per slot) | **Channel-packed** RGBA: any source into any of R, G, B, A |
| `export.normal` | Normal | Normal maps, **OpenGL / DirectX** convention switch, XYZ or XY(+Z reconstructed) layouts |
| `export.warp` | UV | Flow / warp textures: biased (0.5 = no motion) or offset codec, flip Y, range scale |
| `export.motion_vector` | Vector | **Motion vectors**: 16-bit PNG / EXR (R = X, G = Y), neutral-0.5 or signed, Unreal / Unity / Godot Y convention, `scale`, JSON sidecar (section 9) |
| `export.mesh` | Mesh | GLB, glTF + .bin, OBJ, PLY; mesh flipbooks, **VAT** (soft / rigid), **pivot-baked** meshes |
| `export.viewport` | – | 2D or 3D viewport as image / sequence: transparent background, supersampling, **3×3 tiling preview**, **turntable** |

Common settings (tab *Export*): *Include in "Export all"*, **File name** template, **Engine preset**, **Format**, **Bit depth**,
**Color space**, *Write alpha*, *Premultiplied alpha*, *Colour dilation* (mip-safe edge padding), size override
(*From graph / multiplier / absolute*, 1 … 16384 px, non-square and non-power-of-two allowed), frames and flipbook layout.

### File name templates
Tokens: `{graph} {node} {frame} {frame:4} (zero padded) {index} {w} {h} {date} {time} {engine} {format} {channel}`. Defaults:
`{graph}_{node}` and `{graph}_{node}_{frame:4}` for sequences. Names are sanitised and de-duplicated; VAT adds `_pos` / `_nrm` /
`_rot` suffixes.

## 2. Image formats (`src/export/encoders/`)

| Format | Depths | Notes |
|---|---|---|
| **PNG** | 8, 16 | Streaming encoder, adaptive row filter, sRGB / gAMA chunks, tEXt comment |
| **TGA** | 8 | Uncompressed, top-left origin flag, TGA 2.0 footer; 2-channel data is converted to RGB |
| **EXR** | half, float | Scanline, **ZIP (16 lines)** or none; channel names derived from the channel count |
| **HDR** | float | Radiance RGBE, RGB only |
| **DDS** | 8, 16, half, float | Uncompressed DX10 header (no mips, no block compression), sRGB DXGI formats; 3-channel data is padded to RGBA |

Encoders are *streaming*: they receive Float32 rows already in the final transfer domain (display-referred 0…1 for integer
outputs, linear for half / float) and write to a `ByteSink`, so peak memory is one strip, not the whole image.

**sRGB / linear**: *Auto* = colour textures sRGB, data textures (masks, normals, warps, packed) linear. The flag is written to
the file where the format has one (PNG sRGB chunk, DDS format) — set the matching import option in your engine.

## 3. Flipbooks and sequences

- *Frame mode*: **Single**, **Sequence** (one file per frame), **Flipbook** (grid sheet).
- *Frame count 0* = the graph's loop length. First frame and FPS come from the graph / timeline; rendering uses
  `evaluate(graph, targets, { time: frame / fps })`, so every keyframe and animated parameter is applied.
- Grid: *Columns / Rows* (0 = auto, near-square), *Cell edge padding*, *Row order* (top-down / bottom-up). Non-square sheets
  and non-square cells are supported (e.g. 8×4 of 256×512).
- Optional **JSON metadata** (`cols, rows, frames, fps, padding, rowOrder, loop`) and optionally every frame as its own file.
- Seamless loops: author the loop as in the [User Guide §4](USER_GUIDE.md#4-tiling-and-looping-workflow); the last frame is *not*
  a duplicate of the first (frame count N covers t = 0 … (N−1)/N of the loop), which is what engines expect for looping flipbooks.
- RGBA-packed atlases: feed *Multimask* or *RGBA Merge* into the Color export; custom atlases come from *Sheet Encode*.

## 4. Engine presets (`src/export/engines.ts`)

An engine preset only supplies **defaults** for conventions left on *engine* / *auto*; explicit node settings always win.

| | Unreal | Unity | Godot | None |
|---|---|---|---|---|
| Normal Y | DirectX (green down) | OpenGL (green up) | OpenGL | OpenGL |
| Flow Y flip | no | yes | no | no |
| Texture size hint | power of two, multiple of 4 | multiple of 4 | multiple of 4 | – |
| Mesh axes | Z up, left handed, X forward, **cm (×100)** | Y up, left handed, m | glTF Y up, right handed | as authored (Z up) |
| Default colour format | PNG | PNG | PNG | PNG |

The Export panel lists **validation issues** before running (missing inputs, depth / format combinations that do not exist,
non power-of-two for Unreal, estimated GPU / RAM / file size). Ready-made recipes are in the **Preset** menu
(`src/export/presets.ts`, e.g. *Unreal · Flipbook 8×8, 2048*, *Unity · Normal map*, *Godot · Flowmap*, *Flipbook · EXR half*,
*Viewport · Turntable 120 frames*) — applying one is a single undo step.

## 5. Mesh export (`src/export/mesh/`)

- **Formats**: GLB / glTF (+ .bin) with positions, normals, several UV sets, vertex colours and custom attributes (`_NAME`),
  OBJ, PLY. Axis / handedness / unit conversion come from the engine preset or explicit settings (winding is flipped when the
  conversion mirrors the mesh).
- **Mesh flipbook**: all frames in one mesh (constant topology required; a byte cap and a memory-budget check protect you).
- **VAT soft body**: position (and optional normal) textures, one row per vertex, one column per frame, **bounds metadata JSON**
  (`format: kekenik-vat`: frames, fps, duration, loop, rows, `textureSize`, `bounds.min / max`, position / normal / rotation
  encoding, reconstruction formula, coordinate system, unit scale, file names, UV channel to sample with). Formats: EXR half / float (raw
  values), PNG 16 / 8 (normalised by the bounds). *Store offset from frame 0* switches position storage to offsets.
- **VAT rigid body**: per-piece pivot + rotation quaternion per frame (rows = pieces), fitted from the animated points.
- **Pivot-baked mesh**: per-island pivots written to UV (or colour) so a shader can rotate / scale pieces around their pivots.

## 6. Viewport export

2D or 3D view as **image or image sequence**; transparent background, **supersampling**, **3×3 tiling preview**
(2D), **turntable** (3D: N frames, degrees, elevation, framed automatically from the mesh bounds, or through a Camera node).

## 7. Large exports and memory safety

- Outputs beyond the device limits or the memory budget are rendered in **tiles with a halo** (nodes with global dependencies —
  Distance, Glow, Auto Crop, Transform, Lattice — are rendered in one piece or at reduced scale and the panel says so) and
  read back in strips with `mapAsync` (never blocking the UI).
- **Targets**: a folder via the File System Access API (Chrome / Edge; files stream to disk), or a download (single file or a
  chunked ZIP). Download buffers have a hard cap and fail with a clear message instead of exhausting RAM.
- Jobs can be **paused, resumed and cancelled**; a cancelled job releases all GPU memory immediately.
- Stress coverage: the GPU test harness (`src/selftest/perf.ts`, development server only) covers repeated readbacks without leaks, a 4K chain and graceful 8K degradation; `src/selftest/export.ts` holds known-answer round trips of every encoder.

## 8. Import settings per engine (cheat sheet)

- **Unreal**: Colour → sRGB on; Masks / packed / Normal → sRGB off, compression *Masks* / *Normalmap*; flipbook in a material
  with *Flipbook* node using the JSON cols / rows; VAT: import GLB, use the exported JSON bounds in the VAT material function.
- **Unity**: Colour → sRGB on; masks / packed → sRGB off; Normal → *Normal map*; flowmaps → sRGB off. Flip Y is already applied by
  the preset.
- **Godot**: Normal map → *Detect 3D → Normal Map*; masks → *VRAM Compressed* with sRGB off; GLB imports directly.

## 9. Motion vectors (flipbook frame interpolation)

Workflow: `Sheet Encode` (e.g. 12 frames, looping) -> `Motion Vector Generate` -> `Motion Vector Interpolate` (e.g. 48 frames) -> `Export Color` for the smoothed flipbook; `Motion Vector Generate` -> `Motion Vector Encode` (or straight into `Export Motion Vector`) for the vector flipbook. The vector flipbook has **the same sheet size, grid and frame order as the colour flipbook** (row-major, top-left first, `row_order` of the Sheet Encode node), so one UV rect addresses both.

**Encoding.** A vector `v` (tile fractions of one cell per flipbook frame, x right, **y down**) is stored as `e = v / scale` (Y negated when the convention says so): *neutral* `0.5 + 0.5 e` (0.5 = no motion, clamped to [0, 1]) for 8 / 16-bit PNG, or *signed* `e` for EXR / float. `scale` = the largest representable length; Motion Vector Generate writes it as `max displacement / cell size` (shown in the Encode node tooltip), and the sidecar repeats it. Decode in the shader: `v = (texel - 0.5) * 2 * scale` (neutral) or `texel * scale` (signed), Y flipped back.

| Convention | Encoded Y | Starting point for the engine setup |
|---|---|---|
| Unreal | **negated** (`yDown: false`, positive = up) | Flipbook / motion-vector material function: sample both sheets with the same frame UV, offset the colour lookup by `+/- (t) * v * scale`; texture settings: no sRGB, no mips or *Masks* compression, 16-bit PNG or EXR |
| Unity | not negated (`yDown: true`) | Shader Graph: two Sample Texture 2D nodes with the frame UV; sRGB off; flowmap-style `(texel - 0.5) * 2 * scale` |
| Godot | not negated (`yDown: true`) | Spatial shader `texture()` with the frame UV; import with *Compress: Lossless / VRAM (sRGB off)* |
| Custom | `Flip Y` switch | whatever your shader expects |

These are **starting values** (engines differ between versions and between flipbook materials): export one sheet, test it in the engine and flip *Flip Y* if the motion runs vertically backwards. Use **16-bit** (or EXR / signed float) - 8-bit quantisation limits sub-pixel motion to `scale / 128` tile fractions.

**Runtime interpolation in the engine** (what the vectors are for): for a time `t` between frame A and B, sample A at `uv - t * v_A * scale` and B at `uv + (1 - t) * v_A * scale` (backward-warped lookups) and lerp with weight `t`; where the occlusion mask (optional second sheet, `Occlusion` pin of Generate) is high, fall back to a plain cross-fade.

**Sidecar JSON** (`<name>.motion.json` for single images / sequences, the `motionVectors` block inside the flipbook JSON):

```json
{ "format": "kekenik-motion-vectors", "version": 1, "size": [2048, 2048], "depth": 16,
  "motionVectors": { "scale": 0.0625, "encoding": "neutral-0.5", "convention": "unreal", "yDown": false,
    "units": "tile fractions of one cell per flipbook frame", "channels": "R = X, G = Y",
    "sheet": { "grid": [8, 6], "frames": 48, "fps": 60, "loop": true, "frameOrder": "row-major, top-left first" } } }
```

`sheet` is present when *Sheet columns* is set on the node (Export tab: frame mode *Single*, size = the sheet size). `Motion Vector Interpolate` multiplies `fps` by the frame-count ratio (12 -> 48 frames: 4x), keep the same duration.
