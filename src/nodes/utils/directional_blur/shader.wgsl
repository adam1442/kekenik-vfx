// utils.directional_blur — t0 input, t1 angle modulation, t2 length modulation, t3 UV field (optional).
// The blur vector is either (angle, length) [+ per-pixel modulation] or the displacement of the UV field
// (field - own uv, shortest wrapped difference when tiling) * uv_scale. Taps use tex_sample, so edges wrap when
// tiling and clamp otherwise. A per-pixel hash jitter (optional) hides step banding.
#include "sampling"
#include "hash"
#include "util"

fn shade(uv: vec2f) -> vec4f {
  var v = vec2f(0.0);
  let side = min(F.res.x, F.res.y);
  if (P.has_uv == 1u) {
    let f = tex_sample(t3, uv, F.tile, F.filter_mode).rg;
    var d = f - uv;
    if (F.tile.x == 1u) {
      d.x = d.x - round(d.x);
    }
    if (F.tile.y == 1u) {
      d.y = d.y - round(d.y);
    }
    v = d * P.uv_scale;
  } else {
    let ma = tex_sample(t1, uv, F.tile, F.filter_mode).r;
    let ml = tex_sample(t2, uv, F.tile, F.filter_mode).r;
    let a = modulate(P.angle, ma, P.angle_mod_k);
    let l = max(modulate(P.length, ml, P.length_mod_k), 0.0);
    v = vec2f(cos(a), sin(a)) * l * side / F.res;
  }
  let len_px = length(v * F.res);
  var n = P.samples;
  if (P.adaptive == 1u) {
    n = clamp(i32(ceil(len_px)) + 1, 2, P.samples);
  }
  var jit = 0.0;
  if (P.jitter == 1u) {
    let q = vec2u(floor(uv * F.res));
    jit = u01(hash_u(q.x, q.y, 7u, F.seed)) - 0.5;
  }
  var acc = vec4f(0.0);
  var wsum = 0.0;
  let inv = 1.0 / f32(max(n - 1, 1));
  for (var i = 0; i < n; i = i + 1) {
    var s = (f32(i) + jit * select(0.0, 1.0, n > 1)) * inv; // 0..1 along the blur line
    s = clamp(s, 0.0, 1.0);
    var t = s - 0.5;
    if (P.placement == 1u) {
      t = s;
    } else if (P.placement == 2u) {
      t = -s;
    }
    var w = 1.0;
    if (P.falloff == 1u) {
      w = 1.0 - s * 0.95;
    } else if (P.falloff == 2u) {
      let g = (s - 0.5) * 3.0;
      w = exp(-g * g * 0.5);
    }
    acc = acc + tex_sample(t0, uv + v * t, F.tile, F.filter_mode) * w;
    wsum = wsum + w;
  }
  return acc / max(wsum, 0.00001);
}
