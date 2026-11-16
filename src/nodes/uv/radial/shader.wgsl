// uv.radial — push (strength > 0: content moves AWAY from the centre) / pull (strength < 0) with a falloff over
// `radius` (full strength inside inner * radius). Tiling: the distance uses the minimum image. t0 = strength modulation.
#include "util"
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let d0 = uvf_wrap(uv - P.center, F.tile) * asp;
  let dist = length(d0);
  let ms = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let s = modulate(P.strength, ms, P.strength_mod_k);
  let inner = clamp(P.inner, 0.0, 0.999) * P.radius;
  let t = 1.0 - clamp((dist - inner) / max(P.radius - inner, 0.00001), 0.0, 1.0);
  let f = uvf_falloff(t, P.falloff);
  let dir = select(vec2f(0.0), d0 / max(dist, 0.000001), dist > 0.000001);
  return uvf_pack(-dir * s * f / asp, uv, P.uv_mode);
}
