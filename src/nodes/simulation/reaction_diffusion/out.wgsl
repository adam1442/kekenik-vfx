// Reaction Diffusion outputs: OUT 0 A, 1 B, 2 pattern (B normalized), 3 normal of the pattern. t0 = state.
#include "sampling"
fn sa(uv: vec2f) -> vec2f {
  return tex_sample(t0, uv, P.wrap, P.filt).xy;
}
fn pat(uv: vec2f) -> f32 {
  return clamp((sa(uv).y - P.out_lo) / max(P.out_hi - P.out_lo, 1e-4), 0.0, 1.0);
}
fn shade(uv: vec2f) -> vec4f {
#if OUT == 0
  return vec4f(sa(uv).x, 0.0, 0.0, 1.0);
#elif OUT == 1
  return vec4f(sa(uv).y, 0.0, 0.0, 1.0);
#elif OUT == 2
  let p = pat(uv);
  return vec4f(p * p * (3.0 - 2.0 * p), 0.0, 0.0, 1.0);
#else
  let e = 1.0 / P.sim_res;
  let dx = pat(uv + vec2f(e.x, 0.0)) - pat(uv - vec2f(e.x, 0.0));
  let dy = pat(uv + vec2f(0.0, e.y)) - pat(uv - vec2f(0.0, e.y));
  let n = normalize(vec3f(-dx * P.out_strength, -dy * P.out_strength, 1.0));
  return vec4f(n * 0.5 + 0.5, 1.0);
#endif
}
