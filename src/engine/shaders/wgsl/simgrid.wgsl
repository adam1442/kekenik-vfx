// simgrid.wgsl — helpers for the grid simulations (raw fragment passes, textureLoad only).
// Pure module: pass the periodic flag explicitly. Pixel coordinates are integer texel indices; "x" below = continuous pixel
// coordinates where texel centres are at +0.5.
#include "hash"

fn sg_wrap(p: vec2i, n: vec2i, periodic: bool) -> vec2i {
  if (periodic) {
    return vec2i(((p.x % n.x) + n.x) % n.x, ((p.y % n.y) + n.y) % n.y);
  }
  return clamp(p, vec2i(0), n - vec2i(1));
}

fn sg_ld(t: texture_2d<f32>, p: vec2i, periodic: bool) -> vec4f {
  return textureLoad(t, sg_wrap(p, vec2i(textureDimensions(t)), periodic), 0);
}

// Bilinear sample at continuous pixel coordinates (x = texel index + 0.5 at centres).
fn sg_bil(t: texture_2d<f32>, x: vec2f, periodic: bool) -> vec4f {
  let q = x - vec2f(0.5);
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let a = sg_ld(t, i, periodic);
  let b = sg_ld(t, i + vec2i(1, 0), periodic);
  let c = sg_ld(t, i + vec2i(0, 1), periodic);
  let d = sg_ld(t, i + vec2i(1, 1), periodic);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Resample an input (any resolution) at the tile uv.
fn sg_in(t: texture_2d<f32>, uv: vec2f, periodic: bool) -> vec4f {
  return sg_bil(t, uv * vec2f(textureDimensions(t)), periodic);
}

// Uniform random number in [0,1) per cell / seed / channel.
fn sg_rand(c: vec2i, seed: u32, ch: u32) -> f32 {
  return u01(hash_u(bitcast<u32>(c.x), bitcast<u32>(c.y), ch, seed));
}

// 5 point laplacian (cell units, dx = 1).
fn sg_lap(t: texture_2d<f32>, c: vec2i, periodic: bool) -> vec4f {
  return sg_ld(t, c + vec2i(1, 0), periodic) + sg_ld(t, c - vec2i(1, 0), periodic) + sg_ld(t, c + vec2i(0, 1), periodic) + sg_ld(t, c - vec2i(0, 1), periodic) - 4.0 * sg_ld(t, c, periodic);
}

// 9 point isotropic laplacian (weights 0.2 / 0.05, sums to zero): rounder patterns than the 5 point stencil.
fn sg_lap9(t: texture_2d<f32>, c: vec2i, periodic: bool) -> vec4f {
  let e = sg_ld(t, c + vec2i(1, 0), periodic) + sg_ld(t, c - vec2i(1, 0), periodic) + sg_ld(t, c + vec2i(0, 1), periodic) + sg_ld(t, c - vec2i(0, 1), periodic);
  let d = sg_ld(t, c + vec2i(1, 1), periodic) + sg_ld(t, c - vec2i(1, 1), periodic) + sg_ld(t, c + vec2i(1, -1), periodic) + sg_ld(t, c - vec2i(1, -1), periodic);
  return 0.2 * e + 0.05 * d - 1.0 * sg_ld(t, c, periodic);
}
