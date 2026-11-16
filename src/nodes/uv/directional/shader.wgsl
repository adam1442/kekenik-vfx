// uv.directional — uniform push: CONTENT moves along `angle` (clockwise on screen, y down) by `strength` (fraction of
// the smaller side), so the lookup delta is -dir * strength. Angle and strength accept modulation (t0 = strength, t1 = angle).
#include "util"
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let ms = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let ma = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  let ang = modulate(P.angle, ma, P.angle_mod_k);
  let s = modulate(P.strength, ms, P.strength_mod_k);
  let dir = vec2f(cos(ang), sin(ang));
  return uvf_pack(-dir * s / asp, uv, P.uv_mode);
}
