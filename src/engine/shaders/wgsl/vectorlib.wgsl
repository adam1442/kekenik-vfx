// vectorlib.wgsl — pure helpers for the Vector / simulation nodes. Needs `F`-independent arguments only.
// CPU mirrors: src/nodes/_shared/vectorref.ts (curl noise, wrap, rotate).
#include "noise"
#include "uvfield"

const VL_TAU: f32 = 6.28318530717959;

fn vl_rot(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x - s * v.y, s * v.x + c * v.y);
}

// Safe normalisation (zero stays zero).
fn vl_norm(v: vec2f) -> vec2f {
  let l = length(v);
  return select(vec2f(0.0), v / l, l > 1e-9);
}

// Tileable fractal gradient-noise potential (scalar). cells = lattice cells across the image per axis (rounded
// when tiling so the pattern wraps), z = loop coordinate in [0,1) (periodic with zc layers), returns ~[-1,1].
fn vl_potential(uv: vec2f, cells: vec2f, oct: i32, rough: f32, z: f32, zc: i32, seed: u32, tile: vec2u) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  var freq = 1.0;
  for (var o = 0; o < 6; o = o + 1) {
    if (o >= oct) { break; }
    let cl = select(cells * freq, round(cells * freq), true);
    let per = vec3i(select(0, i32(cl.x), tile.x == 1u), select(0, i32(cl.y), tile.y == 1u), zc);
    let q = vec3f(uv * cl, z * f32(zc));
    sum = sum + amp * perlin3(q, per, seed + u32(o) * 7919u);
    norm = norm + amp;
    amp = amp * rough;
    freq = freq * 2.0;
  }
  return sum / max(norm, 1e-6);
}

// Divergence-free velocity = rotated gradient of the potential (central differences, exact up to O(eps^2)).
fn vl_curl_noise(uv: vec2f, cells: vec2f, oct: i32, rough: f32, z: f32, zc: i32, seed: u32, tile: vec2u) -> vec2f {
  let e = 0.5 / (64.0 * max(cells.x, cells.y));
  let px = vl_potential(uv + vec2f(e, 0.0), cells, oct, rough, z, zc, seed, tile) - vl_potential(uv - vec2f(e, 0.0), cells, oct, rough, z, zc, seed, tile);
  let py = vl_potential(uv + vec2f(0.0, e), cells, oct, rough, z, zc, seed, tile) - vl_potential(uv - vec2f(0.0, e), cells, oct, rough, z, zc, seed, tile);
  return vec2f(py, -px) / (2.0 * e) / (max(cells.x, cells.y) * 4.0);
}

// Plain (non divergence-free) vector noise: two decorrelated potentials.
fn vl_vec_noise(uv: vec2f, cells: vec2f, oct: i32, rough: f32, z: f32, zc: i32, seed: u32, tile: vec2u) -> vec2f {
  return vec2f(vl_potential(uv, cells, oct, rough, z, zc, seed, tile), vl_potential(uv, cells, oct, rough, z, zc, seed + 101u, tile));
}

// Aspect-correct isotropic offset (unit: fraction of the smaller side) from a uv delta.
fn vl_iso(d: vec2f, res: vec2f) -> vec2f {
  return d * uvf_aspect(res);
}

// Smooth-step like triangle weight for two-phase flow maps: 1 at phase 0.5, 0 at 0 and 1.
fn vl_tri(ph: f32) -> f32 {
  return 1.0 - abs(2.0 * ph - 1.0);
}

// Nearest signed distance helpers for segments (returns vec3(dist, t, side)).
fn vl_seg(p: vec2f, a: vec2f, b: vec2f) -> vec3f {
  let ab = b - a;
  let l2 = max(dot(ab, ab), 1e-12);
  let t = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
  let q = a + ab * t;
  let side = sign(ab.x * (p.y - a.y) - ab.y * (p.x - a.x));
  return vec3f(length(p - q), t, side);
}
