// utils.blend / utils.blend_color — blend Foreground (t0) over Background (t1) with a blend mode, cross mix, opacity and
// optional Mask (t2). Alpha is an ordinary channel. -DGRAY=1 (gray variant) makes the non-separable modes sane (blend.wgsl).
#include "sampling"
#include "blend"

fn shade(uv: vec2f) -> vec4f {
  var fg = vec4f(0.0);
  var bg = vec4f(0.0);
  var mask = 1.0;
  if (P.has_fg == 1u) {
    fg = tex_sample(t0, uv, F.tile, F.filter_mode);
  }
  if (P.has_bg == 1u) {
    bg = tex_sample(t1, uv, F.tile, F.filter_mode);
  }
  if (P.has_mask == 1u) {
    mask = tex_sample(t2, uv, F.tile, F.filter_mode).r;
  }
  var b = blend_cross(P.blend_type, bg, fg, P.cross_mix, P.smoothness);
  if (P.clamp_output == 1u) {
    b = clamp(b, vec4f(0.0), vec4f(1.0));
  }
  return mix(bg, b, clamp(mask * P.opacity, 0.0, 1.0));
}
