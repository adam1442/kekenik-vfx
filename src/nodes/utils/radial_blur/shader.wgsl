// utils.radial_blur — zoom and/or spin blur around a centre (flares, shockwave streaks, speed lines, god-ray-ish glow).
// t0 = input, t1 = amount modulation. For each pixel the tap k (0..1 along the blur) samples the input at
//   centre + rot(angle * k) * (uv - centre) * (1 - amount * k)           (aspect-corrected rotation)
// Taps use tex_sample, so the edges wrap when the node tiles and clamp otherwise. The pixels closer than `inner` to the
// centre are left sharp (smooth transition over `inner_soft`). Modes: 0 zoom, 1 spin, 2 zoom + spin.
#include "sampling"
#include "hash"
#include "util"

fn shade(uv: vec2f) -> vec4f {
  let side = min(F.res.x, F.res.y);
  let asp = F.res / side;
  let ma = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  let amount = modulate(P.amount, ma, P.amount_mod_k);
  let d0 = (uv - P.center) * asp;
  let dist = length(d0);
  // 0 near the centre (sharp), 1 outside.
  let keep = smoothstep(P.inner, P.inner + max(P.inner_soft, 0.0001), dist);
  let zoom_on = P.mode == 0u || P.mode == 2u;
  let spin_on = P.mode == 1u || P.mode == 2u;
  let n = clamp(P.samples, 2, 128);
  var jit = 0.0;
  if (P.jitter == 1u) {
    let q = vec2u(floor(uv * F.res));
    jit = u01(hash_u(q.x, q.y, 13u, F.seed)) - 0.5;
  }
  var acc = vec4f(0.0);
  var wsum = 0.0;
  let inv = 1.0 / f32(n - 1);
  for (var i = 0; i < n; i = i + 1) {
    let k = clamp((f32(i) + jit) * inv, 0.0, 1.0);
    let kk = k * keep;
    var d = d0;
    if (zoom_on) {
      d = d * (1.0 - amount * kk);
    }
    if (spin_on) {
      let a = radians(P.angle) * kk;
      let cs = cos(a);
      let sn = sin(a);
      d = vec2f(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    }
    var w = 1.0;
    if (P.falloff == 1u) {
      w = 1.0 - k * 0.95;
    } else if (P.falloff == 2u) {
      let g = k * 2.5;
      w = exp(-g * g * 0.5);
    }
    acc = acc + tex_sample(t0, P.center + d / asp, F.tile, F.filter_mode) * w;
    wsum = wsum + w;
  }
  return acc / max(wsum, 0.00001);
}
