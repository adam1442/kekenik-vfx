// Flow advection outputs: OUT 0 colour (rgb * gain), 1 density (mean of rgb). t0 = state.
#include "sampling"
fn shade(uv: vec2f) -> vec4f {
  let s = tex_sample(t0, uv, P.wrap, P.filt).rgb * P.out_gain;
#if OUT == 0
  return vec4f(s, 1.0);
#else
  return vec4f((s.r + s.g + s.b) / 3.0, 0.0, 0.0, 1.0);
#endif
}
