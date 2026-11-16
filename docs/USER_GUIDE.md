# Kekenik VFX — User Guide

Kekenik VFX is a browser-based, node-based tool for authoring real-time game VFX assets: tiling noises and masks, flipbooks,
flow / warp maps, normal maps, channel-packed textures and VFX meshes (beams, shockwaves, ribbons, VAT …). Everything is live:
every node has a preview, everything animates on a timeline and loops.

> The in-app **Help panel (F1)** shows the same node reference as [NODE_REFERENCE.md](NODE_REFERENCE.md) (generated from the
> node definitions, always in sync), the live shortcut list and a quick start.

## 1. Requirements

- A browser with **WebGPU**: Chrome / Edge 113+, Safari 18+, or Firefox with WebGPU enabled, and an up-to-date GPU driver.
  There is no WebGL fallback. If WebGPU is missing you get a screen with diagnostics and a **Copy diagnostics** button.
- The app is a set of static files: open `index.html` from any web server (or `npm run preview`). It makes **no network calls** at
  runtime. Install it as an app (PWA) for offline use when served over http(s).
- GPU trouble (black panels, driver crashes)? Add **`?safe`** to the URL: the 3D viewport, node gallery and flipbook editor
  are replaced by a placeholder (enable them one by one), thumbnails and the shader warm-up are off.

## 2. Quick start (5 minutes)

1. **Add nodes** – press **Tab** (or right-click) in the Graph Editor and type a node name (`noise`, `ramp`, `blur` …).
   **Ctrl+K** opens the command palette for every command.
2. **Connect** – drag from an output pin to an input pin. Pin colours show the type: gray, color, normal, uv, mesh, points …
   Gray → Color converts implicitly; everything else is explicit (use *RGBA Merge*, *Color to Normal* …).
3. **Look** – select a node and the 2D Viewport follows it. Drag any parameter: the preview drops to a lower resolution while
   you drag and refines when you let go (see §8).
4. **Shape** – nodes with spatial parameters show **gizmos** in the viewport (points, circles, arcs, splines, transforms).
   Dragging a gizmo writes the parameter and is one undo step.
5. **Animate** – right-click a parameter → *Add keyframe*. The **Timeline** holds the keys, the **Curve Editor** shapes the easing.
6. **Export** – add an *Export* node, pick an engine preset in the **Export** panel (Unreal / Unity / Godot) and press *Export all*.

## 3. Concepts

| Concept | What it means |
|---|---|
| **Pin types** | Gray (1 channel), Color (RGBA), Normal (RGB), UV (2 channels, a warp field), Mesh, Points, Flipbook (texture + grid + frame metadata). Alpha is *not* special: any value can be packed in any channel of a Color. |
| **Texture tab** | Every texture node: **Size** (From Graph / From Parent / Absolute; W,H are multipliers or pixels), **Filtering**, **Tiling** (None / Both / Horizontal / Vertical) and **HQ** supersampling. Defaults inherit from the input (*From Parent*). |
| **Blending tab** | Appears when the optional **Background** pin is connected: blend type (copy, add, multiply, screen, overlay, smooth-min …) and *Cross mix* (0 % = background, 50 % = pure blend, 100 % = foreground). |
| **Modulation** | Float parameters marked *modulatable* get an optional `<param> mod` Gray pin and a *modulation intensity* (0 % = ignore, 100 % = multiply, negative = inverted): vary a value per pixel. |
| **Bypass / identity** | **B** toggles bypass. Nodes whose parameters make them an identity (e.g. Blur radius 0) are skipped by the engine — they cost nothing. |
| **Graph settings** | Default size, tiling, filtering, bit depth (16 / 32-bit float), FPS, loop length, seed. |

## 4. Tiling and looping workflow

Seamless tiles and loops are first-class — every generator and filter respects the node's **Tiling** mode.

**Tiling textures**
1. Set *Tiling* on the graph (toolbar) or on the node (Texture tab). Noise lattices become periodic, filters sample with wrap.
2. Use the 2D Viewport's **3×3 tiling preview** to check seams. The Export node *Viewport* can render that preview as an image.
3. Noise scale on a tiling axis is rounded to an integer number of cells (otherwise the pattern cannot wrap).
4. Avoid non-periodic operations after the tiling generators (Transform with rotation, Lattice with large offsets) unless the node
   itself has a *Tiling* option; the *Tile* node repeats an image N×N.

**Looping animation**
1. Set *loop length* (frames) and FPS in the graph settings. The Timeline repeat / loop shows the range.
2. Noise: animate **Evolution** from 0 → 1 over the loop (periodic Z axis → seamless). Key it **linear** with *cycle with offset*
   extrapolation, or use the *Match loop* command on the curve.
3. Scrolling: animate offsets by **whole tiles** per loop (1 tile / loop = perfect loop).
4. Rotation: whole turns per loop (±1, ±2 …). Pulses: use a sine / ease curve whose first and last key are equal.
5. **Check**: export a flipbook with *Loop* on; the last frame crossfades to the first when asked, and the Flipbook Editor
   plays it back.

## 5. Gizmos

A node *declares* gizmos bound to its parameters; the 2D and 3D viewports draw them and write changes through the undo system.

- Drag a handle to edit. Modifiers: **Ctrl / Cmd** snaps to the grid / angle step (magnetic guides at 0, ½, 1 always pull
  within a few pixels), **Shift** locks to the dominant axis / keeps uniform scale and aspect, **Alt** scales from the centre
  (scale gizmos) or breaks handle symmetry (splines).
- Numeric fields appear while a gizmo is active (X / Y in UV or pixels) for exact values.
- Spline gizmos: click to add points, drag handles for tangents, per-point width / attributes in the Properties panel.
- 3D gizmos (point, radius, axis, transform, box, spline, falloff) live in the 3D Viewport.

## 6. Subgraphs, presets and the library

- Select nodes → **Ctrl+G** (*Make Subgraph*): cut links become Inputs / Outputs, and you can **promote parameters** to the
  instance. **Alt+↓** enters a subgraph, the breadcrumb exits. Subgraphs nest; recursion is detected and reported.
- Any node can be saved as a **preset** (searchable in *Presets / Assets*). Curves and gradients have shareable preset folders.
  Libraries export as `.kvlib`, single subgraphs as `.kvsg`.
- **Import**: drop PNG / JPG / WEBP / TGA / HDR / EXR images and GLB / glTF / OBJ models on the window (or **Ctrl+I**). Huge files
  are downscaled while decoding (default cap 4096) and big OBJ files are parsed off the main thread.
- The **Start screen** (Ctrl+Shift+H) has animated sample projects: fire orb, lightning, shockwave, sword swipe, energy beam,
  magic circle, tornado, flipbooks …

## 7. Exporting to Unreal, Unity and Godot

See [EXPORT_GUIDE.md](EXPORT_GUIDE.md) for the full reference. In short:

| Engine | Colour | Normal map | Flow / warp | Mesh | Notes |
|---|---|---|---|---|---|
| **Unreal** | PNG 8 sRGB (or EXR half) | **DirectX** (green down) | PNG 16 biased | GLB, Z-up, cm | Power-of-two + multiples of 4 for flipbooks (warnings are shown) |
| **Unity** | PNG 8 sRGB | **OpenGL** (green up) | PNG 16, Flip Y | GLB, Y-up left handed | Untick *sRGB* for masks / packed textures |
| **Godot** | PNG 8 sRGB | **OpenGL** | PNG 16 biased | GLB, Y-up | Import normal maps with *Detect 3D → Normal Map* |

Workflow: add an Export node (*Color*, *Mask*, *Multimask* for channel packing, *Normal*, *Warp*, *Mesh*, *Viewport*) → connect →
open **Export** → choose the preset → **Export all**. Large outputs (8K+) are rendered in tiles and streamed to a folder
(File System Access API, Chrome / Edge) or a chunked ZIP download; peak memory stays bounded.

## 8. Performance and memory (what the app does for you)

- **Adaptive preview**: while you drag, the evaluation resolution is chosen so a drag stays under the budget (default 8 ms).
  *Settings → Quality & memory* sets the starting preview quality, the budget, and the GPU memory budget.
- **Caching**: results are cached by (params + input versions). Unchanged branches are never recomputed; during playback only
  time-dependent nodes re-run, and a bounded frame cache replays loops for free.
- **Profiler** (Window → Profiler): per-node GPU / CPU time, memory timeline, pool and cache hit rates, pipeline compile times.
  **F3** toggles the Performance HUD overlay.
- **Memory pressure**: on an out-of-memory error or budget overflow the app drops caches, then halves the preview resolution and
  tells you with a toast. It never crashes the tab. *Command palette → Free GPU Memory* drops caches manually.
- **Shader errors** show in the Console with the node name and WGSL line numbers; the node gets an error badge and the rest of
  the graph keeps working.

## 9. Projects, autosave and recovery

- `.kvfx` files are versioned JSON (assets embedded). Older projects are migrated on load.
- **Autosave** writes to IndexedDB (interval in Settings → Project), keeps a backup slot and an integrity checksum. After a crash
  the app offers to recover.
- **Damaged files** are repaired where possible (truncated JSON is closed, broken nodes / links are dropped) and the Console lists
  every repair. A file from a *newer* app version is refused with a clear message instead of being corrupted.
- Closing the tab with unsaved changes asks for confirmation.

## 10. Keyboard shortcuts

See [KEYBOARD_SHORTCUTS.md](KEYBOARD_SHORTCUTS.md) (or press **Ctrl+/** in the app). Everything can be rebound in Settings → *Keyboard shortcuts*.

## 11. Accessibility and display

- Reduced motion is honoured (OS setting or *Settings → Reduce motion*). The accent colour keeps WCAG contrast on panels.
- HiDPI: canvases render at device pixel ratio. UI scale 60–180 % in Settings. Touch / pen: panels and viewports use pointer events
  (`touch-action` is set so dragging does not scroll the page).
- Strings live in one table (`src/shared/i18n.ts`) so the UI can be localised; English is the first locale.

## 12. Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 13. Samples
The Home screen (first start, or **Home** in the menu) is the sample gallery. Pick a category chip (Fire & Smoke, Magic, Energy, Weapons & Slashes, Water & Wind, Lightning, Environment, Tiling Textures, Flipbooks, Meshes, Simulation, Beginner), type to search by name, tag or **node** (for example "fluid" or "sweep"), and sort by name, newest or difficulty. Use the arrow keys to move, **Enter** to open, **/** to jump to the search box.

The right pane shows what the sample is, how hard it is, its features (loops, tileable, mesh, simulation, flipbook, export-ready), the nodes it uses, the resolution and the estimated memory, and a short **How to adapt** note.
- **Open as copy** (default): an unsaved copy named "<sample> (copy)". Samples are read-only templates: save the copy under your own name.
- **Open**: the sample itself, still as an unsaved project.
- **Show in graph tour**: a copy with numbered comment frames around the key nodes.

Samples open at 256–512 px (the texture-focused Sprite Pack at 1024) and simulation samples use Draft–Balanced quality. Nothing runs until you select a node, so opening is instant. Thumbnails are generated in the background the first time (only for cards you can see) and cached; **Regenerate thumbnails** rebuilds them. Without WebGPU you see gradient placeholders.

Every sample is a clean left-to-right graph: coloured groups (Inputs / Shape / Motion / Color / Output), comment frames in your language, animation that loops where the sample is a flipbook, and **preconfigured Export nodes** (flipbook grid, channel-packed mask, normal, distortion warp, mesh, motion vectors). Mesh samples preselect the mesh and the additive material in the 3D viewport. Start with **Hello Nodes** and **Tiling Check**, then open Campfire (simulation + flipbook) or Energy Beam Mesh (Sweep with a custom Profile).

