// uvfield.wgsl — helpers for the UV pin convention.
//
//   A UV field texture holds, per pixel, either
//     mode 0  ABSOLUTE : the lookup coordinate itself  (identity field = own uv)           <- canonical, graph default
//     mode 1  OFFSET   : delta = lookup - own uv        (neutral = 0, "warp", flowmap style)
//   Units are TILE SPACE (1.0 = one full image), +u right, +v DOWN (top-left origin, like frame_uv()).
//   Absolute coordinates are NEVER wrapped to [0,1): a sampler wraps them with the consumer's tiling, and bilinear
//   interpolation of the field stays valid across the seam.
// Pure module (no bindings): everything is passed as an argument.
#include "sampling"

// Resolution -> aspect vector, so lengths in the smaller-side unit become isotropic: iso = uv * aspect.
fn uvf_aspect(res: vec2f) -> vec2f {
  return res / min(res.x, res.y);
}

// Pack a warp (delta, tile space) at pixel `uv` into the stored representation.
fn uvf_pack(delta: vec2f, uv: vec2f, mode: u32) -> vec4f {
  return vec4f(select(uv + delta, delta, mode == 1u), 0.0, 1.0);
}

// Stored value -> delta (tile space).
fn uvf_delta(raw: vec2f, uv: vec2f, mode: u32) -> vec2f {
  return select(raw - uv, raw, mode == 1u);
}

// Sample a UV field texture at `uv` and return the DELTA there (wrap/clamp by `tile`, point/linear/cubic by `filt`).
fn uvf_sample(t: texture_2d<f32>, uv: vec2f, tile: vec2u, filt: u32, mode: u32) -> vec2f {
  return uvf_delta(tex_sample(t, uv, tile, filt).rg, uv, mode);
}

// Minimum-image difference on tiling axes (period 1), identity otherwise.
fn uvf_wrap(d: vec2f, tile: vec2u) -> vec2f {
  var r = d;
  if (tile.x == 1u) {
    r.x = r.x - round(r.x);
  }
  if (tile.y == 1u) {
    r.y = r.y - round(r.y);
  }
  return r;
}

// Smooth falloff profiles shared by Radial / Rotational / Spline: t in [0,1] (1 = at the centre / spine), kind:
// 0 linear, 1 smooth (smoothstep), 2 gaussian-like, 3 constant (hard edge), 4 quadratic ease-out.
fn uvf_falloff(t: f32, kind: u32) -> f32 {
  let x = clamp(t, 0.0, 1.0);
  switch (kind) {
    case 1u: { return x * x * (3.0 - 2.0 * x); }
    case 2u: { return exp(-4.0 * (1.0 - x) * (1.0 - x)) * x; }
    case 3u: { return select(0.0, 1.0, x > 0.0); }
    case 4u: { return 1.0 - (1.0 - x) * (1.0 - x); }
    default: { return x; }
  }
}

// Vector pin sample (signed rg, tile fractions / second). Never clamped. Pass F.tile / F.filter_mode.
fn vec_sample(t: texture_2d<f32>, uv: vec2f, tile: vec2u, mode: u32) -> vec2f {
  return tex_sample(t, uv, tile, mode).xy;
}
