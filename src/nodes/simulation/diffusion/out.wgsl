// Diffusion outputs: OUT 0 result, 1 heat flux (-grad T, Vector). t0 = state.
#include "sampling"
fn ta(uv: vec2f) -> f32 {
  return tex_sample(t0, uv, P.wrap, P.filt).x;
}
fn shade(uv: vec2f) -> vec4f {
#if OUT == 0
  return vec4f(ta(uv) * P.out_gain, 0.0, 0.0, 1.0);
#else
  let e = 1.0 / P.sim_res;
  let gx = (ta(uv + vec2f(e.x, 0.0)) - ta(uv - vec2f(e.x, 0.0))) * 0.5 / e.x;
  let gy = (ta(uv + vec2f(0.0, e.y)) - ta(uv - vec2f(0.0, e.y))) * 0.5 / e.y;
  return vec4f(-gx * P.out_flux * 0.01, -gy * P.out_flux * 0.01, 0.0, 1.0);
#endif
}
