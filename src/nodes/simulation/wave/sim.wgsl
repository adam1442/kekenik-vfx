// Wave simulation, state = (h, v, 0, 1). PASS 0 init (t1 initial height), PASS 1 step (t0 state, t1 obstacle, t2 impulse).
// v += dt (c^2 lap(h)); damping implicit (v / (1 + dt g)); h += dt v. Speed c is clamped so that c dt <= 0.7 cells (CFL).
// Obstacles: zero-flux walls (a solid neighbour is replaced by the centre value), solid cells are held at 0.
#include "simgrid"
#if PASS == 0
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = vec2f(P.sim_res);
  let uv = (in.pos.xy) / n;
  var h = 0.0;
  if (P.has_initial == 1u) { h = sg_in(t1, uv, P.boundary == 2u).r * P.init_scale; }
  return vec4f(h, 0.0, 0.0, 1.0);
}
#else
fn solid(uv: vec2f) -> bool {
  return P.has_obstacle == 1u && sg_in(t1, uv, P.boundary == 2u).r > 0.5;
}
fn emit(uv: vec2f, asp: vec2f, pos: vec2f, rad: f32, amp: f32, mode: u32, freq: f32, pulse: i32) -> f32 {
  let d = length(uvf_wrap2(uv - pos, P.boundary == 2u) * asp);
  let m = exp(-(d * d) / (rad * rad));
  var s = 1.0;
  if (mode == 0u) {
    s = sin(6.28318530718 * freq * P.time);
  } else {
    s = select(0.0, 1.0, P.frame < pulse);
  }
  return m * amp * s;
}
fn uvf_wrap2(d: vec2f, per: bool) -> vec2f {
  if (per) { return d - round(d); }
  return d;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let per = P.boundary == 2u;
  let n = vec2f(P.sim_res);
  let uv = (vec2f(c) + vec2f(0.5)) / n;
  let asp = n / min(n.x, n.y);
  let px = 1.0 / n;
  let s = textureLoad(t0, c, 0);
  if (solid(uv)) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let hc = s.x;
  var hr = sg_ld(t0, c + vec2i(1, 0), per).x;
  var hl = sg_ld(t0, c - vec2i(1, 0), per).x;
  var hd = sg_ld(t0, c + vec2i(0, 1), per).x;
  var hu = sg_ld(t0, c - vec2i(0, 1), per).x;
  if (solid(uv + vec2f(px.x, 0.0))) { hr = hc; }
  if (solid(uv - vec2f(px.x, 0.0))) { hl = hc; }
  if (solid(uv + vec2f(0.0, px.y))) { hd = hc; }
  if (solid(uv - vec2f(0.0, px.y))) { hu = hc; }
  let lap = hr + hl + hd + hu - 4.0 * hc;
  let cells = P.wave_speed * max(n.x, n.y);
  let ce = min(cells, 0.7 / max(P.dt, 1e-6));
  var gam = P.damping;
  if (P.boundary == 1u) {
    let e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    let w = clamp(1.0 - e / max(P.sponge, 1e-3), 0.0, 1.0);
    gam = gam + 60.0 * w * w;
  }
  var v = (s.y + P.dt * ce * ce * lap) / (1.0 + P.dt * gam);
  var h = hc + P.dt * v;
  if (P.em1_on == 1u) { h = h + P.dt * emit(uv, asp, P.em1_pos, P.em1_radius, P.em1_amp, P.em1_mode, P.em1_freq, P.em1_pulse); }
  if (P.em2_on == 1u) { h = h + P.dt * emit(uv, asp, P.em2_pos, P.em2_radius, P.em2_amp, P.em2_mode, P.em2_freq, P.em2_pulse); }
  if (P.has_impulse == 1u) { h = h + P.dt * P.impulse_gain * sg_in(t2, uv, per).r; }
  if (!(abs(h) < 1.0e6)) { h = 0.0; v = 0.0; }
  return vec4f(h, v, 0.0, 1.0);
}
#endif
