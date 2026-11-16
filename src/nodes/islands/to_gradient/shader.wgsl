// islands.to_gradient — a gradient inside every island's bounding box (Island Map t0). Local position c = local - 0.5 (box centre = 0).
// keep_aspect = 1 works in pixels (isotropic), 0 stretches the box to a unit square. mode 0 direction (angle, projected on the box so
// 0..1 spans the whole box), 1 from centre (0 centre -> 1 corner), 2 angular (turns around the centre), 3 box (0 at the box edge ->
// 1 at the centre). Per island random angle / inversion by the island hash. Then repeat / offset (clamped or wrapped), invert, curve.
#include "sampling"
#include "island"
#include "lut_curve"

fn shade(uv: vec2f) -> vec4f {
  let m = tex_sample(t0, uv, F.tile, 0u);
  if (!island_valid(m)) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let rnd = island_rand(m, P.seed);
  let c = island_local(m, uv, F.tile) - vec2f(0.5);
  let sz = max(m.zw * F.res, vec2f(1.0));
  let keep = P.keep_aspect == 1u;
  let q = select(c * 2.0, c * sz, keep);
  let ang = P.angle + (rnd - 0.5) * TAU * P.angle_random;
  var v = 0.0;
  if (P.mode == 0u) {
    let dir = vec2f(cos(ang), sin(ang));
    let ext = select(abs(dir.x) + abs(dir.y), abs(dir.x) * sz.x + abs(dir.y) * sz.y, keep);
    v = 0.5 + dot(select(c, q, keep), dir) / max(ext, 0.0001);
  } else if (P.mode == 1u) {
    v = select(length(q) / 1.41421356, length(q) / (0.5 * length(sz)), keep);
  } else if (P.mode == 2u) {
    v = fract(atan2(q.y, q.x) / TAU + 0.5 - ang / TAU);
  } else {
    let e = select(vec2f(1.0) - abs(q), 0.5 * sz - abs(q), keep);
    v = select(min(e.x, e.y), min(e.x, e.y) / (0.5 * min(sz.x, sz.y)), keep);
  }
  v = v * P.repeat + P.offset;
  if (P.wrap == 1u) {
    v = v - floor(v);
  }
  v = clamp(v, 0.0, 1.0);
  if (P.random_invert > 0.0 && u01(pcg(island_hash(m, P.seed) ^ 0xa511e9b3u)) < P.random_invert) {
    v = 1.0 - v;
  }
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(curve_lut(v), 0.0, 0.0, 1.0);
}
