// utils.distance — one jump-flooding step with 3x3 offsets * P.step. Candidate = packed seed read at (p + offset)
// (wrapped when tiling). Distance uses the minimum-image convention on tiling axes, so seeds across the seam win.
#include "sampling"

fn unpack(c: vec4f) -> vec2i {
  return vec2i(i32(round(c.x)) * 1024 + i32(round(c.y)), i32(round(c.z)) * 1024 + i32(round(c.w)));
}

fn wrapped_delta(s: vec2i, p: vec2i, n: vec2i) -> vec2f {
  var d = vec2f(s - p);
  if (F.tile.x == 1u) {
    d.x = d.x - f32(n.x) * round(d.x / f32(n.x));
  }
  if (F.tile.y == 1u) {
    d.y = d.y - f32(n.y) * round(d.y / f32(n.y));
  }
  return d;
}

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let p = vec2i(floor(uv * F.res));
  var best = tex_load(t0, p, F.tile);
  var bestd = 1.0e30;
  if (best.x >= 0.0) {
    let d = wrapped_delta(unpack(best), p, n);
    bestd = dot(d, d);
  }
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      if (i == 0 && j == 0) {
        continue;
      }
      let q = p + vec2i(i, j) * P.step;
      if (F.tile.x == 0u && (q.x < 0 || q.x >= n.x)) {
        continue;
      }
      if (F.tile.y == 0u && (q.y < 0 || q.y >= n.y)) {
        continue;
      }
      let c = tex_load(t0, q, F.tile);
      if (c.x < 0.0) {
        continue;
      }
      let d = wrapped_delta(unpack(c), p, n);
      let dd = dot(d, d);
      if (dd < bestd) {
        bestd = dd;
        best = c;
      }
    }
  }
  return best;
}
