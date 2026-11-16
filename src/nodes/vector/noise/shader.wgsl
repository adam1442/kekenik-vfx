// vector.noise — curl (divergence-free) / plain vector noise. Tileable through periodic lattices (vectorlib.wgsl).
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let cells = max(round(P.scale), vec2f(1.0));
  let p = uv + P.offset;
  var v: vec2f;
  if (P.kind == 0u) {
    v = vl_curl_noise(p, cells, P.octaves, P.roughness, P.evolution, P.z_cells, P.seed, F.tile);
  } else {
    v = vl_vec_noise(p, cells, P.octaves, P.roughness, P.evolution, P.z_cells, P.seed, F.tile);
  }
  var m = 1.0;
  if (P.has_mask == 1u) { m = tex_sample(t0, uv, F.tile, F.filter_mode).r; }
  return vec4f(v * P.strength * m, 0.0, 1.0);
}
