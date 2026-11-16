# Kekenik VFX — Node Reference

_Generated from the node definitions by `npm run docs:nodes` — 223 nodes. Do not edit by hand._

## Contents

- **Camera** (2): Camera, Look At
- **Color** (9): Adjust, Blackbody / Temperature Ramp, Fractal (Color), Hue Spread, Interpolate, Premultiply Alpha, Ramp, Replace Color, Uniform Color
- **Export** (8): Export Color, Export Mask, Export Mesh, Export Motion Vector, Export Multimask, Export Normal, Export Viewport, Export Warp
- **Geometry** (35): Accumulate, Bake, Bounds, Combine Color, Combine Color (Points), Combine Scale, Combine Scale (Points), Combine Transform, Combine Transform (Points), Copy To Points, Copy and Transform, Delete By Mask, Extract Points, Merge Vertices, Merge, Merge (Points), Noise, Noise (Points), Normals, Points Shape, Promote, Shapes, Space Warp, Space Warp (Points), Spline Combine, Spline Resample, Spline Shape, Spline to Points, Spline Transform, Subdivide, Sweep, Transform, Transform (Points), Triangulate, UV
- **Grayscale** (20): Ambient Occlusion, Caustics, Curvature, Curve, Dilate, Filter, Fractal, Gradient, Lightning, Noise, Polar Scatter, Ripple / Shockwave, Rune Ring, Shape, Slice, Spline, Starburst / Glint, Threshold, Uniform, XDoG
- **Import** (3): Flipbook (Import), Model (Import), Texture (Import)
- **Islands** (6): Islands Generate, Islands Padding, Islands To Color, Islands To Gradient, Islands To Grayscale, Islands To UV
- **Normal** (6): Color to Normal, Normal Combine, Normal Create, Normal Merge, Normal Split, Normal to Color
- **Particle** (3): Emitter, Point Attributes, 2D Render
- **Simulation** (7): Dissolve / Burn Front, Diffusion / Heat, Flow Advection Simulation, Fluid 2D, Lightning, Reaction Diffusion, Wave Simulation
- **Subgraphs** (12): Input (Color), Input (Gray), Input (Mesh), Input (Normal), Input (Points), Input (UV), Output (Color), Output (Gray), Output (Mesh), Output (Normal), Output (Points), Output (UV)
- **Utils** (72): Alpha Merge, Alpha Split, Auto Crop, Auto Crop (Color), Bilateral Filter, Bilateral Filter (Color), Blend, Blend (Color), Blur, Blur (Color), Cartesian to Polar, Cartesian to Polar (Color), Chromatic Aberration, Color to UV, Copy and Transform, Copy and Transform (Color), Curl, Denoise, Denoise (Color), Directional Blur, Directional Blur (Color), Dissolve Over Time, Distance, Divergence, Edge Detect, Edge Detect (Color), Fluid Advect, Fluid Advect (Color), FXAA, FXAA (Color), Glow, Glow (Color), Grid, HSVA to RGBA, Kaleidoscope, Kaleidoscope (Color), Anisotropic Kuwahara, Anisotropic Kuwahara (Color), Lattice, Lattice (Color), Levels, Levels (Color), Light Pack (Fake Lighting), Math, Multi Blend, Multi Blend (Color), Multi Switch, Multi Switch (Color), Polar to Cartesian, Polar to Cartesian (Color), Radial Blur, Radial Blur (Color), RGB to Grayscale, RGBA Merge, RGBA Split, RGBA to HSVA, Sheet Decode, Sheet Encode, Softblend, Softblend (Color), Tile, Tile (Color), Transform, Transform (Color), UV Merge, UV Split, UV to Color, UV to Vector, Vector Direction, Vector Magnitude, Vector to UV, Vector Visualize
- **UV** (12): UV Blend, UV Blur, Cartesian to Polar (UV), UV Directional, UV Flow, UV From Grayscale, UV Identity, UV Noise, UV Radial, UV Rotational, UV Spline, UV Transform
- **Vector** (28): Vector Adjust, Vector Advect, Vector Advect (Color), Vector Blur / Smooth, Vector Combine, Vector Compose, Vector Decompose, Vector From Gray, Vector From Normal, LIC (Line Integral Convolution), Vector Motion Blur, Vector Motion Blur (Color), Motion Vector Encode / Decode, Motion Vector Generate, Motion Vector Interpolate, Vector Noise, Vector Noise Warp, Vector Particles, Vector Divergence-Free Project, Vector Radial, Vector Spline, Vector Stats, Vector Streamlines, Vector Transform, Vector Uniform, Vector Vortex, Vector Warp, Vector Warp (Color)

## Camera

### Camera

`camera.camera` · Camera · GPU trivial, tiling pixel

Position, target, field of view (or orthographic height), clip planes and roll. Pick it in a 3D viewport (Camera menu) to look through it; Viewport export and turntables (Export) use it. Z up.

**Gizmos:** Camera (point3d, 3d); Target (point3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Camera (`camera`) | camera |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Camera | Position (`position`) | vec3 | [4, -6, 3.2] | -20 … 20 | ● |  |
| Camera | Target (`target`) | vec3 | [0, 0, 0.6] | -20 … 20 | ● |  |
| Camera | Orthographic (`ortho`) | bool | false |  |  |  |
| Camera | Field of view (`fov`) | float (angle) | 40 | 1 … 170 | ● |  |
| Camera | Ortho height (`ortho_size`) | float | 4 | 0.001 … 10000 | ● |  |
| Camera | Roll (`roll`) | float (angle) | 0 | -180 … 180 | ● |  |
| Camera / Clipping | Near (`near`) | float | 0.05 | 0.0001 … 1000 |  |  |
| Camera / Clipping | Far (`far`) | float | 500 | 0.01 … 1000000 |  |  |

### Look At

`camera.look_at` · Camera · GPU trivial, tiling pixel

Aims the input camera at a target point, or at the bounds centre of a connected mesh (optionally framing it by distance). Without an input camera it uses its own position. Keeps the camera distance unless "Distance" is set.

**Gizmos:** Target (point3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Camera (`camera`) | camera | optional |
| in | Mesh (`mesh`) | mesh | optional · When connected and "Target mesh bounds" is on, the target is the bounds centre. |
| out | Camera (`camera`) | camera |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Look At | Target mesh bounds (`use_mesh`) | bool | true |  |  | Use the bounds centre of the connected mesh as the target. |
| Look At | Target (`target`) | vec3 | [0, 0, 0] | -20 … 20 | ● |  |
| Look At | Position (`position`) | vec3 | [4, -6, 3.2] | -20 … 20 | ● | Used only when no camera is connected. |
| Look At | Distance (`distance`) | float | 0 | 0 … 10000 | ● | 0 keeps the current distance; otherwise the camera is placed this far from the target along its current direction. |
| Look At | Frame mesh (x radius) (`frame_margin`) | float | 1 | 0 … 20 |  | With a mesh and Distance = 0: distance = mesh radius x this value / tan(fov/2). 0 disables framing. |

## Color

### Adjust

`color.adjust` · Color · GPU trivial, tiling pixel · identity short-cut

Hue, saturation, value, brightness, contrast, gamma, exposure and tint of a Color. Hue / saturation work in OKLab (perceptual); everything is HDR safe and alpha is untouched. Optional Gray mask.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Mask (`mask`) | gray | optional · Optional Gray mask: where it is 0 the colour stays unchanged. |
| in | Hue mod (`hue_mod`) | gray | optional · modulation · Modulates "Hue" per pixel. |
| in | Saturation mod (`saturation_mod`) | gray | optional · modulation · Modulates "Saturation" per pixel. |
| in | Brightness mod (`brightness_mod`) | gray | optional · modulation · Modulates "Brightness" per pixel. |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Color | Hue (`hue`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the hue (OKLab chroma plane). |
| Main / Color | Hue modulation (`hue_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Color | Saturation (`saturation`) | float (percent) | 1 | 0 … 16 | ● |  |
| Main / Color | Saturation modulation (`saturation_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Color | Value (`value`) | float (percent) | 1 | 0 … 64 | ● | Multiplies the RGB values. |
| Main / Tone | Brightness (`brightness`) | float | 0 | -16 … 16 | ● | Added to RGB. |
| Main / Tone | Brightness modulation (`brightness_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Tone | Contrast (`contrast`) | float | 1 | 0 … 8 | ● | Power about 18% gray (linear). |
| Main / Tone | Gamma (`gamma`) | float | 1 | 0.05 … 8 | ● |  |
| Main / Tone | Exposure (`exposure`) | float | 0 | -16 … 16 | ● | Stops: RGB * 2^EV. |
| Main / Tint | Tint (`tint`) | color | [1, 0.6, 0.3, 1] |  | ● | RGB multiplier (alpha ignored). |
| Main / Tint | Tint amount (`tint_amount`) | float (percent) | 0 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Blackbody / Temperature Ramp

`color.blackbody` · Color · GPU trivial, tiling pixel

Turns a Gray temperature map into HDR fire colours: Kelvin range, emission curve (hot = bright > 1), tint, alpha from temperature and an optional tonemap preview. The core of every flame, explosion and ember.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Temperature (`input`) | gray | required · 0 = cold / transparent, 1 = hottest. |
| in | Intensity mod (`intensity_mod`) | gray | optional · modulation · Modulates "Intensity" per pixel. |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Temperature | Kelvin at 0% (`kelvin_min`) | float | 1000 | 1000 … 40000 |  | Colour temperature of the coolest visible value (1000 K = deep red). |
| Main / Temperature | Kelvin at 100% (`kelvin_max`) | float | 4200 | 1000 … 40000 | ● | Temperature of the hottest value (4200 K yellow-white, 6500 K white, 9000 K blue-white). |
| Main / Temperature | Temperature curve (`temp_curve`) | float | 1 | 0.2 … 4 |  | Power applied to the input before the Kelvin mapping (above 1 pushes the mid body towards red). |
| Main / Emission | Emission curve (`emission_curve`) | float | 1.6 | 0 … 6 |  | Brightness = Intensity * value^curve: hot areas glow, cool areas fade to black. |
| Main / Emission | Intensity (`intensity`) | float | 3 | 0 … 64 | ● | HDR emission multiplier (the core exceeds 1). |
| Main / Emission | Intensity modulation (`intensity_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Emission | Tint (`tint`) | color | [1, 1, 1, 1] |  | ● | Multiplies the colour (variants: green fire, blue fire ...). |
| Main / Alpha | Alpha mode (`alpha_mode`) | enum | temperature | opaque, temperature |  |  |
| Main / Alpha | Alpha from (`alpha_lo`) | float | 0.02 | 0 … 1 |  |  |
| Main / Alpha | Alpha to (`alpha_hi`) | float | 0.35 | 0 … 1 |  |  |
| Main / Preview | Filmic tonemap (LDR preview) (`tonemap`) | bool | false |  |  | Compresses HDR values to 0..1 for previews / LDR export. Leave off for EXR / additive engines. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Fractal (Color)

`color.fractal` · Color · GPU high, tiling pixel

The splat Fractal with colour per splat: pick colours from a gradient (random or by splat profile) or random hues. Everything else (shapes, octaves, Z loop, UV, modulation pins, tiling) is identical to the Gray Fractal.

**Gizmos:** Fractal transform (transform, 2d); Scale range (range, 2d); Intensity range (range, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input Pattern (`pattern`) | gray | optional · Gray pattern splatted instead of the built-in shape. Set "Atlas size" above 1x1 to treat it as an atlas of elements. |
| in | UV (`uv`) | uv | optional · Optional UV map: aligns / deforms the fractal (see the UV tab). |
| in | Z position mod (`z_position_mod`) | gray | optional · modulation · Modulates "Z position" per pixel. |
| in | Atlas mod (`atlas_pick_mod`) | gray | optional · modulation · Modulates "Atlas" per pixel. |
| in | Blending ramp mod (`ramp_mod`) | gray | optional · modulation · Modulates "Blending ramp" per pixel. |
| in | Gain mod (`gain_mod`) | gray | optional · modulation · Modulates "Gain" per pixel. |
| in | UV mod (`uv_amount_mod`) | gray | optional · modulation · Modulates "UV" per pixel. |
| in | Scale mod (`size_mod`) | gray | optional · modulation · Modulates "Scale" per pixel. |
| in | Intensity mod (`intensity_mod`) | gray | optional · modulation · Modulates "Intensity" per pixel. |
| in | Visibility mod (`visibility_mod`) | gray | optional · modulation · Modulates "Visibility" per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Main | Position (`position`) | vec2 | [0, 0] | -1 … 1 |  | Moves the pattern. The pattern repeats every 100% translation. |
| Main / Main | Grid scale (`scale`) | vec2 | [4, 4] | 1 … 256 |  | Grid cells across the image on the first octave. Rounded to whole numbers on tiling axes so the pattern wraps seamlessly. |
| Main / Main | Seed (`seed`) | seed | 0 |  |  |  |
| Main / Main | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the grid. While the graph tiles it snaps to 90 degree steps. |
| Main / Main | Anisotropy (`anisotropy`) | float (percent) | 0 | -1 … 1 | ● | + squeezes the pattern horizontally, - vertically. Ignored while the graph tiles (it would break seamlessness). |
| Main / Z axis | Add Z axis (`add_z`) | bool | false |  |  | Gives every splat a life along Z: its attributes are re-rolled per Z layer and interpolated between layers. |
| Main / Z axis | Z position (`z_position`) | float (percent) | 0 | -100 … 100 | ● | 0% and 100% give the same pattern, so animating 0 -> 100% loops seamlessly. |
| Main / Z axis | Z position modulation (`z_position_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Z axis | Z layers (`z_layers`) | int | 3 | 1 … 32 |  | Number of independent slices along Z (interpolated). More layers = more change per loop. |
| Fractal / Shape | Shape (`shape`) | enum | cone | cone, pyramid, polygon, star, pixel |  |  |
| Fractal / Shape | Sides (`sides`) | int | 5 | 3 … 32 |  |  |
| Fractal / Shape | Rounding (`rounding`) | float (percent) | 0 | 0 … 1 |  |  |
| Fractal / Shape | Secondary size (`secondary`) | float (percent) | 0.4 | 0.02 … 1 |  | Inner radius of the star (pinching). |
| Fractal / Shape | Inner filling (`inner`) | float (percent) | 0 | 0 … 0.99 |  | Flat plateau in the middle of the splat (0% = pointed). |
| Fractal / Atlas | Atlas size (`atlas_size`) | vec2 | [1, 1] | 1 … 16 |  | Elements of the input pattern when it is an atlas. |
| Fractal / Atlas | Atlas (`atlas_pick`) | float (percent) | 0 | 0 … 1 |  | Offset added to the element choice. Connect "Atlas mod": its intensity blends from a random element per splat (0%) to the element chosen by the texture (100%). |
| Fractal / Atlas | Atlas modulation (`atlas_pick_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Fractal / Shape | Shape remap (`shape_curve`) | curve | curve (2 keys) |  |  | Luminance curve applied over the splat profile. |
| Fractal / Splats | Splat blending (`splat_blend`) | enum | max | add, max |  | How overlapping splats inside one octave combine. |
| Fractal / Splats | Max smoothness (`max_smooth`) | float (percent) | 0 | 0 … 1 |  |  |
| Fractal / Octaves | Octaves (`octaves`) | int | 3 | 1 … 8 |  | Number of grid refinements. |
| Fractal / Octaves | Lacunarity (`lacunarity`) | float | 2 | 1.1 … 8 |  | Grid size ratio between octaves. While tiling only whole numbers keep the grid periodic (it is rounded). |
| Fractal / Octaves | Octave blending (`octave_mode`) | enum | fbm | add, max, fbm, mix, multiply, screen |  |  |
| Fractal / Octaves | Blending ramp (`ramp`) | float (percent) | 1 | 0 … 1 | ● | Weight of the octave blend (Mix / Multiply / Screen). Unavailable for fBm and Max. |
| Fractal / Octaves | Blending ramp modulation (`ramp_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Fractal / Octaves | Gain (`gain`) | float (percent) | 0.5 | -2 … 2 | ● | Amplitude change per octave. Negative values alternate / invert octaves. |
| Fractal / Octaves | Gain modulation (`gain_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| UV / UV | Align to UVs (`uv_align`) | enum | per_pixel | ignore, per_splat, per_pixel |  |  |
| UV / UV | UV (`uv_amount`) | float (percent) | 1 | 0 … 4 |  | UV distortion amount for the whole texture. |
| UV / UV | UV modulation (`uv_amount_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Orientation | Rotation min (`rot_min`) | float (angle) | 0 | -3600 … 3600 |  |  |
| Splats / Orientation | Rotation max (`rot_max`) | float (angle) | 0 | -3600 … 3600 |  |  |
| Splats / Orientation | Flip horizontal (`flip_h`) | float (percent) | 0 | 0 … 1 |  | Chance that a splat is mirrored horizontally. |
| Splats / Orientation | Flip vertical (`flip_v`) | float (percent) | 0 | 0 … 1 |  | Chance that a splat is mirrored vertically. |
| Splats / Size | Scale min (`scale_min`) | float (percent) | 0.6 | 0 … 4 |  | 100% = the splat fills its cell. |
| Splats / Size | Scale max (`scale_max`) | float (percent) | 1 | 0 … 4 |  |  |
| Splats / Size | Horizontal scale min (`hscale_min`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Horizontal scale max (`hscale_max`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Vertical scale min (`vscale_min`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Vertical scale max (`vscale_max`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Scale (`size`) | float (percent) | 1 | 0 … 4 | ● | Global splat scale multiplier (modulated at each splat centre). |
| Splats / Size | Scale modulation (`size_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Position | Position randomization (`pos_random`) | float (percent) | 1 | 0 … 2 |  | 0% = regular grid. |
| Splats / Position | H/V randomization scale (`pos_scale`) | vec2 | [1, 1] | 0 … 2 |  |  |
| Splats / Position | Quincunx (`quincunx`) | enum | none | none, rows, columns |  | Offsets every other row / column by half a cell (bricks). Tiling rounds the grid to an even count on that axis. |
| Splats / Visibility | Intensity min (`int_min`) | float (percent) | 0.5 | -1 … 4 |  |  |
| Splats / Visibility | Intensity max (`int_max`) | float (percent) | 1 | -1 … 4 |  |  |
| Splats / Visibility | Intensity (`intensity`) | float (percent) | 1 | 0 … 4 | ● | Global intensity multiplier (modulated at each splat centre). |
| Splats / Visibility | Intensity modulation (`intensity_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Visibility | Visibility (`visibility`) | float (percent) | 1 | 0 … 1 | ● | Overall chance that a splat is visible. With a modulation texture the intensity acts as a threshold. |
| Splats / Visibility | Visibility modulation (`visibility_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Visibility | Visibility transition width (`vis_width`) | float (percent) | 0 | 0 … 1 |  | Width of the fade between hidden and visible (0% = hard on/off). |
| Color / Splat color | Color source (`color_mode`) | enum | gradient | gradient, hue, profile |  |  |
| Color / Splat color | Gradient (`color_gradient`) | gradient | gradient (3 stops) |  | ● |  |
| Color / Splat color | Hue min (`hue_min`) | float (percent) | 0 | -4 … 4 |  | 100% = a full turn of the colour wheel. |
| Color / Splat color | Hue max (`hue_max`) | float (percent) | 1 | -4 … 4 |  |  |
| Color / Splat color | Saturation (`col_sat`) | float (percent) | 0.85 | 0 … 1 |  |  |
| Color / Splat color | Value (`col_val`) | float (percent) | 1 | 0 … 4 |  |  |
| Color / Output | Color gain (HDR) (`color_gain`) | float | 1 | 0 … 64 | ● |  |
| Color / Output | Alpha (`alpha_mode`) | enum | opaque | opaque, coverage |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Hue Spread

`color.hue_spread` · Color · GPU trivial, tiling pixel

Spreads hue across a range using a Gray id or pattern (e.g. Islands -> Gray). Shift mode rotates the input hue, Set mode assigns the hue. Optional quantisation and repeats.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | optional · Colour to shift. Unconnected: "Base color". |
| in | Id (`id`) | gray | required · Gray value 0..1 that selects the position inside the hue range. |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Hue | Base color (`base`) | color | [0.9, 0.2, 0.1, 1] |  | ● |  |
| Main / Hue | Mode (`mode`) | enum | set | shift, set |  |  |
| Main / Hue | Hue start (`hue_start`) | float (angle) | 0 | -3600 … 3600 | ● | Hue at id = 0. |
| Main / Hue | Hue range (`hue_range`) | float (angle) | 360 | -3600 … 3600 | ● | Hue distance covered when id goes from 0 to 100%. |
| Main / Id | Quantize (`quantize`) | int | 0 | 0 … 256 |  | 0 = continuous; N = N discrete hues. |
| Main / Id | Repeat (`repeat`) | float | 1 | 0.01 … 256 | ● | Repeats the id before mapping (> 1 wraps). |
| Main / Output | Saturation (`saturation`) | float (percent) | 1 | 0 … 4 | ● | Shift mode: multiplier. Set mode: absolute saturation. |
| Main / Output | Value (`value`) | float (percent) | 1 | 0 … 16 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Interpolate

`color.interpolate` · Color · GPU trivial, tiling pixel

Mixes two colours or two Color textures (A, B) by a Gray mask. The mask can be remapped with a curve; mixing in linear RGB or OKLab.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | A (`a`) | color | optional · Colour at mask = 0. Unconnected: "Color A". |
| in | B (`b`) | color | optional · Colour at mask = 100%. Unconnected: "Color B". |
| in | Mask (`mask`) | gray | required |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Colors | Color A (`color_a`) | color | [0.02, 0.02, 0.1, 1] |  | ● |  |
| Main / Colors | Color B (`color_b`) | color | [1, 0.5, 0.05, 1] |  | ● |  |
| Main / Mix | Mix space (`space`) | enum | linear | linear, oklab |  |  |
| Main / Mix | Mask curve (`curve`) | curve | curve (2 keys) |  | ● | Remaps the mask before mixing. |
| Main / Mix | Amount (`amount`) | float (percent) | 1 | 0 … 4 | ● | Scales the mask. |
| Main / Mix | Invert mask (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Premultiply Alpha

`color.premultiply` · Color · GPU trivial, tiling pixel

Premultiply, unpremultiply, bake alpha into emission (additive) or force opaque: choose the alpha convention of an export deliberately. HDR-safe.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Alpha | Mode (`mode`) | enum | premultiply | premultiply, unpremultiply, additive, opaque |  |  |
| Main / Alpha | Epsilon (`epsilon`) | float | 0.0001 | 0 … 0.1 |  | Alpha below this is treated as 0 when unpremultiplying. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Ramp

`color.ramp` · Color · GPU trivial, tiling pixel

Gradient map: converts a Gray input to Color through an editable gradient (linear / smooth / OKLab / step, alpha is a normal stop channel, preset library with folders).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Gradient | Gradient (`gradient`) | gradient | gradient (5 stops) |  | ● | Linear RGBA stops. The preset button stores / loads gradients in shareable folders. |
| Main / Input | Input low (`in_low`) | float | 0 | -16 … 16 | ● |  |
| Main / Input | Input high (`in_high`) | float | 1 | -16 … 16 | ● |  |
| Main / Input | Offset (`offset`) | float | 0 | -64 … 64 | ● | Scrolls the gradient (loops every 100% with Repeat wrap). |
| Main / Input | Repeat (`repeat`) | float | 1 | 0.01 … 64 | ● |  |
| Main / Input | Wrap (`wrap_mode`) | enum | clamp | clamp, repeat, mirror |  |  |
| Main / Output | Intensity (`intensity`) | float | 1 | 0 … 64 | ● | Multiplier of RGB (HDR); alpha untouched. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Replace Color

`color.replace` · Color · GPU trivial, tiling pixel

Replaces a source colour by a new colour. Tolerance and softness are OKLab distances; optionally keeps the lightness variation of the original. Second output: the replacement mask.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| out | Output (`output`) | color |  |
| out | Mask (`mask`) | gray | How strongly each pixel matched the source colour. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Replace | Source color (`source`) | color | [0.8, 0.1, 0.05, 1] |  | ● |  |
| Main / Replace | New color (`target`) | color | [0.05, 0.4, 1, 1] |  | ● |  |
| Main / Match | Tolerance (`tolerance`) | float | 0.12 | 0 … 2 | ● | OKLab distance that is replaced completely. |
| Main / Match | Softness (`softness`) | float | 0.12 | 0 … 2 | ● | Extra distance over which the replacement fades out. |
| Main / Match | Ignore lightness (`ignore_lum`) | bool | false |  |  | Match hue / chroma only. |
| Main / Result | Keep lightness (`keep_lightness`) | float (percent) | 1 | 0 … 1 |  | Keeps the lightness difference between the pixel and the source colour. |
| Main / Result | Strength (`strength`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Uniform Color

`color.uniform` · Color · GPU trivial, tiling pixel

A constant colour (linear, HDR capable: the colour picker has an intensity multiplier). Alpha is a normal channel. Resolution, filtering and tiling come from the Texture tab.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Intensity mod (`intensity_mod`) | gray | optional · modulation · Modulates "Intensity" per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Color | Color (`color`) | color | [0.8, 0.35, 0.08, 1] |  | ● | Linear RGBA. Use the picker's intensity for HDR values above 1. |
| Main / Color | Intensity (`intensity`) | float | 1 | 0 … 64 | ● | Multiplier of the RGB channels (not alpha). |
| Main / Color | Intensity modulation (`intensity_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

## Export

### Export Color

`export.color` · Export · GPU trivial, tiling pixel

Writes a Color texture (RGBA) as PNG / TGA / EXR / HDR / DDS: sRGB or linear, 8 / 16-bit or float, optional premultiplied alpha, size override, image sequences and flipbook sheets with padding and JSON metadata. Use the Export panel to run it.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Color (`input`) | color | required |
| out | Export (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node} |  |  | Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders. |
| Export / Output | Engine preset (`engine`) | enum | none | none, unreal, unity, godot |  | Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot. |
| Export / Output | Format (`format`) | enum | png | png, tga, exr, hdr, dds |  |  |
| Export / Output | Bit depth (`depth`) | enum | 8 | 8, 16, half, float |  | PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged). |
| Export / Output | Color space (`color_space`) | enum | auto | auto, srgb, linear |  | EXR / HDR are always linear. Data textures (masks, normals, warps) should be linear. |
| Export / Output | Write alpha (`alpha`) | bool | true |  |  |  |
| Export / Output | Premultiplied alpha (`premultiply`) | bool | false |  |  | RGB is multiplied by alpha in linear light before the colour space encoding. |
| Export / Output | EXR compression (`exr_compression`) | enum | zip | zip, none |  |  |
| Export / Size | Size mode (`size_mode`) | enum | graph | graph, multiplier, absolute |  |  |
| Export / Size | Width / height multiplier (`size_mul`) | vec2 | [1, 1] | 0.01 … 64 |  |  |
| Export / Size | Width / height (px) (`size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  | Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles. |
| Export / Frames | Frame mode (`frame_mode`) | enum | single | single, sequence, flipbook |  |  |
| Export / Frames | First frame (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / Flipbook | Columns (0 = auto) (`fb_cols`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Rows (0 = auto) (`fb_rows`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Cell edge padding (px) (`fb_padding`) | int | 0 | 0 … 64 |  | Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding. |
| Export / Flipbook | Row order (`fb_row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Export / Flipbook | Write JSON metadata (`fb_json`) | bool | true |  |  |  |
| Export / Flipbook | Also write every frame as a file (`fb_files`) | bool | false |  |  |  |
| Export / Quality | Colour dilation (px) (`edge_padding`) | int | 0 | 0 … 64 |  | Bleeds colour into fully transparent pixels (mip-safe edges). Needs alpha. |

### Export Mask

`export.mask` · Export · GPU trivial, tiling pixel

Writes a Gray texture as a single-channel image (gray PNG / TGA / EXR "Y" / HDR), linear by default. Same size, frame, sequence and flipbook options as Export Color.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Gray (`input`) | gray | required |
| out | Export (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node} |  |  | Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders. |
| Export / Output | Engine preset (`engine`) | enum | none | none, unreal, unity, godot |  | Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot. |
| Export / Output | Format (`format`) | enum | png | png, tga, exr, hdr, dds |  |  |
| Export / Output | Bit depth (`depth`) | enum | 16 | 8, 16, half, float |  | PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged). |
| Export / Output | Color space (`color_space`) | enum | linear | auto, srgb, linear |  | EXR / HDR are always linear. Data textures (masks, normals, warps) should be linear. |
| Export / Output | Store as RGB (gray replicated) (`as_rgb`) | bool | false |  |  |  |
| Export / Output | EXR compression (`exr_compression`) | enum | zip | zip, none |  |  |
| Export / Size | Size mode (`size_mode`) | enum | graph | graph, multiplier, absolute |  |  |
| Export / Size | Width / height multiplier (`size_mul`) | vec2 | [1, 1] | 0.01 … 64 |  |  |
| Export / Size | Width / height (px) (`size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  | Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles. |
| Export / Frames | Frame mode (`frame_mode`) | enum | single | single, sequence, flipbook |  |  |
| Export / Frames | First frame (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / Flipbook | Columns (0 = auto) (`fb_cols`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Rows (0 = auto) (`fb_rows`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Cell edge padding (px) (`fb_padding`) | int | 0 | 0 … 64 |  | Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding. |
| Export / Flipbook | Row order (`fb_row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Export / Flipbook | Write JSON metadata (`fb_json`) | bool | true |  |  |  |
| Export / Flipbook | Also write every frame as a file (`fb_files`) | bool | false |  |  |  |

### Export Mesh

`export.mesh` · Export · GPU trivial, tiling pixel

Exports a mesh as GLB / glTF (positions, normals, several UV sets, vertex colours, custom attributes), OBJ or PLY with axis / handedness / unit conversion. Modes: single mesh, MESH FLIPBOOK (all frames in one mesh with frame attributes), VAT soft body (position + normal textures + JSON), VAT rigid body (pivot displacement + rotation), PIVOT-baked mesh (pivot in UV sets / vertex colour / attributes).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node} |  |  | Tokens: {graph} {node} {frame} {date} {time} {engine} {format}. VAT adds _pos / _nrm / _rot suffixes. |
| Export / Output | Mode (`mode`) | enum | mesh | mesh, flipbook, vat_soft, vat_rigid, pivot |  |  |
| Export / Output | Format (`mesh_format`) | enum | glb | glb, gltf, obj, ply |  |  |
| Export / Output | Engine preset (`engine`) | enum | none | none, unreal, unity, godot |  |  |
| Export / Coordinates | Axes / handedness (`axis`) | enum | engine | engine, zup, gltf, unity, unreal |  | Authoring space is Z up, +Y forward, right handed. Mirrored targets (Unity, Unreal) get reversed triangle winding. |
| Export / Coordinates | Unit scale (0 = engine default) (`unit_scale`) | float | 0 | 0 … 100000 |  | 1 authoring unit = 1 metre. Unreal default 100 (centimetres). |
| Export / Attributes | Normals (`normals`) | bool | true |  |  |  |
| Export / Attributes | Custom attributes (pscale, age, id ...) (`custom_attrs`) | bool | true |  |  | GLB / glTF: application-specific _NAME attributes + described in extras. PLY: float properties. OBJ: not stored. |
| Export / Frames | Frame (first frame) (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / VAT | Texture format (`vat_format`) | enum | exr_half | exr_half, exr_float, png16, png8 |  | EXR stores raw positions; PNG stores positions normalised by the bounds in the JSON. |
| Export / VAT | Store offset from frame 0 (`vat_offset`) | bool | false |  |  |  |
| Export / VAT | Write normal texture (`vat_normals`) | bool | true |  |  |  |
| Export / VAT | Loops (metadata) (`vat_loop`) | bool | true |  |  |  |
| Export / Pivot | Pivot position (`pivot_mode`) | enum | bounds | centroid, bounds, base, top |  | Used when the mesh has no `pivot` attribute yet (otherwise the Bake node data is used). |
| Export / Pivot | Pivot encoding (`pivot_encoding`) | enum | uv | attributes, uv, vertex_color |  |  |

### Export Motion Vector

`export.motion_vector` · Export · GPU trivial, tiling pixel

Writes a motion vector flipbook (Vector sheet) as 16-bit PNG or EXR, encoded for Unreal / Unity / Godot, plus a JSON sidecar with scale, grid, frame count and the convention.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | required |
| out | Export (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node} |  |  | Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders. |
| Export / Output | Engine preset (`engine`) | enum | none | none, unreal, unity, godot |  | Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot. |
| Export / Output | Format (`format`) | enum | png | png, tga, exr, hdr, dds |  |  |
| Export / Output | Bit depth (`depth`) | enum | 16 | 8, 16, half, float |  | PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged). |
| Export / Output | Color space (`color_space`) | enum | linear | auto, srgb, linear |  | EXR / HDR are always linear. Data textures (masks, normals, warps) should be linear. |
| Export / Output | Write alpha (`alpha`) | bool | true |  |  |  |
| Export / Output | Premultiplied alpha (`premultiply`) | bool | false |  |  | RGB is multiplied by alpha in linear light before the colour space encoding. |
| Export / Output | EXR compression (`exr_compression`) | enum | zip | zip, none |  |  |
| Export / Size | Size mode (`size_mode`) | enum | graph | graph, multiplier, absolute |  |  |
| Export / Size | Width / height multiplier (`size_mul`) | vec2 | [1, 1] | 0.01 … 64 |  |  |
| Export / Size | Width / height (px) (`size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  | Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles. |
| Export / Frames | Frame mode (`frame_mode`) | enum | single | single, sequence, flipbook |  |  |
| Export / Frames | First frame (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / Flipbook | Columns (0 = auto) (`fb_cols`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Rows (0 = auto) (`fb_rows`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Cell edge padding (px) (`fb_padding`) | int | 0 | 0 … 64 |  | Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding. |
| Export / Flipbook | Row order (`fb_row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Export / Flipbook | Write JSON metadata (`fb_json`) | bool | true |  |  |  |
| Export / Flipbook | Also write every frame as a file (`fb_files`) | bool | false |  |  |  |
| Export / Quality | Colour dilation (px) (`edge_padding`) | int | 0 | 0 … 64 |  | Bleeds colour into fully transparent pixels (mip-safe edges). Needs alpha. |
| Motion / Motion vectors | Scale (`mv_scale`) | float | 0.1 | 0.0001 … 100 |  | Vector length (tile fractions per frame) that maps to the full range; written to the sidecar. |
| Motion / Motion vectors | Engine convention (`mv_convention`) | enum | unreal | unreal, unity, godot, custom |  |  |
| Motion / Motion vectors | Flip Y (custom) (`mv_flip_y`) | bool | false |  |  |  |
| Motion / Motion vectors | Signed float (no 0.5 bias) (`mv_signed`) | bool | false |  |  | Use with EXR / float. |
| Motion / Vector flipbook | Sheet columns (`mv_cols`) | int | 0 | 0 … 256 |  | Exporting a vector flipbook sheet (Motion Vector Generate output, Export tab: frame mode Single, size = the sheet size)? Enter its grid so the sidecar JSON carries it. 0 = plain image. |
| Motion / Vector flipbook | Sheet rows (`mv_rows`) | int | 0 | 0 … 256 |  |  |
| Motion / Vector flipbook | Sheet frames (`mv_frames`) | int | 0 | 0 … 65536 |  | 0 = columns x rows. |
| Motion / Vector flipbook | Sheet FPS (`mv_fps`) | float | 30 | 1 … 1000 |  | Playback rate of the flipbook the vectors belong to. |

### Export Multimask

`export.multimask` · Export · GPU trivial, tiling pixel

Packs up to four sources into the R, G, B and A channels of ONE file. Per channel: source channel (R/G/B/A/luminance/0/1), levels (black / white / gamma) and invert. Use it for ORM / RMA / mask packs; the output is the packed texture.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | R source (`r`) | color | optional |
| in | G source (`g`) | color | optional |
| in | B source (`b`) | color | optional |
| in | A source (`a`) | color | optional |
| out | Packed (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Channels / R channel | Take channel (`r_source`) | enum | r | r, g, b, a, luma, zero, one |  |  |
| Channels / R channel | Value when unconnected (`r_default`) | float | 0 | -16 … 16 |  |  |
| Channels / R channel | Levels black (`r_black`) | float | 0 | -16 … 16 |  |  |
| Channels / R channel | Levels white (`r_white`) | float | 1 | -16 … 16 |  |  |
| Channels / R channel | Levels gamma (`r_gamma`) | float | 1 | 0.05 … 8 |  |  |
| Channels / R channel | Invert (`r_invert`) | bool | false |  |  |  |
| Channels / G channel | Take channel (`g_source`) | enum | r | r, g, b, a, luma, zero, one |  |  |
| Channels / G channel | Value when unconnected (`g_default`) | float | 0 | -16 … 16 |  |  |
| Channels / G channel | Levels black (`g_black`) | float | 0 | -16 … 16 |  |  |
| Channels / G channel | Levels white (`g_white`) | float | 1 | -16 … 16 |  |  |
| Channels / G channel | Levels gamma (`g_gamma`) | float | 1 | 0.05 … 8 |  |  |
| Channels / G channel | Invert (`g_invert`) | bool | false |  |  |  |
| Channels / B channel | Take channel (`b_source`) | enum | r | r, g, b, a, luma, zero, one |  |  |
| Channels / B channel | Value when unconnected (`b_default`) | float | 0 | -16 … 16 |  |  |
| Channels / B channel | Levels black (`b_black`) | float | 0 | -16 … 16 |  |  |
| Channels / B channel | Levels white (`b_white`) | float | 1 | -16 … 16 |  |  |
| Channels / B channel | Levels gamma (`b_gamma`) | float | 1 | 0.05 … 8 |  |  |
| Channels / B channel | Invert (`b_invert`) | bool | false |  |  |  |
| Channels / A channel | Take channel (`a_source`) | enum | r | r, g, b, a, luma, zero, one |  |  |
| Channels / A channel | Value when unconnected (`a_default`) | float | 1 | -16 … 16 |  |  |
| Channels / A channel | Levels black (`a_black`) | float | 0 | -16 … 16 |  |  |
| Channels / A channel | Levels white (`a_white`) | float | 1 | -16 … 16 |  |  |
| Channels / A channel | Levels gamma (`a_gamma`) | float | 1 | 0.05 … 8 |  |  |
| Channels / A channel | Invert (`a_invert`) | bool | false |  |  |  |
| Export / Output | Written channels (`slots`) | enum | rgba | rgba, rgb |  |  |
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node} |  |  | Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders. |
| Export / Output | Engine preset (`engine`) | enum | none | none, unreal, unity, godot |  | Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot. |
| Export / Output | Format (`format`) | enum | png | png, tga, exr, hdr, dds |  |  |
| Export / Output | Bit depth (`depth`) | enum | 8 | 8, 16, half, float |  | PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged). |
| Export / Output | EXR compression (`exr_compression`) | enum | zip | zip, none |  |  |
| Export / Size | Size mode (`size_mode`) | enum | graph | graph, multiplier, absolute |  |  |
| Export / Size | Width / height multiplier (`size_mul`) | vec2 | [1, 1] | 0.01 … 64 |  |  |
| Export / Size | Width / height (px) (`size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  | Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles. |
| Export / Frames | Frame mode (`frame_mode`) | enum | single | single, sequence, flipbook |  |  |
| Export / Frames | First frame (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / Flipbook | Columns (0 = auto) (`fb_cols`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Rows (0 = auto) (`fb_rows`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Cell edge padding (px) (`fb_padding`) | int | 0 | 0 … 64 |  | Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding. |
| Export / Flipbook | Row order (`fb_row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Export / Flipbook | Write JSON metadata (`fb_json`) | bool | true |  |  |  |
| Export / Flipbook | Also write every frame as a file (`fb_files`) | bool | false |  |  |  |
| Export / Quality | Colour dilation (px) (`edge_padding`) | int | 0 | 0 … 64 |  | Bleeds colour into fully transparent pixels (mip-safe edges). Needs alpha. |
| Export / Output | Color space (`color_space`) | enum | linear | linear, srgb |  |  |
| Export / Output | Premultiplied alpha (`premultiply`) | bool | false |  |  |  |

### Export Normal

`export.normal` · Export · GPU trivial, tiling pixel

Writes a normal map. Y convention OpenGL (Unity, Godot) or DirectX (Unreal) — "Engine" follows the engine preset. Layouts: full XYZ, XYZ with Z rebuilt from XY, or RG only (B = 0, for BC5 / two-channel imports). Always linear data.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Normal (`input`) | normal | required |
| out | Export (`output`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Export / Normal | Y convention (`convention`) | enum | engine | engine, opengl, directx |  |  |
| Export / Normal | Layout (`normal_layout`) | enum | xyz | xyz, reconstruct, rg |  |  |
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node} |  |  | Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders. |
| Export / Output | Engine preset (`engine`) | enum | none | none, unreal, unity, godot |  | Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot. |
| Export / Output | Format (`format`) | enum | png | png, tga, exr, hdr, dds |  |  |
| Export / Output | Bit depth (`depth`) | enum | 16 | 8, 16, half, float |  | PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged). |
| Export / Output | Color space (`color_space`) | enum | linear | auto, srgb, linear |  | EXR / HDR are always linear. Data textures (masks, normals, warps) should be linear. |
| Export / Output | EXR compression (`exr_compression`) | enum | zip | zip, none |  |  |
| Export / Size | Size mode (`size_mode`) | enum | graph | graph, multiplier, absolute |  |  |
| Export / Size | Width / height multiplier (`size_mul`) | vec2 | [1, 1] | 0.01 … 64 |  |  |
| Export / Size | Width / height (px) (`size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  | Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles. |
| Export / Frames | Frame mode (`frame_mode`) | enum | single | single, sequence, flipbook |  |  |
| Export / Frames | First frame (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / Flipbook | Columns (0 = auto) (`fb_cols`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Rows (0 = auto) (`fb_rows`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Cell edge padding (px) (`fb_padding`) | int | 0 | 0 … 64 |  | Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding. |
| Export / Flipbook | Row order (`fb_row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Export / Flipbook | Write JSON metadata (`fb_json`) | bool | true |  |  |  |
| Export / Flipbook | Also write every frame as a file (`fb_files`) | bool | false |  |  |  |

### Export Viewport

`export.viewport` · Export · GPU trivial, tiling pixel

2D: the Color input as a picture (optional 3x3 tiling preview, safe frames, background). 3D: renders the Mesh input with the Camera input (or a turntable) through the 3D viewport renderer, optional Color texture as material. Image or sequence, supersampled, transparent background. Export formats: PNG / TGA (8-bit).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Color (`color`) | color | optional |
| in | Mesh (`mesh`) | mesh | optional |
| in | Camera (`camera`) | camera | optional |
| out | View (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node}_{frame:4} |  |  |  |
| Export / Output | View (`source`) | enum | 3d | 2d, 3d |  |  |
| Export / Output | Format (`format`) | enum | png | png, tga |  |  |
| Export / Output | Resolution (px) (`size`) | vec2 | [1920, 1080] | 16 … 16384 |  |  |
| Export / Quality | Supersampling (`ss`) | enum | 2 | 1, 2, 3, 4 |  | Rendered at N times the resolution in tiles and box-filtered down: memory stays bounded. |
| Export / Quality | Transparent background (`transparent`) | bool | true |  |  |  |
| Export / Quality | Background colour (`background`) | color | [0.08, 0.09, 0.1, 1] |  |  |  |
| Export / 2D | 3x3 tiling preview (`tile3x3`) | bool | false |  |  |  |
| Export / 2D | Safe frames overlay (90% / 80%) (`safe_frames`) | bool | false |  |  |  |
| Export / 3D | Display (`display`) | enum | unlit | matcap, pbr, unlit, vertex_color, normals, wireframe |  |  |
| Export / 3D | Material blend (`blend`) | enum | additive | opaque, alpha, additive |  | How the Color input is shown on the mesh. |
| Export / Frames | Frame mode (`frame_mode`) | enum | single | single, sequence, turntable |  |  |
| Export / Frames | First frame (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / Frames | Turntable degrees (`turn_degrees`) | float | 360 | -3600 … 3600 |  |  |
| Export / Frames | Turntable elevation offset (`turn_elevation`) | float (angle) | 0 | -80 … 80 |  |  |

### Export Warp

`export.warp` · Export · GPU trivial, tiling pixel

Writes a UV warp / flowmap using the documented UV codecs: absolute lookup, signed offset (EXR / float), 0.5-neutral biased (8 / 16-bit flowmaps, Unreal / Unity / Godot) or direction + speed. A JSON file next to the image records the encoding and the range scale so engines can decode it exactly.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`input`) | uv | required |
| out | Export (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | UV input (`uv_in`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Export / Warp | Encoding (`codec`) | enum | biased | absolute, offset, biased, direction |  |  |
| Export / Warp | Range scale (`range`) | float (percent) | 0.1 | 0.0001 … 8 |  | Tile-space offset that maps to a fully saturated channel (neutral = 0.5). Written to the JSON. |
| Export / Warp | Vector means (`flow_sign`) | enum | flow | flow, lookup |  |  |
| Export / Warp | Vertical flip (`flip_y`) | enum | engine | engine, off, on |  |  |
| Export / Warp | Write encoding JSON (`write_json`) | bool | true |  |  |  |
| Export / Output | Include in "Export all" (`enabled`) | bool | true |  |  |  |
| Export / Output | File name (`file_name`) | string | {graph}_{node} |  |  | Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders. |
| Export / Output | Engine preset (`engine`) | enum | none | none, unreal, unity, godot |  | Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot. |
| Export / Output | Format (`format`) | enum | png | png, tga, exr, hdr, dds |  |  |
| Export / Output | Bit depth (`depth`) | enum | 16 | 8, 16, half, float |  | PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged). |
| Export / Output | Color space (`color_space`) | enum | linear | auto, srgb, linear |  | EXR / HDR are always linear. Data textures (masks, normals, warps) should be linear. |
| Export / Output | EXR compression (`exr_compression`) | enum | zip | zip, none |  |  |
| Export / Size | Size mode (`size_mode`) | enum | graph | graph, multiplier, absolute |  |  |
| Export / Size | Width / height multiplier (`size_mul`) | vec2 | [1, 1] | 0.01 … 64 |  |  |
| Export / Size | Width / height (px) (`size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  | Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles. |
| Export / Frames | Frame mode (`frame_mode`) | enum | single | single, sequence, flipbook |  |  |
| Export / Frames | First frame (`frame_start`) | int | 0 | -100000 … 100000 |  |  |
| Export / Frames | Frame count (0 = graph loop) (`frame_count`) | int | 0 | 0 … 4096 |  |  |
| Export / Flipbook | Columns (0 = auto) (`fb_cols`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Rows (0 = auto) (`fb_rows`) | int | 0 | 0 … 256 |  |  |
| Export / Flipbook | Cell edge padding (px) (`fb_padding`) | int | 0 | 0 … 64 |  | Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding. |
| Export / Flipbook | Row order (`fb_row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Export / Flipbook | Write JSON metadata (`fb_json`) | bool | true |  |  |  |
| Export / Flipbook | Also write every frame as a file (`fb_files`) | bool | false |  |  |  |

## Geometry

### Accumulate

`geometry.accumulate` · Geometry · time dependent · GPU trivial, tiling pixel

Creates trails: every `Step` seconds the input mesh is stored (at most `Max count` frames and `Max memory` MB, accounted in the shared memory budget) and the output merges the current mesh with the stored ones. Older copies fade (alpha), shrink and drift by a cumulative translate / rotate per step. Point attribute `age` = step / max count. History is rebuilt from the playhead: it resets on rewind, on a long jump and on any parameter change, so playing from the start always reproduces the same trail.

**Gizmos:** drift (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Accumulate | Max count (`max_count`) | int | 12 | 1 … 256 |  | Frames kept (including the current one). |
| Accumulate | Step (s) (`step_time`) | float | 0.05 | 0.0005 … 60 |  | Seconds between stored frames. |
| Accumulate | Include current frame (`include_current`) | bool | true |  |  |  |
| Accumulate | Max memory (MB) (`max_memory_mb`) | float | 64 | 1 … 1024 |  | Oldest frames are dropped beyond this cap. |
| Fade | Alpha decay / step (`decay`) | float (percent) | 0.15 | 0 … 1 |  |  |
| Fade | Scale per step (`scale_per_step`) | float | 1 | 0 … 4 |  |  |
| Drift | Translate per step (`translate`) | vec3 | [0, 0, 0] | -1 … 1 | ● |  |
| Drift | Rotate per step (`rotate`) | vec3 | [0, 0, 0] | -45 … 45 | ● |  |
| Drift | Pivot (`pivot`) | vec3 | [0, 0, 0] | -10 … 10 |  |  |

### Bake

`geometry.bake` · Geometry · time dependent · GPU trivial, tiling pixel

Freeze: holds the mesh the first time the playhead reaches `Freeze at` (change `Re-bake` to capture again). Texture: samples a texture at the UVs into a named vertex / point attribute. Pivots: one pivot per island written to `pivot`, `pivot_offset`, `id` (and optionally UV sets) for pivot-baked meshes. Record animation: stores the mesh of every frame slot (constant point count, memory capped and accounted in the shared budget) for the mesh flipbook / VAT exporter; the node passes the mesh through.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| in | Texture (`texture`) | color | optional · Texture to bake (Texture mode). |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Bake | Mode (`mode`) | enum | freeze | freeze, texture, pivots, animation |  |  |
| Bake | Freeze at (s) (`freeze_at`) | float | 0 | 0 … 100000 |  |  |
| Bake | Re-bake (change to capture again) (`rebake`) | int | 0 | 0 … 1000000 |  |  |
| Bake | Attribute name (`attribute`) | string | baked |  |  |  |
| Bake | Channels (`channels`) | enum | luma | r, g, b, a, luma, rgb, rgba |  |  |
| Bake | Write to (`element`) | enum | vertex | vertex, point |  |  |
| Bake | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Bake | Scale (`scale`) | float | 1 | -1000 … 1000 |  |  |
| Bake | Bias (`bias`) | float | 0 | -1000 … 1000 |  |  |
| Bake | Pivot position (`pivot`) | enum | bounds | centroid, bounds, base, top |  |  |
| Bake | Pivot to UV set (-1 off) (`pivot_uv_set`) | int | -1 | -1 … 6 |  | Writes pivot x,y (normalised to the bounds) to uv<n> and pivot z + island id to uv<n+1>. |
| Bake | Frames per second (`fps`) | int | 30 | 1 … 240 |  |  |
| Bake | Max memory (MB) (`max_memory_mb`) | float | 256 | 1 … 4096 |  | Recording stops (logged) beyond this cap. |
| Bake | Record normals (`normals`) | bool | true |  |  |  |

### Bounds

`geometry.bounds` · Geometry · GPU trivial, tiling pixel

Outputs the axis-aligned bounding box of the input as a box mesh (padding adds margin): a proxy for collision shapes, VAT bounds checks or fitting other nodes.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Bounds | Padding (`padding`) | float | 0 | -100 … 100 | ● |  |

### Combine Color

`geometry.combine_color` · Geometry · time dependent · GPU trivial, tiling pixel

Writes vertex colour (Cd, or any named RGBA attribute) from a Gray / Color texture sampled through the UVs, a colour gradient along an axis (gizmo) or along an attribute such as Sweep's `age`, 3D noise, a random colour per island, or a uniform colour. Each RGBA channel has its own write mask, and the result can be blended with the existing colour (copy, add, multiply, screen, overlay ...).

**Gizmos:** axis (axis3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| in | Texture (`texture`) | color | optional · Sampled at the mesh UVs when Source = Texture via UV (Gray works too). |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Source | Source (`source`) | enum | gradient_axis | uniform, texture, gradient_axis, gradient_radial, gradient_length, noise, island |  |  |
| Source | Color (`color`) | color | [1, 1, 1, 1] |  |  |  |
| Source | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Source | Gray value -> alpha (`gray_to_alpha`) | bool | false |  |  | A Gray texture has alpha 1; turn this on to write its value into the alpha channel (masks). |
| Source | Gradient origin (`origin`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Source | Gradient direction (`direction`) | vec3 | [0, 0, 1] | -1 … 1 | ● |  |
| Source | Gradient length (`length`) | float | 0 | 0 … 100000 | ● | 0 = fit the mesh extent along the direction. |
| Source | Attribute (`length_attr`) | string | age |  |  |  |
| Source | Range min (`range_min`) | float | 0 |  |  |  |
| Source | Range max (`range_max`) | float | 0 |  |  | Equal min / max = automatic range. |
| Source / Noise | Noise type (`n_kind`) | enum | perlin | perlin, simplex |  |  |
| Source / Noise | Frequency (`n_frequency`) | float | 2 | 0.001 … 200 |  |  |
| Source / Noise | Octaves (`n_octaves`) | int | 3 | 1 … 8 |  |  |
| Source / Noise | Seed (`n_seed`) | seed | 1 |  |  |  |
| Source | Random seed (`seed`) | seed | 1 |  |  |  |
| Source | Color ramp (`gradient`) | gradient | gradient (2 stops) |  |  |  |
| Source | Remap curve (`curve`) | curve | curve (2 keys) |  |  |  |
| Write / Channels | Write R (`write_r`) | bool | true |  |  |  |
| Write / Channels | Write G (`write_g`) | bool | true |  |  |  |
| Write / Channels | Write B (`write_b`) | bool | true |  |  |  |
| Write / Channels | Write A (`write_a`) | bool | true |  |  |  |
| Write | Blend with existing (`blend`) | enum | copy | copy, add, subtract, multiply, screen, max, min, overlay, difference |  |  |
| Write | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● |  |
| Write | Write to (`element`) | enum | auto | auto, point, vertex |  |  |
| Write | Attribute name (`attribute`) | string | Cd |  |  |  |

### Combine Color (Points)

`geometry.combine_color_points` · Geometry · time dependent · GPU trivial, tiling pixel

Writes vertex colour (Cd, or any named RGBA attribute) from a Gray / Color texture sampled through the UVs, a colour gradient along an axis (gizmo) or along an attribute such as Sweep's `age`, 3D noise, a random colour per island, or a uniform colour. Each RGBA channel has its own write mask, and the result can be blended with the existing colour (copy, add, multiply, screen, overlay ...).

**Gizmos:** axis (axis3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`input`) | points | required |
| in | Texture (`texture`) | color | optional · Sampled at the mesh UVs when Source = Texture via UV (Gray works too). |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Source | Source (`source`) | enum | gradient_axis | uniform, texture, gradient_axis, gradient_radial, gradient_length, noise, island |  |  |
| Source | Color (`color`) | color | [1, 1, 1, 1] |  |  |  |
| Source | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Source | Gray value -> alpha (`gray_to_alpha`) | bool | false |  |  | A Gray texture has alpha 1; turn this on to write its value into the alpha channel (masks). |
| Source | Gradient origin (`origin`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Source | Gradient direction (`direction`) | vec3 | [0, 0, 1] | -1 … 1 | ● |  |
| Source | Gradient length (`length`) | float | 0 | 0 … 100000 | ● | 0 = fit the mesh extent along the direction. |
| Source | Attribute (`length_attr`) | string | age |  |  |  |
| Source | Range min (`range_min`) | float | 0 |  |  |  |
| Source | Range max (`range_max`) | float | 0 |  |  | Equal min / max = automatic range. |
| Source / Noise | Noise type (`n_kind`) | enum | perlin | perlin, simplex |  |  |
| Source / Noise | Frequency (`n_frequency`) | float | 2 | 0.001 … 200 |  |  |
| Source / Noise | Octaves (`n_octaves`) | int | 3 | 1 … 8 |  |  |
| Source / Noise | Seed (`n_seed`) | seed | 1 |  |  |  |
| Source | Random seed (`seed`) | seed | 1 |  |  |  |
| Source | Color ramp (`gradient`) | gradient | gradient (2 stops) |  |  |  |
| Source | Remap curve (`curve`) | curve | curve (2 keys) |  |  |  |
| Write / Channels | Write R (`write_r`) | bool | true |  |  |  |
| Write / Channels | Write G (`write_g`) | bool | true |  |  |  |
| Write / Channels | Write B (`write_b`) | bool | true |  |  |  |
| Write / Channels | Write A (`write_a`) | bool | true |  |  |  |
| Write | Blend with existing (`blend`) | enum | copy | copy, add, subtract, multiply, screen, max, min, overlay, difference |  |  |
| Write | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● |  |
| Write | Write to (`element`) | enum | auto | auto, point, vertex |  |  |
| Write | Attribute name (`attribute`) | string | Cd |  |  |  |

### Combine Scale

`geometry.combine_scale` · Geometry · GPU trivial, tiling pixel

Writes the per-point scale used by Copy To Points: `pscale` (uniform) and / or `scale` (vec3, per-axis weights). The value comes from a constant, random numbers (deterministic by seed), a Gray texture through the UVs, any attribute (age, id, noise ...), a gradient along an axis (gizmo) or 3D noise, optionally remapped by a curve; it can multiply the existing scale.

**Gizmos:** axis (axis3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| in | Texture (`texture`) | gray | optional · Sampled at the point UVs when Source = Texture via UV. |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Source | Source (`source`) | enum | random | uniform, random, texture, attribute, gradient_axis, noise |  |  |
| Source | Value (`value`) | float | 1 | -1000 … 1000 | ● |  |
| Source | Min (source = 0) (`min`) | float | 0.5 | -1000 … 1000 | ● |  |
| Source | Max (source = 1) (`max`) | float | 1.5 | -1000 … 1000 | ● |  |
| Source | Seed (`seed`) | seed | 1 |  |  |  |
| Source | Texture channel (`channel`) | enum | luma | r, g, b, a, luma |  |  |
| Source | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Source | Attribute (`attr`) | string | age |  |  |  |
| Source | Attribute range min (`range_min`) | float | 0 |  |  |  |
| Source | Attribute range max (`range_max`) | float | 0 |  |  | Equal min / max = automatic range. |
| Source | Gradient origin (`origin`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Source | Gradient direction (`direction`) | vec3 | [0, 0, 1] | -1 … 1 | ● |  |
| Source | Gradient length (`length`) | float | 0 | 0 … 100000 |  | 0 = fit the mesh extent. |
| Source / Noise | Noise type (`n_kind`) | enum | perlin | perlin, simplex |  |  |
| Source / Noise | Frequency (`n_frequency`) | float | 2 | 0.001 … 200 |  |  |
| Source / Noise | Octaves (`n_octaves`) | int | 3 | 1 … 8 |  |  |
| Source / Noise | Seed (`n_seed`) | seed | 1 |  |  |  |
| Curve | Remap with curve (`use_curve`) | bool | false |  |  |  |
| Curve | Remap curve (`curve`) | curve | curve (2 keys) |  |  |  |
| Write | Target (`target`) | enum | pscale | pscale, scale, both |  |  |
| Write | Axis weights (scale) (`axes`) | vec3 | [1, 1, 1] | 0 … 1 |  | 0 leaves an axis untouched, 1 applies the full value. |
| Write | Multiply existing scale (`multiply`) | bool | true |  |  |  |

### Combine Scale (Points)

`geometry.combine_scale_points` · Geometry · GPU trivial, tiling pixel

Writes the per-point scale used by Copy To Points: `pscale` (uniform) and / or `scale` (vec3, per-axis weights). The value comes from a constant, random numbers (deterministic by seed), a Gray texture through the UVs, any attribute (age, id, noise ...), a gradient along an axis (gizmo) or 3D noise, optionally remapped by a curve; it can multiply the existing scale.

**Gizmos:** axis (axis3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`input`) | points | required |
| in | Texture (`texture`) | gray | optional · Sampled at the point UVs when Source = Texture via UV. |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Source | Source (`source`) | enum | random | uniform, random, texture, attribute, gradient_axis, noise |  |  |
| Source | Value (`value`) | float | 1 | -1000 … 1000 | ● |  |
| Source | Min (source = 0) (`min`) | float | 0.5 | -1000 … 1000 | ● |  |
| Source | Max (source = 1) (`max`) | float | 1.5 | -1000 … 1000 | ● |  |
| Source | Seed (`seed`) | seed | 1 |  |  |  |
| Source | Texture channel (`channel`) | enum | luma | r, g, b, a, luma |  |  |
| Source | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Source | Attribute (`attr`) | string | age |  |  |  |
| Source | Attribute range min (`range_min`) | float | 0 |  |  |  |
| Source | Attribute range max (`range_max`) | float | 0 |  |  | Equal min / max = automatic range. |
| Source | Gradient origin (`origin`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Source | Gradient direction (`direction`) | vec3 | [0, 0, 1] | -1 … 1 | ● |  |
| Source | Gradient length (`length`) | float | 0 | 0 … 100000 |  | 0 = fit the mesh extent. |
| Source / Noise | Noise type (`n_kind`) | enum | perlin | perlin, simplex |  |  |
| Source / Noise | Frequency (`n_frequency`) | float | 2 | 0.001 … 200 |  |  |
| Source / Noise | Octaves (`n_octaves`) | int | 3 | 1 … 8 |  |  |
| Source / Noise | Seed (`n_seed`) | seed | 1 |  |  |  |
| Curve | Remap with curve (`use_curve`) | bool | false |  |  |  |
| Curve | Remap curve (`curve`) | curve | curve (2 keys) |  |  |  |
| Write | Target (`target`) | enum | pscale | pscale, scale, both |  |  |
| Write | Axis weights (scale) (`axes`) | vec3 | [1, 1, 1] | 0 … 1 |  | 0 leaves an axis untouched, 1 applies the full value. |
| Write | Multiply existing scale (`multiply`) | bool | true |  |  |  |

### Combine Transform

`geometry.combine_transform` · Geometry · time dependent · GPU trivial, tiling pixel

Per-point transform driven by an attribute: a DRIVER (age, id, index, pscale, x / y / z, random, noise or any attribute) is normalised by the input range, remapped by a curve and then scales a translation (+ along the normal), an Euler rotation (composed into `orient`) and a scale (multiplied into `scale`). Use it before Copy To Points to fan, spiral or grow instances.

**Gizmos:** xf (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Driver | Driver (`driver`) | enum | age | age, id, index, pscale, x, y, z, random, noise, attribute |  |  |
| Driver | Attribute (`attr`) | string | age |  |  |  |
| Driver | Input min (`in_min`) | float | 0 |  |  |  |
| Driver | Input max (`in_max`) | float | 1 |  |  |  |
| Driver | Seed (`seed`) | seed | 1 |  |  |  |
| Driver / Noise | Noise type (`n_kind`) | enum | perlin | perlin, simplex |  |  |
| Driver / Noise | Frequency (`n_frequency`) | float | 2 | 0.001 … 200 |  |  |
| Driver / Noise | Octaves (`n_octaves`) | int | 3 | 1 … 8 |  |  |
| Driver / Noise | Seed (`n_seed`) | seed | 1 |  |  |  |
| Driver | Remap with curve (`use_curve`) | bool | false |  |  |  |
| Driver | Remap curve (`curve`) | curve | curve (2 keys) |  |  |  |
| Transform | Move points (`apply_to_position`) | bool | true |  |  |  |
| Transform | Translate at 1 (`translate`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Transform | Along normal at 1 (`along_normal`) | float | 0 | -1000 … 1000 | ● |  |
| Transform | Rotate at 1 (`rotate`) | vec3 | [0, 0, 0] | -360 … 360 | ● |  |
| Transform | Scale at 1 (`scale`) | vec3 | [1, 1, 1] | -1000 … 1000 | ● |  |

### Combine Transform (Points)

`geometry.combine_transform_points` · Geometry · time dependent · GPU trivial, tiling pixel

Per-point transform driven by an attribute: a DRIVER (age, id, index, pscale, x / y / z, random, noise or any attribute) is normalised by the input range, remapped by a curve and then scales a translation (+ along the normal), an Euler rotation (composed into `orient`) and a scale (multiplied into `scale`). Use it before Copy To Points to fan, spiral or grow instances.

**Gizmos:** xf (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`input`) | points | required |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Driver | Driver (`driver`) | enum | age | age, id, index, pscale, x, y, z, random, noise, attribute |  |  |
| Driver | Attribute (`attr`) | string | age |  |  |  |
| Driver | Input min (`in_min`) | float | 0 |  |  |  |
| Driver | Input max (`in_max`) | float | 1 |  |  |  |
| Driver | Seed (`seed`) | seed | 1 |  |  |  |
| Driver / Noise | Noise type (`n_kind`) | enum | perlin | perlin, simplex |  |  |
| Driver / Noise | Frequency (`n_frequency`) | float | 2 | 0.001 … 200 |  |  |
| Driver / Noise | Octaves (`n_octaves`) | int | 3 | 1 … 8 |  |  |
| Driver / Noise | Seed (`n_seed`) | seed | 1 |  |  |  |
| Driver | Remap with curve (`use_curve`) | bool | false |  |  |  |
| Driver | Remap curve (`curve`) | curve | curve (2 keys) |  |  |  |
| Transform | Move points (`apply_to_position`) | bool | true |  |  |  |
| Transform | Translate at 1 (`translate`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Transform | Along normal at 1 (`along_normal`) | float | 0 | -1000 … 1000 | ● |  |
| Transform | Rotate at 1 (`rotate`) | vec3 | [0, 0, 0] | -360 … 360 | ● |  |
| Transform | Scale at 1 (`scale`) | vec3 | [1, 1, 1] | -1000 … 1000 | ● |  |

### Copy To Points

`geometry.copy_to_points` · Geometry · GPU trivial, tiling pixel

Instances the mesh on every point. Each copy is rotated by the point `orient` (or aligned to `N`), scaled by `pscale` x `scale` x the global scale, and its colour is multiplied by the point `Cd`. Point attributes (id, age, custom) are written onto the copied points; `pivot` = the copy origin (pivot-baked meshes / VAT).

**Gizmos:** xf (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`mesh`) | mesh | required |
| in | Points (`points`) | points | required |
| out | Mesh (`mesh`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Copy | Use orient (`use_orient`) | bool | true |  |  | Rotate each copy by the point orient quaternion. |
| Copy | Align to normal (if no orient) (`align_normal`) | bool | true |  |  |  |
| Copy | Use pscale (`use_pscale`) | bool | true |  |  |  |
| Copy | Use scale (vec3) (`use_scale`) | bool | true |  |  |  |
| Copy | Multiply by point color (`use_color`) | bool | true |  |  |  |
| Copy | Scale (`scale`) | float | 1 | 0 … 1000 | ● |  |
| Copy | Rotate offset (`rotate`) | vec3 | [0, 0, 0] | -360 … 360 | ● | Extra local rotation applied before the point orientation. |

### Copy and Transform

`geometry.copy_transform` · Geometry · GPU trivial, tiling pixel

Makes N copies; copy i is the step transform applied i times about the pivot (exact matrix composition). Writes id (copy index), age and pivot per copy, plus optional colour / pscale / age ranges and seeded jitter. Spirals, fans, stacked rings, trails.

**Gizmos:** xf (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Copies | Copies (`copies`) | int | 4 | 1 … 100000 | ● |  |
| Copies / Step | Translate (`translate`) | vec3 | [0, 0, 0.5] | -10 … 10 | ● |  |
| Copies / Step | Rotate (`rotate`) | vec3 | [0, 0, 15] | -360 … 360 | ● |  |
| Copies / Step | Scale (`scale`) | vec3 | [1, 1, 1] | 0.5 … 1.5 | ● | Per-copy multiplier (compounds). |
| Copies / Step | Pivot (`pivot`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Copies / Jitter | Jitter translate (`jitter_translate`) | vec3 | [0, 0, 0] | 0 … 2 |  |  |
| Copies / Jitter | Jitter rotate (`jitter_rotate`) | vec3 | [0, 0, 0] | 0 … 180 |  |  |
| Copies / Jitter | Jitter scale (`jitter_scale`) | float (percent) | 0 | 0 … 0.99 |  |  |
| Copies / Jitter | Seed (`seed`) | seed | 1 |  |  |  |
| Ranges / Color (Cd) | Color start (`color_start`) | color | [1, 1, 1, 1] |  |  |  |
| Ranges / Color (Cd) | Color end (`color_end`) | color | [1, 1, 1, 1] |  |  |  |
| Ranges / pscale attribute | Pscale start (`pscale_start`) | float | 1 | 0 … 1000 |  |  |
| Ranges / pscale attribute | Pscale end (`pscale_end`) | float | 1 | 0 … 1000 |  |  |
| Ranges / age attribute | Age start (`age_start`) | float | 0 | 0 … 1 |  |  |
| Ranges / age attribute | Age end (`age_end`) | float | 1 | 0 … 1 |  |  |

### Delete By Mask

`geometry.delete_mask` · Geometry · GPU trivial, tiling pixel

Deletes primitives by a mask: vertex colour channel, an attribute, a Gray texture sampled at the UVs, or a box region (gizmo). A primitive is kept when the average mask of its points is >= the threshold (Invert flips; the box keeps what is inside). Unused points can be removed.

**Gizmos:** box (box3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| in | Mask (`mask`) | gray | optional · mask |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Mask | Source (`source`) | enum | cd_a | cd_r, cd_g, cd_b, cd_a, attribute, texture, box |  |  |
| Mask | Attribute (`attr`) | string | age |  |  |  |
| Mask | Texture channel (`channel`) | enum | luma | r, g, b, a, luma |  |  |
| Mask | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Mask | Threshold (`threshold`) | float | 0.5 | 0 … 1 | ● |  |
| Mask | Box center (`box_pos`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Mask | Box size (`box_size`) | vec3 | [1, 1, 1] | 0.0001 … 1000 | ● |  |
| Mask | Invert (`invert`) | bool | false |  |  |  |
| Mask | Remove unused points (`remove_unused`) | bool | true |  |  |  |

### Extract Points

`geometry.extract_points` · Geometry · GPU trivial, tiling pixel

Converts a mesh into a point cloud: one point per mesh point, vertex, primitive (centroid + normal) or per connected island (centroid / bounds centre / base centre, id = island, optional pscale from the island size). Attributes are kept (vertex and primitive values are averaged onto the points), `orient` is built from the normal and `id` is added when missing, so the result feeds Copy To Points directly.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Extract | Mode (`mode`) | enum | points | points, vertices, primitives, islands |  |  |
| Extract | Island center (`island_center`) | enum | bounds | centroid, bounds, base |  |  |
| Extract | Keep every n-th (`stride`) | int | 1 | 1 … 100000 |  |  |
| Extract | Max points (`max_points`) | int | 1000000 | 1 … 4000000 |  | Hard guard against huge point clouds. |
| Attributes | pscale (`pscale_from`) | enum | none | none, size |  |  |
| Attributes | Build orient from N (`orient_from_normal`) | bool | true |  |  |  |
| Attributes | Keep attributes (`keep_attributes`) | bool | true |  |  |  |

### Merge Vertices

`geometry.fuse` · Geometry · GPU trivial, tiling pixel

Merges points closer than the distance (spatial hash, the first point wins) and removes primitives that collapse below 3 distinct points. Welds seams and duplicate cap points; note that smooth normals then average across the weld.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Merge | Distance (`distance`) | float | 0.0001 | 0 … 100 |  |  |

### Merge

`geometry.merge` · Geometry · GPU trivial, tiling pixel

Concatenates up to six inputs. Attributes are united; missing values get defaults (orient identity, scale / pscale 1, Cd white). Empty slots are ignored.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh 1 (`in1`) | mesh | optional |
| in | Mesh 2 (`in2`) | mesh | optional |
| in | Mesh 3 (`in3`) | mesh | optional |
| in | Mesh 4 (`in4`) | mesh | optional |
| in | Mesh 5 (`in5`) | mesh | optional |
| in | Mesh 6 (`in6`) | mesh | optional |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|

### Merge (Points)

`geometry.merge_points` · Geometry · GPU trivial, tiling pixel

Concatenates up to six inputs. Attributes are united; missing values get defaults (orient identity, scale / pscale 1, Cd white). Empty slots are ignored.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points 1 (`in1`) | points | optional |
| in | Points 2 (`in2`) | points | optional |
| in | Points 3 (`in3`) | points | optional |
| in | Points 4 (`in4`) | points | optional |
| in | Points 5 (`in5`) | points | optional |
| in | Points 6 (`in6`) | points | optional |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|

### Noise

`geometry.noise` · Geometry · time dependent · GPU trivial, tiling pixel

Displaces points along the normal, a fixed axis or a noise vector with 3D fBm (Perlin 4D or simplex). The 4th dimension animates the noise; with Loop on, exactly `cycles` noise cycles fit into the graph loop so animations repeat seamlessly. Mask by vertex colour, an attribute (e.g. `age` from Sweep) or a Gray texture sampled through the mesh UVs, and limit the effect to a spherical falloff region. Deterministic by seed.

**Gizmos:** origin (point3d, 3d); falloff (falloff3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| in | Mask (`mask`) | gray | optional · mask · Gray texture sampled at the mesh UVs when Mask = Gray texture. |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Noise | Mode (`mode`) | enum | normal | normal, vector, axis |  |  |
| Noise | Axis (`axis`) | vec3 | [0, 0, 1] | -1 … 1 |  |  |
| Noise | Noise type (`kind`) | enum | perlin | perlin, simplex |  |  |
| Noise | Amplitude (`amplitude`) | float | 0.1 | -1000 … 1000 | ● |  |
| Noise | Bias (`bias`) | float | 0 | -2 … 2 |  | 0 displaces both ways, 1 only outwards. |
| Noise | Frequency (`frequency`) | float | 2 | 0.001 … 500 | ● |  |
| Noise | Frequency scale (per axis) (`freq_scale`) | vec3 | [1, 1, 1] | 0 … 100 |  | Stretch the noise: e.g. (1, 1, 0.2) for long streaks along Z. |
| Noise | Offset (`offset`) | vec3 | [0, 0, 0] | -10 … 10 | ● | Noise origin (gizmo). Animate it to scroll the noise. |
| Noise / Fractal | Octaves (`octaves`) | int | 3 | 1 … 8 |  |  |
| Noise / Fractal | Lacunarity (`lacunarity`) | float | 2 | 1 … 4 |  |  |
| Noise / Fractal | Gain (`gain`) | float | 0.5 | 0 … 1 |  |  |
| Noise / Fractal | Seed (`seed`) | seed | 1 |  |  |  |
| Animation | Animate (4th dimension) (`animate`) | bool | false |  |  |  |
| Animation | Loop with graph (`loop`) | bool | true |  |  | One graph loop = `cycles` noise cycles (seamless). |
| Animation | Cycles per loop (`loop_cycles`) | int | 1 | 1 … 16 |  |  |
| Animation | Speed (noise units / s) (`speed`) | float | 1 | -100 … 100 |  |  |
| Mask | Mask source (`mask`) | enum | none | none, cd_r, cd_g, cd_b, cd_a, attribute, texture |  |  |
| Mask | Attribute (`mask_attr`) | string | age |  |  |  |
| Mask | Texture channel (`mask_channel`) | enum | luma | r, g, b, a, luma |  |  |
| Mask | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Mask | Invert mask (`mask_invert`) | bool | false |  |  |  |
| Falloff | Enable falloff region (`falloff_enabled`) | bool | false |  |  | Limit the effect to a spherical region (gizmo in the 3D viewport). |
| Falloff | Center (`falloff_center`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Falloff | Inner radius (`falloff_inner`) | float | 0.5 | 0 … 1000 | ● |  |
| Falloff | Outer radius (`falloff_outer`) | float | 1.5 | 0 … 1000 | ● |  |
| Falloff | Invert (`falloff_invert`) | bool | false |  |  |  |
| Output | Write `noise` attribute (`store_noise`) | bool | false |  |  | Point attribute with the raw noise value (-1..1): drive Combine Color / Scale from it. |
| Output | Recompute normals (angle weighted) (`recompute_normals`) | bool | true |  |  |  |

### Noise (Points)

`geometry.noise_points` · Geometry · time dependent · GPU trivial, tiling pixel

Displaces points along the normal, a fixed axis or a noise vector with 3D fBm (Perlin 4D or simplex). The 4th dimension animates the noise; with Loop on, exactly `cycles` noise cycles fit into the graph loop so animations repeat seamlessly. Mask by vertex colour, an attribute (e.g. `age` from Sweep) or a Gray texture sampled through the mesh UVs, and limit the effect to a spherical falloff region. Deterministic by seed.

**Gizmos:** origin (point3d, 3d); falloff (falloff3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`input`) | points | required |
| in | Mask (`mask`) | gray | optional · mask · Gray texture sampled at the mesh UVs when Mask = Gray texture. |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Noise | Mode (`mode`) | enum | normal | normal, vector, axis |  |  |
| Noise | Axis (`axis`) | vec3 | [0, 0, 1] | -1 … 1 |  |  |
| Noise | Noise type (`kind`) | enum | perlin | perlin, simplex |  |  |
| Noise | Amplitude (`amplitude`) | float | 0.1 | -1000 … 1000 | ● |  |
| Noise | Bias (`bias`) | float | 0 | -2 … 2 |  | 0 displaces both ways, 1 only outwards. |
| Noise | Frequency (`frequency`) | float | 2 | 0.001 … 500 | ● |  |
| Noise | Frequency scale (per axis) (`freq_scale`) | vec3 | [1, 1, 1] | 0 … 100 |  | Stretch the noise: e.g. (1, 1, 0.2) for long streaks along Z. |
| Noise | Offset (`offset`) | vec3 | [0, 0, 0] | -10 … 10 | ● | Noise origin (gizmo). Animate it to scroll the noise. |
| Noise / Fractal | Octaves (`octaves`) | int | 3 | 1 … 8 |  |  |
| Noise / Fractal | Lacunarity (`lacunarity`) | float | 2 | 1 … 4 |  |  |
| Noise / Fractal | Gain (`gain`) | float | 0.5 | 0 … 1 |  |  |
| Noise / Fractal | Seed (`seed`) | seed | 1 |  |  |  |
| Animation | Animate (4th dimension) (`animate`) | bool | false |  |  |  |
| Animation | Loop with graph (`loop`) | bool | true |  |  | One graph loop = `cycles` noise cycles (seamless). |
| Animation | Cycles per loop (`loop_cycles`) | int | 1 | 1 … 16 |  |  |
| Animation | Speed (noise units / s) (`speed`) | float | 1 | -100 … 100 |  |  |
| Mask | Mask source (`mask`) | enum | none | none, cd_r, cd_g, cd_b, cd_a, attribute, texture |  |  |
| Mask | Attribute (`mask_attr`) | string | age |  |  |  |
| Mask | Texture channel (`mask_channel`) | enum | luma | r, g, b, a, luma |  |  |
| Mask | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Mask | Invert mask (`mask_invert`) | bool | false |  |  |  |
| Falloff | Enable falloff region (`falloff_enabled`) | bool | false |  |  | Limit the effect to a spherical region (gizmo in the 3D viewport). |
| Falloff | Center (`falloff_center`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Falloff | Inner radius (`falloff_inner`) | float | 0.5 | 0 … 1000 | ● |  |
| Falloff | Outer radius (`falloff_outer`) | float | 1.5 | 0 … 1000 | ● |  |
| Falloff | Invert (`falloff_invert`) | bool | false |  |  |  |
| Output | Write `noise` attribute (`store_noise`) | bool | false |  |  | Point attribute with the raw noise value (-1..1): drive Combine Color / Scale from it. |
| Output | Recompute normals (angle weighted) (`recompute_normals`) | bool | true |  |  |  |

### Normals

`geometry.normals` · Geometry · GPU trivial, tiling pixel

Recomputes normals weighted by the corner angle of every face (independent of how a surface is triangulated). Smooth = point normals, Flat = per-vertex face normals. Optionally writes per-vertex `tangent` (xyz + handedness) from a UV set.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Normals | Mode (`mode`) | enum | smooth | smooth, flat |  |  |
| Normals | Write tangents (`tangents`) | bool | false |  |  |  |
| Normals | Tangent UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Normals | Flip normals (`flip`) | bool | false |  |  |  |

### Points Shape

`geometry.points_shape` · Geometry · GPU trivial, tiling pixel

Generates points with position, normal, orient, pscale, id, age and color: on a line, circle / arc, grid, sphere (Fibonacci), area-weighted on the surface of a connected mesh, or randomly in a box (seeded). Feed them to Copy To Points.

**Gizmos:** center (point3d, 3d); radius (radius3d, 3d); box (box3d, 3d); Start (point3d, 3d); End (point3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Surface (`mesh`) | mesh | optional · Surface mode scatters points on this mesh. |
| out | Points (`points`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Points / Distribution | Mode (`mode`) | enum | circle | line, circle, grid, sphere, surface, random |  |  |
| Points / Distribution | Count (`count`) | int | 16 | 1 … 1000000 | ● |  |
| Points / Distribution | Grid divisions (`grid`) | vec2 | [4, 4] | 1 … 1000 |  |  |
| Points / Transform | Start (`start`) | vec3 | [-1, 0, 0] | -10 … 10 | ● |  |
| Points / Transform | End (`end`) | vec3 | [1, 0, 0] | -10 … 10 | ● |  |
| Points / Transform | Center (`center`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Points / Transform | Radius (`radius`) | float | 1 | 0 … 1000 | ● |  |
| Points / Transform | Sweep (`sweep`) | float (angle) | 360 | 1 … 360 | ● |  |
| Points / Transform | Size (`size`) | vec3 | [2, 2, 0] | 0 … 1000 | ● |  |
| Points / Attributes | Seed (`seed`) | seed | 1 |  |  |  |
| Points / Attributes | Pscale (`pscale`) | float | 1 | 0 … 1000 | ● |  |
| Points / Attributes | Orient to normal (`align`) | bool | true |  |  | orient = rotation of local +Z onto the point normal. |
| Points / Attributes | Random orientation (`random_orient`) | bool | false |  |  |  |
| Points / Attributes | Color (Cd) (`color`) | color | [1, 1, 1, 1] |  |  |  |

### Promote

`geometry.promote` · Geometry · GPU trivial, tiling pixel

Moves an attribute between elements (point <-> vertex <-> primitive <-> detail). Going to a coarser element reduces the values with the chosen mode (average, sum, min, max, first); going to a finer one copies them. Example: promote vertex `Cd` to points before Extract Points, or a primitive `island` id to points.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Promote | Attribute (`attribute`) | string | Cd |  |  | Name of the attribute (Cd, N, uv, age, id, island, custom ...). |
| Promote | From (`from`) | enum | vertex | point, vertex, primitive, detail |  |  |
| Promote | To (`to`) | enum | point | point, vertex, primitive, detail |  |  |
| Promote | Reduction (`mode`) | enum | average | average, sum, min, max, first |  |  |
| Promote | Keep original (`keep_original`) | bool | false |  |  |  |

### Shapes

`geometry.shapes` · Geometry · GPU trivial, tiling pixel

Parametric meshes for VFX: plane / grid, disc, ring (shockwave), cylinder, cone, tube, sphere, hemisphere, cube, torus, arc strip (sword swipe), spiral ribbon, quad, cross-plane, crater / bowl. Z up, UVs v-up, smooth normals with hard caps.

**Gizmos:** Center (point3d, 3d); radius (radius3d, 3d); size (box3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Mesh (`mesh`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Geometry / Shape | Shape (`shape`) | enum | plane | plane, grid, quad, disc, ring, cylinder, cone, tube, sphere, hemisphere, cube, torus, arc_strip, spiral, cross_plane, crater |  |  |
| Geometry / Shape | Center (`center`) | vec3 | [0, 0, 0] | -10 … 10 | ● | Offset of the shape (world units). |
| Geometry / Shape | Pivot (`pivot`) | enum | center | center, base |  |  |
| Geometry / Size | Size (`size`) | vec3 | [1, 1, 1] | 0.0001 … 1000 | ● | Plane / cube extents. Strips: X = width, Z = rise. Cylinder family: Z = height. |
| Geometry / Size | Radius (`radius`) | float | 0.5 | 0.0001 … 1000 | ● |  |
| Geometry / Size | Inner radius (`inner_radius`) | float | 0.25 | 0 … 1000 | ● | Ring / tube inner radius, torus tube radius, spiral start radius. |
| Geometry / Size | Taper (`taper`) | float | 1 | 0 … 8 | ● | Cylinder top radius / strip end width multiplier. |
| Geometry / Size | Sweep (`sweep`) | float (angle) | 360 | 1 … 360 | ● | Arc length in degrees. |
| Geometry / Size | Turns (`turns`) | float | 2 | 0.05 … 32 | ● |  |
| Geometry / Size | Depth (`depth`) | float | 0.25 | 0 … 100 | ● |  |
| Geometry / Size | Rim (`rim`) | float | 0.08 | 0 … 100 | ● |  |
| Geometry / Subdivision | Segments (`segments`) | int | 32 | 3 … 1024 |  | Divisions around the axis / along strips. |
| Geometry / Subdivision | Rings (`rings`) | int | 8 | 1 … 512 |  | Radial / height divisions (sphere and torus use twice this many). |
| Geometry / Subdivision | Columns (`cols`) | int | 1 | 1 … 1024 |  |  |
| Geometry / Subdivision | Rows (`rows`) | int | 1 | 1 … 1024 |  | Strips: divisions across the width. |
| Geometry / Subdivision | Planes (`count`) | int | 2 | 1 … 64 |  |  |
| Geometry / Subdivision | Caps (`caps`) | bool | true |  |  |  |
| Geometry / UV | Uv mode (`uv_mode`) | enum | polar | polar, planar |  | Polar: u = angle, v = radius (shockwave textures). Planar: top view. |

### Space Warp

`geometry.space_warp` · Geometry · GPU trivial, tiling pixel

Deforms points in a warp space you place with the gizmo: Bend, Twist, Taper, Stretch (volume preserving), Spherify, Wave, Ripple, Lattice free-form deform (box with 8 corner offsets + jitter) and Displace by texture (Gray texture through the mesh UVs). A spherical falloff region (gizmo) limits the effect. Normals are recomputed with angle weighting.

**Gizmos:** space (transform3d, 3d); lattice (box3d, 3d); falloff (falloff3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| in | Texture (`texture`) | gray | optional · Gray texture for Displace by texture (sampled at the mesh UVs). |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Warp | Mode (`mode`) | enum | bend | bend, twist, taper, stretch, spherify, wave, ripple, lattice, displace_texture |  |  |
| Warp | Axis (`axis`) | enum | z | x, y, z |  | Bend / twist / taper / stretch run along this local axis; wave and ripple displace along it. |
| Warp | Amount (`amount`) | float | 45 | -100000 … 100000 | ● | Bend / twist: degrees over `length`. Taper / stretch: factor. Spherify: 0..1. Wave / ripple / displace: distance. |
| Warp | Length (`length`) | float | 2 | 0.0001 … 100000 | ● |  |
| Warp | Radius (`radius`) | float | 1 | 0 … 100000 | ● |  |
| Warp | Preserve volume (`preserve_volume`) | bool | true |  |  |  |
| Warp | Frequency (`frequency`) | float | 1 | 0 … 1000 |  |  |
| Warp | Phase (`phase`) | float | 0 | -100000 … 100000 | ● | Animate over a whole number of cycles for a seamless loop. |
| Warp | Decay (`decay`) | float | 0 | 0 … 100 |  |  |
| Space | Warp space position (`position`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Space | Warp space rotation (`rotation`) | vec3 | [0, 0, 0] | -360 … 360 | ● |  |
| Lattice | Lattice box center (`box_pos`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Lattice | Lattice box size (`box_size`) | vec3 | [2, 2, 2] | 0.0001 … 1000 | ● |  |
| Lattice | Grid resolution (`lat_res`) | int | 3 | 2 … 8 |  |  |
| Lattice / Corner offsets | Corner 0 (-x -y -z) (`lat_c0`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 1 (+x -y -z) (`lat_c1`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 2 (-x +y -z) (`lat_c2`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 3 (+x +y -z) (`lat_c3`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 4 (-x -y +z) (`lat_c4`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 5 (+x -y +z) (`lat_c5`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 6 (-x +y +z) (`lat_c6`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 7 (+x +y +z) (`lat_c7`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice | Random jitter (`lat_jitter`) | float | 0 | 0 … 10 | ● |  |
| Lattice | Jitter seed (`lat_seed`) | seed | 1 |  |  |  |
| Texture | Displace along (`along`) | enum | normal | normal, x, y, z |  |  |
| Texture | Channel (`channel`) | enum | luma | r, g, b, a, luma |  |  |
| Texture | Neutral value (`mid`) | float | 0.5 | 0 … 1 |  |  |
| Texture | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Falloff | Enable falloff region (`falloff_enabled`) | bool | false |  |  | Limit the effect to a spherical region (gizmo in the 3D viewport). |
| Falloff | Center (`falloff_center`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Falloff | Inner radius (`falloff_inner`) | float | 0.5 | 0 … 1000 | ● |  |
| Falloff | Outer radius (`falloff_outer`) | float | 1.5 | 0 … 1000 | ● |  |
| Falloff | Invert (`falloff_invert`) | bool | false |  |  |  |
| Output | Recompute normals (angle weighted) (`recompute_normals`) | bool | true |  |  |  |

### Space Warp (Points)

`geometry.space_warp_points` · Geometry · GPU trivial, tiling pixel

Deforms points in a warp space you place with the gizmo: Bend, Twist, Taper, Stretch (volume preserving), Spherify, Wave, Ripple, Lattice free-form deform (box with 8 corner offsets + jitter) and Displace by texture (Gray texture through the mesh UVs). A spherical falloff region (gizmo) limits the effect. Normals are recomputed with angle weighting.

**Gizmos:** space (transform3d, 3d); lattice (box3d, 3d); falloff (falloff3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`input`) | points | required |
| in | Texture (`texture`) | gray | optional · Gray texture for Displace by texture (sampled at the mesh UVs). |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Warp | Mode (`mode`) | enum | bend | bend, twist, taper, stretch, spherify, wave, ripple, lattice, displace_texture |  |  |
| Warp | Axis (`axis`) | enum | z | x, y, z |  | Bend / twist / taper / stretch run along this local axis; wave and ripple displace along it. |
| Warp | Amount (`amount`) | float | 45 | -100000 … 100000 | ● | Bend / twist: degrees over `length`. Taper / stretch: factor. Spherify: 0..1. Wave / ripple / displace: distance. |
| Warp | Length (`length`) | float | 2 | 0.0001 … 100000 | ● |  |
| Warp | Radius (`radius`) | float | 1 | 0 … 100000 | ● |  |
| Warp | Preserve volume (`preserve_volume`) | bool | true |  |  |  |
| Warp | Frequency (`frequency`) | float | 1 | 0 … 1000 |  |  |
| Warp | Phase (`phase`) | float | 0 | -100000 … 100000 | ● | Animate over a whole number of cycles for a seamless loop. |
| Warp | Decay (`decay`) | float | 0 | 0 … 100 |  |  |
| Space | Warp space position (`position`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Space | Warp space rotation (`rotation`) | vec3 | [0, 0, 0] | -360 … 360 | ● |  |
| Lattice | Lattice box center (`box_pos`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Lattice | Lattice box size (`box_size`) | vec3 | [2, 2, 2] | 0.0001 … 1000 | ● |  |
| Lattice | Grid resolution (`lat_res`) | int | 3 | 2 … 8 |  |  |
| Lattice / Corner offsets | Corner 0 (-x -y -z) (`lat_c0`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 1 (+x -y -z) (`lat_c1`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 2 (-x +y -z) (`lat_c2`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 3 (+x +y -z) (`lat_c3`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 4 (-x -y +z) (`lat_c4`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 5 (+x -y +z) (`lat_c5`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 6 (-x +y +z) (`lat_c6`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice / Corner offsets | Corner 7 (+x +y +z) (`lat_c7`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Lattice | Random jitter (`lat_jitter`) | float | 0 | 0 … 10 | ● |  |
| Lattice | Jitter seed (`lat_seed`) | seed | 1 |  |  |  |
| Texture | Displace along (`along`) | enum | normal | normal, x, y, z |  |  |
| Texture | Channel (`channel`) | enum | luma | r, g, b, a, luma |  |  |
| Texture | Neutral value (`mid`) | float | 0.5 | 0 … 1 |  |  |
| Texture | UV set (`uv_set`) | int | 0 | 0 … 7 |  |  |
| Falloff | Enable falloff region (`falloff_enabled`) | bool | false |  |  | Limit the effect to a spherical region (gizmo in the 3D viewport). |
| Falloff | Center (`falloff_center`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Falloff | Inner radius (`falloff_inner`) | float | 0.5 | 0 … 1000 | ● |  |
| Falloff | Outer radius (`falloff_outer`) | float | 1.5 | 0 … 1000 | ● |  |
| Falloff | Invert (`falloff_invert`) | bool | false |  |  |  |
| Output | Recompute normals (angle weighted) (`recompute_normals`) | bool | true |  |  |  |

### Spline Combine

`geometry.spline_combine` · Geometry · GPU trivial, tiling global

Merges up to four spline inputs into one set. A Sweep with a multi-spline Profile builds one loop per spline.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | A (`a`) | spline | required |
| in | B (`b`) | spline | optional |
| in | C (`c`) | spline | optional |
| in | D (`d`) | spline | optional |
| out | Spline (`spline`) | spline |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|

### Spline Resample

`geometry.spline_resample` · Geometry · GPU trivial, tiling global

Resamples the splines to a fixed point count (equal arc length), smooths them (neighbour averaging) or offsets them sideways.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Spline (`spline`) | spline | required |
| out | Spline (`spline`) | spline |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main | Mode (`mode`) | enum | resample | resample, smooth, offset |  |  |
| Main | Points (`count`) | int | 16 | 2 … 2048 |  |  |
| Main | Iterations (`iterations`) | int | 2 | 1 … 32 |  |  |
| Main | Distance (`distance`) | float | 0.03 | -1 … 1 | ● |  |

### Spline Shape

`geometry.spline_shape` · Geometry · GPU trivial, tiling global

Generates a spline from a parametric shape: circle, rounded rectangle, star, polygon, line or arc. Feed it into Sweep (Profile or Path), Spline Transform / Resample / Combine, or the Spline node.

**Gizmos:** Shape centre / radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Spline (`spline`) | spline |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Shape | Shape (`shape`) | enum | circle | circle, rounded_rect, star, polygon, line, arc |  |  |
| Main / Shape | Center (`center`) | vec2 | [0.5, 0.5] | 0 … 1 | ● |  |
| Main / Shape | Radius (`radius`) | float | 0.3 | 0.001 … 100 | ● |  |
| Main / Shape | Points / sides (`points`) | int | 8 | 3 … 256 |  |  |
| Main / Shape | Star inner radius (`inner`) | float | 0.45 | 0.01 … 1 |  |  |
| Main / Shape | Corner cut (`round`) | float | 0.35 | 0.01 … 1 |  |  |
| Main / Shape | Rotation (`rotation`) | float | 0 | -3600 … 3600 | ● |  |

### Spline to Points

`geometry.spline_to_points` · Geometry · GPU trivial, tiling global

Places points at equal arc length along each spline of the input set. Orientation follows the tangent (+Z), `age` runs 0..1 along each spline. 2D splines lie on the XY plane.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Spline (`spline`) | spline | required |
| out | Points (`points`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main | Count (`count`) | int | 32 | 1 … 100000 |  | Points per spline. |
| Main | Point scale (`pscale`) | float | 1 | 0 … 1000 |  |  |
| Main | Align to tangent (`align`) | bool | true |  |  | Orient each point so +Z follows the spline direction. |

### Spline Transform

`geometry.spline_transform` · Geometry · GPU trivial, tiling global

Translates, rotates and scales all splines of the input about a pivot. Handles are transformed with the points.

**Gizmos:** Translate (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Spline (`spline`) | spline | required |
| out | Spline (`spline`) | spline |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main | Translate (`translate`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main | Rotation (`rotation`) | float | 0 | -3600 … 3600 | ● |  |
| Main | Scale (`scale`) | vec2 | [1, 1] | -4 … 4 | ● |  |
| Main | Pivot (`pivot`) | vec2 | [0.5, 0.5] | 0 … 1 |  |  |

### Subdivide

`geometry.subdivide` · Geometry · GPU trivial, tiling pixel

Simple tessellation: triangles become 4 triangles, polygons with 4+ corners become quads around their centre. New points interpolate every attribute (UV, colour, custom); positions are not smoothed, so combine it with Noise or Space Warp. Guarded by the mesh caps.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Subdivide | Iterations (`iterations`) | int | 1 | 0 … 5 |  | Each iteration multiplies the primitive count by 4 (triangles) or the corner count (n-gons). |

### Sweep

`geometry.sweep` · Geometry · GPU trivial, tiling pixel

Extrudes a 2D profile (circle, ribbon, star or a custom spline) along a 3D spline you edit with the gizmo. Scale and twist curves run along the length, taper / roll / orientation mode (minimal torsion, Frenet, up vector) control the frames, caps close tubes, closed loops make rings. UV U runs around the profile, V along the length (tiling + offset for scrolling). Vertex colour comes from a gradient along the length; `age` (0..1 along the length) and `pscale` are written as point attributes. The heart of beams, arcs, sword swipes and ribbons.

**Gizmos:** path (spline3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Profile (`profile_in`) | spline | optional · Optional Spline used as the custom profile (auto-centred, normalised to unit size, winding fixed; several splines = several loops). Overrides the built-in profile. |
| in | Path (`path_in`) | spline | optional · Optional Spline used as the sweep path (3D, or a 2D spline lifted to 3D). Overrides the built-in 3D spline. |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Path | 3D Spline (`spline`) | spline | … |  |  | Edit the points with the gizmo in the 3D viewport (point, in / out tangents, per-point scale and twist handles). |
| Path | Closed loop (`closed`) | bool | false |  |  | Join the last point to the first (rings, shockwaves). |
| Path | Segments (`segments`) | int | 48 | 1 … 4096 |  | Rings along the length (arc-length spaced). |
| Profile | Profile (`profile`) | enum | circle | circle, ribbon, star, custom |  |  |
| Profile | Profile resolution (`profile_res`) | int | 12 | 3 … 256 |  |  |
| Profile | Star points (`star_points`) | int | 5 | 3 … 32 |  |  |
| Profile | Star inner radius (`star_inner`) | float | 0.45 | 0.01 … 1 |  |  |
| Profile | Custom profile (`profile_spline`) | spline | … |  |  | Drawn in the unit square, centred on the path. |
| Profile | Width (`width`) | float | 0.2 | 0 … 1000 | ● | Profile size across the binormal axis. |
| Profile | Height (`height`) | float | 0.2 | 0 … 1000 | ● | Profile size along the normal axis (ignored by Ribbon). |
| Profile | Cap start (`cap_start`) | bool | true |  |  | Closed profiles on open paths only. |
| Profile | Cap end (`cap_end`) | bool | true |  |  |  |
| Shape / Along length | Scale along length (`scale_curve`) | curve | curve (2 keys) |  |  | Profile scale over the path (0 = start, 1 = end). |
| Shape / Along length | Twist along length (`twist_curve`) | curve | curve (2 keys) |  |  |  |
| Shape / Along length | Twist at curve = 1 (`twist_amount`) | float | 360 | -100000 … 100000 | ● |  |
| Shape / Along length | Rotation (`rotation`) | float | 0 | -3600 … 3600 | ● |  |
| Shape / Taper | Taper start (`taper_start`) | float | 1 | 0 … 100 | ● |  |
| Shape / Taper | Taper end (`taper_end`) | float | 1 | 0 … 100 | ● |  |
| Shape / Taper | Per-point scale / twist (`use_point_attrs`) | bool | true |  |  | Blend the per-point scale and twist handles of the spline gizmo into the sweep. |
| Orientation | Orientation (`orientation`) | enum | minimal_torsion | minimal_torsion, frenet, up_vector |  |  |
| Orientation | Up vector (`up`) | vec3 | [0, 0, 1] | -1 … 1 |  | Reference for the first frame (minimal torsion) or every frame (up vector). A ribbon faces along it. |
| UV / U (around) | U tiling (`u_tiling`) | float | 1 | 0.01 … 1000 |  |  |
| UV / V (along) | V tiling (`v_tiling`) | float | 1 | 0.001 … 10000 | ● |  |
| UV / V (along) | V offset (scroll) (`v_offset`) | float | 0 | -100000 … 100000 | ● | Animate this to scroll a texture along the mesh. |
| UV / V (along) | V in world units (`v_by_length`) | bool | false |  |  | V = distance along the path x tiling (constant texel density when the spline is resized). |
| Color | Vertex colour gradient (`use_gradient`) | bool | true |  |  |  |
| Color | Color along length (`color_gradient`) | gradient | gradient (2 stops) |  |  | Written to point Cd (alpha is an ordinary channel). |
| Color | Normals (`normals`) | enum | smooth | smooth, flat |  |  |

### Transform

`geometry.transform` · Geometry · GPU trivial, tiling pixel

Translate, rotate (Euler XYZ degrees) and scale about a pivot. Normals use the inverse transpose, orient / scale / pscale / pivot attributes follow, mirroring flips the winding. Unchanged attributes are shared (copy-on-write).

**Gizmos:** xf (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Transform | Translate (`translate`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Transform | Rotate (`rotate`) | vec3 | [0, 0, 0] | -360 … 360 | ● | Euler angles in degrees, applied X then Y then Z. |
| Transform | Scale (`scale`) | vec3 | [1, 1, 1] | -4 … 4 | ● |  |
| Transform | Uniform scale (`uniform`) | float | 1 | -1000 … 1000 | ● |  |
| Transform | Pivot (`pivot`) | vec3 | [0, 0, 0] | -10 … 10 | ● | Rotation / scale centre (before the translation). |

### Transform (Points)

`geometry.transform_points` · Geometry · GPU trivial, tiling pixel

Translate, rotate (Euler XYZ degrees) and scale about a pivot. Normals use the inverse transpose, orient / scale / pscale / pivot attributes follow, mirroring flips the winding. Unchanged attributes are shared (copy-on-write).

**Gizmos:** xf (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`input`) | points | required |
| out | Points (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Transform | Translate (`translate`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| Transform | Rotate (`rotate`) | vec3 | [0, 0, 0] | -360 … 360 | ● | Euler angles in degrees, applied X then Y then Z. |
| Transform | Scale (`scale`) | vec3 | [1, 1, 1] | -4 … 4 | ● |  |
| Transform | Uniform scale (`uniform`) | float | 1 | -1000 … 1000 | ● |  |
| Transform | Pivot (`pivot`) | vec3 | [0, 0, 0] | -10 … 10 | ● | Rotation / scale centre (before the translation). |

### Triangulate

`geometry.triangulate` · Geometry · GPU trivial, tiling pixel

Splits every polygon into triangles (fan triangulation, exact for convex polygons). Vertex attributes follow, primitive attributes are copied to each triangle.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|

### UV

`geometry.uv` · Geometry · GPU trivial, tiling pixel

Writes per-vertex UVs (v up). Planar, cylindrical, spherical and box projections work inside a projection volume you move / rotate / scale with the gizmo; Island projects every connected island along its own dominant normal and packs them on a grid (layout tool, not an unwrapper). A post transform (scale / offset / rotation) is applied about the UV centre.

**Gizmos:** volume (transform3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mesh (`input`) | mesh | required |
| out | Mesh (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| UV / Projection | Mode (`mode`) | enum | planar | planar, cylindrical, spherical, box, island |  |  |
| UV / Projection | Planar axis (`axis`) | enum | z | x, y, z |  |  |
| UV / Projection | UV set (`uv_set`) | int | 0 | 0 … 7 |  | 0 writes "uv", n writes "uv<n>". |
| UV / Projection volume | Position (`position`) | vec3 | [0, 0, 0] | -10 … 10 | ● |  |
| UV / Projection volume | Rotation (`rotation`) | vec3 | [0, 0, 0] | -360 … 360 | ● |  |
| UV / Projection volume | Size (`size`) | vec3 | [1, 1, 1] | 0.0001 … 1000 | ● |  |
| UV / Island packing | Margin (`margin`) | float (percent) | 0.05 | 0 … 0.45 |  |  |
| UV / UV transform | Uv scale (`uv_scale`) | vec2 | [1, 1] | -8 … 8 | ● |  |
| UV / UV transform | Uv offset (`uv_offset`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| UV / UV transform | Uv rotation (`uv_rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |

## Grayscale

### Ambient Occlusion

`grayscale.ao` · Grayscale · GPU high, tiling halo

Heightmap ambient occlusion: horizon-based, radius / directions / steps / bias / strength, tiling-aware. White = open, dark = occluded.

**Gizmos:** AO radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Height (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Occlusion | Radius (`radius`) | float (percent) | 0.08 | 0.002 … 0.5 | ● | Search radius as a fraction of the smaller image side. |
| Main / Occlusion | Height scale (`height_scale`) | float | 0.2 | 0 … 64 | ● | Height of value 1.0 relative to the image size. Bigger = deeper relief = darker AO. |
| Main / Occlusion | Strength (`strength`) | float | 1 | 0 … 8 | ● |  |
| Main / Occlusion | Bias (`bias`) | float (angle) | 10 | 0 … 80 |  | Horizon angle below which nothing occludes. Removes banding on flat slopes. |
| Main / Occlusion | Contrast (power) (`power`) | float | 1 | 0.1 … 8 |  |  |
| Main / Quality | Directions (`directions`) | int | 12 | 2 … 64 |  | Directions per pixel. |
| Main / Quality | Steps (`steps`) | int | 8 | 1 … 48 |  | Samples along each direction. |
| Main / Quality | Jitter (`jitter`) | bool | true |  |  | Rotates the direction set per pixel (hides banding; adds fine noise at low direction counts). |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Caustics

`grayscale.caustics` · Grayscale · GPU low, tiling pixel

Animated water caustic light patterns. Tileable (whole-number scale) and perfectly loopable: Evolution 0% == 100%, animate it from 0 to 100% for a seamless loop.

**Gizmos:** Caustics transform (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Pattern | Scale (`scale`) | vec2 | [3, 3] | 1 … 64 |  | Repeats across the image. Whole numbers while tiling. |
| Main / Pattern | Offset (`offset`) | vec2 | [0, 0] | -1 … 1 |  |  |
| Main / Animation | Evolution (`evolution`) | float (percent) | 0 | -64 … 64 | ● | 100% = exactly one seamless loop. |
| Main / Animation | Speed (`speed`) | int | 1 | 1 … 8 |  | Whole loops per 100% Evolution (keeps the loop seamless). |
| Main / Pattern | Iterations (`iterations`) | int | 5 | 2 … 8 |  | More iterations = more intricate light network. |
| Main / Pattern | Distortion (`distortion`) | float | 1 | 0 … 3 | ● | Strength of the warp between iterations. |
| Main / Look | Focus (`focus`) | float | 0.8 | 0.1 … 3 |  | Weight of each iteration in the light network. |
| Main / Look | Sharpness (`sharpness`) | float | 6 | 1 … 40 |  | Exponent: higher = thinner, sharper caustic lines. |
| Main / Look | Brightness (`brightness`) | float | 1 | 0 … 8 | ● |  |
| Main / Look | Black point (`floor_level`) | float (percent) | 0.2 | 0 … 0.95 |  | Values below this become black. |
| Main / Look | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Curvature

`grayscale.curvature` · Grayscale · GPU medium, tiling halo

Detects convex (edges, ridges, hills) and concave (creases, pits) areas of a heightmap. The radius sets the feature size that is detected.

**Gizmos:** Curvature radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Height (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Curvature | Type (`kind`) | enum | both | convex, concave, both |  |  |
| Main / Curvature | Radius (`radius`) | float (percent) | 0.01 | 0.0005 … 0.2 | ● | Feature scale as a fraction of the smaller image side. |
| Main / Curvature | Intensity (`intensity`) | float | 1 | 0 … 100 | ● | Gain applied to the detected curvature. |
| Main / Curvature | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Curve

`grayscale.curve` · Grayscale · GPU trivial, tiling pixel · identity short-cut

Remaps luminance with an editable curve (bezier / linear / step keys, tangent handles, presets). Evaluated through a 256-entry LUT.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Curve | Curve (`curve`) | curve | curve (4 keys) |  | ● | Output value as a function of the input value (both 0..1; inputs outside are clamped). |
| Main / Curve | Amount (`amount`) | float (percent) | 1 | 0 … 1 | ● | Mix between the unmodified input (0%) and the curve result (100%). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Dilate

`grayscale.dilate` · Grayscale · GPU medium, tiling halo

Morphological grow (max) / shrink (min) with a circle, square, diamond or octagon of any radius; open and close remove small bright / dark features. Tiling-aware.

**Gizmos:** Dilate radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Morphology | Operation (`operation`) | enum | grow | grow, shrink, open, close |  |  |
| Main / Morphology | Shape (`shape`) | enum | circle | circle, square, diamond, octagon |  | Structuring element. Circle is a 16-gon (max error ~2%), exact below 6 px. |
| Main / Morphology | Radius (`radius`) | float (percent) | 0.02 | 0 … 0.5 | ● | Radius as a fraction of the smaller image side. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Filter

`grayscale.filter` · Grayscale · GPU medium, tiling halo

Generic filters: sharpen, high-pass, emboss, median, box blur, gaussian blur, min and max. All kernels wrap when the node tiles.

**Gizmos:** Filter radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Filter | Mode (`mode`) | enum | sharpen | sharpen, highpass, emboss, median, box, gaussian, min, max |  |  |
| Main / Filter | Radius (`radius`) | float (percent) | 0.006 | 0 … 0.3 | ● | Kernel radius as a fraction of the smaller image side (box blur up to 160 px, gaussian sigma = radius / 2). |
| Main / Filter | Amount (`amount`) | float | 1 | -16 … 16 | ● |  |
| Main / Filter | Angle (`angle`) | float (angle) | 45 | -3600 … 3600 | ● | Light direction. |
| Main / Filter | Median size (`median_size`) | enum | 3x3 | 3x3, 5x5 |  |  |
| Main / Filter | Shape (`shape`) | enum | square | square, circle, diamond, octagon |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Fractal

`grayscale.fractal` · Grayscale · GPU high, tiling pixel

Layers recursively splatted shapes on a jittered grid, octave by octave: cones, pyramids, polygons, stars, single pixels or your own pattern / atlas. Tileable, loopable (Z layers), UV-alignable and modulatable per pixel.

**Gizmos:** Fractal transform (transform, 2d); Scale range (range, 2d); Intensity range (range, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input Pattern (`pattern`) | gray | optional · Gray pattern splatted instead of the built-in shape. Set "Atlas size" above 1x1 to treat it as an atlas of elements. |
| in | UV (`uv`) | uv | optional · Optional UV map: aligns / deforms the fractal (see the UV tab). |
| in | Z position mod (`z_position_mod`) | gray | optional · modulation · Modulates "Z position" per pixel. |
| in | Atlas mod (`atlas_pick_mod`) | gray | optional · modulation · Modulates "Atlas" per pixel. |
| in | Blending ramp mod (`ramp_mod`) | gray | optional · modulation · Modulates "Blending ramp" per pixel. |
| in | Gain mod (`gain_mod`) | gray | optional · modulation · Modulates "Gain" per pixel. |
| in | UV mod (`uv_amount_mod`) | gray | optional · modulation · Modulates "UV" per pixel. |
| in | Scale mod (`size_mod`) | gray | optional · modulation · Modulates "Scale" per pixel. |
| in | Intensity mod (`intensity_mod`) | gray | optional · modulation · Modulates "Intensity" per pixel. |
| in | Visibility mod (`visibility_mod`) | gray | optional · modulation · Modulates "Visibility" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Main | Position (`position`) | vec2 | [0, 0] | -1 … 1 |  | Moves the pattern. The pattern repeats every 100% translation. |
| Main / Main | Grid scale (`scale`) | vec2 | [4, 4] | 1 … 256 |  | Grid cells across the image on the first octave. Rounded to whole numbers on tiling axes so the pattern wraps seamlessly. |
| Main / Main | Seed (`seed`) | seed | 0 |  |  |  |
| Main / Main | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the grid. While the graph tiles it snaps to 90 degree steps. |
| Main / Main | Anisotropy (`anisotropy`) | float (percent) | 0 | -1 … 1 | ● | + squeezes the pattern horizontally, - vertically. Ignored while the graph tiles (it would break seamlessness). |
| Main / Z axis | Add Z axis (`add_z`) | bool | false |  |  | Gives every splat a life along Z: its attributes are re-rolled per Z layer and interpolated between layers. |
| Main / Z axis | Z position (`z_position`) | float (percent) | 0 | -100 … 100 | ● | 0% and 100% give the same pattern, so animating 0 -> 100% loops seamlessly. |
| Main / Z axis | Z position modulation (`z_position_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Z axis | Z layers (`z_layers`) | int | 3 | 1 … 32 |  | Number of independent slices along Z (interpolated). More layers = more change per loop. |
| Fractal / Shape | Shape (`shape`) | enum | cone | cone, pyramid, polygon, star, pixel |  |  |
| Fractal / Shape | Sides (`sides`) | int | 5 | 3 … 32 |  |  |
| Fractal / Shape | Rounding (`rounding`) | float (percent) | 0 | 0 … 1 |  |  |
| Fractal / Shape | Secondary size (`secondary`) | float (percent) | 0.4 | 0.02 … 1 |  | Inner radius of the star (pinching). |
| Fractal / Shape | Inner filling (`inner`) | float (percent) | 0 | 0 … 0.99 |  | Flat plateau in the middle of the splat (0% = pointed). |
| Fractal / Atlas | Atlas size (`atlas_size`) | vec2 | [1, 1] | 1 … 16 |  | Elements of the input pattern when it is an atlas. |
| Fractal / Atlas | Atlas (`atlas_pick`) | float (percent) | 0 | 0 … 1 |  | Offset added to the element choice. Connect "Atlas mod": its intensity blends from a random element per splat (0%) to the element chosen by the texture (100%). |
| Fractal / Atlas | Atlas modulation (`atlas_pick_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Fractal / Shape | Shape remap (`shape_curve`) | curve | curve (2 keys) |  |  | Luminance curve applied over the splat profile. |
| Fractal / Splats | Splat blending (`splat_blend`) | enum | max | add, max |  | How overlapping splats inside one octave combine. |
| Fractal / Splats | Max smoothness (`max_smooth`) | float (percent) | 0 | 0 … 1 |  |  |
| Fractal / Octaves | Octaves (`octaves`) | int | 3 | 1 … 8 |  | Number of grid refinements. |
| Fractal / Octaves | Lacunarity (`lacunarity`) | float | 2 | 1.1 … 8 |  | Grid size ratio between octaves. While tiling only whole numbers keep the grid periodic (it is rounded). |
| Fractal / Octaves | Octave blending (`octave_mode`) | enum | fbm | add, max, fbm, mix, multiply, screen |  |  |
| Fractal / Octaves | Blending ramp (`ramp`) | float (percent) | 1 | 0 … 1 | ● | Weight of the octave blend (Mix / Multiply / Screen). Unavailable for fBm and Max. |
| Fractal / Octaves | Blending ramp modulation (`ramp_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Fractal / Octaves | Gain (`gain`) | float (percent) | 0.5 | -2 … 2 | ● | Amplitude change per octave. Negative values alternate / invert octaves. |
| Fractal / Octaves | Gain modulation (`gain_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| UV / UV | Align to UVs (`uv_align`) | enum | per_pixel | ignore, per_splat, per_pixel |  |  |
| UV / UV | UV (`uv_amount`) | float (percent) | 1 | 0 … 4 |  | UV distortion amount for the whole texture. |
| UV / UV | UV modulation (`uv_amount_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Orientation | Rotation min (`rot_min`) | float (angle) | 0 | -3600 … 3600 |  |  |
| Splats / Orientation | Rotation max (`rot_max`) | float (angle) | 0 | -3600 … 3600 |  |  |
| Splats / Orientation | Flip horizontal (`flip_h`) | float (percent) | 0 | 0 … 1 |  | Chance that a splat is mirrored horizontally. |
| Splats / Orientation | Flip vertical (`flip_v`) | float (percent) | 0 | 0 … 1 |  | Chance that a splat is mirrored vertically. |
| Splats / Size | Scale min (`scale_min`) | float (percent) | 0.6 | 0 … 4 |  | 100% = the splat fills its cell. |
| Splats / Size | Scale max (`scale_max`) | float (percent) | 1 | 0 … 4 |  |  |
| Splats / Size | Horizontal scale min (`hscale_min`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Horizontal scale max (`hscale_max`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Vertical scale min (`vscale_min`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Vertical scale max (`vscale_max`) | float (percent) | 1 | 0.01 … 4 |  |  |
| Splats / Size | Scale (`size`) | float (percent) | 1 | 0 … 4 | ● | Global splat scale multiplier (modulated at each splat centre). |
| Splats / Size | Scale modulation (`size_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Position | Position randomization (`pos_random`) | float (percent) | 1 | 0 … 2 |  | 0% = regular grid. |
| Splats / Position | H/V randomization scale (`pos_scale`) | vec2 | [1, 1] | 0 … 2 |  |  |
| Splats / Position | Quincunx (`quincunx`) | enum | none | none, rows, columns |  | Offsets every other row / column by half a cell (bricks). Tiling rounds the grid to an even count on that axis. |
| Splats / Visibility | Intensity min (`int_min`) | float (percent) | 0.5 | -1 … 4 |  |  |
| Splats / Visibility | Intensity max (`int_max`) | float (percent) | 1 | -1 … 4 |  |  |
| Splats / Visibility | Intensity (`intensity`) | float (percent) | 1 | 0 … 4 | ● | Global intensity multiplier (modulated at each splat centre). |
| Splats / Visibility | Intensity modulation (`intensity_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Visibility | Visibility (`visibility`) | float (percent) | 1 | 0 … 1 | ● | Overall chance that a splat is visible. With a modulation texture the intensity acts as a threshold. |
| Splats / Visibility | Visibility modulation (`visibility_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Splats / Visibility | Visibility transition width (`vis_width`) | float (percent) | 0 | 0 … 1 |  | Width of the fade between hidden and visible (0% = hard on/off). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Gradient

`grayscale.gradient` · Grayscale · GPU trivial, tiling pixel

Linear, radial, angular, diamond, square, reflected and spiral gradients with repeat, offset, curve remap and an optional UV input.

**Gizmos:** Gradient line (line, 2d); Gradient radius (circle, 2d); Start angle (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional · Optional UV map: the gradient is evaluated through it. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Gradient | Type (`gtype`) | enum | linear | linear, radial, angular, diamond, square, reflected, spiral |  |  |
| Main / Gradient | Start (`start`) | vec2 | [0, 0.5] | -0.5 … 1.5 |  | Where the gradient is 0%. |
| Main / Gradient | End (`end`) | vec2 | [1, 0.5] | -0.5 … 1.5 |  | Where the gradient is 100%. |
| Main / Gradient | Center (`center`) | vec2 | [0.5, 0.5] | -0.5 … 1.5 |  |  |
| Main / Gradient | Radius (`radius`) | float | 0.5 | 0.001 … 8 |  | Distance (as a fraction of the smaller image side) where the gradient reaches 100%. |
| Main / Gradient | Angle (`angle`) | float (angle) | 0 | -3600 … 3600 | ● | Start angle of the sweep (clockwise). |
| Main / Gradient | Turns (`turns`) | float | 3 | -32 … 32 | ● | Number of spiral turns from the centre to the radius. |
| Main / Repeat | Repeat (`repeat`) | float | 1 | 0.01 … 64 | ● | Number of gradient cycles. While tiling, linear gradients snap to whole cycles. |
| Main / Repeat | Offset (`offset`) | float | 0 | -64 … 64 | ● | Shifts the gradient phase (loops every 100% when repeating). |
| Main / Repeat | Wrap (`wrap_mode`) | enum | clamp | clamp, repeat, mirror |  | What happens beyond 0%..100%. While tiling, linear gradients always wrap. |
| Main / Remap | Curve (`curve`) | curve | curve (2 keys) |  |  | Luminance remap of the gradient. |
| Main / Remap | Invert (`invert`) | bool | false |  |  |  |
| Main / UV | UV amount (`uv_amount`) | float (percent) | 1 | 0 … 1 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Lightning

`grayscale.lightning` · Grayscale · GPU medium, tiling pixel

Procedural lightning bolt: fractal zig-zag, taper, branches, glow halo and an animatable strike reveal.

**Gizmos:** Bolt start / end (line, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional · Optional UV map: the bolt is looked up through it (warp / deform). |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Bolt | Start (`start`) | vec2 | [0.5, 0.04] | -4 … 5 | ● | Start point (UV, y down). |
| Main / Bolt | End (`end`) | vec2 | [0.5, 0.96] | -4 … 5 | ● | End point (UV, y down). |
| Main / Bolt | Width (`width`) | float (percent) | 0.012 | 0 … 0.5 | ● | Core half-width (fraction of the smaller side). |
| Main / Bolt | Softness (`softness`) | float (percent) | 0.35 | 0 … 1 |  | Edge softness of the core. |
| Main / Bolt | Taper (`taper`) | float (percent) | 0.5 | 0 … 2 |  | Width at the end relative to the start (100% = constant width). |
| Main / Glow | Glow (`glow`) | float | 0.45 | 0 … 4 | ● | Strength of the soft halo added around the core. |
| Main / Glow | Glow radius (`glow_radius`) | float (percent) | 0.03 | 0.001 … 0.5 | ● |  |
| Main / Shape | Jaggedness (`jag`) | float (percent) | 0.09 | 0 … 1 | ● | Maximum sideways deviation as a fraction of the bolt length. |
| Main / Shape | Base segments (`segments`) | int | 5 | 1 … 64 |  | Number of kinks of the first octave; every octave doubles it. |
| Main / Shape | Octaves (`octaves`) | int | 5 | 1 … 8 |  |  |
| Main / Shape | Roughness (`roughness`) | float | 0.52 | 0 … 1 |  | Amplitude gain per octave. |
| Main / Shape | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | Smoothly morphs the bolt between random shapes (integer = a fresh shape). |
| Main / Shape | Seed (`seed`) | seed | 3 |  | ● | Random seed. Animating it (stepped) gives a classic flicker. |
| Main / Branches | Branches (`branches`) | int | 3 | 0 … 6 |  |  |
| Main / Branches | Length (`branch_length`) | float (percent) | 0.45 | 0.02 … 2 |  | Maximum branch length relative to the bolt length. |
| Main / Branches | Angle (`branch_angle`) | float (angle) | 38 | 0 … 85 |  | Average angle between a branch and the main axis. |
| Main / Branches | Width (`branch_width`) | float (percent) | 0.55 | 0.05 … 1.5 |  | Branch width relative to the main bolt. |
| Main / Branches | Jaggedness (`branch_jag`) | float (percent) | 0.8 | 0 … 3 |  |  |
| Main / Strike | Reveal (`reveal`) | float (percent) | 1 | 0 … 1 | ● | Animate 0 -> 100% to make the bolt strike from start to end (branches follow). |
| Main / Strike | Head softness (`reveal_soft`) | float (percent) | 0.12 | 0.001 … 1 |  |  |
| Main / Output | Intensity (`intensity`) | float | 1 | 0 … 4 | ● | Final multiplier: animate to fade the bolt out. |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Main / Output | UV amount (`uv_amount`) | float | 1 | 0 … 1 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Noise

`grayscale.noise` · Grayscale · GPU medium, tiling pixel

Tileable, loopable fractal noise: Perlin, Simplex, Value, Cubic, Billow, Ridged, Gabor, Worley/Cellular (F1, F2, F2-F1, cracks, cell id) and Voronoi borders, with fBm, domain warp, anisotropy and remap. Evolution animates the pattern; one full cycle (0 to 1) loops seamlessly.

**Gizmos:** Noise transform (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional · Optional UV map: the pattern is looked up through it (domain warp / deformation). |
| in | Contrast mod (`contrast_mod`) | gray | optional · modulation · Modulates "Contrast" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Noise | Type (`noise_type`) | enum | perlin | value, perlin, simplex, cubic, billow, ridged, gabor, worley_f1, worley_f2, worley_f2f1, cracks, cell_id, voronoi |  |  |
| Main / Cellular | Distance metric (`metric`) | enum | euclid | euclid, manhattan, chebyshev |  |  |
| Main / Cellular | Jitter (`jitter`) | float (percent) | 1 | 0 … 1 |  | 0% = regular grid of feature points, 100% = fully random. |
| Main / Cellular | Edge width (`edge_width`) | float | 0.08 | 0.001 … 1 |  | Width of the crack lines (in cell units). |
| Main / Gabor | Kernel frequency (`gabor_freq`) | float | 3 | 0.25 … 16 |  | Wave cycles per cell. |
| Main / Gabor | Kernel angle (`gabor_angle`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Gabor | Orientation randomness (`gabor_spread`) | float (percent) | 1 | 0 … 1 |  | 0% = every kernel points the same way (streaks), 100% = isotropic. |
| Main / Noise | Scale (`scale`) | vec2 | [4, 4] | 1 … 256 |  | Lattice cells across the image. Rounded to whole numbers on tiling axes so the pattern wraps seamlessly. |
| Main / fBm | Octaves (`octaves`) | int | 4 | 1 … 8 |  | Number of fractal layers. |
| Main / fBm | Lacunarity (`lacunarity`) | int | 2 | 2 … 4 |  | Frequency multiplier per octave (whole numbers keep it tileable). |
| Main / fBm | Gain (roughness) (`roughness`) | float (percent) | 0.5 | 0 … 1 |  | Amplitude kept per octave. |
| Main / fBm | Octave rotation (`octave_rotation`) | float (angle) | 0 | -360 … 360 | ● | Extra rotation added per octave. While the graph tiles it snaps to 90 degree steps (the lattice must stay axis aligned to remain periodic). |
| Main / Transform | Offset (`offset`) | vec2 | [0, 0] | -1 … 1 |  | Shifts the pattern (UV units). Integer offsets are identical when tiling. |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the pattern clockwise around the gizmo pivot. While the graph tiles it snaps to 90 degree steps so the result stays seamless. |
| Main / Transform | Anisotropy (`anisotropy`) | float (percent) | 0 | -1 … 1 | ● | + squeezes the pattern horizontally (stretched vertical features), - vertically. |
| Main / Warp | UV amount (`uv_amount`) | float (percent) | 1 | 0 … 1 |  | How much the connected UV map distorts the pattern (0% = ignore). |
| Main / Warp | Domain warp (`warp_amount`) | float (percent) | 0 | 0 … 1 | ● | Distorts the lookup position with a second, periodic noise (in image fractions). |
| Main / Warp | Warp frequency (`warp_freq`) | int | 3 | 1 … 32 |  |  |
| Main / Animation | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | Moves through the Z axis. 0 -> 1 is one seamless loop. |
| Main / Animation | Z layers (`z_cells`) | int | 2 | 1 … 16 |  | Z lattice layers per loop: more = faster/more change per loop. |
| Main / Noise | Seed (`seed`) | seed | 0 |  |  |  |
| Main / Levels | Contrast (`contrast`) | float | 1 | 0 … 8 | ● |  |
| Main / Levels | Contrast modulation (`contrast_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Levels | Remap in low (`remap_lo`) | float | 0 | -2 … 2 | ● | Input value mapped to black before contrast (stretch narrow noise like Perlin). |
| Main / Levels | Remap in high (`remap_hi`) | float | 1 | -2 … 2 | ● | Input value mapped to white before contrast. |
| Main / Levels | Bias (`bias`) | float (percent) | 0.5 | 0.01 … 0.99 | ● | 50% = neutral. Higher = brighter mid-tones, lower = darker (Schlick bias). |
| Main / Levels | Brightness (`brightness`) | float | 0 | -1 … 1 | ● |  |
| Main / Levels | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Polar Scatter

`grayscale.polar_scatter` · Grayscale · GPU medium, tiling pixel

Scatters a shape or an input pattern in rings and radial arrays: count per ring, ring count, radius range, spiral, angle / radius jitter, per-ring and per-element scale and rotation, spin animation.

**Gizmos:** Ring radii (falloff, 2d); Start angle (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input Pattern (`pattern`) | gray | optional · Gray pattern scattered instead of the built-in shape (fills the element footprint box). |
| in | Scale mod (`size_mod`) | gray | optional · modulation · Modulates "Scale" per pixel. |
| in | Visibility mod (`visibility_mod`) | gray | optional · modulation · Modulates "Visibility" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Layout | Center (`center`) | vec2 | [0.5, 0.5] | -0.5 … 1.5 |  | Centre of the radial array (UV). While tiling, elements wrap across the borders. |
| Main / Layout | First ring radius (`radius_min`) | float | 0.15 | 0 … 2 |  | Radius of the innermost ring (fraction of the smaller image side). |
| Main / Layout | Last ring radius (`radius_max`) | float | 0.4 | 0 … 2 |  | Radius of the outermost ring. |
| Main / Layout | Ring count (`ring_count`) | int | 3 | 1 … 64 |  |  |
| Main / Layout | Elements per ring (`count`) | int | 12 | 1 … 512 |  |  |
| Main / Layout | Count mode (`count_mode`) | enum | constant | constant, proportional |  |  |
| Main / Layout | Count growth per ring (`ring_growth`) | float | 1 | 0.1 … 4 |  |  |
| Main / Angle | Start angle (`angle_start`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Angle | Angle range (`angle_range`) | float (angle) | 360 | 1 … 360 | ● | 360 = full circle, less = an arc / fan. |
| Main / Angle | Spiral (angle per ring) (`spiral`) | float (angle) | 0 | -360 … 360 | ● |  |
| Main / Angle | Phase (`phase`) | float (percent) | 0 | -100 … 100 | ● | Animation phase: 0 -> 100% rotates every ring by "Spin" turns. Whole numbers of turns loop seamlessly. |
| Main / Angle | Spin (turns per loop) (`spin`) | float | 1 | -32 … 32 |  |  |
| Main / Angle | Alternate spin direction (`spin_alternate`) | bool | false |  |  | Every other ring turns the opposite way. |
| Main / Randomness | Seed (`seed`) | seed | 0 |  |  |  |
| Main / Randomness | Angle jitter (`angle_jitter`) | float (percent) | 0 | 0 … 1 |  | Random angular offset as a fraction of the element spacing. |
| Main / Randomness | Radius jitter (`radius_jitter`) | float (percent) | 0 | 0 … 2 |  | Random radial offset as a fraction of the ring spacing. |
| Main / Randomness | Size randomness (`size_rand`) | float (percent) | 0 | 0 … 1 |  |  |
| Main / Randomness | Rotation randomness (`rot_random`) | float (angle) | 0 | 0 … 360 |  | Each element is rotated by a random angle in +-this range. |
| Main / Randomness | Intensity min (`int_min`) | float (percent) | 1 | 0 … 4 |  |  |
| Main / Randomness | Intensity max (`int_max`) | float (percent) | 1 | 0 … 4 |  |  |
| Main / Element | Shape (`shape`) | enum | circle | circle, square, polygon, star, ring, cross |  |  |
| Main / Element | Sides (`sides`) | int | 5 | 3 … 32 |  |  |
| Main / Element | Star inner size (`pinch`) | float (percent) | 0.35 | 0 … 1 |  |  |
| Main / Element | Thickness (`thickness`) | float (percent) | 0.3 | 0.02 … 1 |  |  |
| Main / Element | Scale (`size`) | float | 0.08 | 0 … 2 | ● | Element size (fraction of the smaller image side). |
| Main / Element | Scale modulation (`size_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Element | Stretch (`stretch`) | float | 1 | 0.1 … 16 |  | Elongates the element along its local X axis (spokes / rays with radial alignment). |
| Main / Element | Scale at last ring (`ring_scale`) | float (percent) | 1 | 0 … 4 |  | Size multiplier of the outermost ring relative to the innermost (interpolated per ring). |
| Main / Element | Softness (`softness`) | float (percent) | 0 | 0 … 1 |  |  |
| Main / Orientation | Align to radius (`align_radial`) | bool | true |  |  | Rotates every element so its local X axis points away from the centre. |
| Main / Orientation | Rotation offset (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Orientation | Rotation per ring (`rot_per_ring`) | float (angle) | 0 | -360 … 360 |  |  |
| Main / Output | Overlap blending (`blend`) | enum | max | add, max |  |  |
| Main / Output | Intensity (`intensity`) | float (percent) | 1 | 0 … 4 | ● |  |
| Main / Output | Visibility (`visibility`) | float (percent) | 1 | 0 … 1 | ● | Chance that an element is visible. Connect a modulation texture to cull elements by position. |
| Main / Output | Visibility modulation (`visibility_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Ripple / Shockwave

`grayscale.ripple` · Grayscale · GPU low, tiling pixel

Shockwave and ripple profile: sharp leading edge, solid band and long soft inner tail, multiple decaying rings and an angular wobble. Animate Radius for the expansion.

**Gizmos:** Ripple centre / radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional · Optional UV map: the ripple is looked up through it (warp / deform). |
| in | Intensity mod (`intensity_mod`) | gray | optional · modulation · Modulates "Intensity" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Ring | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre (UV, y down). |
| Main / Ring | Radius (`radius`) | float (percent) | 0.3 | 0 … 4 | ● | Radius of the leading edge (fraction of the smaller image side). Animate 0 -> max for the expansion. |
| Main / Ring | Width (`width`) | float (percent) | 0.03 | 0 … 1 | ● | Solid band width behind the leading edge. |
| Main / Profile | Front sharpness (`front`) | float (percent) | 0.85 | 0 … 1 |  | 100% = razor sharp leading edge, 0% = soft as wide as the band. |
| Main / Profile | Tail length (`tail`) | float (percent) | 0.35 | 0 … 4 | ● | Length of the soft inner tail relative to the radius. |
| Main / Rings | Count (`count`) | int | 1 | 1 … 12 |  | Number of ripples. |
| Main / Rings | Spacing (`spacing`) | float (percent) | 0.08 | 0 … 1 | ● | Distance between ripples (fraction of the smaller side). |
| Main / Rings | Decay (`decay`) | float (percent) | 0.6 | 0 … 1 |  | Amplitude multiplier per following ripple. |
| Main / Wobble | Wobble (`wobble`) | float (percent) | 0 | 0 … 1 | ● | Angular radius distortion (organic, splash-like rings). |
| Main / Wobble | Lobes (`wobble_freq`) | float | 5 | 1 … 64 |  |  |
| Main / Wobble | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | Animates the wobble; every integer value returns to the same shape (loop). |
| Main / Output | Intensity (`intensity`) | float | 1 | 0 … 4 | ● |  |
| Main / Output | Intensity modulation (`intensity_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Output | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Main / Output | UV amount (`uv_amount`) | float | 1 | 0 … 1 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Rune Ring

`grayscale.rune_ring` · Grayscale · GPU medium, tiling pixel

Procedural rune / glyph ring for magic circles: random stroke glyphs on a circle, optional border lines, flicker, rotation and a reveal that draws the runes in one by one.

**Gizmos:** Rune ring centre / radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional · Optional UV map: the ring is looked up through it (warp / deform). |
| in | Intensity mod (`intensity_mod`) | gray | optional · modulation · Modulates "Intensity" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Ring | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Ring | Radius (`radius`) | float (percent) | 0.36 | 0.01 … 4 | ● | Radius of the glyph band centre (fraction of the smaller side). |
| Main / Ring | Glyph size (`glyph_height`) | float (percent) | 0.1 | 0.004 … 1 | ● | Radial size of the glyph box. |
| Main / Ring | Count (`count`) | int | 24 | 1 … 128 |  | Glyphs around the circle. |
| Main / Ring | Gap (`gap`) | float (percent) | 0.3 | 0 … 0.9 |  | Empty fraction of every glyph cell (spacing between neighbours). |
| Main / Ring | Rotation (`rotation`) | float (angle) | 0 | -36000 … 36000 | ● | Rotates the ring. Loop: 360 (or a multiple of 360 / count) per cycle. |
| Main / Stroke | Stroke (`stroke`) | float (percent) | 0.008 | 0.0005 … 0.2 | ● | Stroke width (fraction of the smaller side). |
| Main / Stroke | Softness (`softness`) | float (percent) | 0.4 | 0 … 1 |  |  |
| Main / Glyphs | Strokes per glyph (`complexity`) | int | 4 | 1 … 8 |  |  |
| Main / Glyphs | Lattice (`grid`) | int | 3 | 2 … 5 |  | Nodes per glyph axis (3 = 3x3 lattice). |
| Main / Glyphs | Vertical stem (`stem`) | bool | true |  |  | The first stroke is a vertical line through the glyph (rune look). |
| Main / Glyphs | Mirror symmetric (`mirror`) | bool | true |  |  | Mirror every stroke about the radial axis. |
| Main / Glyphs | Border circles (`ring_lines`) | bool | true |  |  | Thin circles inside and outside the glyph band. |
| Main / Variation | Flicker (`flicker`) | float (percent) | 0.2 | 0 … 1 |  | Random brightness reduction per glyph. |
| Main / Variation | Reveal (`reveal`) | float (percent) | 1 | 0 … 1 | ● | Animate 0 -> 100% to draw the glyphs in one by one (build-up). |
| Main / Output | Intensity (`intensity`) | float | 1 | 0 … 4 | ● |  |
| Main / Output | Intensity modulation (`intensity_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Output | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Main / Output | UV amount (`uv_amount`) | float | 1 | 0 … 1 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Shape

`grayscale.shape` · Grayscale · GPU low, tiling pixel

Signed-distance-field shapes: circle, ellipse, rounded rectangle, polygon, star, ring, arc, pie, cross, line, heart, drop, lightning bolt and crescent, with soft edge, bevel profile, outlines and repeat.

**Gizmos:** Shape rect (rect, 2d); Corner radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional · Optional UV map: the shape is looked up through it (warp / deform). |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Shape | Shape (`shape`) | enum | circle | circle, ellipse, rounded_rect, polygon, star, ring, arc, pie, cross, line, heart, drop, bolt, crescent |  |  |
| Main / Shape | Size (`size`) | vec2 | [0.5, 0.5] | 0 … 4 |  | Width and height as a fraction of the (repeat) cell. |
| Main / Shape | Position (`position`) | vec2 | [0.5, 0.5] | -0.5 … 1.5 |  | Shape centre (UV). With Repeat it is the centre of one cell. |
| Main / Shape | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Shape | Sides (`sides`) | int | 5 | 3 … 32 |  |  |
| Main / Shape | Rounding (`rounding`) | float (percent) | 0 | 0 … 1 |  | Corner rounding (0% sharp, 100% fully round). |
| Main / Shape | Star inner size (`pinch`) | float (percent) | 0.35 | 0 … 1 |  | Pinching of the star: 100% = regular polygon, 0% = very thin spikes. |
| Main / Shape | Thickness (`thickness`) | float (percent) | 0.3 | 0.02 … 1 |  | Band / arm / crescent thickness. |
| Main / Shape | Aperture (`aperture`) | float (angle) | 120 | 1 … 359 | ● | Opening angle of the arc / pie. |
| Main / Repeat | Repeat (`repeat`) | vec2 | [1, 1] | 1 … 64 |  | Whole number of repetitions. Repeats (and tiling) wrap seamlessly. |
| Main / Edge | Softness (`softness`) | float (percent) | 0 | 0 … 1 | ● | Edge falloff measured inward from the outline, relative to the shape size. The edge is always anti-aliased. |
| Main / Edge | Bevel (`bevel`) | float (percent) | 0 | 0 … 1 | ● | Width of the inner profile ramp (0% = flat fill). |
| Main / Edge | Bevel profile (`profile`) | curve | curve (2 keys) |  |  | Curve over the bevel: left = shape edge, right = end of the bevel. |
| Main / Outline | Output (`output_mode`) | enum | fill | fill, inner_outline, outer_outline, outline |  |  |
| Main / Outline | Outline width (`outline_width`) | float (percent) | 0.1 | 0.001 … 1 | ● | Outline width relative to the shape size. |
| Main / Output | Intensity (`intensity`) | float (percent) | 1 | 0 … 4 | ● |  |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Main / UV | UV amount (`uv_amount`) | float (percent) | 1 | 0 … 1 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Slice

`grayscale.slice` · Grayscale · GPU trivial, tiling pixel

Extracts one or several iso-bands of a heightmap: everything within `width` of the band centre becomes white. Contour lines, terraces and rim masks.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Center mod (`center_mod`) | gray | optional · modulation · Modulates "Center" per pixel. |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Band | Center (`center`) | float | 0.5 | -16 … 16 | ● | Height of the (first) band centre. |
| Main / Band | Center modulation (`center_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Band | Width (`width`) | float | 0.1 | 0 … 16 | ● | Full width of a band. |
| Main / Band | Softness (`softness`) | float (percent) | 0.2 | 0 … 1 | ● | Soft edge as a fraction of the half width. |
| Main / Band | Profile (`profile`) | enum | flat | flat, ramp |  | Flat = constant inside the band, Ramp = peak at the centre. |
| Main / Multiple bands | Bands (`bands`) | int | 1 | 1 … 64 |  | Number of bands (centred around "Center"). |
| Main / Multiple bands | Spacing (`spacing`) | float | 0.2 | 0 … 16 | ● | Distance between neighbouring band centres. |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Spline

`grayscale.spline` · Grayscale · GPU medium, tiling pixel

Draws splines into a mask. Edit them with the spline gizmo in the 2D viewport (click to add points, drag handles, Alt = free handles). Width profile along the length, per-point width, caps, softness; strokes wrap when the graph tiles. Second output: end-to-end gradient.

**Gizmos:** Spline (path, 2d); Spline 2 (path, 2d); Spline 3 (path, 2d); Spline 4 (path, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Spline (`spline_in`) | spline | optional · Optional Spline input: its splines are drawn instead of the points edited in this node (first four). |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Mask (`output`) | gray |  |
| out | Gradient (`gradient`) | gray | End-to-end gradient: 0 at the start of the spline, 100% at its end (only where the stroke is). |
| out | Spline (`spline_out`) | spline | The splines drawn by this node (input or internal points), for Sweep, Spline Transform, ... |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Splines | Spline 1 (`spline`) | spline | … |  |  | Edited with the spline gizmo in a 2D viewport. |
| Main / Splines | Spline 2 (`spline_2`) | spline | … |  |  |  |
| Main / Splines | Spline 3 (`spline_3`) | spline | … |  |  |  |
| Main / Splines | Spline 4 (`spline_4`) | spline | … |  |  |  |
| Main / Stroke | Width (`width`) | float (percent) | 0.05 | 0 … 1 | ● | Full width of the stroke (fraction of the smaller image side) for points without their own width. |
| Main / Stroke | Width profile (`width_curve`) | curve | curve (2 keys) |  | ● | Width multiplier along the length of the spline (left = start, right = end). |
| Main / Stroke | Caps (`cap`) | enum | round | round, butt, square |  | End caps of open splines. |
| Main / Stroke | Softness (`softness`) | float (percent) | 0.3 | 0 … 1 | ● | Soft edge as a fraction of the half width (always at least one pixel of antialiasing). |
| Main / Stroke | Cross section (`profile`) | enum | flat | flat, round, cone |  |  |
| Main / Stroke | Intensity (`intensity`) | float | 1 | 0 … 16 | ● |  |
| Main / Stroke | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Starburst / Glint

`grayscale.starburst` · Grayscale · GPU low, tiling pixel

Spike rays, star glints and flare bursts: N tapered rays with random lengths, long / short alternation, core and halo, rotation and twinkle. For sparkles, muzzle flashes, hit flashes and crystals.

**Gizmos:** Burst centre / length (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional · Optional UV map: the burst is looked up through it (warp / deform). |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Burst | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre (UV, y down). |
| Main / Burst | Ray length (`radius`) | float (percent) | 0.45 | 0.005 … 4 | ● | Length of the longest ray (fraction of the smaller image side). |
| Main / Rays | Rays (`rays`) | int | 4 | 1 … 64 |  | Number of rays (4 = classic glint, 8 = with short diagonals). |
| Main / Rays | Ray width (`ray_width`) | float (percent) | 0.05 | 0 … 1 | ● | Half width at the centre relative to the ray length. |
| Main / Rays | Taper (`taper`) | float | 1.5 | 0 … 8 |  | How fast the ray thins towards its tip (0 = constant width). |
| Main / Rays | Falloff (`falloff`) | float | 1.2 | 0 … 8 |  | Brightness falloff along the ray (0 = full brightness to the tip). |
| Main / Rays | Softness (`softness`) | float (percent) | 0.5 | 0 … 1 |  | Edge softness across the ray. |
| Main / Variation | Length randomness (`length_random`) | float (percent) | 0.3 | 0 … 1 |  |  |
| Main / Variation | Odd ray length (`alt_scale`) | float (percent) | 1 | 0 … 1 |  | Length of every second ray (8 rays + 40% = 4-point star with small diagonals). |
| Main / Variation | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Variation | Twinkle (`twinkle`) | float | 1 | 0 … 3 | ● | Multiplies every ray length: animate for a twinkle / pop-in. |
| Main / Core | Core size (`core_size`) | float (percent) | 0.04 | 0.001 … 1 | ● |  |
| Main / Core | Core glow (`core_glow`) | float | 1 | 0 … 4 | ● |  |
| Main / Core | Halo radius (`halo_radius`) | float (percent) | 0.12 | 0.001 … 2 |  |  |
| Main / Core | Halo (`halo`) | float (percent) | 0.2 | 0 … 1 | ● | Soft glow around the core. |
| Main / Output | Intensity (`intensity`) | float | 1 | 0 … 4 | ● |  |
| Main / Output | Seed (`seed`) | seed | 1 |  | ● |  |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Main / Output | UV amount (`uv_amount`) | float | 1 | 0 … 1 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Threshold

`grayscale.threshold` · Grayscale · GPU trivial, tiling pixel

Hard or soft threshold of a Gray input. The threshold can be modulated per pixel by a Gray texture.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Threshold mod (`threshold_mod`) | gray | optional · modulation · Modulates "Threshold" per pixel. |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Threshold | Type (`type`) | enum | hard | hard, soft |  |  |
| Main / Threshold | Threshold (`threshold`) | float | 0.5 | -16 … 16 | ● | Values at or above the threshold become the high level. |
| Main / Threshold | Threshold modulation (`threshold_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Threshold | Smoothness (`smoothness`) | float | 0.1 | 0 … 8 | ● | Half width of the soft transition around the threshold. |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Main / Output | Low level (`low`) | float | 0 | -16 … 16 |  |  |
| Main / Output | High level (`high`) | float | 1 | -16 … 16 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Uniform

`grayscale.uniform` · Grayscale · GPU trivial, tiling pixel

A constant gray value (resolution, filtering and tiling come from the Texture tab). Connect a Gray texture to "Value mod" to modulate it per pixel; values above 100% are kept for HDR use.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Value mod (`value_mod`) | gray | optional · modulation · Modulates "Value" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main | Value (`value`) | float | 0.5 | -16 … 16 | ● |  |
| Main | Value modulation (`value_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### XDoG

`grayscale.xdog` · Grayscale · GPU medium, tiling halo

Extended difference of gaussians: turns any Gray image into ink lines, hatching or a toon threshold. Radius = detail size, Sharpness / Epsilon / Phi shape the result.

**Gizmos:** XDoG radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / XDoG | Radius (`radius`) | float (percent) | 0.004 | 0.0005 … 0.1 | ● | Detail size (smaller gaussian sigma = radius / 2). |
| Main / XDoG | Scale ratio (k) (`k`) | float | 1.6 | 1.05 … 8 |  | Ratio between the two gaussians. |
| Main / XDoG | Sharpness (`sharpness`) | float | 20 | 0 … 200 | ● | p: boosts the difference of gaussians. |
| Main / XDoG | Epsilon (`epsilon`) | float | 0.5 | -2 … 2 | ● | Threshold: values above stay white. |
| Main / XDoG | Phi (`phi`) | float | 10 | 0.1 … 500 |  | Softness of the tanh ramp below the threshold (higher = harder). |
| Main / XDoG | Hard threshold (`hard`) | bool | false |  |  |  |
| Main / XDoG | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

## Import

### Flipbook (Import)

`import.flipbook` · Import · GPU trivial, tiling global

Imports an existing flipbook sheet and lets you edit it per frame (select, paint over, replace, reorder, delete, duplicate) in the Flipbook Editor panel. Outputs the re-ordered sheet as a Color texture and as a Flipbook.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Sheet (`output`) | color |  |
| out | Flipbook (`flipbook`) | flipbook |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Source | Image (data) (`image`) | string |  |  |  | PNG data URL stored in the project. Use the Flipbook Editor panel to import / edit. |
| Main / Source | File name (`name`) | string |  |  |  |  |
| Main / Grid | Cols (`cols`) | int | 4 | 1 … 256 |  |  |
| Main / Grid | Rows (`rows`) | int | 4 | 1 … 256 |  |  |
| Main / Grid | Source frame count (`frames`) | int | 16 | 1 … 65536 |  |  |
| Main / Grid | Padding (`padding`) | int | 0 | 0 … 64 |  |  |
| Main / Grid | Row order (`row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Main / Edit | Frame order (`order`) | string |  |  |  | JSON list of source frame indices in playback order (edited by the Flipbook Editor). |
| Main / Color | sRGB → linear (`linearize`) | bool | true |  |  | Convert colours from sRGB (as stored in PNG files) to the linear space of the graph. |

### Model (Import)

`import.model` · Import · GPU trivial, tiling global

Imports a GLB, glTF or OBJ file as a Mesh. Drop the file onto the graph to create this node. Geometry only (positions, normals, UVs, vertex colours).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Mesh (`mesh`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Source | Model (`asset`) | asset | — |  |  | Click to import a file or pick one already in the project. |
| Main / Transform | Scale (`scale`) | float | 1 | 0.0001 … 10000 |  | Uniform scale applied at import. |
| Main / Transform | Up axis (`axis`) | enum | y_up_to_z_up | none, y_up_to_z_up, z_up_to_y_up |  | The 3D viewport and the mesh nodes are Z-up; glTF / OBJ files are usually Y-up. |
| Main / Transform | Pivot (`pivot`) | enum | none | none, center, base |  |  |
| Main / UV | UV V (`uv_flip`) | enum | auto | auto, on, off |  |  |

### Texture (Import)

`import.texture` · Import · GPU low, tiling global

Imports an image file (PNG, JPG, WEBP, TGA, EXR, HDR). Drop a file onto the graph to create this node. Outputs the colour, a gray channel, alpha, a decoded normal map, a UV field and a flipbook (grid detection or manual grid). Huge files can be downscaled on import.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Output (`output`) | color |  |
| out | Gray (`gray`) | gray |  |
| out | Alpha (`alpha`) | gray |  |
| out | Normal (`normal`) | normal |  |
| out | UV (`uv`) | uv |  |
| out | Flipbook (`flipbook`) | flipbook |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Source | Image (`asset`) | asset | — |  |  | Click to import a file or pick one already in the project. |
| Main / Source | Color space (`color_space`) | enum | srgb | srgb, linear |  | 8-bit files: sRGB converts to linear for colour textures; choose Linear for normal maps, masks and packed data. EXR / HDR are always linear. |
| Main / Source | Downscale on import (`max_size`) | enum | 4096 | 0, 8192, 4096, 2048, 1024, 512 |  | Larger images are reduced (box filter) while decoding to protect GPU memory. |
| Main / Source | Output size (`size_mode`) | enum | native | native, graph |  | Native keeps the image resolution; Fit graph size resamples to the Texture tab size (wrap-aware). |
| Main / Gray output | Gray source (`gray_channel`) | enum | luma | luma, r, g, b, a |  |  |
| Main / Normal output | Flip green (DirectX → OpenGL) (`flip_green`) | bool | false |  |  | Inverts the green channel of the decoded normal map. |
| Main / UV output | UV decode (`uv_decode`) | enum | absolute | absolute, biased |  |  |
| Main / UV output | Flow range (`uv_range`) | float | 0.1 | 0 … 4 |  |  |
| Main / Flipbook | Grid (`grid_mode`) | enum | none | none, manual, auto |  |  |
| Main / Flipbook | Cols (`cols`) | int | 4 | 1 … 256 |  |  |
| Main / Flipbook | Rows (`rows`) | int | 4 | 1 … 256 |  |  |
| Main / Flipbook | Frame count (`frames`) | int | 16 | 1 … 65536 |  |  |
| Main / Flipbook | Playback fps (`fps`) | float | 30 | 1 … 240 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

## Islands

### Islands Generate

`islands.generate` · Islands · GPU medium, tiling global

Finds the connected islands of a mask and describes every one of them: bounding box (Island Map for the other Islands nodes), random ID, size, centre of mass and an exact label. Tiling aware, 4 or 8 connectivity.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mask (`input`) | gray | required |
| out | Island Map (`islands`) | color | rgba = bounding box (min x, min y, width, height) of the island in UV units. Wire into the other Islands nodes. |
| out | ID (`id`) | gray | Random gray per island (hash of the Island Map). |
| out | Size (`size`) | gray | Island area relative to Size reference. |
| out | Centre (`center`) | uv | Centre of mass of the island (absolute UV coordinate, same for every pixel of the island). |
| out | Labels (`labels`) | color | Exact label: packed coordinate of the first pixel of the island (xhi, xlo, yhi, ylo). |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Mask | Threshold (`threshold`) | float | 0.5 | -16 … 16 | ● |  |
| Main / Mask | Invert (`invert`) | bool | false |  |  |  |
| Main / Mask | Connectivity (`connectivity`) | enum | eight | four, eight |  |  |
| Main / Output | Size reference (`size_reference`) | float (percent) | 0.1 | 0.0001 … 1 | ● | Fraction of the image area that maps to 100% in the Size output. |
| Main / Output | ID seed (`seed`) | seed | 1 |  |  |  |
| Main / Limits | Max islands (`max_islands`) | enum | 65536 | 16384, 65536, 262144 |  | Capacity of the statistics table (memory = 96 bytes per island). Extra islands degrade to one-pixel boxes. |
| Main / Limits | Rounds (0 = auto) (`rounds`) | int | 0 | 0 … 64 |  | Union-find rounds. Auto = log2(size) + 4, which converged for every tested shape in 2-5 rounds. |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Islands Padding

`islands.padding` · Islands · GPU medium, tiling global

Grows every island outwards by a distance (nearest island wins) and returns an Island Map in which the padded pixels belong to their island. Use before To Color / To UV to add bleed around shards.

**Gizmos:** Padding distance (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Island Map (`islands`) | color | required |
| out | Island Map (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Padding | Distance (`distance`) | float (percent) | 0.02 | 0 … 0.5 | ● | Growth distance as a fraction of the smaller side. |
| Main / Padding | Shape (`shape`) | enum | euclidean | euclidean, square |  |  |
| Main / Padding | Expand bounding boxes (`expand_bounds`) | bool | true |  |  | Grow the bounding box by the padding so local gradients / UVs cover the padded island. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Islands To Color

`islands.to_color` · Islands · GPU trivial, tiling pixel

Gives every island its own colour: random HSV within ranges, a lookup into a gradient by the island id, or the colour of an input image sampled at the island centre.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Island Map (`islands`) | color | required |
| in | Color (`color`) | color | optional · Source for the "Sample input" mode: read at the centre of each island. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Color (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Color | Mode (`mode`) | enum | random | random, gradient, input |  |  |
| Main / Color | Hue range (`hue_range`) | vec2 | [0, 1] | -4 … 4 |  |  |
| Main / Color | Saturation range (`sat_range`) | vec2 | [0.6, 0.9] | 0 … 1 |  |  |
| Main / Color | Value range (`val_range`) | vec2 | [0.6, 1] | 0 … 4 |  |  |
| Main / Color | Gradient (`gradient`) | gradient | gradient (5 stops) |  | ● |  |
| Main / Color | Outside islands (`background_color`) | color | [0, 0, 0, 0] |  |  |  |
| Main / Color | Seed (`seed`) | seed | 1 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Islands To Gradient

`islands.to_gradient` · Islands · GPU trivial, tiling pixel

Draws a gradient inside every island, relative to its bounding box: directional, from the centre, angular or edge-to-centre, with per-island random direction / inversion, repeat and a remap curve.

**Gizmos:** Direction (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Island Map (`islands`) | color | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Gradient (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Gradient | Mode (`mode`) | enum | direction | direction, center, angular, box |  |  |
| Main / Gradient | Angle (`angle`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Gradient | Random angle (`angle_random`) | float (percent) | 0 | 0 … 1 | ● | 100% = every island gets a random direction over the full circle. |
| Main / Gradient | Keep aspect (`keep_aspect`) | bool | true |  |  | On: isotropic (pixel) space. Off: every island box is stretched to a unit square. |
| Main / Gradient | Repeat (`repeat`) | float | 1 | 0.01 … 64 | ● |  |
| Main / Gradient | Offset (`offset`) | float | 0 | -64 … 64 | ● |  |
| Main / Gradient | Wrap (repeat / offset) (`wrap`) | bool | false |  |  | Wrap the gradient instead of clamping it. |
| Main / Gradient | Invert (`invert`) | bool | false |  |  |  |
| Main / Gradient | Random invert (`random_invert`) | float (percent) | 0 | 0 … 1 | ● | Probability that an island is inverted. |
| Main / Remap | Curve (`curve`) | curve | curve (2 keys) |  | ● |  |
| Main / Gradient | Seed (`seed`) | seed | 1 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Islands To Grayscale

`islands.to_grayscale` · Islands · GPU trivial, tiling pixel

One gray value per island: random, or derived from the island (bounding box area, width, height, aspect, position, distance from the image centre), with output range and quantization.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Island Map (`islands`) | color | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Gray (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Gray | Mode (`mode`) | enum | random | random, area, width, height, aspect, pos_x, pos_y, center_distance |  |  |
| Main / Gray | Output range (`range`) | vec2 | [0, 1] | -4 … 4 | ● |  |
| Main / Gray | Quantize steps (`steps`) | int | 0 | 0 … 256 |  | 0 / 1 = continuous. |
| Main / Gray | Size reference (`size_reference`) | float (percent) | 0.25 | 0.0001 … 1 |  | Box side (fraction of the image) that maps to white; area uses its square. |
| Main / Gray | Outside islands (`background`) | float | 0 | 0 … 1 |  |  |
| Main / Gray | Seed (`seed`) | seed | 1 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Islands To UV

`islands.to_uv` · Islands · GPU trivial, tiling pixel

Local UV coordinates for every island: 0..1 across its bounding box with stretch / fit / fill, rotation (also random and 90 degree steps), mirror and scale. Feed it to Transform's UV pin to put a texture on every shard.

**Gizmos:** Rotation (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Island Map (`islands`) | color | required |
| out | UV (`output`) | uv |  |
| out | Mask (`mask`) | gray | 1 inside islands. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / UV | Fit (`fit`) | enum | fit | stretch, fit, fill |  |  |
| Main / UV | Angle (`angle`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / UV | Random angle (`angle_random`) | float (percent) | 0 | 0 … 1 | ● |  |
| Main / UV | Random 90° steps (`random_90`) | bool | false |  |  |  |
| Main / UV | Align long axis (`align_long`) | bool | false |  |  | Turns tall islands by 90° so the image runs along the long side. |
| Main / UV | Random mirror (`mirror`) | bool | false |  |  |  |
| Main / UV | Scale (`scale`) | float | 1 | 0.01 … 64 | ● |  |
| Main / UV | Offset (`offset`) | vec2 | [0, 0] | -8 … 8 | ● |  |
| Main / UV | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

## Normal

### Color to Normal

`normal.color_to_normal` · Normal · GPU trivial, tiling pixel

Interprets a Color texture as a normal map: RGB as stored, two-channel RG with reconstructed Z, or DXT5nm (X in alpha, Y in green). Optional axis flips and renormalization.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Color (`input`) | color | required |
| out | Normal (`output`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Convert | Source (`source`) | enum | rgb | rgb, rg, dxt5nm |  |  |
| Main / Convert | Flip X (red) (`flip_x`) | bool | false |  |  |  |
| Main / Convert | Flip Y (green) (`flip_y`) | bool | false |  |  | Converts between OpenGL and DirectX normal maps. |
| Main / Convert | Normalize (`normalize`) | bool | true |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Normal Combine

`normal.combine` · Normal · GPU trivial, tiling pixel

Blends a detail normal map onto a base normal map: reoriented normal mapping (RNM), UDN detail, whiteout, linear and partial derivative, with detail strength, opacity and a mask.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Base (`base`) | normal | required |
| in | Detail (`detail`) | normal | optional |
| in | Mask (`mask`) | gray | optional |
| out | Normal (`output`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Combine | Blend mode (`mode`) | enum | reoriented | reoriented, detail, whiteout, linear, partial |  |  |
| Main / Combine | Detail strength (`detail_strength`) | float | 1 | 0 … 8 | ● | Scales the slope of the detail normals. |
| Main / Combine | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Normal Create

`normal.create` · Normal · GPU low, tiling halo

Creates a normal map from a height map: strength and height scale, OpenGL / DirectX Y convention, 4-way central, 8-way Sobel or Scharr kernels, tiling aware.

**Gizmos:** Sample distance (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Height (`input`) | gray | required |
| out | Normal (`output`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Normal | Strength (`strength`) | float | 1 | 0 … 64 | ● | Multiplier of the slope. |
| Main / Normal | Height scale (`height_scale`) | float (percent) | 0.05 | 0 … 4 | ● | Height 0 -> 100% corresponds to this fraction of the smaller image side (resolution independent). |
| Main / Normal | Kernel (`kernel`) | enum | sobel | central, sobel, scharr |  |  |
| Main / Normal | Sample distance (`radius`) | float (percent) | 0.001 | 0 … 0.2 | ● | Distance of the taps as a fraction of the smaller side (at least one pixel). Larger = broader, softer normals. |
| Main / Normal | Y convention (`y_convention`) | enum | opengl | opengl, directx |  |  |
| Main / Normal | Invert height (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Normal Merge

`normal.normal_merge` · Normal · GPU trivial, tiling pixel

Builds a normal map from X and Y Gray textures (50% = 0). Z is reconstructed from X and Y, or taken from an optional third input and normalized.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | X (`x`) | gray | optional |
| in | Y (`y`) | gray | optional |
| in | Z (`z`) | gray | optional |
| out | Normal (`output`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Merge | Mode (`mode`) | enum | reconstruct | reconstruct, xyz |  |  |
| Main / Merge | Range (`range`) | float | 1 | 0 … 4 | ● | Scales X / Y after decoding (strength of the tilt). |
| Main / Merge | Flip Y (`flip_y`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Normal Split

`normal.normal_split` · Normal · GPU trivial, tiling pixel

Splits a normal map into X, Y and Z Gray textures: encoded (50% = 0), magnitude or positive part; optional Y flip and normalization.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Normal (`input`) | normal | required |
| out | X (`x`) | gray |  |
| out | Y (`y`) | gray |  |
| out | Z (`z`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Split | Format (`format`) | enum | encoded | encoded, magnitude, positive |  |  |
| Main / Split | Flip Y (`flip_y`) | bool | false |  |  |  |
| Main / Split | Normalize (`normalize`) | bool | true |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Normal to Color

`normal.normal_to_color` · Normal · GPU trivial, tiling pixel

Converts a normal map to a Color texture: encoded RGB, signed float vectors, two-channel RG or DXT5nm layout; optional Y flip (OpenGL <-> DirectX).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Normal (`input`) | normal | required |
| out | Color (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Convert | Format (`format`) | enum | encoded | encoded, signed, two_channel, dxt5nm |  |  |
| Main / Convert | Flip Y (green) (`flip_y`) | bool | false |  |  |  |
| Main / Convert | Normalize (`normalize`) | bool | true |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

## Particle

### Emitter

`particle.emitter` · Particle · time dependent · GPU trivial, tiling pixel

Deterministic particle emitter: burst or continuous, cone / sphere / ring emission, speed, gravity, drag, turbulence and size / colour / alpha over life. Closed form, loops seamlessly. Feeds 2D Render and Copy To Points.

**Gizmos:** Emitter centre (point3d, 3d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`points`) | points | optional · Optional: emit from the positions of these points (Count follows the input). |
| out | Points (`points`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Emission / Timing | Mode (`mode`) | enum | oneshot | oneshot, loop |  | One-shot: particles are born once and are all dead at the end of the timeline. Loop: C = round(1 / lifetime) lifetimes per loop, seamless. |
| Emission / Timing | Count (`count`) | int | 64 | 0 … 1000000 |  | Particles per loop (loop mode: per lifetime cycle). |
| Emission / Timing | Lifetime (`lifetime`) | float (percent) | 0.6 | 0.01 … 1 |  | Particle lifetime as a fraction of the loop / timeline. |
| Emission / Timing | Spawn window (`spawn_window`) | float (percent) | 0.15 | 0 … 1 |  | One-shot: births are spread over this fraction of the timeline (0 = one burst at the start). |
| Emission / Timing | Seed (`seed`) | seed | 1 |  |  |  |
| Emission / Shape | Shape (`shape`) | enum | point | point, disc, ring, box, line |  |  |
| Emission / Shape | Plane (`plane`) | enum | xy | xy, xz, yz |  | World plane of the emission shape and the velocity (match the 2D Render plane). |
| Emission / Shape | Center (`center`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Emission / Shape | Size (`size`) | vec3 | [0.2, 0.2, 0] | 0 … 1000 | ● | Extents of the emission shape (diameter for disc / ring). |
| Emission / Limits | Hard cap (`max_points`) | int | 200000 | 1 … 1000000 |  |  |
| Motion / Velocity | Direction (`direction`) | float (angle) | 90 | -3600 … 3600 | ● | Emission direction in the plane (0 = +first axis, 90 = +second axis = up in XY). |
| Motion / Velocity | Cone (`cone`) | float (angle) | 360 | 0 … 360 | ● | Cone angle around the direction (360 = every direction). |
| Motion / Velocity | Outward (`outward`) | bool | false |  |  | Emit away from the centre (explosions, rings). |
| Motion / Velocity | Speed (`speed`) | float | 0.5 | 0 … 1000 | ● | Initial speed (world units per loop). |
| Motion / Velocity | Speed random (`speed_random`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Motion / Forces | Gravity (`gravity`) | vec3 | [0, -0.5, 0] | -4 … 4 | ● | Acceleration (world units per loop squared). |
| Motion / Forces | Drag (`drag`) | float | 1 | 0 … 100 |  | Linear drag (1/loop): sparks decelerate. |
| Motion / Forces | Turbulence (`turbulence`) | float | 0 | 0 … 10 | ● | Noise displacement amplitude (world units), growing with age. |
| Motion / Forces | Turbulence freq (`turbulence_freq`) | float | 2 | 0 … 64 |  |  |
| Look / Size | Size (pscale) (`size_pscale`) | float | 0.03 | 0 … 100 | ● |  |
| Look / Size | Size random (`size_random`) | float (percent) | 0.4 | 0 … 1 |  |  |
| Look / Size | Size over life (`size_over_life`) | bool | true |  |  |  |
| Look / Size | Size over life (`size_curve`) | curve | curve (2 keys) |  |  |  |
| Look / Rotation | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 |  |  |
| Look / Rotation | Rotation random (`rotation_random`) | float (percent) | 0 | 0 … 1 |  |  |
| Look / Rotation | Spin turns (`spin_turns`) | float | 0 | -16 … 16 |  | Turns over the lifetime (random direction per particle). |
| Look / Color | Color (Cd) (`color`) | color | [1, 1, 1, 1] |  | ● |  |
| Look / Color | Intensity (`intensity`) | float | 1 | 0 … 100 | ● | HDR multiplier of the colour. |
| Look / Color | Color over life (`color_over_life`) | bool | true |  |  |  |
| Look / Color | Color over life (`color_gradient`) | gradient | gradient (3 stops) |  |  |  |
| Look / Color | Alpha over life (`alpha_over_life`) | bool | true |  |  |  |
| Look / Color | Alpha over life (`alpha_curve`) | curve | curve (4 keys) |  |  |  |

### Point Attributes

`particle.point_attributes` · Particle · time dependent · GPU trivial, tiling pixel

Creates or modifies particle attributes over time. Position flows by a travel vector per loop (wrapped inside the emission box) with periodic noise drift; age loops N lifetimes per loop; size and colour can follow curves / gradients over age. All values are functions of the loop phase so the result loops exactly.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`points`) | points | optional · Optional: modify these points instead of creating new ones. |
| out | Points (`points`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Points / Emission | Count (`count`) | int | 64 | 1 … 1000000 |  | Points created when no input is connected. |
| Points / Emission | Seed (`seed`) | seed | 1 |  |  |  |
| Points / Emission | Box center (`box_center`) | vec3 | [0, 0, 0] | -2 … 2 | ● |  |
| Points / Emission | Box size (`box_size`) | vec3 | [1, 1, 0] | 0 … 1000 | ● | Emission and wrap box (world units). 1 × 1 covers the whole image of a 2D Render with extent 1. |
| Points / Emission | Hard cap (`max_points`) | int | 500000 | 1 … 1000000 |  | Safety cap on created points. |
| Motion / Flow | Travel (`travel`) | vec3 | [0, 0.5, 0] | -2 … 2 | ● | Displacement over one loop. |
| Motion / Flow | Wrap (`wrap`) | bool | true |  |  | Wrap positions inside the box (endless flow). |
| Motion / Flow | Snap travel to whole boxes (`snap_travel`) | bool | true |  |  | With wrap: rounds the travel of every axis to a whole number of box sizes so the loop is exactly periodic. |
| Motion / Drift | Drift amount (`drift_amount`) | float | 0.05 | 0 … 10 | ● |  |
| Motion / Drift | Drift freq (`drift_freq`) | float | 2 | 0 … 64 |  |  |
| Motion / Drift | Drift cycles (`drift_cycles`) | int | 1 | 1 … 16 |  | Noise cycles per loop (integer = seamless). |
| Life / Age | Life cycles (`life_cycles`) | int | 1 | 0 … 16 |  | Lifetimes per loop (0 = age follows the loop phase). |
| Life / Age | Age random (`age_random`) | float (percent) | 1 | 0 … 1 |  | Random starting age per particle. |
| Look / Size | Size (pscale) (`size`) | float | 0.06 | 0 … 100 | ● |  |
| Look / Size | Size random (`size_random`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Look / Size | Size over age (`size_over_age`) | bool | true |  |  |  |
| Look / Size | Size over age (`size_curve`) | curve | curve (3 keys) |  |  |  |
| Look / Rotation | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Look / Rotation | Rotation random (`rotation_random`) | float (percent) | 0 | 0 … 1 |  |  |
| Look / Rotation | Spin turns (`spin_turns`) | float | 0 | -16 … 16 |  | Turns per loop (whole numbers loop seamlessly). |
| Look / Color | Color (Cd) (`color`) | color | [1, 1, 1, 1] |  | ● |  |
| Look / Color | Color over age (`color_over_age`) | bool | true |  |  |  |
| Look / Color | Color over age (`color_gradient`) | gradient | gradient (3 stops) |  |  |  |

### 2D Render

`particle.render_2d` · Particle · GPU medium, tiling global

Renders points as sprites (soft disc, square, ring, diamond or an input sprite / atlas) with GPU instanced quads: size, rotation and colour come from the point attributes (pscale, rot, Cd, age, v). Additive, alpha or max blending, soft edge, motion stretch and tiling wrap. Hard caps on count and memory.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Points (`points`) | points | required |
| in | Sprite (`sprite`) | color | optional · Optional sprite or atlas texture. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / View | Plane (`plane`) | enum | xy | xy, xz, yz |  | World plane projected into the image. |
| Main / View | View center (`center`) | vec2 | [0, 0] | -2 … 2 | ● |  |
| Main / View | View width (world) (`extent`) | float | 1 | 0.001 … 1000 | ● | World units covered by the image width. |
| Main / Sprite | Blend (`blend`) | enum | additive | additive, alpha, max |  |  |
| Main / Sprite | Shape (`shape`) | enum | disc | disc, square, ring, diamond, sprite |  | Sprite uses the Sprite input. |
| Main / Sprite | Soft edge (`soft`) | float (percent) | 0.6 | 0.001 … 1 | ● |  |
| Main / Sprite | Size scale (`size_scale`) | float | 1 | 0 … 1000 | ● |  |
| Main / Sprite | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Sprite | Intensity (`intensity`) | float | 1 | 0 … 100 | ● |  |
| Main / Motion stretch | Trail (loop fraction) (`trail`) | float (percent) | 0 | 0 … 1 | ● | Stretches every sprite along its velocity by this fraction of one loop of travel. |
| Main / Atlas | Atlas cols (`atlas_cols`) | int | 1 | 1 … 64 |  |  |
| Main / Atlas | Atlas rows (`atlas_rows`) | int | 1 | 1 … 64 |  |  |
| Main / Atlas | Atlas frames (`atlas_frames`) | int | 1 | 1 … 4096 |  |  |
| Main / Atlas | Atlas pick (`atlas_pick`) | enum | first | first, age, random |  |  |
| Main / Atlas | Use luminance as alpha (`sprite_luma`) | bool | false |  |  | For Gray sprites (alpha is 1): the brightness becomes the sprite alpha. |
| Main / Limits | Draw order (`sort`) | enum | none | none, oldest_first, youngest_first |  | Sort by age before drawing (alpha blending of overlapping smoke / sprites). Additive / max blending do not need it. |
| Main / Limits | Max particles (`max_particles`) | int | 200000 | 1 … 1000000 |  | Hard cap on drawn particles (extra points are ignored). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

## Simulation

### Dissolve / Burn Front

`simulation.burn_front` · Simulation · time dependent · GPU high, tiling global

A burn or dissolve front that spreads across a surface: speed modulated by a height map, a noise field and a Vector wind. Outputs front, burned mask, edge glow and a time-to-burn map.

**Gizmos:** Ignition (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Ignite (`ignite`) | gray | optional · Mask (> 50%) that sets cells on fire; animate it for moving ignition. |
| in | Height (`height`) | gray | optional · Burn resistance: bright areas burn later. |
| in | Noise (`noise`) | gray | optional · Speed modulation (50% = neutral). |
| in | Wind (`wind`) | vector | optional · Vector wind: the front is faster along it. |
| out | Front mask (`front`) | gray | The burning edge. |
| out | Burned mask (`burned`) | gray | 1 where the surface has ignited. |
| out | Edge glow (`edge`) | gray | Glow gradient behind the front. |
| out | Time to burn (`time`) | gray | Ignition time (0 = first, 1 = last / not yet): use as a threshold animation. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Front | Front speed (`front_speed`) | float | 0.15 | 0.001 … 4 | ● |  |
| Main / Front | Burn duration (`burn_duration`) | float | 2 | 0.05 … 100 |  | How long a cell keeps spreading fire. |
| Main / Front | Height influence (`height_influence`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Main / Front | Noise influence (`noise_influence`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Main / Front | Wind influence (`wind_gain`) | float | 1 | 0 … 4 |  |  |
| Main / Front | Constant wind (`wind_dir`) | vec2 | [0, 0] | -1 … 1 |  | Added to the Wind input (unit-less direction). |
| Main / Ignition | Ignition point (`ignite_pos`) | vec2 | [0.5, 0.5] | -1 … 2 |  |  |
| Main / Ignition | Ignition radius (`ignite_radius`) | float | 0.03 | 0 … 1 |  | 0 = no built-in ignition (use the Ignite input). |
| Main / Output | Front width (`out_front`) | float | 0.4 | 0.02 … 20 |  |  |
| Main / Output | Glow length (`out_glow`) | float | 1.5 | 0.05 … 40 |  |  |
| Main / Output | Time range (`out_range`) | float | 8 | 0.1 … 400 |  | Ignition time that maps to 1 in the Time to burn map. |
| Main / Simulation | Sim resolution (`sim_res`) | int | 256 | 16 … 2048 |  | Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory). |
| Main / Simulation | State precision (`precision`) | enum | half | half, full |  |  |
| Main / Simulation | Speed (`speed`) | float | 1 | 0.05 … 8 |  | Simulated seconds per real second. |
| Main / Simulation | Sub-steps (`substeps`) | int | 2 | 1 … 32 |  | Fixed sub-steps per frame (more = more accurate and slower). |
| Main / Simulation | Periodic / tileable (`periodic`) | bool | false |  |  | Wraps around the image edges: the result tiles seamlessly. |
| Main / Simulation | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Simulation | Warm-up frames (`warmup`) | int | 0 | 0 … 600 |  | Frames simulated before frame 0 (pre-roll, not shown). |
| Main / Loop | Loop mode (`loop_mode`) | enum | none | none, crossfade, periodic |  | Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L. |
| Main / Loop | Loop length (frames) (`loop_frames`) | int | 0 | 0 … 4096 |  | 0 = the graph loop length. |
| Main / Loop | Blend length (frames) (`blend_frames`) | int | 16 | 1 … 1024 |  |  |
| Main / Cache | Cache budget (MB) (`cache_mb`) | int | 64 | 1 … 4096 |  | Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget). |
| Main / Cache | Pause simulation (`paused`) | bool | false |  |  | Stop simulating new frames (cached frames stay available). |
| Main / Output | Resample filter (`out_filter`) | enum | cubic | cubic, linear, point |  | Quality filter used to resample the simulation grid to the graph resolution. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Diffusion / Heat

`simulation.diffusion` · Simulation · time dependent · GPU high, tiling global

Heat equation on a grid: isotropic or anisotropic diffusion (direction from a Vector input), decay, sources and sinks, periodic option. Glow bleed, burn-in and dissolve maps. Sub-iterations keep it stable.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Source (`source`) | gray | optional · Heat added per second (x gain). |
| in | Sink (`sink`) | gray | optional · Mask where the value is pulled to zero. |
| in | Direction (`direction`) | vector | optional · Vector field: diffusion is strong along it (anisotropic). |
| in | Conductivity (`conductivity`) | gray | optional · Per-pixel diffusion multiplier. |
| in | Initial (`initial`) | gray | optional |
| out | Result (`output`) | gray |  |
| out | Heat flux (`flux`) | vector | Minus the gradient of the result (flows from hot to cold). |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Diffusion | Diffusion (`diffusion`) | float | 0.0005 | 0 … 0.05 | ● |  |
| Main / Diffusion | Along direction (`aniso_par`) | float | 1 | 0 … 16 |  | Diffusion multiplier along the Direction vectors. |
| Main / Diffusion | Across direction (`aniso_perp`) | float | 1 | 0 … 16 |  | Diffusion multiplier across the Direction vectors. |
| Main / Diffusion | Decay (`decay`) | float | 0 | 0 … 20 | ● | Exponential decay per second. |
| Main / Sources | Source gain (`source_gain`) | float | 1 | -1000 … 1000 | ● |  |
| Main / Sources | Sink rate (`sink_rate`) | float | 4 | 0 … 100 |  |  |
| Main / Sources | Initial scale (`init_scale`) | float | 1 | -100 … 100 |  |  |
| Main / Output | Gain (`out_gain`) | float | 1 | 0 … 1000 |  |  |
| Main / Output | Flux scale (`out_flux`) | float | 1 | 0 … 1000 |  |  |
| Main / Simulation | Sim resolution (`sim_res`) | int | 256 | 16 … 2048 |  | Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory). |
| Main / Simulation | State precision (`precision`) | enum | half | half, full |  |  |
| Main / Simulation | Speed (`speed`) | float | 1 | 0.05 … 8 |  | Simulated seconds per real second. |
| Main / Simulation | Sub-steps (`substeps`) | int | 2 | 1 … 32 |  | Fixed sub-steps per frame (more = more accurate and slower). |
| Main / Simulation | Periodic / tileable (`periodic`) | bool | false |  |  | Wraps around the image edges: the result tiles seamlessly. |
| Main / Simulation | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Simulation | Warm-up frames (`warmup`) | int | 0 | 0 … 600 |  | Frames simulated before frame 0 (pre-roll, not shown). |
| Main / Loop | Loop mode (`loop_mode`) | enum | none | none, crossfade, periodic |  | Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L. |
| Main / Loop | Loop length (frames) (`loop_frames`) | int | 0 | 0 … 4096 |  | 0 = the graph loop length. |
| Main / Loop | Blend length (frames) (`blend_frames`) | int | 16 | 1 … 1024 |  |  |
| Main / Cache | Cache budget (MB) (`cache_mb`) | int | 64 | 1 … 4096 |  | Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget). |
| Main / Cache | Pause simulation (`paused`) | bool | false |  |  | Stop simulating new frames (cached frames stay available). |
| Main / Output | Resample filter (`out_filter`) | enum | cubic | cubic, linear, point |  | Quality filter used to resample the simulation grid to the graph resolution. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Flow Advection Simulation

`simulation.flow_advect_sim` · Simulation · time dependent · GPU high, tiling global

Continuously advects and accumulates a texture through a Vector field (for example Fluid 2D velocity): injection mask, dissipation, optional vorticity from the field. Smoke-like trails without the full fluid solver; loops with a crossfade.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`vector`) | vector | optional · Velocity field (tile fractions per second). |
| in | Inject (`inject`) | color | optional · Texture added every frame (x gain). |
| in | Initial (`initial`) | color | optional |
| out | Result (`output`) | color |  |
| out | Density (`density`) | gray | Average of the RGB channels. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Flow | Flow scale (`flow_scale`) | float | 1 | -20 … 20 | ● | Multiplies the vector field. |
| Main / Flow | Dissipation (`dissipation`) | float | 0.5 | 0 … 20 | ● | Exponential fade per second. |
| Main / Flow | Diffusion (`diffuse`) | float (percent) | 0 | 0 … 1 |  | Softens the trails every step. |
| Main / Flow | Vorticity (`vorticity`) | float | 0 | 0 … 10 | ● | Confines the vorticity of the vector field (swirls stay lively). |
| Main / Injection | Inject gain (`inject_gain`) | float | 5 | 0 … 1000 | ● | Amount added per second. |
| Main / Injection | Max value (`max_value`) | float | 4 | 0.1 … 100 |  |  |
| Main / Output | Gain (`out_gain`) | float | 1 | 0 … 100 |  |  |
| Main / Simulation | Sim resolution (`sim_res`) | int | 256 | 16 … 2048 |  | Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory). |
| Main / Simulation | State precision (`precision`) | enum | half | half, full |  |  |
| Main / Simulation | Speed (`speed`) | float | 1 | 0.05 … 8 |  | Simulated seconds per real second. |
| Main / Simulation | Sub-steps (`substeps`) | int | 1 | 1 … 32 |  | Fixed sub-steps per frame (more = more accurate and slower). |
| Main / Simulation | Periodic / tileable (`periodic`) | bool | true |  |  | Wraps around the image edges: the result tiles seamlessly. |
| Main / Simulation | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Simulation | Warm-up frames (`warmup`) | int | 0 | 0 … 600 |  | Frames simulated before frame 0 (pre-roll, not shown). |
| Main / Loop | Loop mode (`loop_mode`) | enum | none | none, crossfade, periodic |  | Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L. |
| Main / Loop | Loop length (frames) (`loop_frames`) | int | 0 | 0 … 4096 |  | 0 = the graph loop length. |
| Main / Loop | Blend length (frames) (`blend_frames`) | int | 16 | 1 … 1024 |  |  |
| Main / Cache | Cache budget (MB) (`cache_mb`) | int | 64 | 1 … 4096 |  | Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget). |
| Main / Cache | Pause simulation (`paused`) | bool | false |  |  | Stop simulating new frames (cached frames stay available). |
| Main / Output | Resample filter (`out_filter`) | enum | cubic | cubic, linear, point |  | Quality filter used to resample the simulation grid to the graph resolution. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Fluid 2D

`simulation.fluid2d` · Simulation · time dependent · GPU high, tiling global

GPU smoke, fire and explosion solver: MacCormack advection, multigrid / PCG pressure projection, buoyancy, vorticity, turbulence, combustion. Loopable and tileable.

**Gizmos:** Emitter 1 (circle, 2d); Emitter 1 direction (angle, 2d); Emitter 1 line end (point, 2d); Emitter 1 rectangle (rect, 2d); Emitter 2 (circle, 2d); Emitter 2 direction (angle, 2d); Emitter 2 line end (point, 2d); Emitter 2 rectangle (rect, 2d); Wind direction (angle, 2d); Swirl (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Density emit (`density_emit`) | gray | optional · Gray mask: density added per second (x gain), evaluated every frame. |
| in | Temperature emit (`temperature_emit`) | gray | optional |
| in | Fuel emit (`fuel_emit`) | gray | optional |
| in | Velocity emit (`velocity_emit`) | vector | optional · Vector field added as acceleration inside its support. |
| in | Obstacle (`obstacle`) | gray | optional · Solid mask (> 50%). Animate it for moving obstacles. |
| in | Force field (`force_field`) | vector | optional · Vector acceleration added at every step. |
| in | Kill mask (`kill`) | gray | optional · Removes density, temperature, fuel and soot where it is 1. |
| in | Initial density (`initial_density`) | gray | optional |
| in | Initial velocity (`initial_velocity`) | vector | optional |
| out | Density (`density`) | gray |  |
| out | Temperature (`temperature`) | gray |  |
| out | Fuel (`fuel`) | gray |  |
| out | Velocity (`velocity`) | vector | Tile fractions per second. |
| out | Pressure (`pressure`) | gray |  |
| out | Divergence (`divergence`) | gray |  |
| out | Vorticity / Curl (`curl`) | gray |  |
| out | Smoke color (`smoke_color`) | color | Density + temperature through the internal smoke / black-body ramp. |
| out | Fire mask (`fire_mask`) | gray |  |
| out | Motion vectors (`motion`) | vector | Displacement per frame in tile fractions (velocity / fps). |
| out | Normal (`normal`) | normal | Normal of the density height field. |
| out | Soot (`soot`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Simulation | Quality preset (`quality`) | enum | balanced | draft, balanced, high, ultra, custom |  | Draft 128, Balanced 256, High 512, Ultra 1024 cells; also sets sub-steps and the pressure solver. Custom uses the values below. |
| Main / Simulation | Sim resolution (`sim_res`) | int | 256 | 16 … 2048 |  | Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory). |
| Main / Simulation | State precision (`precision`) | enum | half | half, full |  | High precision stores the state in 32-bit floats (twice the memory, sampled manually). |
| Main / Simulation | Speed (`speed`) | float | 1 | 0.05 … 8 |  | Simulated seconds per real second. dt = (1/fps) * speed / sub-steps. |
| Main / Simulation | Min sub-steps (`substeps`) | int | 1 | 1 … 8 |  |  |
| Main / Simulation | Max sub-steps (`max_substeps`) | int | 4 | 1 … 16 |  | Upper limit of the CFL-adaptive sub-step count. |
| Main / Simulation | Adaptive sub-steps (`adaptive`) | bool | true |  |  | More sub-steps when the flow is fast (CFL condition). Deterministic: a function of the state only. |
| Main / Simulation | CFL limit (`cfl`) | float | 1.5 | 0.25 … 6 |  | Maximum advection distance in cells per sub-step. |
| Main / Simulation | Boundary (`boundary`) | enum | open | closed, open, periodic |  | Periodic wraps in both directions: the result tiles seamlessly. |
| Main / Numerics | Advection (`advection`) | enum | maccormack | maccormack, semi |  | MacCormack is low-dissipation with min/max limiting; semi-Lagrangian is cheaper and smoother. |
| Main / Numerics | Back-trace (`backtrace`) | enum | rk2 | rk1, rk2, rk3 |  |  |
| Main / Numerics | Pressure solver (`pressure`) | enum | balanced | fast, balanced, accurate |  |  |
| Main / Numerics | Iterations (`iterations`) | int | 30 | 1 … 200 |  | Jacobi sweeps (Fast) or conjugate-gradient iterations (Accurate). |
| Main / Numerics | V-cycles (`cycles`) | int | 2 | 1 … 6 |  |  |
| Main / Numerics | Warm start (`warm_start`) | bool | true |  |  | Start the pressure solve from the previous pressure. |
| Main / Numerics | Viscosity (`viscosity`) | float | 0 | 0 … 0.1 |  | Kinematic viscosity (tile^2 / s), Jacobi diffusion. |
| Main / Numerics | No-slip obstacles (`noslip`) | bool | false |  |  | Off = free-slip (flow slides along obstacles). |
| Main / Numerics | Moving obstacles (`obstacle_motion`) | bool | true |  |  | Obstacle velocity is estimated from the frame difference of the Obstacle mask. |
| Main / Simulation | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Simulation | Warm-up frames (`warmup`) | int | 0 | 0 … 600 |  | Frames simulated before frame 0 (pre-roll, not shown). |
| Main / Loop | Loop mode (`loop_mode`) | enum | none | none, crossfade, periodic |  | Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L (use with a periodic boundary). |
| Main / Loop | Loop length (frames) (`loop_frames`) | int | 0 | 0 … 4096 |  | 0 = the graph loop length. |
| Main / Loop | Blend length (frames) (`blend_frames`) | int | 16 | 1 … 1024 |  |  |
| Main / Cache | Cache budget (MB) (`cache_mb`) | int | 64 | 1 … 4096 |  | Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget). |
| Main / Cache | Pause simulation (`paused`) | bool | false |  |  | Stop simulating new frames (cached frames stay available). |
| Main / Forces | Gravity (`gravity`) | vec2 | [0, 0] | -20 … 20 |  |  |
| Main / Forces | Wind direction (`wind_angle`) | float (angle) | 0 | -360 … 360 | ● |  |
| Main / Forces | Wind strength (`wind_strength`) | float | 0 | 0 … 20 | ● | Animate it for gusts. |
| Main / Forces | Density weight (`buoy_density`) | float | 0 | 0 … 20 |  | Heavy smoke sinks (alpha). |
| Main / Forces | Temperature lift (`buoy_temp`) | float | 1 | 0 … 20 |  | Hot gas rises (beta). |
| Main / Forces | Ambient temperature (`ambient`) | float | 0 | -10 … 10 |  |  |
| Main / Forces | Vorticity confinement (`vort_eps`) | float | 3 | 0 … 100 | ● |  |
| Main / Forces | Vorticity scale (`vort_scale`) | float | 1 | 0.25 … 8 |  | Length scale in cells. |
| Main / Forces | Drag (`drag`) | float | 0 | 0 … 20 |  |  |
| Main / Forces | Velocity damping (`damping`) | float | 0 | 0 … 20 |  |  |
| Main / Turbulence | Strength (`turb_strength`) | float | 0 | 0 … 20 | ● | Curl-noise acceleration (divergence free). |
| Main / Turbulence | Scale (`turb_scale`) | int | 4 | 1 … 32 |  | Wave number: features per tile (integer so the field tiles). |
| Main / Turbulence | Speed (`turb_speed`) | float | 1 | 0 … 16 |  | Cycles per loop with a loop mode (rounded to an integer so the noise loops in Z), cycles per second otherwise. |
| Main / Swirl | Position (`swirl_pos`) | vec2 | [0.5, 0.5] | -1 … 2 |  |  |
| Main / Swirl | Radius (`swirl_radius`) | float | 0.15 | 0.005 … 1 |  |  |
| Main / Swirl | Strength (`swirl_strength`) | float | 0 | -50 … 50 | ● | Tangential acceleration; the sign sets the direction. |
| Main / Combustion | Ignition temperature (`ignition`) | float | 0.6 | 0 … 50 |  |  |
| Main / Combustion | Burn rate (`burn_rate`) | float | 0 | 0 … 100 |  | 0 disables combustion (fuel is only advected). |
| Main / Combustion | Heat release (`heat_release`) | float | 4 | 0 … 100 |  |  |
| Main / Combustion | Expansion (`expansion`) | float | 0 | 0 … 50 |  | Gas expansion of burning fuel (divergence source). |
| Main / Combustion | Cooling rate (`cooling`) | float | 1.2 | 0 … 20 |  |  |
| Main / Combustion | Radiative cooling (`radiative`) | float | 0 | 0 … 5 |  |  |
| Main / Combustion | Smoke from burning (`smoke_gen`) | float | 0 | 0 … 20 |  |  |
| Main / Combustion | Soot from burning (`soot_gen`) | float | 0 | 0 … 20 |  |  |
| Main / Combustion | Soot decay (`soot_decay`) | float | 0.3 | 0 … 20 |  |  |
| Main / Dissipation | Density (`diss_density`) | float | 0.2 | 0 … 20 |  |  |
| Main / Dissipation | Temperature (`diss_temp`) | float | 0 | 0 … 20 |  |  |
| Main / Dissipation | Fuel (`diss_fuel`) | float | 0 | 0 … 20 |  |  |
| Main / Dissipation | Velocity (`diss_velocity`) | float | 0 | 0 … 20 |  |  |
| Main / Dissipation | Max density (`max_density`) | float | 4 | 0.1 … 100 |  |  |
| Main / Dissipation | Max temperature (`max_temp`) | float | 8 | 0.1 … 200 |  |  |
| Main / Dissipation | Max fuel (`max_fuel`) | float | 4 | 0.1 … 100 |  |  |
| Main / Dissipation | Max speed (`max_speed`) | float | 3 | 0.1 … 50 |  | Velocity limiter (deterministic stability guard). |
| Main / Inputs | Density emit gain (`gain_density`) | float | 1 | 0 … 100 | ● |  |
| Main / Inputs | Temperature emit gain (`gain_temperature`) | float | 1 | 0 … 100 | ● |  |
| Main / Inputs | Fuel emit gain (`gain_fuel`) | float | 1 | 0 … 100 | ● |  |
| Main / Inputs | Velocity emit gain (`gain_velocity`) | float | 1 | 0 … 100 | ● |  |
| Main / Emitter 1 | Enabled (`em1_on`) | bool | true |  |  |  |
| Main / Emitter 1 | Shape (`em1_shape`) | enum | circle | circle, rect, line |  |  |
| Main / Emitter 1 | Position (`em1_pos`) | vec2 | [0.5, 0.88] | -1 … 2 |  | Centre in tile space (0..1, y down). |
| Main / Emitter 1 | Radius (`em1_radius`) | float | 0.06 | 0.002 … 1 | ● | Circle radius / line thickness (fraction of the image height). |
| Main / Emitter 1 | Half size (`em1_size`) | vec2 | [0.1, 0.04] | 0.002 … 1 |  |  |
| Main / Emitter 1 | Line end (`em1_pos2`) | vec2 | [0.7, 0.88] | -1 … 2 |  |  |
| Main / Emitter 1 | Softness (`em1_soft`) | float (percent) | 0.5 | 0.001 … 1 |  |  |
| Main / Emitter 1 | Density (`em1_density`) | float | 6 | 0 … 200 | ● | Amount per second added inside the shape. |
| Main / Emitter 1 | Temperature (`em1_temperature`) | float | 3 | -50 … 200 | ● |  |
| Main / Emitter 1 | Fuel (`em1_fuel`) | float | 0 | 0 … 200 | ● |  |
| Main / Emitter 1 | Expansion (`em1_expand`) | float | 0 | -100 … 400 | ● | Divergence source: pushes the gas outwards (explosions). |
| Main / Emitter 1 | Direction (`em1_dir`) | float (angle) | -90 | -360 … 360 | ● | Emission direction (degrees, clockwise on screen; -90 = up). |
| Main / Emitter 1 | Velocity (`em1_speed`) | float | 0 | 0 … 10 | ● |  |
| Main / Emitter 1 | Mode (`em1_mode`) | enum | continuous | continuous, burst |  |  |
| Main / Emitter 1 | Burst length (frames) (`em1_burst`) | int | 6 | 1 … 600 |  |  |
| Main / Emitter 1 | Start frame (`em1_start`) | int | 0 | 0 … 100000 |  |  |
| Main / Emitter 1 | End frame (`em1_end`) | int | -1 | -1 … 100000 |  | -1 = never ends. |
| Main / Emitter 1 | Noise modulation (`em1_noise`) | float (percent) | 0 | 0 … 1 |  |  |
| Main / Emitter 1 | Noise scale (`em1_noise_scale`) | int | 4 | 1 … 32 |  |  |
| Main / Emitter 2 | Enabled (`em2_on`) | bool | false |  |  |  |
| Main / Emitter 2 | Shape (`em2_shape`) | enum | circle | circle, rect, line |  |  |
| Main / Emitter 2 | Position (`em2_pos`) | vec2 | [0.5, 0.5] | -1 … 2 |  | Centre in tile space (0..1, y down). |
| Main / Emitter 2 | Radius (`em2_radius`) | float | 0.06 | 0.002 … 1 | ● | Circle radius / line thickness (fraction of the image height). |
| Main / Emitter 2 | Half size (`em2_size`) | vec2 | [0.1, 0.04] | 0.002 … 1 |  |  |
| Main / Emitter 2 | Line end (`em2_pos2`) | vec2 | [0.7, 0.5] | -1 … 2 |  |  |
| Main / Emitter 2 | Softness (`em2_soft`) | float (percent) | 0.5 | 0.001 … 1 |  |  |
| Main / Emitter 2 | Density (`em2_density`) | float | 6 | 0 … 200 | ● | Amount per second added inside the shape. |
| Main / Emitter 2 | Temperature (`em2_temperature`) | float | 3 | -50 … 200 | ● |  |
| Main / Emitter 2 | Fuel (`em2_fuel`) | float | 0 | 0 … 200 | ● |  |
| Main / Emitter 2 | Expansion (`em2_expand`) | float | 0 | -100 … 400 | ● | Divergence source: pushes the gas outwards (explosions). |
| Main / Emitter 2 | Direction (`em2_dir`) | float (angle) | -90 | -360 … 360 | ● | Emission direction (degrees, clockwise on screen; -90 = up). |
| Main / Emitter 2 | Velocity (`em2_speed`) | float | 0 | 0 … 10 | ● |  |
| Main / Emitter 2 | Mode (`em2_mode`) | enum | continuous | continuous, burst |  |  |
| Main / Emitter 2 | Burst length (frames) (`em2_burst`) | int | 6 | 1 … 600 |  |  |
| Main / Emitter 2 | Start frame (`em2_start`) | int | 0 | 0 … 100000 |  |  |
| Main / Emitter 2 | End frame (`em2_end`) | int | -1 | -1 … 100000 |  | -1 = never ends. |
| Main / Emitter 2 | Noise modulation (`em2_noise`) | float (percent) | 0 | 0 … 1 |  |  |
| Main / Emitter 2 | Noise scale (`em2_noise_scale`) | int | 4 | 1 … 32 |  |  |
| Main / Output | Resample filter (`out_filter`) | enum | cubic | cubic, linear, point |  | Quality filter used to resample the simulation grid to the graph resolution. |
| Main / Output | Gain (`out_gain`) | float | 1 | -100 … 100 |  | Multiplies Density, Temperature, Fuel, Pressure, Divergence, Curl. |
| Main / Output | Smoke opacity (`out_opacity`) | float | 2.5 | 0 … 40 |  |  |
| Main / Output | Smoke colour (`out_smoke_color`) | color | [0.82, 0.82, 0.86, 1] |  |  |  |
| Main / Output | Temperature scale (`out_temp_scale`) | float | 0.3 | 0.01 … 10 |  | Temperature that maps to the white end of the black-body ramp is 1 / this. |
| Main / Output | Fire intensity (`out_fire_gain`) | float | 1 | 0 … 20 |  |  |
| Main / Output | Soot darkening (`out_soot_dark`) | float | 0.5 | 0 … 10 |  |  |
| Main / Output | Fire mask low (`out_fire_lo`) | float | 0.15 | 0 … 50 |  |  |
| Main / Output | Fire mask high (`out_fire_hi`) | float | 0.6 | 0.001 … 50 |  |  |
| Main / Output | Normal strength (`out_normal_strength`) | float | 6 | 0 … 100 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Lightning

`simulation.lightning` · Simulation · time dependent · GPU low, tiling global

Branching lightning bolt: recursive midpoint displacement and branch spawning between two points. Outputs a Spline set with per-point width (feeds Spline mask nodes and 3D Sweep) and a mask. Seeded; flicker changes the bolt per frame and loops seamlessly.

**Gizmos:** Bolt (line, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Mask (`mask`) | gray |  |
| out | Spline (`spline`) | spline |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Bolt | Start (`p_start`) | vec2 | [0.5, 0.05] | -1 … 2 | ● |  |
| Main / Bolt | End (`p_end`) | vec2 | [0.5, 0.95] | -1 … 2 | ● |  |
| Main / Bolt | Jaggedness (`jaggedness`) | float | 0.45 | 0 … 1.5 | ● |  |
| Main / Bolt | Subdivisions (`levels`) | int | 6 | 2 … 8 |  |  |
| Main / Branches | Branch probability (`branch_prob`) | float (percent) | 0.25 | 0 … 1 |  |  |
| Main / Branches | Branch angle (`branch_angle`) | float (angle) | 35 | 5 … 85 |  |  |
| Main / Branches | Branch length (`branch_length`) | float (percent) | 0.5 | 0.05 … 1 |  | Length of a branch relative to its parent. |
| Main / Branches | Branch depth (`branch_depth`) | int | 2 | 0 … 3 |  |  |
| Main / Branches | Max branches (`max_branches`) | int | 12 | 0 … 48 |  |  |
| Main / Stroke | Main thickness (`width`) | float | 0.02 | 0.001 … 0.3 | ● | Full width at the start (UV, smaller side). |
| Main / Stroke | Tip width (`taper`) | float (percent) | 0.35 | 0.05 … 1 |  |  |
| Main / Stroke | Branch width (`branch_width`) | float (percent) | 0.55 | 0.05 … 1 |  |  |
| Main / Stroke | Branch brightness (`branch_bright`) | float (percent) | 0.75 | 0 … 1 |  |  |
| Main / Stroke | Edge softness (`softness`) | float (percent) | 0.6 | 0.01 … 1 |  |  |
| Main / Stroke | Glow (`glow`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Main / Animation | Seed (`seed`) | seed | 3 |  |  |  |
| Main / Animation | Flicker rate (`flicker_rate`) | float | 0 | 0 … 120 |  | New random bolts per second (0 = static). |
| Main / Animation | Flicker loop (variants) (`flicker_loop`) | int | 8 | 0 … 512 |  | Number of distinct bolts before the sequence repeats (periodic seeds: the flicker loops). 0 = never repeats. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Reaction Diffusion

`simulation.reaction_diffusion` · Simulation · time dependent · GPU high, tiling global

Gray-Scott reaction-diffusion: organic spots, stripes, coral and worm patterns. Periodic boundary gives tileable skins; seed from noise, points, a mask or a disk. Loops with a crossfade.

**Gizmos:** Seed (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Seed mask (`seed_mask`) | gray | optional · Where chemical B is seeded (> 50%). |
| in | Feed map (`feed_map`) | gray | optional · Per-pixel feed offset (50% = no change). |
| in | Kill map (`kill_map`) | gray | optional · Per-pixel kill offset (50% = no change). |
| out | A (`a`) | gray | Chemical A (1 = empty). |
| out | B (`b`) | gray | Chemical B (the visible pattern). |
| out | Pattern (`pattern`) | gray | B normalized to 0..1 between the pattern range values. |
| out | Normal (`normal`) | normal | Normal map of the Pattern height field. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Reaction | Feed (`feed`) | float | 0.055 | 0 … 0.12 | ● |  |
| Main / Reaction | Kill (`kill`) | float | 0.062 | 0 … 0.1 | ● |  |
| Main / Reaction | Diffusion A (`diff_a`) | float | 1 | 0.05 … 1.2 |  |  |
| Main / Reaction | Diffusion B (`diff_b`) | float | 0.5 | 0.02 … 1 |  |  |
| Main / Reaction | Time step (`step_size`) | float | 1 | 0.1 … 1.5 |  | Clamped by the stability limit (dt x diffusion <= 1.2). |
| Main / Reaction | Map range (`map_range`) | float | 0.02 | 0 … 0.1 |  | Feed / kill change at 0% / 100% of the maps. |
| Main / Seeding | Seed pattern (`seed_mode`) | enum | noise | noise, center, points, mask |  |  |
| Main / Seeding | Seed density (`seed_density`) | float (percent) | 0.02 | 0 … 1 |  |  |
| Main / Seeding | Noise cell size (`seed_cells`) | int | 4 | 1 … 32 |  |  |
| Main / Seeding | Points per side (`seed_points`) | int | 4 | 1 … 32 |  |  |
| Main / Seeding | Center (`seed_pos`) | vec2 | [0.5, 0.5] | -1 … 2 |  |  |
| Main / Seeding | Seed radius (`seed_radius`) | float | 0.04 | 0.002 … 1 |  |  |
| Main / Seeding | Keep seeding from mask (`mask_continuous`) | bool | false |  |  | Re-inject B under the mask every step (animated masks). |
| Main / Output | Pattern low (`out_lo`) | float | 0.08 | 0 … 1 |  |  |
| Main / Output | Pattern high (`out_hi`) | float | 0.35 | 0 … 1 |  |  |
| Main / Output | Normal strength (`out_strength`) | float | 4 | 0 … 64 |  |  |
| Main / Simulation | Sim resolution (`sim_res`) | int | 256 | 16 … 2048 |  | Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory). |
| Main / Simulation | State precision (`precision`) | enum | half | half, full |  |  |
| Main / Simulation | Speed (`speed`) | float | 1 | 0.05 … 8 |  | Simulated seconds per real second. |
| Main / Simulation | Sub-steps (`substeps`) | int | 12 | 1 … 32 |  | Fixed sub-steps per frame (more = more accurate and slower). |
| Main / Simulation | Periodic / tileable (`periodic`) | bool | true |  |  | Wraps around the image edges: the result tiles seamlessly. |
| Main / Simulation | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Simulation | Warm-up frames (`warmup`) | int | 24 | 0 … 600 |  | Frames simulated before frame 0 (pre-roll, not shown). |
| Main / Loop | Loop mode (`loop_mode`) | enum | none | none, crossfade, periodic |  | Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L. |
| Main / Loop | Loop length (frames) (`loop_frames`) | int | 0 | 0 … 4096 |  | 0 = the graph loop length. |
| Main / Loop | Blend length (frames) (`blend_frames`) | int | 16 | 1 … 1024 |  |  |
| Main / Cache | Cache budget (MB) (`cache_mb`) | int | 64 | 1 … 4096 |  | Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget). |
| Main / Cache | Pause simulation (`paused`) | bool | false |  |  | Stop simulating new frames (cached frames stay available). |
| Main / Output | Resample filter (`out_filter`) | enum | cubic | cubic, linear, point |  | Quality filter used to resample the simulation grid to the graph resolution. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Wave Simulation

`simulation.wave` · Simulation · time dependent · GPU high, tiling global

Two-dimensional wave equation: ripples from animated emitters and masks, obstacles, reflecting / absorbing / periodic boundaries. Outputs height, velocity and a ready normal map. Stable: speed is clamped to the CFL limit.

**Gizmos:** Emitter 1 (circle, 2d); Emitter 2 (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Impulse (`impulse`) | gray | optional · Gray mask added to the height every frame (x gain). |
| in | Obstacle (`obstacle`) | gray | optional · Solid mask (> 50%): waves reflect. |
| in | Initial height (`initial`) | gray | optional |
| out | Height (`height`) | gray |  |
| out | Velocity (`velocity`) | gray |  |
| out | Normal (`normal`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Wave | Wave speed (`wave_speed`) | float | 0.25 | 0.01 … 4 | ● | Clamped to the stability limit (CFL <= 0.7 cells per step). |
| Main / Wave | Damping (`damping`) | float | 0.3 | 0 … 20 | ● | Energy loss per second. |
| Main / Wave | Boundary (`boundary`) | enum | reflect | reflect, absorb, periodic |  |  |
| Main / Wave | Absorber width (`sponge`) | float (percent) | 0.12 | 0.01 … 0.5 |  |  |
| Main / Wave | Impulse gain (`impulse_gain`) | float | 20 | -1000 … 1000 | ● |  |
| Main / Wave | Initial height scale (`init_scale`) | float | 1 | -100 … 100 |  |  |
| Main / Emitter 1 | Enabled (`em1_on`) | bool | true |  |  |  |
| Main / Emitter 1 | Position (`em1_pos`) | vec2 | [0.5, 0.5] | -1 … 2 | ● |  |
| Main / Emitter 1 | Radius (`em1_radius`) | float | 0.03 | 0.002 … 1 | ● |  |
| Main / Emitter 1 | Amplitude (`em1_amp`) | float | 4 | -100 … 100 | ● |  |
| Main / Emitter 1 | Mode (`em1_mode`) | enum | sine | sine, pulse |  |  |
| Main / Emitter 1 | Frequency (`em1_freq`) | float | 2 | 0.05 … 60 |  |  |
| Main / Emitter 1 | Pulse length (frames) (`em1_pulse`) | int | 3 | 1 … 120 |  |  |
| Main / Emitter 2 | Enabled (`em2_on`) | bool | false |  |  |  |
| Main / Emitter 2 | Position (`em2_pos`) | vec2 | [0.3, 0.7] | -1 … 2 | ● |  |
| Main / Emitter 2 | Radius (`em2_radius`) | float | 0.03 | 0.002 … 1 | ● |  |
| Main / Emitter 2 | Amplitude (`em2_amp`) | float | 4 | -100 … 100 | ● |  |
| Main / Emitter 2 | Mode (`em2_mode`) | enum | sine | sine, pulse |  |  |
| Main / Emitter 2 | Frequency (`em2_freq`) | float | 2 | 0.05 … 60 |  |  |
| Main / Emitter 2 | Pulse length (frames) (`em2_pulse`) | int | 3 | 1 … 120 |  |  |
| Main / Output | Height gain (`out_gain`) | float | 1 | 0 … 1000 |  |  |
| Main / Output | Centered (0 = 50%) (`out_centered`) | bool | true |  |  | Height output is height * gain * 0.5 + 0.5. |
| Main / Output | Normal strength (`out_strength`) | float | 4 | 0 … 64 |  |  |
| Main / Simulation | Sim resolution (`sim_res`) | int | 256 | 16 … 2048 |  | Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory). |
| Main / Simulation | State precision (`precision`) | enum | half | half, full |  |  |
| Main / Simulation | Speed (`speed`) | float | 1 | 0.05 … 8 |  | Simulated seconds per real second. |
| Main / Simulation | Sub-steps (`substeps`) | int | 2 | 1 … 32 |  | Fixed sub-steps per frame (more = more accurate and slower). |
| Main / Simulation | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Simulation | Warm-up frames (`warmup`) | int | 0 | 0 … 600 |  | Frames simulated before frame 0 (pre-roll, not shown). |
| Main / Loop | Loop mode (`loop_mode`) | enum | none | none, crossfade, periodic |  | Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L. |
| Main / Loop | Loop length (frames) (`loop_frames`) | int | 0 | 0 … 4096 |  | 0 = the graph loop length. |
| Main / Loop | Blend length (frames) (`blend_frames`) | int | 16 | 1 … 1024 |  |  |
| Main / Cache | Cache budget (MB) (`cache_mb`) | int | 64 | 1 … 4096 |  | Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget). |
| Main / Cache | Pause simulation (`paused`) | bool | false |  |  | Stop simulating new frames (cached frames stay available). |
| Main / Output | Resample filter (`out_filter`) | enum | cubic | cubic, linear, point |  | Quality filter used to resample the simulation grid to the graph resolution. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

## Subgraphs

### Input (Color)

`subgraph.in_color` · Subgraphs · GPU trivial, tiling pixel

Interface input of a subgraph (Color). Unconnected on the instance: this node's default is used.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Input |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |
| Main / Default | Default color (`color`) | color | [0, 0, 0, 1] |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Input (Gray)

`subgraph.in_gray` · Subgraphs · GPU trivial, tiling pixel

Interface input of a subgraph (Gray). Unconnected on the instance: this node's default is used.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Input |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |
| Main / Default | Default value (`value`) | float | 0 | -16 … 16 |  | Used when the pin is not connected. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Input (Mesh)

`subgraph.in_mesh` · Subgraphs · GPU trivial, tiling pixel

Interface input of a subgraph (Mesh). Unconnected on the instance: this node's default is used.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Output (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Input |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

### Input (Normal)

`subgraph.in_normal` · Subgraphs · GPU trivial, tiling pixel

Interface input of a subgraph (Normal). Unconnected on the instance: this node's default is used.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Output (`output`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Input |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Input (Points)

`subgraph.in_points` · Subgraphs · GPU trivial, tiling pixel

Interface input of a subgraph (Points). Unconnected on the instance: this node's default is used.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Output (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Input |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

### Input (UV)

`subgraph.in_uv` · Subgraphs · GPU trivial, tiling pixel

Interface input of a subgraph (UV). Unconnected on the instance: this node's default is used.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Output (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Input |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Output (Color)

`subgraph.out_color` · Subgraphs · GPU trivial, tiling pixel

Interface output of a subgraph (Color). Connect the result you want to expose.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Output |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

### Output (Gray)

`subgraph.out_gray` · Subgraphs · GPU trivial, tiling pixel

Interface output of a subgraph (Gray). Connect the result you want to expose.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Output |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

### Output (Mesh)

`subgraph.out_mesh` · Subgraphs · GPU trivial, tiling pixel

Interface output of a subgraph (Mesh). Connect the result you want to expose.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | mesh | required |
| out | Output (`output`) | mesh |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Output |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

### Output (Normal)

`subgraph.out_normal` · Subgraphs · GPU trivial, tiling pixel

Interface output of a subgraph (Normal). Connect the result you want to expose.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | normal | required |
| out | Output (`output`) | normal |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Output |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

### Output (Points)

`subgraph.out_points` · Subgraphs · GPU trivial, tiling pixel

Interface output of a subgraph (Points). Connect the result you want to expose.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | points | required |
| out | Output (`output`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Output |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

### Output (UV)

`subgraph.out_uv` · Subgraphs · GPU trivial, tiling pixel

Interface output of a subgraph (UV). Connect the result you want to expose.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | uv | required |
| out | Output (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Interface | Pin name (`name`) | string | Output |  |  | Name of the pin on the subgraph node. |
| Main / Interface | Order (`order`) | int | 0 | -1000 … 1000 |  | Pins are sorted by this value (then by position). |

## Utils

### Alpha Merge

`utils.alpha_merge` · Utils · GPU trivial, tiling pixel

Combines a Color input with a Gray alpha into one Color texture.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Color (`color`) | color | required |
| in | Alpha (`alpha`) | gray | optional |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Alpha | Alpha when unconnected (`default_alpha`) | float | 1 | 0 … 16 | ● |  |
| Main / Alpha | Premultiply (`premultiply`) | bool | false |  |  | Multiply RGB by the alpha. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Alpha Split

`utils.alpha_split` · Utils · GPU trivial, tiling pixel

Splits a Color texture into RGB (alpha 1) and a Gray alpha.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| out | Color (`color`) | color |  |
| out | Alpha (`alpha`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Alpha | Unpremultiply (`unpremultiply`) | bool | false |  |  | Divide RGB by alpha (undo premultiplication). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Auto Crop

`utils.auto_crop` · Utils · GPU low, tiling global

Crops to the content bounds (found on the GPU without stalls), with padding, aspect fit and optional normalisation.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Crop | Threshold (`threshold`) | float | 0.01 | -16 … 16 | ● | Pixels above this value count as content. |
| Main / Crop | Padding (`padding`) | float (percent) | 0 | -0.4 … 1 | ● | Extra border around the bounds (fraction of the smaller side). |
| Main / Crop | Fit (`fit`) | enum | keep_aspect | stretch, keep_aspect |  |  |
| Main / Crop | Normalize (`normalize`) | bool | false |  |  | Remap the min..max of the detected channel to 0..1. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Auto Crop (Color)

`utils.auto_crop_color` · Utils · GPU low, tiling global

Crops to the content bounds (found on the GPU without stalls), with padding, aspect fit and optional normalisation.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Crop | Detect by (`source`) | enum | alpha | luminance, alpha, any |  |  |
| Main / Crop | Threshold (`threshold`) | float | 0.01 | -16 … 16 | ● | Pixels above this value count as content. |
| Main / Crop | Padding (`padding`) | float (percent) | 0 | -0.4 … 1 | ● | Extra border around the bounds (fraction of the smaller side). |
| Main / Crop | Fit (`fit`) | enum | keep_aspect | stretch, keep_aspect |  |  |
| Main / Crop | Normalize (`normalize`) | bool | false |  |  | Remap the min..max of the detected channel to 0..1. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Bilateral Filter

`utils.bilateral` · Utils · GPU high, tiling halo

Edge-preserving smoothing: blurs flat areas, keeps strong edges.

**Gizmos:** Filter radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Filter | Radius (`radius`) | float (percent) | 0.006 | 0 … 0.2 | ● | Fraction of the smaller image side (resolution independent). |
| Main / Filter | Edge range (`range`) | float | 0.15 | 0.001 … 4 | ● | Value difference above which neighbours are ignored (smaller = more edges kept). |
| Main / Filter | Iterations (`iterations`) | int | 1 | 1 … 6 |  |  |
| Main / Filter | Quality (`quality`) | enum | exact | exact, separable |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Bilateral Filter (Color)

`utils.bilateral_color` · Utils · GPU high, tiling halo

Edge-preserving smoothing: blurs flat areas, keeps strong edges.

**Gizmos:** Filter radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Filter | Radius (`radius`) | float (percent) | 0.006 | 0 … 0.2 | ● | Fraction of the smaller image side (resolution independent). |
| Main / Filter | Edge range (`range`) | float | 0.15 | 0.001 … 4 | ● | Value difference above which neighbours are ignored (smaller = more edges kept). |
| Main / Filter | Iterations (`iterations`) | int | 1 | 1 … 6 |  |  |
| Main / Filter | Quality (`quality`) | enum | exact | exact, separable |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Blend

`utils.blend` · Utils · GPU trivial, tiling pixel

Blends a Foreground over a Background using a blend mode. Optional Mask and Opacity limit the effect per pixel.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Foreground (`foreground`) | gray | optional |
| in | Background (`background`) | gray | optional |
| in | Mask (`mask`) | gray | optional · mask |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main | Blend type (`blend_type`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main | Cross mix (`cross_mix`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even, 100% = foreground only. |
| Main | Smoothness (`smoothness`) | float | 0.1 | 0 … 1 |  |  |
| Main | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● | Final opacity (multiplied with the Mask). |
| Main | Clamp 0..1 (`clamp_output`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Blend (Color)

`utils.blend_color` · Utils · GPU trivial, tiling pixel

Blends a Foreground over a Background using a blend mode. Optional Mask and Opacity limit the effect per pixel.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Foreground (`foreground`) | color | optional |
| in | Background (`background`) | color | optional |
| in | Mask (`mask`) | gray | optional · mask |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main | Blend type (`blend_type`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main | Cross mix (`cross_mix`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even, 100% = foreground only. |
| Main | Smoothness (`smoothness`) | float | 0.1 | 0 … 1 |  |  |
| Main | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● | Final opacity (multiplied with the Mask). |
| Main | Clamp 0..1 (`clamp_output`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Blur

`utils.blur` · Utils · GPU medium, tiling halo · identity short-cut

Gaussian (pyramid hybrid), box or Kawase blur with per-axis radius and per-pixel radius modulation. Wraps when the node tiles.

**Gizmos:** Blur radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Radius mod (`radius_mod`) | gray | optional · modulation · Modulates "Radius" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Mode (`mode`) | enum | gaussian | gaussian, box, kawase |  |  |
| Main / Blur | Radius (`radius`) | float (percent) | 0.02 | 0 … 0.5 | ● | Fraction of the smaller image side (resolution independent). |
| Main / Blur | Radius modulation (`radius_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Blur | Axis radius (`stretch`) | vec2 | [1, 1] | 0 … 16 | ● | Per-axis radius multiplier (X = 1, Y = 0 blurs horizontally only). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Blur (Color)

`utils.blur_color` · Utils · GPU medium, tiling halo · identity short-cut

Gaussian (pyramid hybrid), box or Kawase blur with per-axis radius and per-pixel radius modulation. Wraps when the node tiles.

**Gizmos:** Blur radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Radius mod (`radius_mod`) | gray | optional · modulation · Modulates "Radius" per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Mode (`mode`) | enum | gaussian | gaussian, box, kawase |  |  |
| Main / Blur | Radius (`radius`) | float (percent) | 0.02 | 0 … 0.5 | ● | Fraction of the smaller image side (resolution independent). |
| Main / Blur | Radius modulation (`radius_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Blur | Axis radius (`stretch`) | vec2 | [1, 1] | 0 … 16 | ● | Per-axis radius multiplier (X = 1, Y = 0 blurs horizontally only). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Cartesian to Polar

`utils.cartesian_to_polar` · Utils · GPU low, tiling global

Warps an image into polar space: X becomes angle, Y becomes radius. Square / squircle metrics, spiral, pinch, tunnel perspective, aperture, angular / radial tiling and a seam overlap for non-tiling inputs.

**Gizmos:** Polar centre (circle, 2d); Rotation (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`position`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre of the polar mapping (UV). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Transform | Scale (`scale`) | float | 1 | 0.01 … 32 | ● | 1 = the radius of the inscribed circle (half of the smaller side) maps to the full source height. |
| Main / Transform | Spiral (`spiral`) | float | 0 | -16 … 16 | ● | Offsets the angle by the distance from the centre: turns of twist per unit radius. |
| Main / Shape | Distance metric (`metric`) | enum | euclidean | euclidean, chebyshev, squircle |  |  |
| Main / Shape | Squircle factor (`squircle`) | float | 4 | 1 … 16 |  | p-norm exponent: 2 = circle, large = square. |
| Main / Shape | Pinch (`pinch`) | float | 0 | -4 … 4 | ● | Radial power curve (+ pulls content towards the centre, - pushes it out). |
| Main / Shape | Perspective (`perspective`) | float (percent) | 0 | 0 … 0.98 | ● | Tunnel look: the radius maps through 1/r so texture compresses towards the centre. |
| Main / Aperture | Angle (`angle`) | float (angle) | 360 | 1 … 360 | ● | Angular range covered by the full width of the polar image. |
| Main / Aperture | Radial scaling (`radial_scaling`) | float | 1 | 0.05 … 16 | ● |  |
| Main / Aperture | Radial centering (`radial_centering`) | float | 0 | -2 … 2 | ● | Shifts the radial axis of the polar image. |
| Main / Aperture | Out of range (`out_of_range`) | enum | repeat | clamp, repeat, transparent |  | What happens outside the radial / angular range. |
| Main / Tiling | Angular tiling (`angular_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Tiling | Radial tiling (`radial_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Overlap | Overlap range (`overlap_range`) | float (percent) | 0 | 0 … 0.5 | ● | Cross-fades the angular seam of NON-tiling inputs: this much of the source width is blended over the start. |
| Main / Overlap | Overlap scale (`overlap_scale`) | float (percent) | 1 | 0.05 … 1 | ● | Width of the cross-fade relative to the overlap range. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Cartesian to Polar (Color)

`utils.cartesian_to_polar_color` · Utils · GPU low, tiling global

Warps an image into polar space: X becomes angle, Y becomes radius. Square / squircle metrics, spiral, pinch, tunnel perspective, aperture, angular / radial tiling and a seam overlap for non-tiling inputs.

**Gizmos:** Polar centre (circle, 2d); Rotation (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`position`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre of the polar mapping (UV). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Transform | Scale (`scale`) | float | 1 | 0.01 … 32 | ● | 1 = the radius of the inscribed circle (half of the smaller side) maps to the full source height. |
| Main / Transform | Spiral (`spiral`) | float | 0 | -16 … 16 | ● | Offsets the angle by the distance from the centre: turns of twist per unit radius. |
| Main / Shape | Distance metric (`metric`) | enum | euclidean | euclidean, chebyshev, squircle |  |  |
| Main / Shape | Squircle factor (`squircle`) | float | 4 | 1 … 16 |  | p-norm exponent: 2 = circle, large = square. |
| Main / Shape | Pinch (`pinch`) | float | 0 | -4 … 4 | ● | Radial power curve (+ pulls content towards the centre, - pushes it out). |
| Main / Shape | Perspective (`perspective`) | float (percent) | 0 | 0 … 0.98 | ● | Tunnel look: the radius maps through 1/r so texture compresses towards the centre. |
| Main / Aperture | Angle (`angle`) | float (angle) | 360 | 1 … 360 | ● | Angular range covered by the full width of the polar image. |
| Main / Aperture | Radial scaling (`radial_scaling`) | float | 1 | 0.05 … 16 | ● |  |
| Main / Aperture | Radial centering (`radial_centering`) | float | 0 | -2 … 2 | ● | Shifts the radial axis of the polar image. |
| Main / Aperture | Out of range (`out_of_range`) | enum | repeat | clamp, repeat, transparent |  | What happens outside the radial / angular range. |
| Main / Tiling | Angular tiling (`angular_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Tiling | Radial tiling (`radial_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Overlap | Overlap range (`overlap_range`) | float (percent) | 0 | 0 … 0.5 | ● | Cross-fades the angular seam of NON-tiling inputs: this much of the source width is blended over the start. |
| Main / Overlap | Overlap scale (`overlap_scale`) | float (percent) | 1 | 0.05 … 1 | ● | Width of the cross-fade relative to the overlap range. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Chromatic Aberration

`utils.chromatic_aberration` · Utils · GPU medium, tiling global

Spectral colour fringing: the image is integrated over a rainbow of offsets. Radial (lens, grows outward) or directional.

**Gizmos:** Lens centre (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Amount mod (`amount_mod`) | gray | optional · modulation · Modulates "Amount" per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Dispersion | Mode (`mode`) | enum | radial | radial, directional |  |  |
| Main / Dispersion | Amount (`amount`) | float (percent) | 0.04 | -1 … 1 | ● | Total spread of the spectrum (UV fraction at the image edge for radial mode). |
| Main / Dispersion | Amount modulation (`amount_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Dispersion | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Dispersion | Angle (`angle`) | float (angle) | 0 | -3600 … 3600 | ● | Direction of the split (directional mode). |
| Main / Dispersion | Falloff (`falloff`) | float | 1.5 | 0 … 6 |  | Radial mode: how quickly the fringing grows with the distance from the centre. |
| Main / Quality | Samples (`samples`) | int | 12 | 3 … 32 |  | Spectral taps: more = smoother rainbow. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Color to UV

`utils.color_to_uv` · Utils · GPU trivial, tiling pixel

Decodes a Color texture into a UV field: absolute coordinates, signed offsets, 0.5-biased flowmaps (Unreal / Unity / Godot) or direction + speed.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Color (`input`) | color | required |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Decode | Encoding (`codec`) | enum | biased | absolute, offset, biased, direction |  |  |
| Main / Decode | Range (`range`) | float (percent) | 0.1 | 0.0001 … 8 | ● | Offset (tile space) that a fully saturated channel represents. |
| Main / Decode | Flip Y (`flip_y`) | bool | false |  |  | Mirror the vertical component (green) — Unity / OpenGL flowmaps are bottom-up. |
| Main / Decode | Vector means (`flow_sign`) | enum | flow | flow, lookup |  |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Copy and Transform

`utils.copy_transform` · Utils · GPU medium, tiling pixel

Scatters many transformed copies of the input pattern with random position, scale, rotation and value ranges.

**Gizmos:** Copy size (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Pattern (`input`) | gray | required |
| in | Scale map (`scale_map`) | gray | optional · Copy scale is multiplied by this value at the copy centre. |
| in | Distribution (`mask`) | gray | optional · mask · A copy survives with probability = mask value at its centre. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Copies | Count (`count`) | int | 64 | 1 … 4096 | ● |  |
| Main / Copies | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Copies | Size (`size`) | float (percent) | 0.12 | 0.001 … 2 | ● | Base copy size as a fraction of the smaller image side. |
| Main / Copies | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● | Shifts the whole scatter. |
| Main / Copies | Position randomness (`jitter`) | float (percent) | 1 | 0 … 1 | ● | 0% = regular grid, 100% = anywhere inside its cell. |
| Main / Ranges | Scale min (`scale_min`) | float | 0.6 | 0.01 … 16 | ● |  |
| Main / Ranges | Scale max (`scale_max`) | float | 1.2 | 0.01 … 16 | ● |  |
| Main / Ranges | Rotation min (`rot_min`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Ranges | Rotation max (`rot_max`) | float (angle) | 360 | -3600 … 3600 | ● |  |
| Main / Ranges | Value min (`value_min`) | float | 0.4 | 0 … 16 | ● |  |
| Main / Ranges | Value max (`value_max`) | float | 1 | 0 … 16 | ● |  |
| Main / Ranges | Combine (`combine`) | enum | max | max, add, over |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Copy and Transform (Color)

`utils.copy_transform_color` · Utils · GPU medium, tiling pixel

Scatters many transformed copies of the input pattern with random position, scale, rotation and value ranges.

**Gizmos:** Copy size (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Pattern (`input`) | color | required |
| in | Scale map (`scale_map`) | gray | optional · Copy scale is multiplied by this value at the copy centre. |
| in | Distribution (`mask`) | gray | optional · mask · A copy survives with probability = mask value at its centre. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Copies | Count (`count`) | int | 64 | 1 … 4096 | ● |  |
| Main / Copies | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Copies | Size (`size`) | float (percent) | 0.12 | 0.001 … 2 | ● | Base copy size as a fraction of the smaller image side. |
| Main / Copies | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● | Shifts the whole scatter. |
| Main / Copies | Position randomness (`jitter`) | float (percent) | 1 | 0 … 1 | ● | 0% = regular grid, 100% = anywhere inside its cell. |
| Main / Ranges | Scale min (`scale_min`) | float | 0.6 | 0.01 … 16 | ● |  |
| Main / Ranges | Scale max (`scale_max`) | float | 1.2 | 0.01 … 16 | ● |  |
| Main / Ranges | Rotation min (`rot_min`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Ranges | Rotation max (`rot_max`) | float (angle) | 360 | -3600 … 3600 | ● |  |
| Main / Ranges | Value min (`value_min`) | float | 0.4 | 0 … 16 | ● |  |
| Main / Ranges | Value max (`value_max`) | float | 1 | 0 … 16 | ● |  |
| Main / Ranges | Combine (`combine`) | enum | max | max, add, over |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Curl

`utils.curl` · Utils · GPU trivial, tiling halo

Curl (vorticity) of a Vector field, central differences, per second: sign = rotation direction.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | required |
| out | Gray (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Vector | Gain (`gain`) | float | 1 | -1000 … 1000 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Denoise

`utils.denoise` · Utils · GPU high, tiling halo

Non-local-means denoise: removes noise, keeps edges and structure.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Denoise | Filter strength (`strength`) | float | 0.1 | 0.001 … 2 | ● | Patch difference tolerance (h). |
| Main / Denoise | Noise level (`sigma`) | float | 0.02 | 0 … 1 | ● | Expected noise standard deviation (differences below it count as equal). |
| Main / Denoise | Search radius (`search`) | int | 3 | 1 … 8 |  | Search window radius in pixels (cost grows with its square). |
| Main / Denoise | Patch (`patch`) | enum | cross | cross, square |  |  |
| Main / Denoise | Iterations (`iterations`) | int | 1 | 1 … 4 |  |  |
| Main / Denoise | Amount (`amount`) | float (percent) | 1 | 0 … 1 | ● | Mix with the original (keeps detail). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Denoise (Color)

`utils.denoise_color` · Utils · GPU high, tiling halo

Non-local-means denoise: removes noise, keeps edges and structure.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Denoise | Filter strength (`strength`) | float | 0.1 | 0.001 … 2 | ● | Patch difference tolerance (h). |
| Main / Denoise | Noise level (`sigma`) | float | 0.02 | 0 … 1 | ● | Expected noise standard deviation (differences below it count as equal). |
| Main / Denoise | Search radius (`search`) | int | 3 | 1 … 8 |  | Search window radius in pixels (cost grows with its square). |
| Main / Denoise | Patch (`patch`) | enum | cross | cross, square |  |  |
| Main / Denoise | Iterations (`iterations`) | int | 1 | 1 … 4 |  |  |
| Main / Denoise | Amount (`amount`) | float (percent) | 1 | 0 … 1 | ● | Mix with the original (keeps detail). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Directional Blur

`utils.directional_blur` · Utils · GPU medium, tiling halo

Blur along a direction. Angle / length can be modulated per pixel by Gray inputs or driven by a UV field.

**Gizmos:** Blur direction (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | UV (`uv`) | uv | optional · Optional: per-pixel blur vector = (UV - own coordinate) * UV scale. |
| in | Angle mod (`angle_mod`) | gray | optional · modulation · Modulates "Angle" per pixel. |
| in | Length mod (`length_mod`) | gray | optional · modulation · Modulates "Length" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Direction | Angle (`angle`) | float (angle) | 0 | -3600 … 3600 | ● | Direction in degrees, clockwise on screen. Modulation multiplies the angle. |
| Main / Direction | Angle modulation (`angle_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Direction | Length (`length`) | float (percent) | 0.05 | 0 … 1 | ● | Total blur length as a fraction of the smaller side. |
| Main / Direction | Length modulation (`length_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Direction | UV scale (`uv_scale`) | float | 1 | -64 … 64 | ● | Scale of the UV displacement when the UV pin is connected. |
| Main / Quality | Samples (`samples`) | int | 32 | 2 … 128 |  |  |
| Main / Quality | Adaptive (`adaptive`) | bool | true |  |  | Never use more taps than pixels along the blur line. |
| Main / Quality | Jitter (`jitter`) | bool | true |  |  | Per-pixel offset of the taps; trades banding for fine noise. |
| Main / Shape | Placement (`placement`) | enum | centered | centered, forward, backward |  |  |
| Main / Shape | Falloff (`falloff`) | enum | box | box, trail, gaussian |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Directional Blur (Color)

`utils.directional_blur_color` · Utils · GPU medium, tiling halo

Blur along a direction. Angle / length can be modulated per pixel by Gray inputs or driven by a UV field.

**Gizmos:** Blur direction (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | UV (`uv`) | uv | optional · Optional: per-pixel blur vector = (UV - own coordinate) * UV scale. |
| in | Angle mod (`angle_mod`) | gray | optional · modulation · Modulates "Angle" per pixel. |
| in | Length mod (`length_mod`) | gray | optional · modulation · Modulates "Length" per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Direction | Angle (`angle`) | float (angle) | 0 | -3600 … 3600 | ● | Direction in degrees, clockwise on screen. Modulation multiplies the angle. |
| Main / Direction | Angle modulation (`angle_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Direction | Length (`length`) | float (percent) | 0.05 | 0 … 1 | ● | Total blur length as a fraction of the smaller side. |
| Main / Direction | Length modulation (`length_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Direction | UV scale (`uv_scale`) | float | 1 | -64 … 64 | ● | Scale of the UV displacement when the UV pin is connected. |
| Main / Quality | Samples (`samples`) | int | 32 | 2 … 128 |  |  |
| Main / Quality | Adaptive (`adaptive`) | bool | true |  |  | Never use more taps than pixels along the blur line. |
| Main / Quality | Jitter (`jitter`) | bool | true |  |  | Per-pixel offset of the taps; trades banding for fine noise. |
| Main / Shape | Placement (`placement`) | enum | centered | centered, forward, backward |  |  |
| Main / Shape | Falloff (`falloff`) | enum | box | box, trail, gaussian |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Dissolve Over Time

`utils.dissolve` · Utils · GPU trivial, tiling pixel

Animated threshold dissolve / erode with a burn edge. Input (gradient, shape or distance) + optional Noise give the dissolve order; animate Progress 0 to 100% for Mask, Edge-glow and Heat (age at the front) outputs.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required · Dissolve order: dark areas dissolve first. A gradient gives a wipe, a shape a radial erode. |
| in | Noise (`noise`) | gray | optional · Optional noise mixed into the order (breaks up the front). |
| in | Progress mod (`progress_mod`) | gray | optional · modulation · Modulates "Progress" per pixel. |
| out | Mask (`mask`) | gray | Remaining (visible) part. |
| out | Edge (`edge`) | gray | Burn band just inside the dissolve front. |
| out | Heat (`heat`) | gray | 1 at the front fading to 0 inside: feed it to a Ramp / Blackbody for burn colours. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Dissolve | Progress (`progress`) | float (percent) | 0 | 0 … 1 | ● | Animate 0 -> 100%: 0 shows everything, 100% nothing (Reverse: the opposite). |
| Main / Dissolve | Progress modulation (`progress_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Dissolve | Softness (`softness`) | float (percent) | 0.08 | 0.001 … 1 | ● | Width of the soft transition at the front. |
| Main / Edge | Edge width (`edge_width`) | float (percent) | 0.12 | 0 … 1 | ● | Width of the burn band. |
| Main / Order | Noise amount (`noise_amount`) | float (percent) | 0.5 | 0 … 1 | ● | How much the Noise input breaks up the order (needs the Noise pin). |
| Main / Order | Noise contrast (`noise_contrast`) | float | 1 | 0.1 … 4 |  | Power applied to the noise before mixing. |
| Main / Dissolve | Reverse (`reverse`) | bool | false |  |  | Grow instead of dissolve (appear effect). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Distance

`utils.distance` · Utils · GPU medium, tiling global

Signed or unsigned distance field from a mask or from single-pixel points (jump flooding). Also outputs a per-nearest-point id and the nearest point UV for custom animated voronoi.

**Gizmos:** Max distance (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Distance (`output`) | gray |  |
| out | Point ID (`id`) | gray |  |
| out | Nearest UV (`nearest_uv`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Distance | Mode (`mode`) | enum | mask | mask, points |  |  |
| Main / Distance | Signed (`signed`) | bool | true |  |  | Mask mode: negative inside, positive outside (0.5 at the edge when normalised). |
| Main / Distance | Threshold (`threshold`) | float | 0.5 | -16 … 16 | ● |  |
| Main / Distance | Invert (`invert`) | bool | false |  |  |  |
| Main / Output | Max distance (`max_distance`) | float (percent) | 0.25 | 0.001 … 2 | ● | Fraction of the smaller side that maps to 100%. |
| Main / Output | Normalize (`normalize`) | bool | true |  |  | Off: raw distance in fractions of the smaller side. |
| Main / Output | ID seed (`seed`) | seed | 1 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Divergence

`utils.divergence` · Utils · GPU trivial, tiling halo

Divergence of a Vector field (central differences, per second): positive where the flow spreads out, negative where it converges.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | required |
| out | Gray (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Vector | Gain (`gain`) | float | 1 | -1000 … 1000 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Edge Detect

`utils.edge_detect` · Utils · GPU low, tiling halo

Sobel, Prewitt, Scharr or Laplacian edge detection with width, tolerance and invert. Output is Gray.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Edges | Kind (`kind`) | enum | sobel | sobel, prewitt, scharr, laplacian |  |  |
| Main / Edges | Width (`width`) | float (percent) | 0.002 | 0 … 0.1 | ● | Tap distance as a fraction of the smaller side (fractional pixels are fine). |
| Main / Edges | Intensity (`intensity`) | float | 4 | 0 … 256 | ● |  |
| Main / Edges | Tolerance (`tolerance`) | float | 0 | 0 … 4 | ● | Edges weaker than this are removed (0 = off). |
| Main / Edges | Softness (`softness`) | float | 0.1 | 0 … 4 |  |  |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Edge Detect (Color)

`utils.edge_detect_color` · Utils · GPU low, tiling halo

Sobel, Prewitt, Scharr or Laplacian edge detection with width, tolerance and invert. Output is Gray.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Edges | Kind (`kind`) | enum | sobel | sobel, prewitt, scharr, laplacian |  |  |
| Main / Edges | Width (`width`) | float (percent) | 0.002 | 0 … 0.1 | ● | Tap distance as a fraction of the smaller side (fractional pixels are fine). |
| Main / Edges | Intensity (`intensity`) | float | 4 | 0 … 256 | ● |  |
| Main / Edges | Tolerance (`tolerance`) | float | 0 | 0 … 4 | ● | Edges weaker than this are removed (0 = off). |
| Main / Edges | Softness (`softness`) | float | 0.1 | 0 … 4 |  |  |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Fluid Advect

`utils.fluid_advect` · Utils · GPU high, tiling global

Pushes the input back along a divergence-free curl-noise velocity field several times (finer swirls every step): thin curling smoke / ink tendrils from any simple shape. Tiles and loops.

**Gizmos:** Noise offset (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Flow | Strength (`strength`) | float (percent) | 0.28 | 0 … 4 | ● | Total displacement of all steps (fraction of the smaller side). |
| Main / Flow | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Flow | Steps (`steps`) | int | 6 | 1 … 16 |  | Advection steps: more steps = longer, finer tendrils. |
| Main / Flow | Scale (`scale`) | vec2 | [2, 2] | 0.1 … 64 | ● | Cells of the first (largest) curl across the image. Whole numbers are used while tiling. |
| Main / Flow | Frequency gain (`freq_gain`) | float | 1.45 | 1 … 3 |  | Every step multiplies the noise frequency by this factor. |
| Main / Flow | Step decay (`step_decay`) | float | 0.78 | 0.2 … 1.5 |  | Relative weight of every following step (< 1 = fine curls are weaker). |
| Main / Flow | Divergence (`divergence`) | float (percent) | 0 | 0 … 1 |  | 0 = pure swirling curl, 100% = puffy gradient flow (billowing). |
| Main / Flow | Drift (`drift`) | vec2 | [0, 0] | -2 … 2 | ● | Constant wind / buoyancy (UV units, y down). Animate with a whole tile for seamless scrolling. |
| Main / Noise | Octaves (`octaves`) | int | 3 | 1 … 6 |  |  |
| Main / Noise | Roughness (`roughness`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Main / Noise | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● |  |
| Main / Animation | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | 0 -> 1 is one seamless loop. |
| Main / Animation | Z layers (`z_cells`) | int | 2 | 1 … 16 |  |  |
| Main / Noise | Seed (`seed`) | seed | 3 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Fluid Advect (Color)

`utils.fluid_advect_color` · Utils · GPU high, tiling global

Pushes the input back along a divergence-free curl-noise velocity field several times (finer swirls every step): thin curling smoke / ink tendrils from any simple shape. Tiles and loops.

**Gizmos:** Noise offset (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Flow | Strength (`strength`) | float (percent) | 0.28 | 0 … 4 | ● | Total displacement of all steps (fraction of the smaller side). |
| Main / Flow | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Flow | Steps (`steps`) | int | 6 | 1 … 16 |  | Advection steps: more steps = longer, finer tendrils. |
| Main / Flow | Scale (`scale`) | vec2 | [2, 2] | 0.1 … 64 | ● | Cells of the first (largest) curl across the image. Whole numbers are used while tiling. |
| Main / Flow | Frequency gain (`freq_gain`) | float | 1.45 | 1 … 3 |  | Every step multiplies the noise frequency by this factor. |
| Main / Flow | Step decay (`step_decay`) | float | 0.78 | 0.2 … 1.5 |  | Relative weight of every following step (< 1 = fine curls are weaker). |
| Main / Flow | Divergence (`divergence`) | float (percent) | 0 | 0 … 1 |  | 0 = pure swirling curl, 100% = puffy gradient flow (billowing). |
| Main / Flow | Drift (`drift`) | vec2 | [0, 0] | -2 … 2 | ● | Constant wind / buoyancy (UV units, y down). Animate with a whole tile for seamless scrolling. |
| Main / Noise | Octaves (`octaves`) | int | 3 | 1 … 6 |  |  |
| Main / Noise | Roughness (`roughness`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Main / Noise | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● |  |
| Main / Animation | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | 0 -> 1 is one seamless loop. |
| Main / Animation | Z layers (`z_cells`) | int | 2 | 1 … 16 |  |  |
| Main / Noise | Seed (`seed`) | seed | 3 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### FXAA

`utils.fxaa` · Utils · GPU low, tiling halo

Fast approximate anti-aliasing of hard edges (luma based).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / FXAA | Threshold (`threshold`) | float | 0.125 | 0 … 1 |  | Relative contrast needed to smooth an edge. |
| Main / FXAA | Min threshold (`min_threshold`) | float | 0.03 | 0 … 1 |  | Absolute contrast floor (skips dark noise). |
| Main / FXAA | Span (`span`) | float | 8 | 1 … 16 |  | Maximum search distance in pixels. |
| Main / FXAA | Reduce mul (`reduce_mul`) | float | 0.125 | 0.01 … 1 |  |  |
| Main / FXAA | Strength (`strength`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### FXAA (Color)

`utils.fxaa_color` · Utils · GPU low, tiling halo

Fast approximate anti-aliasing of hard edges (luma based).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / FXAA | Threshold (`threshold`) | float | 0.125 | 0 … 1 |  | Relative contrast needed to smooth an edge. |
| Main / FXAA | Min threshold (`min_threshold`) | float | 0.03 | 0 … 1 |  | Absolute contrast floor (skips dark noise). |
| Main / FXAA | Span (`span`) | float | 8 | 1 … 16 |  | Maximum search distance in pixels. |
| Main / FXAA | Reduce mul (`reduce_mul`) | float | 0.125 | 0.01 … 1 |  |  |
| Main / FXAA | Strength (`strength`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Glow

`utils.glow` · Utils · GPU medium, tiling global

Multi-scale bloom with threshold, radius, intensity and tint.

**Gizmos:** Glow radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Glow | Threshold (`threshold`) | float | 0.5 | 0 … 16 | ● |  |
| Main / Glow | Knee (`knee`) | float | 0.2 | 0 … 4 |  | Softness of the threshold. |
| Main / Glow | Radius (`radius`) | float (percent) | 0.06 | 0.001 … 1 | ● | Glow spread, fraction of the smaller side. |
| Main / Glow | Bloom scales (`scales`) | int | 5 | 1 … 6 |  | Number of pyramid levels (multi-scale bloom). |
| Main / Glow | Intensity (`intensity`) | float | 1 | 0 … 64 | ● |  |
| Main / Output | Mode (`mode`) | enum | add | add, glow_only, screen |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Glow (Color)

`utils.glow_color` · Utils · GPU medium, tiling global

Multi-scale bloom with threshold, radius, intensity and tint.

**Gizmos:** Glow radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Glow | Threshold (`threshold`) | float | 0.5 | 0 … 16 | ● |  |
| Main / Glow | Knee (`knee`) | float | 0.2 | 0 … 4 |  | Softness of the threshold. |
| Main / Glow | Radius (`radius`) | float (percent) | 0.06 | 0.001 … 1 | ● | Glow spread, fraction of the smaller side. |
| Main / Glow | Bloom scales (`scales`) | int | 5 | 1 … 6 |  | Number of pyramid levels (multi-scale bloom). |
| Main / Glow | Intensity (`intensity`) | float | 1 | 0 … 64 | ● |  |
| Main / Glow | Tint (`tint`) | color | [1, 1, 1, 1] |  |  | Glow colour multiplier. |
| Main / Output | Mode (`mode`) | enum | add | add, glow_only, screen |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Grid

`utils.grid` · Utils · GPU trivial, tiling pixel

Square grid, bricks or hex cells: lines, random per-cell values, or both. Tileable.

**Gizmos:** Grid cells (grid, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |
| out | Cell ID (`cell_id`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Grid | Pattern (`pattern`) | enum | square | square, bricks, hex |  |  |
| Main / Grid | Cells (`cells`) | vec2 | [8, 8] | 1 … 512 |  | Cell counts (whole numbers keep the pattern tileable). |
| Main / Grid | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● |  |
| Main / Grid | Brick offset (`brick_offset`) | float (percent) | 0.5 | 0 … 1 |  | Even row counts keep bricks seamless. |
| Main / Output | Output (`output_kind`) | enum | lines | lines, cells, cells_lines |  |  |
| Main / Lines | Line width (`line_width`) | float (percent) | 0.1 | 0 … 1 | ● | Fraction of the smaller cell side. |
| Main / Lines | Softness (`softness`) | float (percent) | 0.1 | 0 … 1 | ● |  |
| Main / Lines | Line level (`line_level`) | float | 0 | 0 … 1 |  |  |
| Main / Cells | Random per cell (`random_amount`) | float (percent) | 0.5 | 0 … 1 | ● |  |
| Main / Cells | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Output | Invert (`invert`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### HSVA to RGBA

`utils.hsva_to_rgba` · Utils · GPU trivial, tiling pixel

Interprets the channels as hue, saturation, value, alpha and converts to RGBA.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | HSVA (`input`) | color | required |
| out | RGBA (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Kaleidoscope

`utils.kaleidoscope` · Utils · GPU low, tiling global

N-fold mirror or rotational symmetry around a centre (mandalas, crystals, magic circles, sigils) or a mirrored tiling.

**Gizmos:** Symmetry centre (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Symmetry | Mode (`mode`) | enum | radial | radial, grid |  |  |
| Main / Symmetry | Segments (`segments`) | int | 6 | 1 … 64 |  | Number of wedges around the centre. |
| Main / Symmetry | Mirror (`mirror`) | bool | true |  |  | Reflect every second wedge (seamless). Off = pure rotational repeat. |
| Main / Symmetry | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre of the symmetry. |
| Main / Source | Source (`source`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Point of the input that is mapped onto the centre. |
| Main / Source | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the wedge layout. |
| Main / Source | Angle offset (`angle_offset`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the picked part of the input inside the wedge (spins the pattern). |
| Main / Source | Zoom (`zoom`) | float | 1 | 0.05 … 16 | ● |  |
| Main / Source | Radius offset (`radius_offset`) | float | 0 | -2 … 2 | ● | Moves the lookup outward: animate for an endless zoom-out. |
| Main / Grid | Tiles (`tiles`) | vec2 | [2, 2] | 1 … 32 |  |  |
| Main / Grid | Shift (`shift`) | vec2 | [0, 0] | -8 … 8 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Kaleidoscope (Color)

`utils.kaleidoscope_color` · Utils · GPU low, tiling global

N-fold mirror or rotational symmetry around a centre (mandalas, crystals, magic circles, sigils) or a mirrored tiling.

**Gizmos:** Symmetry centre (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Symmetry | Mode (`mode`) | enum | radial | radial, grid |  |  |
| Main / Symmetry | Segments (`segments`) | int | 6 | 1 … 64 |  | Number of wedges around the centre. |
| Main / Symmetry | Mirror (`mirror`) | bool | true |  |  | Reflect every second wedge (seamless). Off = pure rotational repeat. |
| Main / Symmetry | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre of the symmetry. |
| Main / Source | Source (`source`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Point of the input that is mapped onto the centre. |
| Main / Source | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the wedge layout. |
| Main / Source | Angle offset (`angle_offset`) | float (angle) | 0 | -3600 … 3600 | ● | Rotates the picked part of the input inside the wedge (spins the pattern). |
| Main / Source | Zoom (`zoom`) | float | 1 | 0.05 … 16 | ● |  |
| Main / Source | Radius offset (`radius_offset`) | float | 0 | -2 … 2 | ● | Moves the lookup outward: animate for an endless zoom-out. |
| Main / Grid | Tiles (`tiles`) | vec2 | [2, 2] | 1 … 32 |  |  |
| Main / Grid | Shift (`shift`) | vec2 | [0, 0] | -8 … 8 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Anisotropic Kuwahara

`utils.kuwahara` · Utils · GPU high, tiling halo

Painterly oil-paint look: flattens regions along edge directions while keeping edges crisp.

**Gizmos:** Brush radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Brush | Radius (`radius`) | float (percent) | 0.006 | 0.0005 … 0.1 | ● | Fraction of the smaller image side (resolution independent). Capped at 16 px. |
| Main / Brush | Anisotropy (`anisotropy`) | float | 1 | 0.05 … 4 | ● | Low = strongly stretched along edges, high = round window. |
| Main / Brush | Sharpness (`sharpness`) | float | 8 | 1 … 32 | ● | How strongly the lowest-variance sector wins. |
| Main / Brush | Smoothing (`smoothing`) | float (percent) | 0.004 | 0 … 0.05 |  | Smoothing of the direction field. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Anisotropic Kuwahara (Color)

`utils.kuwahara_color` · Utils · GPU high, tiling halo

Painterly oil-paint look: flattens regions along edge directions while keeping edges crisp.

**Gizmos:** Brush radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Brush | Radius (`radius`) | float (percent) | 0.006 | 0.0005 … 0.1 | ● | Fraction of the smaller image side (resolution independent). Capped at 16 px. |
| Main / Brush | Anisotropy (`anisotropy`) | float | 1 | 0.05 … 4 | ● | Low = strongly stretched along edges, high = round window. |
| Main / Brush | Sharpness (`sharpness`) | float | 8 | 1 … 32 | ● | How strongly the lowest-variance sector wins. |
| Main / Brush | Smoothing (`smoothing`) | float (percent) | 0.004 | 0 … 0.05 |  | Smoothing of the direction field. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Lattice

`utils.lattice` · Utils · GPU low, tiling global

Warps the input by dragging the points of a 4x4 control lattice.

**Gizmos:** Lattice point 1, 1 (point, 2d); Lattice point 2, 1 (point, 2d); Lattice point 3, 1 (point, 2d); Lattice point 4, 1 (point, 2d); Lattice point 1, 2 (point, 2d); Lattice point 2, 2 (point, 2d); Lattice point 3, 2 (point, 2d); Lattice point 4, 2 (point, 2d); Lattice point 1, 3 (point, 2d); Lattice point 2, 3 (point, 2d); Lattice point 3, 3 (point, 2d); Lattice point 4, 3 (point, 2d); Lattice point 1, 4 (point, 2d); Lattice point 2, 4 (point, 2d); Lattice point 3, 4 (point, 2d); Lattice point 4, 4 (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Lattice | Mode (`mode`) | enum | periodic | periodic, clamped |  |  |
| Main / Lattice | Amount (`amount`) | float | 1 | -4 … 4 | ● | Scales all displacements. |
| Main / Lattice | Jitter (`jitter`) | float | 0 | 0 … 0.5 | ● | Seeded random displacement added to every point (UV units). |
| Main / Lattice | Jitter seed (`jitter_seed`) | seed | 1 |  |  |  |
| Main / Control points | Point 1, 1 (`p00`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 1 (`p01`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 1 (`p02`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 1 (`p03`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 1, 2 (`p10`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 2 (`p11`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 2 (`p12`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 2 (`p13`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 1, 3 (`p20`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 3 (`p21`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 3 (`p22`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 3 (`p23`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 1, 4 (`p30`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 4 (`p31`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 4 (`p32`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 4 (`p33`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Lattice (Color)

`utils.lattice_color` · Utils · GPU low, tiling global

Warps the input by dragging the points of a 4x4 control lattice.

**Gizmos:** Lattice point 1, 1 (point, 2d); Lattice point 2, 1 (point, 2d); Lattice point 3, 1 (point, 2d); Lattice point 4, 1 (point, 2d); Lattice point 1, 2 (point, 2d); Lattice point 2, 2 (point, 2d); Lattice point 3, 2 (point, 2d); Lattice point 4, 2 (point, 2d); Lattice point 1, 3 (point, 2d); Lattice point 2, 3 (point, 2d); Lattice point 3, 3 (point, 2d); Lattice point 4, 3 (point, 2d); Lattice point 1, 4 (point, 2d); Lattice point 2, 4 (point, 2d); Lattice point 3, 4 (point, 2d); Lattice point 4, 4 (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Lattice | Mode (`mode`) | enum | periodic | periodic, clamped |  |  |
| Main / Lattice | Amount (`amount`) | float | 1 | -4 … 4 | ● | Scales all displacements. |
| Main / Lattice | Jitter (`jitter`) | float | 0 | 0 … 0.5 | ● | Seeded random displacement added to every point (UV units). |
| Main / Lattice | Jitter seed (`jitter_seed`) | seed | 1 |  |  |  |
| Main / Control points | Point 1, 1 (`p00`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 1 (`p01`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 1 (`p02`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 1 (`p03`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 1, 2 (`p10`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 2 (`p11`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 2 (`p12`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 2 (`p13`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 1, 3 (`p20`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 3 (`p21`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 3 (`p22`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 3 (`p23`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 1, 4 (`p30`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 2, 4 (`p31`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 3, 4 (`p32`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Main / Control points | Point 4, 4 (`p33`) | vec2 | [0, 0] | -1 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Levels

`utils.levels` · Utils · GPU trivial, tiling pixel

Remaps the input range, gamma and output range. Auto levels stretch the actual min / max to the full range (GPU reduction, no stall).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | Auto levels (`auto`) | bool | false |  |  | Use the image minimum / maximum as input range (found on the GPU). |
| Main / Input | Input low (`in_low`) | float | 0 | -16 … 16 | ● |  |
| Main / Input | Input high (`in_high`) | float | 1 | -16 … 16 | ● |  |
| Main / Input | Gamma (`gamma`) | float | 1 | 0.01 … 10 | ● | >1 brightens midtones, <1 darkens. |
| Main / Output | Output low (`out_low`) | float | 0 | -16 … 16 | ● |  |
| Main / Output | Output high (`out_high`) | float | 1 | -16 … 16 | ● |  |
| Main / Output | Clamp output (`clamp_output`) | bool | true |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Levels (Color)

`utils.levels_color` · Utils · GPU trivial, tiling pixel

Remaps the input range, gamma and output range. Auto levels stretch the actual min / max to the full range (GPU reduction, no stall).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | Auto levels (`auto`) | bool | false |  |  | Use the image minimum / maximum as input range (found on the GPU). |
| Main / Input | Input low (`in_low`) | float | 0 | -16 … 16 | ● |  |
| Main / Input | Input high (`in_high`) | float | 1 | -16 … 16 | ● |  |
| Main / Input | Gamma (`gamma`) | float | 1 | 0.01 … 10 | ● | >1 brightens midtones, <1 darkens. |
| Main / Output | Output low (`out_low`) | float | 0 | -16 … 16 | ● |  |
| Main / Output | Output high (`out_high`) | float | 1 | -16 … 16 | ● |  |
| Main / Output | Clamp output (`clamp_output`) | bool | true |  |  |  |
| Main / Output | Include alpha (`levels_alpha`) | bool | false |  |  | Alpha is an ordinary channel: tick to level it as well. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Light Pack (Fake Lighting)

`utils.light_pack` · Utils · GPU low, tiling halo

Bakes three directional light maps (+ alpha) from a height / density map into RGBA for smoke and cloud flipbooks. The engine recombines the channels with the real light direction.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Height (`height`) | gray | required · Density / height of the puff (bright = closer to the viewer). |
| in | Alpha (`alpha`) | gray | optional · Opacity written to A. Default: the height itself. |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Surface | Strength (`strength`) | float | 6 | 0 … 64 | ● | Bump strength: slope of the surface per UV unit of height change. |
| Main / Lights | Elevation (`elevation`) | float (angle) | 40 | 0 … 90 | ● | Elevation of all three lights above the surface plane. |
| Main / Lights | Light A (R) azimuth (`angle_a`) | float (angle) | 135 | -360 … 360 | ● | Counter-clockwise from +X on screen: 135 = top-left. |
| Main / Lights | Light B (G) azimuth (`angle_b`) | float (angle) | 45 | -360 … 360 | ● | 45 = top-right. |
| Main / Lights | Light C (B) azimuth (`angle_c`) | float (angle) | -90 | -360 … 360 | ● | -90 = from below (under-light / back-light). |
| Main / Shading | Wrap (`wrap`) | float (percent) | 0.4 | 0 … 1 |  | Soft terminator (wrapped diffuse): smoke scatters light past the shadow line. |
| Main / Shading | Ambient (`ambient`) | float (percent) | 0.1 | 0 … 1 |  |  |
| Main / Output | Output (`output_mode`) | enum | packed | packed, preview |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Math

`utils.math` · Utils · GPU trivial, tiling pixel · identity short-cut

Per-pixel math on Gray: add, multiply, pow, min / max, lerp, step, smoothstep, remap range, clamp, gamma ... with a second Gray input or a constant. The workhorse for masks, envelopes and contrast.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | A (`a`) | gray | required · First operand. |
| in | B (`b`) | gray | optional · Second operand. When not connected the constant Value is used. |
| in | Value (B) mod (`value_mod`) | gray | optional · modulation · Modulates "Value (B)" per pixel. |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Math | Operation (`op`) | enum | multiply | add, subtract, multiply, divide, pow, min, max, difference, lerp, mod, step, smoothstep, remap, clamp, abs, one_minus, gamma |  |  |
| Main / Math | Value (B) (`value`) | float | 1 | -100 … 100 | ● | Constant used as B when the B input is not connected. |
| Main / Math | Value (B) modulation (`value_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Math | Value 2 (`value2`) | float | 0.5 | -100 … 100 | ● | Lerp factor / smoothstep width / clamp maximum. |
| Main / Remap | In range (`in_range`) | vec2 | [0, 1] | -100 … 100 | ● |  |
| Main / Remap | Out range (`out_range`) | vec2 | [0, 1] | -100 … 100 | ● |  |
| Main / Output | Clamp result 0..1 (`clamp_out`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Multi Blend

`utils.multi_blend` · Utils · GPU low, tiling pixel

Composites up to 8 layers over a base, each with its own blend mode and opacity.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Base (`base`) | gray | optional |
| in | Layer 1 (`layer_1`) | gray | optional |
| in | Layer 2 (`layer_2`) | gray | optional |
| in | Layer 3 (`layer_3`) | gray | optional |
| in | Layer 4 (`layer_4`) | gray | optional |
| in | Layer 5 (`layer_5`) | gray | optional |
| in | Layer 6 (`layer_6`) | gray | optional |
| in | Layer 7 (`layer_7`) | gray | optional |
| in | Layer 8 (`layer_8`) | gray | optional |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Layers | Layers (`layers`) | int | 3 | 1 … 8 |  | Number of layers that take part (the pins stay visible; unused ones are ignored). |
| Main / Layers | Smoothness (`smoothness`) | float | 0.1 | 0 … 1 |  | Used by smooth min / max layers. |
| Main / Layers | Clamp 0..1 (`clamp_output`) | bool | false |  |  |  |
| Main / Layer 1 | Enabled (`enabled_1`) | bool | true |  |  |  |
| Main / Layer 1 | Blend type (`mode_1`) | enum | copy | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 1 | Opacity (`opacity_1`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 2 | Enabled (`enabled_2`) | bool | true |  |  |  |
| Main / Layer 2 | Blend type (`mode_2`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 2 | Opacity (`opacity_2`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 3 | Enabled (`enabled_3`) | bool | true |  |  |  |
| Main / Layer 3 | Blend type (`mode_3`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 3 | Opacity (`opacity_3`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 4 | Enabled (`enabled_4`) | bool | true |  |  |  |
| Main / Layer 4 | Blend type (`mode_4`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 4 | Opacity (`opacity_4`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 5 | Enabled (`enabled_5`) | bool | true |  |  |  |
| Main / Layer 5 | Blend type (`mode_5`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 5 | Opacity (`opacity_5`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 6 | Enabled (`enabled_6`) | bool | true |  |  |  |
| Main / Layer 6 | Blend type (`mode_6`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 6 | Opacity (`opacity_6`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 7 | Enabled (`enabled_7`) | bool | true |  |  |  |
| Main / Layer 7 | Blend type (`mode_7`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 7 | Opacity (`opacity_7`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 8 | Enabled (`enabled_8`) | bool | true |  |  |  |
| Main / Layer 8 | Blend type (`mode_8`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 8 | Opacity (`opacity_8`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Multi Blend (Color)

`utils.multi_blend_color` · Utils · GPU low, tiling pixel

Composites up to 8 layers over a base, each with its own blend mode and opacity.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Base (`base`) | color | optional |
| in | Layer 1 (`layer_1`) | color | optional |
| in | Layer 2 (`layer_2`) | color | optional |
| in | Layer 3 (`layer_3`) | color | optional |
| in | Layer 4 (`layer_4`) | color | optional |
| in | Layer 5 (`layer_5`) | color | optional |
| in | Layer 6 (`layer_6`) | color | optional |
| in | Layer 7 (`layer_7`) | color | optional |
| in | Layer 8 (`layer_8`) | color | optional |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Layers | Layers (`layers`) | int | 3 | 1 … 8 |  | Number of layers that take part (the pins stay visible; unused ones are ignored). |
| Main / Layers | Smoothness (`smoothness`) | float | 0.1 | 0 … 1 |  | Used by smooth min / max layers. |
| Main / Layers | Clamp 0..1 (`clamp_output`) | bool | false |  |  |  |
| Main / Layer 1 | Enabled (`enabled_1`) | bool | true |  |  |  |
| Main / Layer 1 | Blend type (`mode_1`) | enum | copy | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 1 | Opacity (`opacity_1`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 2 | Enabled (`enabled_2`) | bool | true |  |  |  |
| Main / Layer 2 | Blend type (`mode_2`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 2 | Opacity (`opacity_2`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 3 | Enabled (`enabled_3`) | bool | true |  |  |  |
| Main / Layer 3 | Blend type (`mode_3`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 3 | Opacity (`opacity_3`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 4 | Enabled (`enabled_4`) | bool | true |  |  |  |
| Main / Layer 4 | Blend type (`mode_4`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 4 | Opacity (`opacity_4`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 5 | Enabled (`enabled_5`) | bool | true |  |  |  |
| Main / Layer 5 | Blend type (`mode_5`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 5 | Opacity (`opacity_5`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 6 | Enabled (`enabled_6`) | bool | true |  |  |  |
| Main / Layer 6 | Blend type (`mode_6`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 6 | Opacity (`opacity_6`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 7 | Enabled (`enabled_7`) | bool | true |  |  |  |
| Main / Layer 7 | Blend type (`mode_7`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 7 | Opacity (`opacity_7`) | float (percent) | 1 | 0 … 1 | ● |  |
| Main / Layer 8 | Enabled (`enabled_8`) | bool | true |  |  |  |
| Main / Layer 8 | Blend type (`mode_8`) | enum | add | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Main / Layer 8 | Opacity (`opacity_8`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Multi Switch

`utils.multi_switch` · Utils · GPU trivial, tiling pixel

Selects one of up to 8 inputs by an animatable index (step, nearest or crossfade; loop friendly).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input 1 (`input_1`) | gray | optional |
| in | Input 2 (`input_2`) | gray | optional |
| in | Input 3 (`input_3`) | gray | optional |
| in | Input 4 (`input_4`) | gray | optional |
| in | Input 5 (`input_5`) | gray | optional |
| in | Input 6 (`input_6`) | gray | optional |
| in | Input 7 (`input_7`) | gray | optional |
| in | Input 8 (`input_8`) | gray | optional |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Switch | Index (`index`) | float | 0 | -1024 … 1024 | ● | 0 selects Input 1. Fractions matter in Crossfade mode. |
| Main / Switch | Inputs (`count`) | int | 2 | 1 … 8 |  | How many inputs take part (also the loop length when Wrap is on). |
| Main / Switch | Mode (`mode`) | enum | step | step, nearest, crossfade |  |  |
| Main / Switch | Wrap (loop) (`wrap`) | bool | true |  |  | Index wraps around the active inputs; otherwise it is clamped. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Multi Switch (Color)

`utils.multi_switch_color` · Utils · GPU trivial, tiling pixel

Selects one of up to 8 inputs by an animatable index (step, nearest or crossfade; loop friendly).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input 1 (`input_1`) | color | optional |
| in | Input 2 (`input_2`) | color | optional |
| in | Input 3 (`input_3`) | color | optional |
| in | Input 4 (`input_4`) | color | optional |
| in | Input 5 (`input_5`) | color | optional |
| in | Input 6 (`input_6`) | color | optional |
| in | Input 7 (`input_7`) | color | optional |
| in | Input 8 (`input_8`) | color | optional |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Switch | Index (`index`) | float | 0 | -1024 … 1024 | ● | 0 selects Input 1. Fractions matter in Crossfade mode. |
| Main / Switch | Inputs (`count`) | int | 2 | 1 … 8 |  | How many inputs take part (also the loop length when Wrap is on). |
| Main / Switch | Mode (`mode`) | enum | step | step, nearest, crossfade |  |  |
| Main / Switch | Wrap (loop) (`wrap`) | bool | true |  |  | Index wraps around the active inputs; otherwise it is clamped. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Polar to Cartesian

`utils.polar_to_cartesian` · Utils · GPU low, tiling global

Unwraps a radial image: angle becomes X, radius becomes Y (inverse of Cartesian to Polar). Turns shockwave rings and radial bursts into straight, scrollable textures.

**Gizmos:** Polar centre (circle, 2d); Rotation (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`position`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre of the polar mapping (UV). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Transform | Scale (`scale`) | float | 1 | 0.01 … 32 | ● | 1 = the radius of the inscribed circle (half of the smaller side) maps to the full source height. |
| Main / Transform | Spiral (`spiral`) | float | 0 | -16 … 16 | ● | Offsets the angle by the distance from the centre: turns of twist per unit radius. |
| Main / Shape | Distance metric (`metric`) | enum | euclidean | euclidean, chebyshev, squircle |  |  |
| Main / Shape | Squircle factor (`squircle`) | float | 4 | 1 … 16 |  | p-norm exponent: 2 = circle, large = square. |
| Main / Shape | Pinch (`pinch`) | float | 0 | -4 … 4 | ● | Radial power curve (+ pulls content towards the centre, - pushes it out). |
| Main / Shape | Perspective (`perspective`) | float (percent) | 0 | 0 … 0.98 | ● | Tunnel look: the radius maps through 1/r so texture compresses towards the centre. |
| Main / Aperture | Angle (`angle`) | float (angle) | 360 | 1 … 360 | ● | Angular range covered by the full width of the polar image. |
| Main / Aperture | Radial scaling (`radial_scaling`) | float | 1 | 0.05 … 16 | ● |  |
| Main / Aperture | Radial centering (`radial_centering`) | float | 0 | -2 … 2 | ● | Shifts the radial axis of the polar image. |
| Main / Aperture | Out of range (`out_of_range`) | enum | repeat | clamp, repeat, transparent |  | What happens outside the radial / angular range. |
| Main / Tiling | Angular tiling (`angular_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Tiling | Radial tiling (`radial_tiling`) | int | 1 | 1 … 64 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Polar to Cartesian (Color)

`utils.polar_to_cartesian_color` · Utils · GPU low, tiling global

Unwraps a radial image: angle becomes X, radius becomes Y (inverse of Cartesian to Polar). Turns shockwave rings and radial bursts into straight, scrollable textures.

**Gizmos:** Polar centre (circle, 2d); Rotation (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`position`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre of the polar mapping (UV). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Transform | Scale (`scale`) | float | 1 | 0.01 … 32 | ● | 1 = the radius of the inscribed circle (half of the smaller side) maps to the full source height. |
| Main / Transform | Spiral (`spiral`) | float | 0 | -16 … 16 | ● | Offsets the angle by the distance from the centre: turns of twist per unit radius. |
| Main / Shape | Distance metric (`metric`) | enum | euclidean | euclidean, chebyshev, squircle |  |  |
| Main / Shape | Squircle factor (`squircle`) | float | 4 | 1 … 16 |  | p-norm exponent: 2 = circle, large = square. |
| Main / Shape | Pinch (`pinch`) | float | 0 | -4 … 4 | ● | Radial power curve (+ pulls content towards the centre, - pushes it out). |
| Main / Shape | Perspective (`perspective`) | float (percent) | 0 | 0 … 0.98 | ● | Tunnel look: the radius maps through 1/r so texture compresses towards the centre. |
| Main / Aperture | Angle (`angle`) | float (angle) | 360 | 1 … 360 | ● | Angular range covered by the full width of the polar image. |
| Main / Aperture | Radial scaling (`radial_scaling`) | float | 1 | 0.05 … 16 | ● |  |
| Main / Aperture | Radial centering (`radial_centering`) | float | 0 | -2 … 2 | ● | Shifts the radial axis of the polar image. |
| Main / Aperture | Out of range (`out_of_range`) | enum | repeat | clamp, repeat, transparent |  | What happens outside the radial / angular range. |
| Main / Tiling | Angular tiling (`angular_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Tiling | Radial tiling (`radial_tiling`) | int | 1 | 1 … 64 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Radial Blur

`utils.radial_blur` · Utils · GPU medium, tiling global

Zoom and / or spin blur around a centre. Streaks for flares, shockwaves, speed lines and light shafts.

**Gizmos:** Blur centre (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Amount mod (`amount_mod`) | gray | optional · modulation · Modulates "Amount" per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Mode (`mode`) | enum | zoom | zoom, spin, both |  |  |
| Main / Blur | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Blur | Amount (`amount`) | float (percent) | 0.25 | -1 … 1 | ● | Zoom length: 100% pulls the outer taps all the way to the centre. |
| Main / Blur | Amount modulation (`amount_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Blur | Angle (`angle`) | float (angle) | 20 | -360 … 360 | ● | Total spin angle of the blur. |
| Main / Blur | Sharp radius (`inner`) | float (percent) | 0 | 0 … 2 | ● | Pixels closer than this to the centre stay sharp. |
| Main / Blur | Sharp transition (`inner_soft`) | float (percent) | 0.1 | 0 … 2 |  |  |
| Main / Shape | Falloff (`falloff`) | enum | box | box, trail, gaussian |  |  |
| Main / Quality | Samples (`samples`) | int | 32 | 2 … 128 |  |  |
| Main / Quality | Jitter (`jitter`) | bool | true |  |  | Per-pixel offset of the taps; trades banding for fine noise. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Radial Blur (Color)

`utils.radial_blur_color` · Utils · GPU medium, tiling global

Zoom and / or spin blur around a centre. Streaks for flares, shockwaves, speed lines and light shafts.

**Gizmos:** Blur centre (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Amount mod (`amount_mod`) | gray | optional · modulation · Modulates "Amount" per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Mode (`mode`) | enum | zoom | zoom, spin, both |  |  |
| Main / Blur | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Blur | Amount (`amount`) | float (percent) | 0.25 | -1 … 1 | ● | Zoom length: 100% pulls the outer taps all the way to the centre. |
| Main / Blur | Amount modulation (`amount_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Blur | Angle (`angle`) | float (angle) | 20 | -360 … 360 | ● | Total spin angle of the blur. |
| Main / Blur | Sharp radius (`inner`) | float (percent) | 0 | 0 … 2 | ● | Pixels closer than this to the centre stay sharp. |
| Main / Blur | Sharp transition (`inner_soft`) | float (percent) | 0.1 | 0 … 2 |  |  |
| Main / Shape | Falloff (`falloff`) | enum | box | box, trail, gaussian |  |  |
| Main / Quality | Samples (`samples`) | int | 32 | 2 … 128 |  |  |
| Main / Quality | Jitter (`jitter`) | bool | true |  |  | Per-pixel offset of the taps; trades banding for fine noise. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### RGB to Grayscale

`utils.rgb_to_grayscale` · Utils · GPU trivial, tiling pixel

Converts a Color texture to Gray with luminance weights, average, max, min or custom weights.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | RGB Color (`input`) | color | required |
| out | Grayscale (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Conversion | Mode (`mode`) | enum | rec709 | rec709, rec601, average, max, min, custom |  |  |
| Main / Conversion | Weights (`weights`) | vec3 | [0.2126, 0.7152, 0.0722] | -16 … 16 |  |  |
| Main / Conversion | Normalize weights (`normalize_weights`) | bool | true |  |  |  |
| Main / Conversion | Multiply by alpha (`use_alpha`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### RGBA Merge

`utils.rgba_merge` · Utils · GPU trivial, tiling pixel

Packs four Gray textures into the R, G, B and A channels of a Color texture.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | R (`r`) | gray | optional |
| in | G (`g`) | gray | optional |
| in | B (`b`) | gray | optional |
| in | A (`a`) | gray | optional |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Defaults | R when unconnected (`default_r`) | float | 0 | -16 … 16 | ● |  |
| Main / Defaults | G when unconnected (`default_g`) | float | 0 | -16 … 16 | ● |  |
| Main / Defaults | B when unconnected (`default_b`) | float | 0 | -16 … 16 | ● |  |
| Main / Defaults | A when unconnected (`default_a`) | float | 1 | -16 … 16 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### RGBA Split

`utils.rgba_split` · Utils · GPU trivial, tiling pixel

Splits a Color texture into its R, G, B and A channels as Gray textures.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| out | R (`r`) | gray |  |
| out | G (`g`) | gray |  |
| out | B (`b`) | gray |  |
| out | A (`a`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### RGBA to HSVA

`utils.rgba_to_hsva` · Utils · GPU trivial, tiling pixel

Converts RGBA to hue, saturation, value, alpha stored in the four channels.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | RGBA (`input`) | color | required |
| out | HSVA (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Sheet Decode

`utils.sheet_decode` · Utils · time dependent · GPU trivial, tiling pixel

Plays a flipbook sheet: picks the frame for the current time (or a manual frame), optionally cross-fading neighbouring frames, and outputs it as a normal texture.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Sheet (`sheet`) | color | optional |
| in | Flipbook (`flipbook`) | flipbook | optional · Overrides grid, frame count, padding and row order with the flipbook metadata. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Playback | Mode (`mode`) | enum | time | time, manual |  |  |
| Main / Playback | Frame (`frame`) | float | 0 | -100000 … 100000 | ● | Frame number (fractions blend when Blend frames is on). |
| Main / Playback | Rate (frames / s) (`rate`) | float | 30 | -1000 … 1000 | ● |  |
| Main / Playback | Start offset (frames) (`offset`) | float | 0 | -100000 … 100000 | ● |  |
| Main / Playback | Loop mode (`loop_mode`) | enum | loop | loop, once, pingpong |  |  |
| Main / Playback | Blend frames (`blend`) | bool | true |  |  | Cross-fade between two neighbouring frames (the last frame fades into the first when looping). |
| Main / Grid | Cols (`cols`) | int | 4 | 1 … 256 |  | Used when no Flipbook pin is connected. |
| Main / Grid | Rows (`rows`) | int | 4 | 1 … 256 |  |  |
| Main / Grid | Frame count (`frames`) | int | 16 | 1 … 65536 |  |  |
| Main / Grid | Padding (`padding`) | int | 0 | 0 … 64 |  |  |
| Main / Grid | Row order (`row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Sheet Encode

`utils.sheet_encode` · Utils · GPU low, tiling global

Bakes the animation of the connected node into a flipbook sheet: N frames sampled over the loop (or a custom range) are placed in a grid (non-square / non-power-of-two cells, edge padding, row order, reverse, loop cross-fade). The sheet size is the node size (Texture tab).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required · Animated Gray or Color texture. Not evaluated per frame by the engine: the baker pulls it at every sample time. |
| out | Sheet (`sheet`) | color |  |
| out | Flipbook (`flipbook`) | flipbook |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Frames | Frames (`frames`) | int | 16 | 1 … 1024 |  | Number of frames in the sheet. |
| Main / Frames | Range (`range`) | enum | loop | loop, custom |  | Loop length = frames 0 … loopLength of the graph (frame N == frame 0 for a seamless loop). |
| Main / Frames | Start frame (`start`) | float | 0 | -100000 … 100000 |  |  |
| Main / Frames | End frame (`end`) | float | 64 | -100000 … 100000 |  | Exclusive: frames are sampled in [start, end). |
| Main / Frames | Time offset (frames) (`frame_offset`) | float | 0 | -100000 … 100000 | ● | Shifts every sample in time (rotate the loop start). |
| Main / Frames | Reverse (`reverse`) | bool | false |  |  |  |
| Main / Frames | Loop cross-fade frames (`loop_fade`) | int | 0 | 0 … 64 |  | Blends the last N frames with the same frames one loop earlier so a NON-periodic animation still loops. |
| Main / Grid | Automatic grid (`auto_grid`) | bool | true |  |  |  |
| Main / Grid | Cols (`cols`) | int | 4 | 1 … 64 |  |  |
| Main / Grid | Rows (`rows`) | int | 4 | 1 … 64 |  |  |
| Main / Grid | Row order (`row_order`) | enum | top_down | top_down, bottom_up |  |  |
| Main / Grid | Edge padding (px) (`padding`) | int | 0 | 0 … 64 |  | Pixels per cell border that replicate the frame edge (mip-safe). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Softblend

`utils.softblend` · Utils · GPU trivial, tiling pixel

Height-aware blend: the layer with the higher height wins, softly. Also outputs the blended height.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Foreground (`foreground`) | gray | required |
| in | Background (`background`) | gray | required |
| in | Foreground height (`foreground_height`) | gray | optional |
| in | Background height (`background_height`) | gray | optional |
| in | Mask (`mask`) | gray | optional · mask |
| out | Output (`output`) | gray |  |
| out | Height (`height`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blend | Softness (`softness`) | float | 0.1 | 0 … 4 | ● |  |
| Main / Blend | Foreground height offset (`offset`) | float | 0 | -16 … 16 | ● | Raises / lowers the foreground (positive = foreground wins more often). |
| Main / Blend | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Softblend (Color)

`utils.softblend_color` · Utils · GPU trivial, tiling pixel

Height-aware blend: the layer with the higher height wins, softly. Also outputs the blended height.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Foreground (`foreground`) | color | required |
| in | Background (`background`) | color | required |
| in | Foreground height (`foreground_height`) | gray | optional |
| in | Background height (`background_height`) | gray | optional |
| in | Mask (`mask`) | gray | optional · mask |
| out | Output (`output`) | color |  |
| out | Height (`height`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blend | Softness (`softness`) | float | 0.1 | 0 … 4 | ● |  |
| Main / Blend | Foreground height offset (`offset`) | float | 0 | -16 … 16 | ● | Raises / lowers the foreground (positive = foreground wins more often). |
| Main / Blend | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Tile

`utils.tile` · Utils · GPU low, tiling pixel

Repeats the input in a grid with mirror, brick offsets and per-tile random offset, rotation, scale and flips. Outputs a tile id.

**Gizmos:** Tiles (grid, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |
| out | Tile ID (`tile_id`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Tiles | Tiles (`tiles`) | vec2 | [4, 4] | 1 … 256 |  |  |
| Main / Tiles | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● |  |
| Main / Tiles | Mirror (`mirror`) | bool | false |  |  | Flip every second tile (even counts keep it seamless). |
| Main / Offsets | Row offset (`row_offset`) | float (percent) | 0 | -1 … 1 | ● | Shifts every second row by this fraction of a tile (brick pattern at 50%). |
| Main / Offsets | Column offset (`col_offset`) | float (percent) | 0 | -1 … 1 | ● |  |
| Main / Random per tile | Offset (`rand_offset`) | float (percent) | 0 | 0 … 1 | ● |  |
| Main / Random per tile | Rotation (`rand_rot`) | float (angle) | 0 | 0 … 360 | ● | Maximum random rotation (+-). |
| Main / Random per tile | Random 90° steps (`rot90`) | bool | false |  |  |  |
| Main / Random per tile | Scale (`rand_scale`) | float (percent) | 0 | 0 … 0.95 | ● | Random scale 1 +- amount. |
| Main / Random per tile | Random flip (`rand_flip`) | bool | false |  |  |  |
| Main / Random per tile | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Random per tile | Outside tile (`fill`) | enum | wrap | wrap, empty |  | What a rotated / scaled tile shows outside its own area. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Tile (Color)

`utils.tile_color` · Utils · GPU low, tiling pixel

Repeats the input in a grid with mirror, brick offsets and per-tile random offset, rotation, scale and flips. Outputs a tile id.

**Gizmos:** Tiles (grid, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |
| out | Tile ID (`tile_id`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Tiles | Tiles (`tiles`) | vec2 | [4, 4] | 1 … 256 |  |  |
| Main / Tiles | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● |  |
| Main / Tiles | Mirror (`mirror`) | bool | false |  |  | Flip every second tile (even counts keep it seamless). |
| Main / Offsets | Row offset (`row_offset`) | float (percent) | 0 | -1 … 1 | ● | Shifts every second row by this fraction of a tile (brick pattern at 50%). |
| Main / Offsets | Column offset (`col_offset`) | float (percent) | 0 | -1 … 1 | ● |  |
| Main / Random per tile | Offset (`rand_offset`) | float (percent) | 0 | 0 … 1 | ● |  |
| Main / Random per tile | Rotation (`rand_rot`) | float (angle) | 0 | 0 … 360 | ● | Maximum random rotation (+-). |
| Main / Random per tile | Random 90° steps (`rot90`) | bool | false |  |  |  |
| Main / Random per tile | Scale (`rand_scale`) | float (percent) | 0 | 0 … 0.95 | ● | Random scale 1 +- amount. |
| Main / Random per tile | Random flip (`rand_flip`) | bool | false |  |  |  |
| Main / Random per tile | Seed (`seed`) | seed | 1 |  |  |  |
| Main / Random per tile | Outside tile (`fill`) | enum | wrap | wrap, empty |  | What a rotated / scaled tile shows outside its own area. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Transform

`utils.transform` · Utils · GPU trivial, tiling global · identity short-cut

Translate, rotate, scale and skew around a pivot with wrap / clamp / mirror edge handling.

**Gizmos:** Transform (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | required |
| in | UV (`uv`) | uv | optional · Optional absolute lookup coordinates; the transform is applied to them. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`translate`) | vec2 | [0, 0] | -64 … 64 | ● | Offset in UV units (1 = one image). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -36000 … 36000 | ● |  |
| Main / Transform | Scale (`scale`) | vec2 | [1, 1] | -64 … 64 | ● |  |
| Main / Transform | Skew (`skew`) | vec2 | [0, 0] | -80 … 80 | ● | Shear in degrees. |
| Main / Transform | Pivot (`pivot`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Edges | Edge (`edge`) | enum | tiling | tiling, wrap, clamp, mirror, transparent |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Transform (Color)

`utils.transform_color` · Utils · GPU trivial, tiling global · identity short-cut

Translate, rotate, scale and skew around a pivot with wrap / clamp / mirror edge handling.

**Gizmos:** Transform (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | required |
| in | UV (`uv`) | uv | optional · Optional absolute lookup coordinates; the transform is applied to them. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`translate`) | vec2 | [0, 0] | -64 … 64 | ● | Offset in UV units (1 = one image). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -36000 … 36000 | ● |  |
| Main / Transform | Scale (`scale`) | vec2 | [1, 1] | -64 … 64 | ● |  |
| Main / Transform | Skew (`skew`) | vec2 | [0, 0] | -80 … 80 | ● | Shear in degrees. |
| Main / Transform | Pivot (`pivot`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Edges | Edge (`edge`) | enum | tiling | tiling, wrap, clamp, mirror, transparent |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### UV Merge

`utils.uv_merge` · Utils · GPU trivial, tiling pixel

Combines two Gray textures into a UV field (U and V). Gray can mean an absolute coordinate, a signed offset or a 50%-biased offset.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | U (`u`) | gray | optional |
| in | V (`v`) | gray | optional |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Merge | Gray means (`source`) | enum | biased | absolute, offset, biased |  |  |
| Main / Merge | Range (`range`) | float (percent) | 0.1 | 0.0001 … 8 | ● | Offset (tile space) at 0% / 100% gray. |
| Main / Merge | Flip Y (`flip_y`) | bool | false |  |  |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Split

`utils.uv_split` · Utils · GPU trivial, tiling pixel

Splits a UV field into two Gray textures (U and V) as absolute coordinates, signed offsets or 50%-biased offsets.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`input`) | uv | required |
| out | U (`u`) | gray |  |
| out | V (`v`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | UV input (`uv_in`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Split | Gray holds (`output`) | enum | absolute | absolute, offset, biased |  |  |
| Main / Split | Range (`range`) | float (percent) | 0.1 | 0.0001 … 8 | ● |  |
| Main / Split | Flip Y (`flip_y`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV to Color

`utils.uv_to_color` · Utils · GPU trivial, tiling pixel

Encodes a UV field into RG(B) of a Color texture: absolute coordinates, signed offsets, 0.5-biased flowmap (8/16-bit safe) or direction + speed.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`input`) | uv | required |
| out | Color (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | UV input (`uv_in`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Encode | Encoding (`codec`) | enum | biased | absolute, offset, biased, direction |  |  |
| Main / Encode | Range (`range`) | float (percent) | 0.1 | 0.0001 … 8 | ● | Offset (tile space) that maps to a fully saturated channel (0 or 100%). |
| Main / Encode | Flip Y (`flip_y`) | bool | false |  |  | Mirror the vertical component (green) for bottom-up engines (Unity / OpenGL). |
| Main / Encode | Vector means (`flow_sign`) | enum | flow | flow, lookup |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV to Vector

`utils.uv_to_vector` · Utils · GPU trivial, tiling halo

Converts a UV warp to a Vector field: v = -delta / amount (the direction the content moves).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`input`) | uv | required |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | UV input (`uv_in`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Convert | Amount (`amount`) | float | 0.05 | 0.0001 … 100 | ● | Tile fractions of warp that correspond to a vector of length 1. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Direction

`utils.vector_direction` · Utils · GPU trivial, tiling halo

Angle of a Vector field as a Gray texture: atan2(y, x) mapped to 0..1 (turns), optionally offset and wrapped.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | required |
| out | Gray (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Vector | Offset (`offset`) | float (angle) | 0 | -360 … 360 | ● | Rotates the zero direction (degrees). |
| Main / Vector | Unsigned 0..1 (`unsigned`) | bool | true |  |  | On: 0..1 turns. Off: -0.5..0.5. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Magnitude

`utils.vector_magnitude` · Utils · GPU trivial, tiling halo

Length of a Vector field as a Gray texture (magnitude / scale).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | required |
| out | Gray (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Vector | Scale (`scale`) | float | 1 | 0.0001 … 1000 | ● | Output = \|v\| / scale. |
| Main / Vector | Clamp to 0..1 (`clamp`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector to UV

`utils.vector_to_uv` · Utils · GPU trivial, tiling halo

Converts a Vector field to a UV warp: lookup delta = -v * amount (content moves along the vector), stored absolute or as an offset.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | required |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Main / Convert | Amount (`amount`) | float | 0.05 | -100 … 100 | ● | Tile fractions of warp per unit of vector (e.g. seconds of travel). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Visualize

`utils.vector_visualize` · Utils · GPU trivial, tiling halo

Vector field to Color for display / export: colour wheel (angle = hue, magnitude = value), signed red / green, or biased 0.5 encoding.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | required |
| out | Color (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Vector | Mode (`mode`) | enum | wheel | wheel, signed, biased |  | Wheel: angle = hue, magnitude = value. Biased: v / scale * 0.5 + 0.5. |
| Main / Vector | Scale (`scale`) | float | 1 | 0.0001 … 1000 | ● | Magnitude that maps to full brightness (tile fractions per second). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

## UV

### UV Blend

`uv.blend` · UV · GPU trivial, tiling global

Combines two UV fields: mix, add, subtract, multiply, compose (B applied after A) or strongest wins, with opacity and an optional Gray mask.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | A (`a`) | uv | required |
| in | B (`b`) | uv | optional |
| in | Mask (`mask`) | gray | optional |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blend | Operation (`op`) | enum | add | mix, add, subtract, multiply, compose, max |  |  |
| Main / Blend | Opacity (`opacity`) | float (percent) | 1 | 0 … 1 | ● | Mixes between A and the operation result. |
| Main / Blend | Scale A (`scale_a`) | float | 1 | -16 … 16 | ● |  |
| Main / Blend | Scale B (`scale_b`) | float | 1 | -16 … 16 | ● |  |
| Main / Blend | Reference (`reference`) | float (percent) | 0.1 | 0.0001 … 4 |  | Multiply: B offsets of this size leave A unchanged (x1). |
| Main / Input | Input A mode (`uv_in_a`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Input | Input B mode (`uv_in_b`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Blur

`uv.blur` · UV · GPU medium, tiling global

Smooths a UV field. The blur runs on the warp offsets, so identity regions stay exactly neutral; use it to soften noisy or painted flowmaps.

**Gizmos:** Radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`input`) | uv | required |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Radius (`radius`) | float (percent) | 0.02 | 0 … 0.5 | ● | Gaussian sigma x 2 as a fraction of the smaller side. |
| Main / Input | UV input (`uv_in`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Cartesian to Polar (UV)

`uv.cartesian_to_polar` · UV · GPU trivial, tiling pixel

UV warp field of the Cartesian-to-Polar mapping. Feed it to any node with a UV pin to polar-warp textures without resampling twice.

**Gizmos:** Polar centre (circle, 2d); Rotation (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`position`) | vec2 | [0.5, 0.5] | -4 … 5 | ● | Centre of the polar mapping (UV). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 | ● |  |
| Main / Transform | Scale (`scale`) | float | 1 | 0.01 … 32 | ● | 1 = the radius of the inscribed circle (half of the smaller side) maps to the full source height. |
| Main / Transform | Spiral (`spiral`) | float | 0 | -16 … 16 | ● | Offsets the angle by the distance from the centre: turns of twist per unit radius. |
| Main / Shape | Distance metric (`metric`) | enum | euclidean | euclidean, chebyshev, squircle |  |  |
| Main / Shape | Squircle factor (`squircle`) | float | 4 | 1 … 16 |  | p-norm exponent: 2 = circle, large = square. |
| Main / Shape | Pinch (`pinch`) | float | 0 | -4 … 4 | ● | Radial power curve (+ pulls content towards the centre, - pushes it out). |
| Main / Shape | Perspective (`perspective`) | float (percent) | 0 | 0 … 0.98 | ● | Tunnel look: the radius maps through 1/r so texture compresses towards the centre. |
| Main / Aperture | Angle (`angle`) | float (angle) | 360 | 1 … 360 | ● | Angular range covered by the full width of the polar image. |
| Main / Aperture | Radial scaling (`radial_scaling`) | float | 1 | 0.05 … 16 | ● |  |
| Main / Aperture | Radial centering (`radial_centering`) | float | 0 | -2 … 2 | ● | Shifts the radial axis of the polar image. |
| Main / Aperture | Out of range (`out_of_range`) | enum | repeat | clamp, repeat, transparent |  | What happens outside the radial / angular range. |
| Main / Tiling | Angular tiling (`angular_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Tiling | Radial tiling (`radial_tiling`) | int | 1 | 1 … 64 |  |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Directional

`uv.directional` · UV · GPU trivial, tiling pixel

Pushes content in one direction by a constant (or modulated) amount. The classic scrolling / flow direction field; modulate strength with a mask for local streaking.

**Gizmos:** Direction (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Angle mod (`angle_mod`) | gray | optional · modulation · Modulates "Angle" per pixel. |
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Direction | Angle (`angle`) | float (angle) | 0 | -36000 … 36000 | ● | Direction content moves in (0 = right, 90 = down). |
| Main / Direction | Angle modulation (`angle_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Direction | Strength (`strength`) | float (percent) | 0.1 | -4 … 4 | ● | Distance content moves, as a fraction of the smaller image side. |
| Main / Direction | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Flow

`uv.flow` · UV · time dependent · GPU low, tiling pixel

Flowmap advection with looping two-phase blending: outputs UV A, UV B and the blend weight (the exact setup engines use for flowmaps) plus the advected result of an optional source image. Loops seamlessly with the graph.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Flow (`flow`) | uv | optional · Vector field (lookup delta; content moves along -delta). Chain UV Directional / Noise / Spline / From Grayscale. |
| in | Source (`source`) | color | optional · Optional image advected into the Result output. |
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| out | UV A (`uv_a`) | uv |  |
| out | UV B (`uv_b`) | uv |  |
| out | Weight A (`weight`) | gray | Blend weight of phase A (phase B = 1 - weight). |
| out | Result (`result`) | color | mix(source(UV B), source(UV A), weight). |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | Flow field input (`uv_in`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Flow | Strength (`strength`) | float (percent) | 0.1 | 0 … 4 | ● | Travel distance of one phase cycle (tile space, scales the flow vectors). |
| Main / Flow | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Time | Follow graph loop (`use_loop`) | bool | true |  |  | Phase = graph loop phase x cycles + Phase offset. |
| Main / Time | Phase offset (`phase`) | float | 0 | -1000 … 1000 | ● | With "Follow graph loop" off, animate this 0 -> N for N seamless cycles. |
| Main / Time | Cycles (`cycles`) | int | 1 | 1 … 16 |  | Whole number of flow cycles per graph loop (keeps the loop seamless). |
| Main / Time | Smooth blend (`smooth_weight`) | bool | true |  |  |  |
| Main / Time | Phase randomness (`phase_noise`) | float (percent) | 0.25 | 0 … 1 | ● | Per-pixel phase offset (tileable noise) that hides the pulsing of a global phase. |
| Main / Time | Randomness cells (`noise_cells`) | int | 4 | 1 … 64 |  |  |
| Main / Time | Seed (`seed`) | seed | 0 |  |  |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV From Grayscale

`uv.from_grayscale` · UV · GPU low, tiling halo

Turns the gradient of a height map into a UV warp: refraction from bump heights, flow running down (or along) slopes. Slope-proportional or normalized direction.

**Gizmos:** Sample radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Height (`input`) | gray | required |
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Gradient | Mode (`mode`) | enum | slope | slope, normalized |  |  |
| Main / Gradient | Sample radius (`radius`) | float (percent) | 0.004 | 0.0002 … 0.2 | ● | Distance of the Sobel taps (fraction of the smaller side). Larger = smoother gradient. |
| Main / Gradient | Strength (`strength`) | float (percent) | 0.01 | -4 … 4 | ● | Slope mode: displacement per unit of slope (height per image width). Normalized mode: displacement in tile space. |
| Main / Gradient | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Gradient | Direction (`direction`) | enum | downhill | downhill, uphill |  |  |
| Main / Gradient | Rotate (`rotate`) | float (angle) | 0 | -360 … 360 | ● | 90 = flow along contour lines. |
| Main / Gradient | Flat threshold (`flat_threshold`) | float | 0.1 | 0.0001 … 4 |  | Slopes below this fade out (avoids noisy directions on flat areas). |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Identity

`uv.identity` · UV · GPU trivial, tiling pixel

The neutral UV field: sampling an image with it changes nothing. Use it as a base for UV Blend or as the starting point of a warp chain; the optional repeat tiles the image.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Field | Repeat (`tiles`) | vec2 | [1, 1] | 0.01 … 64 | ● | Image repeats across the tile (use whole numbers on tiling axes to stay seamless). |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Noise

`uv.noise` · UV · GPU low, tiling pixel

Tileable, seamlessly looping noise warp. Vector = independent X/Y noise, Curl = divergence-free swirling flow, Angle = constant-speed flow with noise-driven direction.

**Gizmos:** Noise transform (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Noise | Mode (`mode`) | enum | vector | vector, curl, angle |  |  |
| Main / Noise | Scale (`scale`) | vec2 | [4, 4] | 0.1 … 128 | ● | Cells across the image. Whole numbers are used while the graph tiles. |
| Main / Noise | Strength (`strength`) | float (percent) | 0.05 | 0 … 2 | ● | Maximum displacement as a fraction of the smaller image side. |
| Main / Noise | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / fBm | Octaves (`octaves`) | int | 2 | 1 … 8 |  |  |
| Main / fBm | Lacunarity (`lacunarity`) | int | 2 | 2 … 4 |  |  |
| Main / fBm | Roughness (`roughness`) | float (percent) | 0.5 | 0 … 1 | ● |  |
| Main / Transform | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● |  |
| Main / Animation | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | 0 -> 1 is one seamless loop. |
| Main / Animation | Z layers (`z_cells`) | int | 2 | 1 … 16 |  |  |
| Main / Noise | Seed (`seed`) | seed | 0 |  |  |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Radial

`uv.radial` · UV · GPU trivial, tiling pixel

Pushes content away from (or pulls it towards) a centre with a selectable falloff. Shockwave refraction, bulge and pinch fields.

**Gizmos:** Radius (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Radial | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Radial | Radius (`radius`) | float (percent) | 0.4 | 0.001 … 4 | ● | Extent of the effect (fraction of the smaller side). |
| Main / Radial | Strength (`strength`) | float (percent) | 0.1 | -4 … 4 | ● | + pushes content outwards, - pulls it in. |
| Main / Radial | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Radial | Falloff (`falloff`) | enum | smooth | linear, smooth, gaussian, constant, ease |  |  |
| Main / Radial | Inner radius (`inner`) | float (percent) | 0 | 0 … 0.999 | ● | Full strength inside this fraction of the radius. |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Rotational

`uv.rotational` · UV · GPU trivial, tiling pixel

Swirls content around a centre with a falloff: true rotation (twirl) or a tangential flow vector (vortex flowmap). Angle / strength accept modulation.

**Gizmos:** Radius (circle, 2d); Angle (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Angle mod (`angle_mod`) | gray | optional · modulation · Modulates "Angle" per pixel. |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Swirl | Center (`center`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Swirl | Radius (`radius`) | float (percent) | 0.4 | 0.001 … 4 | ● |  |
| Main / Swirl | Mode (`mode`) | enum | swirl | swirl, tangent |  |  |
| Main / Swirl | Angle (`angle`) | float (angle) | 90 | -36000 … 36000 | ● | Rotation at full strength (centre). Positive = clockwise. |
| Main / Swirl | Angle modulation (`angle_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Swirl | Strength (`strength`) | float (percent) | 0.1 | -4 … 4 | ● | Distance content moves along the circle (fraction of the smaller side). |
| Main / Swirl | Falloff (`falloff`) | enum | smooth | linear, smooth, gaussian, constant, ease |  |  |
| Main / Swirl | Inner radius (`inner`) | float (percent) | 0 | 0 … 0.999 | ● |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Spline

`uv.spline` · UV · GPU medium, tiling pixel

Flow field along up to four splines: content flows in the direction of the spline inside its width and fades out with a falloff. Also pushes away from / pulls towards the spine. Edit with the spline gizmo.

**Gizmos:** Spline (path, 2d); Spline 2 (path, 2d); Spline 3 (path, 2d); Spline 4 (path, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Spline (`spline_in`) | spline | optional · Optional Spline input: its splines (first four) are used instead of the points edited in this node. |
| in | Strength mod (`strength_mod`) | gray | optional · modulation · Modulates "Strength" per pixel. |
| out | UV (`output`) | uv |  |
| out | Spline (`spline_out`) | spline | The splines used by this node (input or internal points), for Sweep, Spline Transform, ... |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Splines | Spline 1 (`spline`) | spline | … |  |  | Edited with the spline gizmo in a 2D viewport. |
| Main / Splines | Spline 2 (`spline_2`) | spline | … |  |  |  |
| Main / Splines | Spline 3 (`spline_3`) | spline | … |  |  |  |
| Main / Splines | Spline 4 (`spline_4`) | spline | … |  |  |  |
| Main / Flow | Mode (`mode`) | enum | along | along, away, towards |  |  |
| Main / Flow | Strength (`strength`) | float (percent) | 0.1 | -4 … 4 | ● | Distance content moves (fraction of the smaller side). |
| Main / Flow | Strength modulation (`strength_mod_k`) | float (percent) | 1 | -1 … 1 |  | 0% = ignore the input, 100% = fully multiply, negative = inverted input. |
| Main / Flow | Reverse direction (`reverse`) | bool | false |  |  |  |
| Main / Width | Width (`width`) | float (percent) | 0.1 | 0 … 1 | ● | Full width of the flow band (fraction of the smaller side). |
| Main / Width | Width profile (`width_curve`) | curve | curve (2 keys) |  | ● |  |
| Main / Width | Softness (`softness`) | float (percent) | 0.6 | 0 … 4 | ● | Fade-out distance beyond the half width, relative to the half width. |
| Main / Width | Falloff (`falloff`) | enum | smooth | linear, smooth, gaussian, constant, ease |  |  |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### UV Transform

`uv.transform` · UV · GPU trivial, tiling pixel

Translate / rotate / scale / skew as a UV field. Without an input it transforms the identity; with one it transforms the lookup coordinates of the connected field.

**Gizmos:** Transform (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | UV (`uv`) | uv | optional |
| out | UV (`output`) | uv |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Transform | Position (`translate`) | vec2 | [0, 0] | -64 … 64 | ● | Content offset in UV units (1 = one image). |
| Main / Transform | Rotation (`rotation`) | float (angle) | 0 | -36000 … 36000 | ● |  |
| Main / Transform | Scale (`scale`) | vec2 | [1, 1] | -64 … 64 | ● |  |
| Main / Transform | Skew (`skew`) | vec2 | [0, 0] | -80 … 80 | ● | Shear in degrees. |
| Main / Transform | Pivot (`pivot`) | vec2 | [0.5, 0.5] | -4 … 5 | ● |  |
| Main / Input | UV input (`uv_in`) | enum | absolute | absolute, offset |  | How the connected UV field is stored. |
| Main / Output | UV output (`uv_out`) | enum | absolute | absolute, offset |  | How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

## Vector

### Vector Adjust

`vector.adjust` · Vector · GPU low, tiling halo

Normalize, clamp, remap and invert vectors: unit-length output, minimum / maximum length, dead zone, power curve on the length, per-component inversion.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | optional |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Length | Normalize (`normalize`) | bool | false |  |  | Every non-zero vector gets the length below. |
| Main / Length | Normalized length (`length`) | float | 1 | 0 … 1000 | ● |  |
| Main / Length | Dead zone (`deadzone`) | float | 0 | 0 … 1000 |  | Vectors shorter than this become zero. |
| Main / Length | Minimum length (`min_len`) | float | 0 | 0 … 1000 |  |  |
| Main / Length | Maximum length (`max_len`) | float | 0 | 0 … 1000 |  | 0 = no limit. |
| Main / Length | Power (`power`) | float | 1 | 0.1 … 8 |  | Length is remapped as (length / reference) ^ power * reference. |
| Main / Length | Reference length (`reference`) | float | 1 | 0.001 … 1000 |  |  |
| Main / Length | Gain (`gain`) | float | 1 | -1000 … 1000 | ● |  |
| Main / Invert | Invert X (`invert_x`) | bool | false |  |  |  |
| Main / Invert | Invert Y (`invert_y`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Advect

`vector.advect` · Vector · GPU low, tiling halo

Advects an image through a vector field. Displace = one step; Integrate = several RK2 / RK4 steps along the field; Flow map = two time-offset samples blended with a triangle weight so the animation loops seamlessly (animate Phase 0 to 1).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | optional |
| in | Vector (`vector`) | vector | optional |
| in | Strength mask (`strength_mask`) | gray | optional · Optional Gray mask multiplying the strength per pixel. |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Advection | Mode (`mode`) | enum | integrate | displace, integrate, flowmap |  |  |
| Main / Advection | Strength (`strength`) | float | 0.3 | -100 … 100 | ● | Time span carried along the field: displacement = vector x strength (vectors are tile fractions per second). |
| Main / Advection | Direction (`direction`) | enum | backward | backward, forward |  | Backward: content moves WITH the vectors (the usual look). |
| Main / Integration | Method (`method`) | enum | rk2 | rk1, rk2, rk4 |  |  |
| Main / Integration | Steps (`steps`) | int | 8 | 1 … 64 |  |  |
| Main / Flow map | Phase (`phase`) | float | 0 | -1000 … 1000 | ● | 0 to 1 is one seamless loop. |
| Main / Flow map | Phase scatter (`scatter`) | float (percent) | 0.3 | 0 … 1 |  | Per-pixel phase offset from tileable noise: hides the pulsing of the two phases. |
| Main / Flow map | Seed (`seed`) | seed | 5 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Vector Advect (Color)

`vector.advect_color` · Vector · GPU low, tiling halo

Advects an image through a vector field. Displace = one step; Integrate = several RK2 / RK4 steps along the field; Flow map = two time-offset samples blended with a triangle weight so the animation loops seamlessly (animate Phase 0 to 1).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | optional |
| in | Vector (`vector`) | vector | optional |
| in | Strength mask (`strength_mask`) | gray | optional · Optional Gray mask multiplying the strength per pixel. |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Advection | Mode (`mode`) | enum | integrate | displace, integrate, flowmap |  |  |
| Main / Advection | Strength (`strength`) | float | 0.3 | -100 … 100 | ● | Time span carried along the field: displacement = vector x strength (vectors are tile fractions per second). |
| Main / Advection | Direction (`direction`) | enum | backward | backward, forward |  | Backward: content moves WITH the vectors (the usual look). |
| Main / Integration | Method (`method`) | enum | rk2 | rk1, rk2, rk4 |  |  |
| Main / Integration | Steps (`steps`) | int | 8 | 1 … 64 |  |  |
| Main / Flow map | Phase (`phase`) | float | 0 | -1000 … 1000 | ● | 0 to 1 is one seamless loop. |
| Main / Flow map | Phase scatter (`scatter`) | float (percent) | 0.3 | 0 … 1 |  | Per-pixel phase offset from tileable noise: hides the pulsing of the two phases. |
| Main / Flow map | Seed (`seed`) | seed | 5 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Vector Blur / Smooth

`vector.blur` · Vector · GPU low, tiling halo

Smooths a vector field with a separable gaussian or box blur. Wraps around when the graph tiles.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | optional |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Radius (`radius`) | float | 0.02 | 0 … 0.5 | ● | Fraction of the smaller image side. |
| Main / Blur | Kernel (`kernel`) | enum | gaussian | gaussian, box |  |  |
| Main / Blur | Taps per side (`taps`) | int | 16 | 2 … 48 |  | Samples on each side of the centre. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Combine

`vector.combine` · Vector · GPU low, tiling halo

Combines two vector fields: add, subtract, multiply, blend, or pick the longer / shorter vector. An optional mask controls where B takes effect.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector A (`a`) | vector | optional |
| in | Vector B (`b`) | vector | optional |
| in | Mask (`mask`) | gray | optional · Where B applies (1 = fully). |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Combine | Mode (`mode`) | enum | add | add, subtract, multiply, blend, max, min |  |  |
| Main / Combine | Gain A (`gain_a`) | float | 1 | -100 … 100 | ● |  |
| Main / Combine | Gain B (`gain_b`) | float | 1 | -100 … 100 | ● |  |
| Main / Combine | Mix (`mix`) | float (percent) | 0.5 | 0 … 1 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Compose

`vector.compose` · Vector · GPU low, tiling halo

Builds a vector field from two Gray textures (X and Y). Centered input treats 50% gray as zero.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | X (`x`) | gray | optional |
| in | Y (`y`) | gray | optional |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Input | Gain (`gain`) | float | 1 | -1000 … 1000 | ● |  |
| Main / Input | Centered (50% = 0) (`centered`) | bool | false |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Decompose

`vector.decompose` · Vector · GPU low, tiling halo

Splits a vector field into its X and Y components (and the length) as Gray textures. Centered output maps zero to 50% gray.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | optional |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | X (`x`) | gray |  |
| out | Y (`y`) | gray |  |
| out | Length (`length`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Output | Gain (`gain`) | float | 1 | -1000 … 1000 | ● |  |
| Main / Output | Centered (0 = 50%) (`centered`) | bool | false |  |  | Components are mapped to value * gain * 0.5 + 0.5. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Vector From Gray

`vector.from_gray` · Vector · GPU low, tiling halo

Turns a Gray height field into a vector field: the gradient (flow downhill / uphill) or the rotated gradient (flow along contours, curl-like). Slope limiting keeps steep edges tame.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Gray (`input`) | gray | optional |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Field | Mode (`mode`) | enum | gradient | gradient, rotated |  |  |
| Main / Field | Extra rotation (`rotation`) | float (angle) | 0 | -360 … 360 | ● | Additional rotation of the vectors (degrees). |
| Main / Field | Strength (`strength`) | float | 1 | -1000 … 1000 | ● | Negative values flow downhill. |
| Main / Field | Sample distance (`smooth_px`) | float | 2 | 0.5 … 64 |  | Half distance of the central difference: larger = smoother field. |
| Main / Field | Slope limit (`slope_limit`) | float | 0 | 0 … 100 |  | Maximum vector length (0 = off). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector From Normal

`vector.from_normal` · Vector · GPU low, tiling halo

Converts a normal map into a vector field: the surface slope (water flows along it) or the raw tangent XY. Flip Y converts between OpenGL and DirectX normals.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Normal (`input`) | normal | optional |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Field | Mode (`mode`) | enum | slope | slope, xy |  |  |
| Main / Field | Strength (`strength`) | float | 0.5 | -1000 … 1000 | ● |  |
| Main / Field | Flip Y (`flip_y`) | bool | false |  |  |  |
| Main / Field | Extra rotation (`rotation`) | float (angle) | 0 | -360 … 360 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### LIC (Line Integral Convolution)

`vector.lic` · Vector · GPU high, tiling global

Streaks a noise texture along a vector field: hair, wind lines, brushed flow, fur. Kernel length, kernel shape, optional noise input, tileable, animatable ripple phase.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`vector`) | vector | optional |
| in | Noise (`noise`) | gray | optional · Optional texture to streak; default: tileable white noise. |
| out | Gray (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Kernel | Length (`length`) | float | 0.12 | 0.001 … 2 | ● | Total streak length (tile fractions). |
| Main / Kernel | Steps per side (`steps`) | int | 24 | 2 … 64 |  |  |
| Main / Kernel | Kernel (`kernel`) | enum | hann | box, triangle, hann |  |  |
| Main / Kernel | Constant speed (`constant_speed`) | bool | true |  |  | Step along the direction only (streak length independent of the vector length). |
| Main / Noise | Noise density (`noise_cells`) | float (percent) | 0.5 | 0.02 … 2 |  | Cells of the built-in white noise as a fraction of the resolution. |
| Main / Noise | Seed (`seed`) | seed | 9 |  |  |  |
| Main / Output | Contrast (`contrast`) | float | 2 | 0 … 16 |  |  |
| Main / Animation | Ripple frequency (`ripple`) | float | 0 | 0 … 16 |  | Moving ripples along the streaks (0 = static). |
| Main / Animation | Phase (`phase`) | float | 0 | -1000 … 1000 | ● | 0 to 1 is one loop of the ripples. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Motion Blur

`vector.motion_blur` · Vector · GPU low, tiling halo

Blurs an image along the vector of every pixel (per-pixel directional blur): length multiplier, sample count, shutter offset and jitter against banding.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | optional |
| in | Vector (`vector`) | vector | optional |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Length (`length`) | float | 0.2 | -100 … 100 | ● | Blur length = vector x length (tile fractions). |
| Main / Blur | Samples (`samples`) | int | 16 | 2 … 64 |  |  |
| Main / Blur | Shutter offset (`shutter`) | float (percent) | 0.5 | 0 … 1 |  | 0 = trailing blur, 50% = centred, 100% = leading. |
| Main / Blur | Jitter (`jitter`) | float (percent) | 0.5 | 0 … 1 |  | Random sample offsets (hide banding). |
| Main / Blur | Seed (`seed`) | seed | 2 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Vector Motion Blur (Color)

`vector.motion_blur_color` · Vector · GPU low, tiling halo

Blurs an image along the vector of every pixel (per-pixel directional blur): length multiplier, sample count, shutter offset and jitter against banding.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | optional |
| in | Vector (`vector`) | vector | optional |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Blur | Length (`length`) | float | 0.2 | -100 … 100 | ● | Blur length = vector x length (tile fractions). |
| Main / Blur | Samples (`samples`) | int | 16 | 2 … 64 |  |  |
| Main / Blur | Shutter offset (`shutter`) | float (percent) | 0.5 | 0 … 1 |  | 0 = trailing blur, 50% = centred, 100% = leading. |
| Main / Blur | Jitter (`jitter`) | float (percent) | 0.5 | 0 … 1 |  | Random sample offsets (hide banding). |
| Main / Blur | Seed (`seed`) | seed | 2 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Motion Vector Encode / Decode

`vector.motion_encode` · Vector · GPU low, tiling halo

Packs a Vector (sheet) into an RG Color texture for engines: 0.5-neutral or signed encoding, scale, Y convention (Unreal / Unity / Godot / custom), 8 / 16-bit quantisation. The same flipbook layout as the colour flipbook. Decode reverses it.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`vector`) | vector | optional |
| in | Encoded (`encoded`) | color | optional |
| out | Encoded (`output`) | color |  |
| out | Decoded (`decoded`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Encoding | Scale (`scale`) | float | 0.1 | 0.0001 … 100 |  | Vector length (tile fractions per frame) that maps to the full range. Motion Vector Generate: max displacement / cell size. |
| Main / Encoding | Engine convention (`convention`) | enum | unreal | unreal, unity, godot, custom |  |  |
| Main / Encoding | Flip Y (custom) (`flip_y`) | bool | false |  |  | Negate the Y component (positive Y up instead of down). |
| Main / Encoding | Signed float (no 0.5 bias) (`signed_out`) | bool | false |  |  | Store v / scale directly (EXR / float textures). |
| Main / Encoding | Precision (`depth`) | enum | bits16 | bits8, bits16, float |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Motion Vector Generate

`vector.motion_generate` · Vector · GPU high, tiling global

GPU pyramidal optical flow between consecutive flipbook frames (Fast or Quality), with median filtering, forward / backward consistency check (occlusion mask), loop wrap and tiling. Output: a Flipbook of Vector (tile fractions per frame).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Flipbook (`flipbook`) | flipbook | required · Flipbook from Sheet Encode. |
| out | Sheet (`sheet`) | vector |  |
| out | Motion flipbook (`motion`) | flipbook |  |
| out | Occlusion (`occlusion`) | gray | Where forward and backward flow disagree (needs the consistency check). |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Flow | Method (`method`) | enum | fast | fast, quality |  | Quality uses a robust (Charbonnier) data term: sharper motion boundaries. |
| Main / Flow | Pyramid levels (`levels`) | int | 4 | 3 … 6 |  |  |
| Main / Flow | Iterations per level (`iterations`) | int | 12 | 1 … 60 |  |  |
| Main / Flow | Smoothness (`smoothness`) | float | 0.03 | 0.002 … 1 |  | Regularization: larger = smoother flow. |
| Main / Flow | Window size (`window`) | float | 1.5 | 1 … 8 |  | Spacing of the gradient taps (larger = more robust, less detail). |
| Main / Flow | Max displacement (`max_disp`) | float | 32 | 1 … 512 |  | Largest motion between two frames in pixels of one cell. Also defines the encoding scale (max displacement / cell size). |
| Main / Filter | Median filter (`median`) | bool | true |  |  | 3x3 median of the flow after every level (removes outliers). |
| Main / Filter | Input pre-blur (`pre_blur`) | float | 1 | 0 … 8 |  |  |
| Main / Filter | Match channel (`channel`) | enum | luma | luma, mean, r, g, b, a |  |  |
| Main / Consistency | Forward / backward check (`consistency`) | bool | true |  |  | Also solves the backward flow (twice the cost) and writes an occlusion mask. |
| Main / Consistency | Occlusion threshold (`occ_thr`) | float | 1 | 0.1 … 16 |  |  |
| Main / Frames | Loop wrap (`loop_wrap`) | bool | true |  |  | The last frame is matched with the first (looping flipbooks). |
| Main / Frames | Tiling wrap (`wrap_tile`) | bool | false |  |  | Image edges wrap around (tileable frames). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Motion Vector Interpolate

`vector.motion_interpolate` · Vector · GPU medium, tiling global

Frame interpolation: for every in-between time t, frame A is warped forward by t x v and frame B backward by (1 - t) x v, blended with occlusion-aware weights (cross-fade where the consistency check failed). Output: a new Flipbook with more frames; Preview shows the A / B / warped difference.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Flipbook (`flipbook`) | flipbook | required |
| in | Motion flipbook (`motion`) | flipbook | required · Motion Vector Generate output. |
| out | Sheet (`sheet`) | color |  |
| out | Flipbook (`output`) | flipbook |  |
| out | Preview (`preview`) | color | R = \|A - B\|, G = \|warped A - warped B\| (should be lower), B = occlusion, at the chosen preview frame. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Frames | Mode (`mode`) | enum | count | count, stretch |  |  |
| Main / Frames | Frame count (`count`) | int | 48 | 2 … 1024 |  |  |
| Main / Frames | Stretch factor (`stretch`) | float | 4 | 1 … 32 |  | Output frames = source frames x factor (the playback rate is divided by it). |
| Main / Frames | Loop (`loop_wrap`) | bool | true |  |  | The last frame interpolates towards the first. |
| Main / Blend | Cross-fade fallback (`fallback`) | float (percent) | 1 | 0 … 1 |  | How strongly occluded pixels fall back to a plain cross-fade. |
| Main / Blend | Tiling wrap (`wrap_tile`) | bool | false |  |  |  |
| Main / Preview | Preview position (`preview_pos`) | float (percent) | 0.5 | 0 … 1 | ● | Position between the first two frames (0 = A, 100% = B). |
| Main / Preview | Difference gain (`gain`) | float | 4 | 0.1 … 64 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Noise

`vector.noise` · Vector · GPU low, tiling halo

Tileable vector noise. Curl mode is divergence-free (swirling, incompressible); Plain mode has independent X / Y noise. Animate Evolution 0 to 1 for a seamless loop.

**Gizmos:** Noise offset (transform, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mask (`mask`) | gray | optional · Optional Gray mask multiplying the strength. |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Noise | Type (`kind`) | enum | curl | curl, plain |  |  |
| Main / Noise | Scale (`scale`) | vec2 | [4, 4] | 1 … 64 | ● | Noise cells across the image (whole numbers are used so the field tiles). |
| Main / Noise | Octaves (`octaves`) | int | 3 | 1 … 6 |  |  |
| Main / Noise | Roughness (`roughness`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Main / Noise | Strength (`strength`) | float | 0.2 | -100 … 100 | ● |  |
| Main / Noise | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● |  |
| Main / Animation | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | 0 to 1 is one seamless loop. |
| Main / Animation | Z layers (`z_cells`) | int | 2 | 1 … 16 |  |  |
| Main / Noise | Seed (`seed`) | seed | 7 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Noise Warp

`vector.noise_warp` · Vector · GPU low, tiling halo

Perturbs a vector field: the sampling position is displaced by tileable curl noise (organic wobble) and curl noise can be added to the vectors themselves.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | optional |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Noise | Warp amount (`warp`) | float | 0.05 | -2 … 2 | ● | Domain displacement (tile space). |
| Main / Noise | Add to vectors (`add`) | float | 0 | -100 … 100 | ● | Strength of divergence-free noise added to the field. |
| Main / Noise | Scale (`scale`) | vec2 | [4, 4] | 1 … 64 |  |  |
| Main / Noise | Octaves (`octaves`) | int | 2 | 1 … 6 |  |  |
| Main / Noise | Roughness (`roughness`) | float (percent) | 0.5 | 0 … 1 |  |  |
| Main / Animation | Evolution (`evolution`) | float | 0 | -1000 … 1000 | ● | 0 to 1 is one seamless loop. |
| Main / Animation | Z layers (`z_cells`) | int | 2 | 1 … 16 |  |  |
| Main / Noise | Seed (`seed`) | seed | 11 |  |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Particles

`vector.particles` · Vector · time dependent · GPU trivial, tiling global

Advects a seeded particle set through a Vector field (Euler / RK2 / RK4) and outputs Points for 2D Render. Seed from the whole tile, a disc, a line or an input Points set. Deterministic, loops seamlessly, hard particle cap and a bounded integration budget.

**Gizmos:** Seed disc (circle, 2d); Seed line (line, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`vector`) | vector | required · The flow field (tile fractions per second). Fluid 2D velocity, Vector Noise, Vortex ... |
| in | Points (`points`) | points | optional · Optional: seed the particles at these points (Seed from = Input points). |
| out | Points (`points`) | points |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Emission / Timing | Mode (`mode`) | enum | oneshot | oneshot, loop |  | One-shot: particles are born once and are all dead at the end of the timeline. Loop: C = round(1 / lifetime) lifetimes per loop, seamless. |
| Emission / Timing | Count (`count`) | int | 2000 | 0 … 1000000 |  | Particles per loop (loop mode: per lifetime cycle). |
| Emission / Timing | Lifetime (`lifetime`) | float (percent) | 0.5 | 0.01 … 1 |  | Particle lifetime as a fraction of the loop / timeline. |
| Emission / Timing | Spawn window (`spawn_window`) | float (percent) | 0.15 | 0 … 1 |  | One-shot: births are spread over this fraction of the timeline (0 = one burst at the start). |
| Emission / Timing | Seed (`seed`) | seed | 1 |  |  |  |
| Emission / Limits | Hard cap (`max_points`) | int | 50000 | 1 … 1000000 |  |  |
| Look / Size | Size (pscale) (`size_pscale`) | float | 0.03 | 0 … 100 | ● |  |
| Look / Size | Size random (`size_random`) | float (percent) | 0.4 | 0 … 1 |  |  |
| Look / Size | Size over life (`size_over_life`) | bool | true |  |  |  |
| Look / Size | Size over life (`size_curve`) | curve | curve (2 keys) |  |  |  |
| Look / Rotation | Rotation (`rotation`) | float (angle) | 0 | -3600 … 3600 |  |  |
| Look / Rotation | Rotation random (`rotation_random`) | float (percent) | 0 | 0 … 1 |  |  |
| Look / Rotation | Spin turns (`spin_turns`) | float | 0 | -16 … 16 |  | Turns over the lifetime (random direction per particle). |
| Look / Color | Color (Cd) (`color`) | color | [1, 1, 1, 1] |  | ● |  |
| Look / Color | Intensity (`intensity`) | float | 1 | 0 … 100 | ● | HDR multiplier of the colour. |
| Look / Color | Color over life (`color_over_life`) | bool | true |  |  |  |
| Look / Color | Color over life (`color_gradient`) | gradient | gradient (3 stops) |  |  |  |
| Look / Color | Alpha over life (`alpha_over_life`) | bool | true |  |  |  |
| Look / Color | Alpha over life (`alpha_curve`) | curve | curve (4 keys) |  |  |  |
| Emission / Seeding | Seed from (`seed_shape`) | enum | random | random, disc, line, points |  |  |
| Emission / Seeding | Start / centre (`p_a`) | vec2 | [0.5, 0.5] | -1 … 2 | ● | Disc centre or line start (tile space, y down). |
| Emission / Seeding | End (`p_b`) | vec2 | [0.8, 0.5] | -1 … 2 | ● |  |
| Emission / Seeding | Seed radius (`radius`) | float | 0.15 | 0 … 2 | ● | Fraction of the smaller image side. |
| Flow / Advection | Travel time (`travel`) | float | 2 | 0 … 1000 | ● | Seconds of flow carried over one whole particle life. |
| Flow / Advection | Speed (`flow_speed`) | float | 1 | -100 … 100 | ● | Multiplies the field (negative = against the flow). |
| Flow / Advection | Speed variation (`speed_random`) | float (percent) | 0.25 | 0 … 1 |  |  |
| Flow / Integration | Method (`method`) | enum | rk2 | rk1, rk2, rk4 |  |  |
| Flow / Integration | Step size (`step`) | float | 0.05 | 0.001 … 5 |  |  |
| Flow / Integration | Max steps per path (`max_steps`) | int | 128 | 2 … 1024 |  | The step grows when a path would need more; the total work (particles x steps) is capped as well. |
| Flow / Integration | Boundary (`bounds`) | enum | wrap | wrap, kill, clamp |  |  |
| Flow / View | Plane (`plane`) | enum | xy | xy, xz, yz |  | Match the 2D Render plane / view settings. |
| Flow / View | View center (`view_center`) | vec2 | [0, 0] | -2 … 2 |  |  |
| Flow / View | View width (world) (`view_extent`) | float | 1 | 0.001 … 1000 |  | World units covered by the image width (same as 2D Render). |

### Vector Divergence-Free Project

`vector.project` · Vector · GPU medium, tiling global

Makes a vector field divergence-free (incompressible) by solving a pressure Poisson equation with Jacobi iterations and subtracting its gradient. Local: for global accuracy use more iterations or the Fluid 2D solver.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | optional |
| out | Vector (`output`) | vector |  |
| out | Pressure (`pressure`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Solver | Iterations (`iterations`) | int | 48 | 1 … 400 |  | Jacobi iterations (even numbers only are used). |
| Main / Solver | Amount (`amount`) | float (percent) | 1 | 0 … 1 | ● | 0 = original field, 100% = fully projected. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Radial

`vector.radial` · Vector · GPU low, tiling halo

Radial vector field: sources push outwards, sinks (negative strength) pull inwards. Four points with radius and falloff; tiling-aware.

**Gizmos:** Source 1 (circle, 2d); Source 2 (circle, 2d); Source 3 (circle, 2d); Source 4 (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Field | Falloff (`falloff`) | enum | smooth | linear, smooth, gaussian, constant, ease |  |  |
| Main / Source 1 | Position (`r1_pos`) | vec2 | [0.5, 0.5] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 1 | Radius (`r1_radius`) | float | 0.3 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 1 | Strength (`r1_strength`) | float | 0.5 | -100 … 100 | ● | Signed: 0 disables the source. |
| Main / Source 2 | Position (`r2_pos`) | vec2 | [0.25, 0.25] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 2 | Radius (`r2_radius`) | float | 0.3 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 2 | Strength (`r2_strength`) | float | 0 | -100 … 100 | ● | Signed: 0 disables the source. |
| Main / Source 3 | Position (`r3_pos`) | vec2 | [0.75, 0.75] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 3 | Radius (`r3_radius`) | float | 0.3 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 3 | Strength (`r3_strength`) | float | 0 | -100 … 100 | ● | Signed: 0 disables the source. |
| Main / Source 4 | Position (`r4_pos`) | vec2 | [0.25, 0.75] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 4 | Radius (`r4_radius`) | float | 0.3 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 4 | Strength (`r4_strength`) | float | 0 | -100 … 100 | ● | Signed: 0 disables the source. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Spline

`vector.spline` · Vector · GPU low, tiling halo

Flow along and around a spline: tangent flow, attraction towards (or away from) the curve and shear on its two sides, with width and falloff. Uses the Spline input or the spline gizmo.

**Gizmos:** Spline (path, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Spline (`spline_in`) | spline | optional · Optional Spline input (its first spline is used instead of the internal one). |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Spline | Spline (`spline`) | spline | … |  |  | Edited with the spline gizmo in a 2D viewport. |
| Main / Field | Width (`width`) | float | 0.15 | 0.002 … 2 | ● | Distance from the curve where the flow fades out (fraction of the smaller side). |
| Main / Field | Falloff (`falloff`) | enum | smooth | linear, smooth, gaussian, constant, ease |  |  |
| Main / Field | Flow along (`along`) | float | 0.4 | -100 … 100 | ● |  |
| Main / Field | Attract / repel (`attract`) | float | 0 | -100 … 100 | ● | Positive = towards the curve, negative = away. |
| Main / Field | Shear (around) (`shear`) | float | 0 | -100 … 100 | ● | Flow along the curve with opposite signs on its two sides (rotation around it). |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Stats

`vector.stats` · Vector · GPU low, tiling global

Measures a vector field on the GPU without any read-back: mean vector, maximum length and the length normalized by the maximum (auto-range for Visualize / Advect).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | optional |
| out | Mean vector (`mean`) | vector |  |
| out | Max length (`max`) | gray |  |
| out | Normalized length (`normalized`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Output | Gain (`gain`) | float | 1 | 0 … 1000 |  | Multiplies the Max length output. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Streamlines

`vector.streamlines` · Vector · GPU high, tiling global

Draws streamlines of a vector field as a mask: jittered seed grid (density), line length, width and fade. Tileable.

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`vector`) | vector | optional |
| out | Mask (`output`) | gray |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Seeds | Seed density (`density`) | int | 24 | 2 … 128 |  | Seed cells per side (one jittered seed per cell). |
| Main / Seeds | Jitter (`jitter`) | float (percent) | 0.8 | 0 … 1 |  |  |
| Main / Seeds | Seed (`seed`) | seed | 4 |  |  |  |
| Main / Lines | Length (`length`) | float | 0.25 | 0.005 … 2 | ● |  |
| Main / Lines | Width (`width`) | float | 0.004 | 0.0005 … 0.2 |  |  |
| Main / Lines | Fade (`fade`) | float | 1 | 0 … 8 |  | Fade towards the ends (0 = none). |
| Main / Lines | Steps (`steps`) | int | 64 | 8 … 128 |  |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Transform

`vector.transform` · Vector · GPU low, tiling halo

Rotates, scales and mirrors the vectors, remaps their length with a curve, moves / repeats the field itself and can warp it by another vector field.

**Gizmos:** Offset (point, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Vector (`input`) | vector | optional |
| in | Warp field (`warp`) | vector | optional · Optional: the sampling position of the input is displaced by this field. |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Vectors | Rotate (`rotate`) | float (angle) | 0 | -360 … 360 | ● |  |
| Main / Vectors | Scale (`scale`) | vec2 | [1, 1] | -100 … 100 | ● |  |
| Main / Vectors | Mirror X (`mirror_x`) | bool | false |  |  | Negates the X component. |
| Main / Vectors | Mirror Y (`mirror_y`) | bool | false |  |  | Negates the Y component. |
| Main / Vectors | Swap X / Y (`swap`) | bool | false |  |  |  |
| Main / Remap | Remap length (`remap_on`) | bool | false |  |  |  |
| Main / Remap | Curve input range (`remap_max`) | float | 1 | 0.001 … 1000 |  | Vector length that maps to the right edge of the curve. |
| Main / Remap | Length curve (`remap_curve`) | curve | curve (2 keys) |  |  |  |
| Main / Domain | Offset (`offset`) | vec2 | [0, 0] | -64 … 64 | ● | Moves the field itself (tile space). |
| Main / Domain | Repeat (`repeat`) | vec2 | [1, 1] | 0.1 … 32 |  | Tiles the field (whole numbers keep it seamless). |
| Main / Warp | Warp amount (`warp_amount`) | float | 0.1 | -10 … 10 | ● |  |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Uniform

`vector.uniform` · Vector · GPU low, tiling halo

Constant directional vector field: angle and strength, or drag the line gizmo. An optional mask scales it per pixel.

**Gizmos:** Direction (line, 2d); Angle (angle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mask (`mask`) | gray | optional · Optional Gray mask multiplying the strength. |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Direction | Direction from (`mode`) | enum | angle | angle, line |  |  |
| Main / Direction | Angle (`angle`) | float (angle) | 0 | -360 … 360 | ● | Degrees, clockwise on screen (0 = right, 90 = down). |
| Main / Direction | Start (`p_a`) | vec2 | [0.3, 0.5] | -1 … 2 | ● |  |
| Main / Direction | End (`p_b`) | vec2 | [0.7, 0.5] | -1 … 2 | ● |  |
| Main / Direction | Strength (`strength`) | float | 0.2 | -100 … 100 | ● | Tile fractions per second. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Vortex

`vector.vortex` · Vector · GPU low, tiling halo

Swirling vector field: up to four vortices with a solid-rotation core, a falloff ring and signed strength (sign = rotation direction). An optional mask modulates the swirl.

**Gizmos:** Vortex 1 (circle, 2d); Vortex 2 (circle, 2d); Vortex 3 (circle, 2d); Vortex 4 (circle, 2d)

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Mask (`mask`) | gray | optional · Optional Gray mask multiplying every vortex. |
| out | Vector (`output`) | vector |  |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Field | Falloff (`falloff`) | enum | smooth | linear, smooth, gaussian, constant, ease |  |  |
| Main / Field | Core size (`core`) | float (percent) | 0.25 | 0 … 1 |  | Fraction of the radius that rotates like a solid body. |
| Main / Source 1 | Position (`w1_pos`) | vec2 | [0.5, 0.5] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 1 | Radius (`w1_radius`) | float | 0.35 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 1 | Swirl (`w1_strength`) | float | 0.6 | -100 … 100 | ● | Signed: 0 disables the source. |
| Main / Source 2 | Position (`w2_pos`) | vec2 | [0.25, 0.25] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 2 | Radius (`w2_radius`) | float | 0.35 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 2 | Swirl (`w2_strength`) | float | 0 | -100 … 100 | ● | Signed: 0 disables the source. |
| Main / Source 3 | Position (`w3_pos`) | vec2 | [0.75, 0.75] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 3 | Radius (`w3_radius`) | float | 0.35 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 3 | Swirl (`w3_strength`) | float | 0 | -100 … 100 | ● | Signed: 0 disables the source. |
| Main / Source 4 | Position (`w4_pos`) | vec2 | [0.25, 0.75] | -1 … 2 | ● | Centre in tile space (0..1, y down). |
| Main / Source 4 | Radius (`w4_radius`) | float | 0.35 | 0.005 … 2 | ● | Radius as a fraction of the smaller image side. |
| Main / Source 4 | Swirl (`w4_strength`) | float | 0 | -100 … 100 | ● | Signed: 0 disables the source. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |

### Vector Warp

`vector.warp` · Vector · GPU low, tiling halo

Displaces an image by a vector field with a scale (vector length x scale = tile fraction). Optionally outputs the absolute UV warp for other nodes. The Color variant can split RGB (chromatic).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | gray | optional |
| in | Vector (`vector`) | vector | optional |
| in | Background (`background`) | gray | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | gray |  |
| out | UV (`uv`) | uv | Absolute UV lookup of the warp. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Warp | Scale (`scale`) | float | 0.2 | -100 … 100 | ● | Tile fractions of displacement per unit of vector length. |
| Main / Warp | Normalize vectors (`normalize`) | bool | false |  |  | Use the direction only (constant displacement). |
| Main / Warp | Chromatic split (`chroma`) | float (percent) | 0 | 0 … 1 |  | Color variant only: red / blue are displaced less / more than green. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |

### Vector Warp (Color)

`vector.warp_color` · Vector · GPU low, tiling halo

Displaces an image by a vector field with a scale (vector length x scale = tile fraction). Optionally outputs the absolute UV warp for other nodes. The Color variant can split RGB (chromatic).

**Pins**

| Direction | Pin | Type | Notes |
|---|---|---|---|
| in | Input (`input`) | color | optional |
| in | Vector (`vector`) | vector | optional |
| in | Background (`background`) | color | optional · background · Optional: blended with the result (Blending tab). |
| out | Output (`output`) | color |  |
| out | UV (`uv`) | uv | Absolute UV lookup of the warp. |

**Parameters**

| Tab / group | Parameter | Type | Default | Range / options | Anim | Tooltip |
|---|---|---|---|---|---|---|
| Main / Warp | Scale (`scale`) | float | 0.2 | -100 … 100 | ● | Tile fractions of displacement per unit of vector length. |
| Main / Warp | Normalize vectors (`normalize`) | bool | false |  |  | Use the direction only (constant displacement). |
| Main / Warp | Chromatic split (`chroma`) | float (percent) | 0 | 0 … 1 |  | Color variant only: red / blue are displaced less / more than green. |
| Texture / Size | Size source (`tex_size_mode`) | enum | from_parent | from_graph, from_parent, absolute |  | Where the output resolution comes from. |
| Texture / Size | Size multiplier (`tex_size_mul`) | vec2 | [1, 1] | 0.015625 … 64 |  | Width/height multipliers applied to the source size. |
| Texture / Size | Size (px) (`tex_size_abs`) | vec2 | [1024, 1024] | 1 … 16384 |  |  |
| Texture / Filtering | Filtering source (`tex_filter_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Filtering | Filtering (`tex_filter`) | enum | linear | point, linear, cubic |  |  |
| Texture / Tiling | Tiling source (`tex_tiling_mode`) | enum | from_parent | from_graph, from_parent, absolute |  |  |
| Texture / Tiling | Tiling (`tex_tiling`) | enum | both | none, both, x, y |  |  |
| Texture / Quality | HQ supersampling (`tex_ss`) | int | 1 | 1 … 4 |  | 1 = off. N = N x N samples per pixel (antialiasing). |
| Blending | Blend type (`blend_mode`) | enum | max | copy, add, subtract, multiply, max, min, smooth_min, smooth_max, screen, overlay, difference, divide, exclusion, soft_light, hard_light, color_dodge, color_burn, linear_light, hue, saturation, color, luminosity |  |  |
| Blending | Cross mix (`blend_cross`) | float (percent) | 0.5 | 0 … 1 | ● | 0% = background only, 50% = even blend, 100% = foreground only. |
| Blending | Smoothness (`blend_smooth`) | float | 0.1 | 0 … 1 |  |  |
