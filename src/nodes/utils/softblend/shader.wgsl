// utils.softblend — height-aware blend. t0 fg, t1 bg, t2 fg height, t3 bg height, t4 mask.
// d = (fgH + offset) - bgH; weight = smoothstep(-softness, softness, d) * opacity * mask; out = mix(bg, fg, weight).
// Without height inputs the red channel of fg / bg is the height. Second output pass (P.want_height = 1) returns the
// blended height = mix(bgH, fgH + offset, weight).
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let fg = tex_sample(t0, uv, F.tile, F.filter_mode);
  let bg = tex_sample(t1, uv, F.tile, F.filter_mode);
  var fh = fg.r;
  var bh = bg.r;
  if (P.has_fh == 1u) {
    fh = tex_sample(t2, uv, F.tile, F.filter_mode).r;
  }
  if (P.has_bh == 1u) {
    bh = tex_sample(t3, uv, F.tile, F.filter_mode).r;
  }
  var mask = 1.0;
  if (P.has_mask == 1u) {
    mask = tex_sample(t4, uv, F.tile, F.filter_mode).r;
  }
  fh = fh + P.offset;
  let d = fh - bh;
  let s = max(P.softness, 0.00001);
  let w = smoothstep(-s, s, d) * clamp(P.opacity * mask, 0.0, 1.0);
  if (P.want_height == 1u) {
    return vec4f(mix(bh, fh, w), 0.0, 0.0, 1.0);
  }
  return mix(bg, fg, w);
}
