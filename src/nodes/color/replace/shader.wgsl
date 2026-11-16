// color.replace — replace a target colour (OKLab distance, tolerance + softness). t0 = input.
// mode 0: colour result, mode 1: the replacement mask in .r (second output).
#include "sampling"
#include "oklab"

fn shade(uv: vec2f) -> vec4f {
  let c = tex_sample(t0, uv, F.tile, F.filter_mode);
  let lc = lin_to_oklab(c.rgb);
  let ls = lin_to_oklab(P.source.rgb);
  var dv = lc - ls;
  if (P.ignore_lum == 1u) {
    dv.x = 0.0;
  }
  let d = length(dv);
  let m = (1.0 - smoothstep(P.tolerance, P.tolerance + max(P.softness, 0.00001), d)) * P.strength;
  if (P.mode == 1u) {
    return vec4f(m, 0.0, 0.0, 1.0);
  }
  var lt = lin_to_oklab(P.repl.rgb);
  lt.x = lt.x + (lc.x - ls.x) * P.keep_lightness;
  let rgb = mix(c.rgb, oklab_to_lin(lt), m);
  return vec4f(rgb, mix(c.a, P.repl.a, m));
}
