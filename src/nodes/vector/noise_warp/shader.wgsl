// vector.noise_warp — domain warp by divergence-free noise + additive noise. Tileable (periodic lattices).
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let cells = max(round(P.scale), vec2f(1.0));
  let nz = vl_curl_noise(uv, cells, P.octaves, P.roughness, P.evolution, P.z_cells, P.seed, F.tile);
  var v = vec_sample(t0, uv + nz * P.warp * 4.0, F.tile, F.filter_mode);
  if (P.add != 0.0) { v = v + nz * P.add * 4.0; }
  return vec4f(v, 0.0, 1.0);
}
