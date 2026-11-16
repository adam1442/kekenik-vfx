// grayscale.slice — iso-band extraction from a heightmap. t0 = input, t1 = centre modulation.
// Band i (0..bands-1) is centred at centre + (i - (bands-1)/2) * spacing; the result is the band nearest to the value.
#include "sampling"
#include "util"

fn shade(uv: vec2f) -> vec4f {
  let v = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  var c = P.center;
  if (P.center_mod_k != 0.0) {
    c = modulate(c, tex_sample(t1, uv, F.tile, F.filter_mode).r, P.center_mod_k);
  }
  let nb = max(P.bands, 1);
  let first = c - 0.5 * f32(nb - 1) * P.spacing;
  var idx = 0.0;
  if (nb > 1) {
    idx = clamp(round((v - first) / max(abs(P.spacing), 0.00001)), 0.0, f32(nb - 1));
  }
  let d = abs(v - (first + idx * P.spacing));
  let half_w = max(0.5 * P.width, 0.00001);
  var r = 0.0;
  if (P.profile == 1u) {
    // ramp: 1 at the band centre falling to 0 at its edges
    r = 1.0 - clamp(d / half_w, 0.0, 1.0);
  } else {
    let e0 = half_w * (1.0 - P.softness);
    let e1 = half_w * (1.0 + P.softness) + 0.000001;
    r = 1.0 - smoothstep(e0, e1, d);
  }
  if (P.invert == 1u) {
    r = 1.0 - r;
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
