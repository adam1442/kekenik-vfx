// utils.chromatic_aberration — spectral colour fringing (lens dispersion). The input is integrated over `samples` taps that
// are displaced by a wavelength dependent amount; every tap carries a rainbow tint (violet -> red) normalised so that
// a flat input stays unchanged. Radial = lateral lens fringing (zero at the centre, growing outward, like the rainbow
// light-streaks of stylised VFX), directional = constant offset along an angle.
// t0 = colour input, t1 = optional modulation of `amount`.
#include "common"
#include "util"
#include "sampling"

// Rainbow weight of a tap with k in [0, 1] (0 = violet, 1 = red); smooth, positive.
fn spectrum(k: f32) -> vec3f {
  let r = smoothstep(0.35, 0.95, k) + 0.25 * smoothstep(0.0, 0.1, 0.1 - k);
  let g = 1.0 - abs(k - 0.5) * 2.2;
  let b = smoothstep(0.65, 0.05, k);
  return max(vec3f(r, g, b), vec3f(0.0));
}

fn shade(uv: vec2f) -> vec4f {
  let side = min(F.res.x, F.res.y);
  let asp = F.res / side;
  let ma = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  let amount = modulate(P.amount, ma, P.amount_mod_k);
  var dir = vec2f(cos(radians(P.angle)), sin(radians(P.angle)));
  var scale = 1.0;
  if (P.mode == 0u) {
    let d = (uv - P.center) * asp;
    let dist = length(d);
    dir = (uv - P.center);
    scale = pow(clamp(dist * 1.4142, 0.0, 4.0), P.falloff);
  } else {
    dir = dir / asp;
  }
  let n = clamp(P.samples, 3, 32);
  var acc = vec4f(0.0);
  var wsum = vec3f(0.0);
  var asum = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let k = f32(i) / f32(n - 1);
    let w = spectrum(k);
    let off = (k - 0.5) * 2.0 * amount * scale;
    let c = tex_sample(t0, uv + dir * off, F.tile, F.filter_mode);
    acc = acc + vec4f(c.rgb * w, c.a);
    wsum = wsum + w;
    asum = asum + 1.0;
  }
  return vec4f(acc.rgb / max(wsum, vec3f(0.0001)), acc.a / asum);
}
