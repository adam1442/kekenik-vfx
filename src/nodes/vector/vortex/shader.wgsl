// vector.vortex — tangential field around up to 4 centres: r < core*R rotates as a solid body, outside the profile falls off to 0 at R.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let pos = array<vec2f, 4>(P.w1_pos, P.w2_pos, P.w3_pos, P.w4_pos);
  let rad = array<f32, 4>(P.w1_radius, P.w2_radius, P.w3_radius, P.w4_radius);
  let str = array<f32, 4>(P.w1_strength, P.w2_strength, P.w3_strength, P.w4_strength);
  var m = 1.0;
  if (P.has_mask == 1u) { m = tex_sample(t0, uv, F.tile, F.filter_mode).r; }
  var v = vec2f(0.0);
  for (var i = 0; i < 4; i = i + 1) {
    if (str[i] == 0.0) { continue; }
    let d = uvf_wrap(uv - pos[i], F.tile) * asp;
    let l = length(d);
    let core = max(P.core * rad[i], 1e-4);
    var prof = l / core;
    if (l >= core) {
      prof = uvf_falloff(1.0 - (l - core) / max(rad[i] - core, 1e-4), P.falloff);
    }
    let tang = vec2f(-d.y, d.x) / max(l, 1e-6);
    v = v + tang * (prof * str[i] * m);
  }
  return vec4f(v, 0.0, 1.0);
}
