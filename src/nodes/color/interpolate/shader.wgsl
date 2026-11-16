// color.interpolate — mix A (t0) and B (t1) by the Gray mask (t2) remapped by a curve (P.lut). Unconnected A / B use the colour params.
#include "sampling"
#include "lut_curve"
#include "oklab"

fn shade(uv: vec2f) -> vec4f {
  var a = P.color_a;
  if (P.has_a == 1u) {
    a = tex_sample(t0, uv, F.tile, F.filter_mode);
  }
  var b = P.color_b;
  if (P.has_b == 1u) {
    b = tex_sample(t1, uv, F.tile, F.filter_mode);
  }
  var m = curve_lut(clamp(tex_sample(t2, uv, F.tile, F.filter_mode).r, 0.0, 1.0));
  if (P.invert == 1u) {
    m = 1.0 - m;
  }
  m = clamp(m * P.amount, 0.0, 1.0);
  var rgb = mix(a.rgb, b.rgb, m);
  if (P.space == 1u) {
    rgb = oklab_to_lin(mix(lin_to_oklab(a.rgb), lin_to_oklab(b.rgb), m));
  }
  return vec4f(rgb, mix(a.a, b.a, m));
}
