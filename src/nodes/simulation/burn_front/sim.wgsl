// Burn front, state = (t_ign, fuse, 0, 1): t_ign = absolute ignition time in seconds (-1 = not ignited), fuse = accumulated heat 0..1.
// PASS 0 init (t1 ignite), PASS 1 step (t0 state, t1 ignite, t2 height, t3 noise, t4 wind). A cell ignites when the heat from burning
// neighbours accumulated over time reaches 1: front speed ~ P.speed tile/s, scaled by height, noise and wind alignment.
#include "simgrid"
fn ignite_at(uv: vec2f, asp: vec2f) -> bool {
  let by_circle = P.ignite_radius > 0.0 && length((uv - P.ignite_pos) * asp) < P.ignite_radius;
  return by_circle;
}
#if PASS == 0
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = vec2f(P.sim_res);
  let uv = in.pos.xy / n;
  let asp = n / min(n.x, n.y);
  var burn = ignite_at(uv, asp);
  if (P.has_ignite == 1u && sg_in(t1, uv, P.periodic_b == 1u).r > 0.5) { burn = true; }
  return vec4f(select(-1.0, 0.0, burn), select(0.0, 1.0, burn), 0.0, 1.0);
}
#else
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let per = P.periodic_b == 1u;
  let n = vec2f(P.sim_res);
  let uv = (vec2f(c) + vec2f(0.5)) / n;
  let s = textureLoad(t0, c, 0);
  if (s.x >= 0.0) { return s; }
  if (P.has_ignite == 1u && sg_in(t1, uv, per).r > 0.5) { return vec4f(P.time, 1.0, 0.0, 1.0); }
  var res = 1.0;
  if (P.has_height == 1u) { res = mix(1.0, 1.0 - clamp(sg_in(t2, uv, per).r, 0.0, 1.0) * 0.97, P.height_influence); }
  if (P.has_noise == 1u) { res = res * max(1.0 + (sg_in(t3, uv, per).r - 0.5) * 2.0 * P.noise_influence, 0.02); }
  var wind = P.wind_dir;
  if (P.has_wind == 1u) { wind = wind + sg_in(t4, uv, per).xy; }
  var acc = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      if (i == 0 && j == 0) { continue; }
      let o = vec2i(i, j);
      let sn = sg_ld(t0, c + o, per);
      if (sn.x >= 0.0 && (P.time - sn.x) <= P.burn_duration) {
        let d = normalize(vec2f(-o));
        let w = 1.0 / length(vec2f(o));
        acc = acc + w * clamp(1.0 + P.wind_gain * dot(d, wind), 0.05, 4.0);
      }
    }
  }
  let g = s.y + P.dt * P.front_speed * max(n.x, n.y) * res * acc * 0.3;
  if (g >= 1.0) { return vec4f(P.time, 1.0, 0.0, 1.0); }
  return vec4f(-1.0, g, 0.0, 1.0);
}
#endif
