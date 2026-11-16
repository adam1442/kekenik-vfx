// Wave outputs: OUT 0 height, 1 velocity, 2 normal (of the height). t0 = state (h, v).
#include "sampling"
fn sa(uv: vec2f) -> vec2f {
  return tex_sample(t0, uv, P.wrap, P.filt).xy;
}
fn shade(uv: vec2f) -> vec4f {
#if OUT == 0
  let h = sa(uv).x * P.out_gain;
  return vec4f(select(h, h * 0.5 + 0.5, P.out_centered == 1u), 0.0, 0.0, 1.0);
#elif OUT == 1
  let v = sa(uv).y * P.out_gain * 0.1;
  return vec4f(select(v, v * 0.5 + 0.5, P.out_centered == 1u), 0.0, 0.0, 1.0);
#else
  let e = 1.0 / P.sim_res;
  let dx = sa(uv + vec2f(e.x, 0.0)).x - sa(uv - vec2f(e.x, 0.0)).x;
  let dy = sa(uv + vec2f(0.0, e.y)).x - sa(uv - vec2f(0.0, e.y)).x;
  let n = normalize(vec3f(-dx * P.out_strength, -dy * P.out_strength, 1.0));
  return vec4f(n * 0.5 + 0.5, 1.0);
#endif
}
