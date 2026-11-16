// color.hue_spread — spreads hue across a range using a Gray id (t1) on top of an optional Color input (t0).
// HSV is evaluated on sRGB-encoded values (perceptually even hue steps); data stays linear in / out.
#include "sampling"
#include "color"

fn shade(uv: vec2f) -> vec4f {
  var src = P.base;
  if (P.has_input == 1u) {
    src = tex_sample(t0, uv, F.tile, F.filter_mode);
  }
  let idv = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  var t = idv * P.repeat;
  if (P.repeat > 1.0001) {
    t = fract(t);
  } else {
    t = clamp(t, 0.0, 1.0);
  }
  if (P.quantize > 1) {
    let q = f32(P.quantize);
    let idx = floor(min(t, 0.99999) * q);
    t = select(idx / (q - 1.0), idx / q, P.hue_range >= 359.9);
  }
  let shift = (P.hue_start + P.hue_range * t) / 360.0;
  let hsv = rgb_to_hsv(linear_to_srgb(max(src.rgb, vec3f(0.0))));
  var h = fract(hsv.x + shift);
  var s = clamp(hsv.y * P.saturation, 0.0, 1.0);
  if (P.mode == 1u) {
    h = fract(shift);
    s = clamp(P.saturation, 0.0, 1.0);
  }
  let rgb = srgb_to_linear(hsv_to_rgb(vec3f(h, s, hsv.z * P.value)));
  return vec4f(rgb, src.a);
}
