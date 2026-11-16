// Burn outputs: OUT 0 front, 1 burned, 2 edge glow, 3 time to burn. t0 = state (t_ign, fuse). P.sim_time = simulated time of the shown frame.
// Point sampling of the ignition time (interpolating it across the front would invent times).
#include "sampling"
fn shade(uv: vec2f) -> vec4f {
  let s = tex_sample(t0, uv, P.wrap, 0u);
  let burning = s.x >= 0.0;
  let age = max(P.sim_time - s.x, 0.0);
#if OUT == 0
  let f = 1.0 - smoothstep(0.0, P.out_front, age);
  return vec4f(select(0.0, f, burning), 0.0, 0.0, 1.0);
#elif OUT == 1
  return vec4f(select(0.0, 1.0, burning), 0.0, 0.0, 1.0);
#elif OUT == 2
  return vec4f(select(0.0, exp(-age / max(P.out_glow, 1e-3)), burning), 0.0, 0.0, 1.0);
#else
  return vec4f(select(1.0, clamp(s.x / max(P.out_range, 1e-3), 0.0, 1.0), burning), 0.0, 0.0, 1.0);
#endif
}
