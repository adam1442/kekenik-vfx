// sdf.wgsl — 2D signed distance helpers (negative inside). All take p centred on the shape.

fn sd_circle(p: vec2f, r: f32) -> f32 {
  return length(p) - r;
}

fn sd_box(p: vec2f, b: vec2f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}

fn sd_round_box(p: vec2f, b: vec2f, r: f32) -> f32 {
  return sd_box(p, b - vec2f(r)) - r;
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0000001), 0.0, 1.0);
  return length(pa - ba * h);
}

fn sd_ring(p: vec2f, r: f32, w: f32) -> f32 {
  return abs(length(p) - r) - w;
}

// Shortest delta on a torus: use for shapes that must tile (tile.x/y == 1 wraps that axis; deltas in UV units).
fn wrap_delta(d: vec2f, tile: vec2u) -> vec2f {
  var r = d;
  if (tile.x == 1u) {
    r.x = d.x - round(d.x);
  }
  if (tile.y == 1u) {
    r.y = d.y - round(d.y);
  }
  return r;
}

// Anti-aliased coverage from a signed distance: 1 inside, 0 outside, soft over `soft` (same units as d).
fn sd_coverage(d: f32, soft: f32) -> f32 {
  return 1.0 - smoothstep(-soft, soft, d);
}
