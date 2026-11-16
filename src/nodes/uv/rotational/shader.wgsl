// uv.rotational — swirl. mode 0 'swirl': content ROTATES by angle * falloff around the centre (clockwise on screen for
// positive angles; the lookup rotates the other way). mode 1 'tangent': flowmap vortex, content moves along the tangent
// with `strength`. Distances are isotropic (aspect corrected), minimum image on tiling axes. t0 = angle modulation.
#include "util"
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let d0 = uvf_wrap(uv - P.center, F.tile) * asp;
  let dist = length(d0);
  let inner = clamp(P.inner, 0.0, 0.999) * P.radius;
  let t = 1.0 - clamp((dist - inner) / max(P.radius - inner, 0.00001), 0.0, 1.0);
  let f = uvf_falloff(t, P.falloff);
  let m = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  var delta = vec2f(0.0);
  if (P.mode == 0u) {
    let th = modulate(P.angle, m, P.angle_mod_k) * f;
    let c = cos(th);
    let s = sin(th);
    let look = vec2f(c * d0.x + s * d0.y, -s * d0.x + c * d0.y);
    delta = (look - d0) / asp;
  } else {
    let tn = select(vec2f(0.0), vec2f(-d0.y, d0.x) / max(dist, 0.000001), dist > 0.000001);
    delta = -tn * modulate(P.strength, m, P.angle_mod_k) * f / asp;
  }
  return uvf_pack(delta, uv, P.uv_mode);
}
