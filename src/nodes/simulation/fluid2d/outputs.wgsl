// Fluid 2D output passes (shade mode). One variant per output pin: `#define OUT n`.
// t0 = state A (vx, vy, density, temperature)   t1 = state B (fuel, soot, pressure, obstacle_prev)
// The simulation grid is resampled with the quality filter P.filt (0 point, 1 linear, 2 cubic) through textureLoad, wrapping when P.wrap.
//  0 density  1 temperature  2 fuel  3 velocity (Vector)  4 pressure  5 divergence  6 curl  7 smoke colour  8 fire mask
//  9 motion vectors (Vector, tile fractions / frame)  10 normal (density height field)  11 soot
#include "sampling"

fn sa(uv: vec2f) -> vec4f {
  return tex_sample(t0, uv, P.wrap, P.filt);
}
fn sb(uv: vec2f) -> vec4f {
  return tex_sample(t1, uv, P.wrap, P.filt);
}

fn bb_ramp(t: f32) -> vec3f {
  // black-body-like ramp: black -> deep red -> orange -> yellow -> white
  let x = clamp(t, 0.0, 1.5);
  let r = smoothstep(0.0, 0.3, x);
  let g = smoothstep(0.25, 0.8, x) * 0.9;
  let b = smoothstep(0.7, 1.4, x) * 0.85;
  return vec3f(r, g, b) * (0.5 + x);
}

fn shade(uv: vec2f) -> vec4f {
  let px = 1.0 / vec2f(P.sim_res);
#if OUT == 0
  return vec4f(sa(uv).z * P.gain, 0.0, 0.0, 1.0);
#elif OUT == 1
  return vec4f(sa(uv).w * P.gain, 0.0, 0.0, 1.0);
#elif OUT == 2
  return vec4f(sb(uv).x * P.gain, 0.0, 0.0, 1.0);
#elif OUT == 3
  let v = sa(uv).xy;
  return vec4f(v, 0.0, 1.0);
#elif OUT == 4
  return vec4f(sb(uv).z * P.gain, 0.0, 0.0, 1.0);
#elif OUT == 5
  let r = sa(uv + vec2f(px.x, 0.0)).x;
  let l = sa(uv - vec2f(px.x, 0.0)).x;
  let u = sa(uv + vec2f(0.0, px.y)).y;
  let d = sa(uv - vec2f(0.0, px.y)).y;
  return vec4f(((r - l) * 0.5 / px.x + (u - d) * 0.5 / px.y) * P.gain, 0.0, 0.0, 1.0);
#elif OUT == 6
  let r = sa(uv + vec2f(px.x, 0.0)).y;
  let l = sa(uv - vec2f(px.x, 0.0)).y;
  let u = sa(uv + vec2f(0.0, px.y)).x;
  let d = sa(uv - vec2f(0.0, px.y)).x;
  return vec4f(((r - l) * 0.5 / px.x - (u - d) * 0.5 / px.y) * P.gain, 0.0, 0.0, 1.0);
#elif OUT == 7
  let a = sa(uv);
  let b = sb(uv);
  let dens = max(a.z, 0.0);
  let alpha = 1.0 - exp(-dens * P.opacity);
  // smoke: tinted, darkened by soot; fire: black-body emission from the temperature
  let smoke = P.smoke_color.rgb * (1.0 - clamp(b.y * P.soot_dark, 0.0, 0.9));
  let fire = bb_ramp(a.w * P.temp_scale) * P.fire_gain;
  let fa = clamp(dot(fire, vec3f(0.33)), 0.0, 1.0);
  let rgb = smoke * alpha * (1.0 - fa) + fire;
  return vec4f(rgb, clamp(max(alpha, fa), 0.0, 1.0));
#elif OUT == 8
  return vec4f(smoothstep(P.fire_lo, P.fire_hi, sa(uv).w), 0.0, 0.0, 1.0);
#elif OUT == 9
  return vec4f(sa(uv).xy / max(P.fps, 1e-3), 0.0, 1.0);
#elif OUT == 10
  let hx = sa(uv + vec2f(px.x, 0.0)).z - sa(uv - vec2f(px.x, 0.0)).z;
  let hy = sa(uv + vec2f(0.0, px.y)).z - sa(uv - vec2f(0.0, px.y)).z;
  let n = normalize(vec3f(-hx * P.gain, -hy * P.gain, 1.0));
  return vec4f(n * 0.5 + vec3f(0.5), 1.0);
#else
  return vec4f(sb(uv).y * P.gain, 0.0, 0.0, 1.0);
#endif
}
