// utils.auto_crop — crop pass. t0 = source, s0 = reduction result (see _shared/reduce.wgsl: [0..3] content bounds in pixel
// edges, [4] / [5] = min / max of the measured value). The bounds never touch the CPU.
// fit 0 = stretch the (padded) bounds over the whole output, fit 1 = keep aspect (centred, uniform scale).
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let dim = vec2f(textureDimensions(t0));
  let pad = P.padding * min(dim.x, dim.y);
  var rmin = vec2f(s0[0] - pad, s0[1] - pad);
  var rsz = vec2f(s0[2] - s0[0] + 2.0 * pad, s0[3] - s0[1] + 2.0 * pad);
  rsz = max(rsz, vec2f(1.0));
  if (P.fit == 1u) {
    let a = F.res.x / F.res.y;
    let c = rmin + rsz * 0.5;
    if (rsz.x / rsz.y < a) {
      rsz.x = rsz.y * a;
    } else {
      rsz.y = rsz.x / a;
    }
    rmin = c - rsz * 0.5;
  }
  let s = (rmin + uv * rsz) / dim;
  var c = vec4f(0.0);
  if (s.x >= 0.0 && s.x <= 1.0 && s.y >= 0.0 && s.y <= 1.0) {
    c = tex_sample(t0, s, vec2u(0u, 0u), F.filter_mode);
    if (P.norm_on == 1u) {
      let lo = s0[4];
      let span = max(s0[5] - lo, 0.000001);
#if COLOR == 1
      c = vec4f((c.rgb - vec3f(lo)) / span, c.a);
#else
      c = vec4f((c.r - lo) / span, 0.0, 0.0, 1.0);
#endif
    }
  }
  return c;
}
