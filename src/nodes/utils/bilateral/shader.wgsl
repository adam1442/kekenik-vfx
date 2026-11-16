// utils.bilateral — edge preserving smoothing. Spatial weight exp(-d^2 / 2 s^2) * range weight exp(-|c - c0|^2 / 2 r^2).
// mode 0: full 2D window, mode 1: separable approximation (direction dir_x/dir_y). Taps are at integer pixel offsets
// times `stride` (>1 for big radii: cheaper, slightly noisier). Wrap-aware via tex_load(F.tile).
#include "sampling"

fn rdist2(a: vec4f, b: vec4f) -> f32 {
#if COLOR == 1
  let d = a.rgb - b.rgb;
  return dot(d, d);
#else
  let d = a.r - b.r;
  return d * d;
#endif
}

fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let c0 = tex_load(t0, p, F.tile);
  let inv_s = 1.0 / (2.0 * max(P.sigma_s, 0.0001) * max(P.sigma_s, 0.0001));
  let inv_r = 1.0 / (2.0 * max(P.sigma_r, 0.0001) * max(P.sigma_r, 0.0001));
  var acc = vec4f(0.0);
  var wsum = 0.0;
  if (P.mode == 0u) {
    for (var j = -P.taps; j <= P.taps; j = j + 1) {
      for (var i = -P.taps; i <= P.taps; i = i + 1) {
        let o = vec2i(i, j) * P.stride;
        let c = tex_load(t0, p + o, F.tile);
        let w = exp(-f32(o.x * o.x + o.y * o.y) * inv_s - rdist2(c, c0) * inv_r);
        acc = acc + c * w;
        wsum = wsum + w;
      }
    }
  } else {
    for (var i = -P.taps; i <= P.taps; i = i + 1) {
      let o = vec2i(P.dir_x, P.dir_y) * (i * P.stride);
      let c = tex_load(t0, p + o, F.tile);
      let w = exp(-f32(o.x * o.x + o.y * o.y) * inv_s - rdist2(c, c0) * inv_r);
      acc = acc + c * w;
      wsum = wsum + w;
    }
  }
  return acc / max(wsum, 0.000001);
}
