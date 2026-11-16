// vector.radial — sum of up to 4 radial sources / sinks. Distances are isotropic (aspect corrected) and wrapped when tiling.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let pos = array<vec2f, 4>(P.r1_pos, P.r2_pos, P.r3_pos, P.r4_pos);
  let rad = array<f32, 4>(P.r1_radius, P.r2_radius, P.r3_radius, P.r4_radius);
  let str = array<f32, 4>(P.r1_strength, P.r2_strength, P.r3_strength, P.r4_strength);
  var v = vec2f(0.0);
  for (var i = 0; i < 4; i = i + 1) {
    if (str[i] == 0.0) { continue; }
    let d = uvf_wrap(uv - pos[i], F.tile) * asp;
    let l = length(d);
    let prof = uvf_falloff(1.0 - l / max(rad[i], 1e-4), P.falloff);
    v = v + vl_norm(d) * (prof * str[i]);
  }
  return vec4f(v, 0.0, 1.0);
}
