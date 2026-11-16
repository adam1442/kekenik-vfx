// island.wgsl — decoding helpers for the ISLAND MAP. Pure module.
//
//   Island Map (Color, rgba16float): rgba = (bbox min x, bbox min y, bbox width, bbox height) in UV units (tile space).
//   Every pixel of an island holds the SAME value. width = height = 0 means "no island" (background).
//   bbox min may be negative / beyond 1 for islands that wrap around the seam of a tiling graph; the island's pixels are
//   then at (uv - min) wrapped into [0,1) (see island_local). The "random id" of an island is a hash of the four values
//   (stored half-floats are bit-identical across the island), so ids agree between every node and the CPU mirror
//   (`islandHash` in _shared/islands.ts).
#include "hash"

fn island_valid(m: vec4f) -> bool {
  return m.z > 0.0 && m.w > 0.0;
}

fn island_hash(m: vec4f, seed: u32) -> u32 {
  return pcg(bitcast<u32>(m.x) ^ pcg(bitcast<u32>(m.y) + pcg(bitcast<u32>(m.z) ^ pcg(bitcast<u32>(m.w) + seed))));
}

// Uniform random value in [0, 1) per island.
fn island_rand(m: vec4f, seed: u32) -> f32 {
  return u01(island_hash(m, seed));
}

fn island_center(m: vec4f) -> vec2f {
  return m.xy + 0.5 * m.zw;
}

// Position of `uv` inside the island's bounding box, 0..1 on both axes (wrap aware on tiling axes).
fn island_local(m: vec4f, uv: vec2f, tile: vec2u) -> vec2f {
  var d = uv - m.xy;
  if (tile.x == 1u) {
    d.x = d.x - floor(d.x);
  }
  if (tile.y == 1u) {
    d.y = d.y - floor(d.y);
  }
  return clamp(d / max(m.zw, vec2f(0.000001)), vec2f(0.0), vec2f(1.0));
}
