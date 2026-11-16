// islands.padding — t0 = flooded seeds (nearest island pixel), t1 = Island Map. Pixels within `dist` (fraction of the smaller side,
// Euclidean or square metric, minimum image on tiling axes) of an island copy that island's map value; with expand = 1 the
// bounding box of EVERY pixel (island + padding) grows by `dist` so local coordinates stay inside 0..1 and the ids of an island and
// its padding stay identical.
#include "island"

fn unpack(c: vec4f) -> vec2i {
  return vec2i(i32(round(c.x)) * 1024 + i32(round(c.y)), i32(round(c.z)) * 1024 + i32(round(c.w)));
}

fn expand_map(m: vec4f) -> vec4f {
  if (P.expand == 0u) {
    return m;
  }
  let pad_uv = vec2f(P.dist) * min(F.res.x, F.res.y) / F.res;
  return vec4f(m.xy - pad_uv, m.zw + 2.0 * pad_uv);
}

fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let m0 = textureLoad(t1, p, 0);
  if (island_valid(m0)) {
    return expand_map(m0);
  }
  let c = textureLoad(t0, p, 0);
  if (c.x < 0.0) {
    return vec4f(0.0);
  }
  let s = unpack(c);
  var d = vec2f(s - p);
  if (F.tile.x == 1u) {
    d.x = d.x - F.res.x * round(d.x / F.res.x);
  }
  if (F.tile.y == 1u) {
    d.y = d.y - F.res.y * round(d.y / F.res.y);
  }
  let dist = select(length(d), max(abs(d.x), abs(d.y)), P.metric == 1u) / min(F.res.x, F.res.y);
  if (dist > P.dist) {
    return vec4f(0.0);
  }
  return expand_map(textureLoad(t1, s, 0));
}
