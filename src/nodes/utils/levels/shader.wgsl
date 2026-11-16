// utils.levels / utils.levels_color — classic levels (input range, gamma, output range) applied to t0.
// With -DAUTO=1 the input range comes from a GPU reduction buffer s0 ([4] = min, [5] = max, see _shared/reduce.wgsl) and the node is
// NOT fusable (the standalone path only). Gray: the red channel; Color: rgb (and alpha when P.levels_alpha = 1).
// the levels math is `levels_apply()` (+ `fuse()` for the manual range): single source of truth for both paths.
#include "sampling"

// @fuse-begin
fn lv(P: Params, v: f32, in_low: f32, in_high: f32) -> f32 {
  let span = max(abs(in_high - in_low), 0.000001) * select(-1.0, 1.0, in_high >= in_low);
  var x = (v - in_low) / span;
  x = max(x, 0.0);
  x = pow(x, 1.0 / max(P.gamma, 0.0001));
  var o = mix(P.out_low, P.out_high, x);
  if (P.clamp_output == 1u) {
    o = clamp(o, min(P.out_low, P.out_high), max(P.out_low, P.out_high));
  }
  return o;
}

fn levels_apply(P: Params, src: vec4f, lo: f32, hi: f32) -> vec4f {
#if COLOR == 1
  var c = vec4f(lv(P, src.r, lo, hi), lv(P, src.g, lo, hi), lv(P, src.b, lo, hi), src.a);
  if (P.levels_alpha == 1u) {
    c.a = lv(P, src.a, lo, hi);
  }
  return c;
#else
  return vec4f(lv(P, src.r, lo, hi), 0.0, 0.0, 1.0);
#endif
}

fn fuse(uv: vec2f, src: vec4f, P: Params) -> vec4f {
  return levels_apply(P, src, P.in_low, P.in_high);
}
// @fuse-end

fn shade(uv: vec2f) -> vec4f {
  let c = tex_sample(t0, uv, F.tile, F.filter_mode);
#if AUTO == 1
  var lo = s0[4];
  var hi = s0[5];
  if (hi - lo < 0.000001) {
    hi = lo + 0.000001;
  }
  return levels_apply(P, c, lo, hi);
#else
  return fuse(uv, c, P);
#endif
}
