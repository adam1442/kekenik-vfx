// Flow advection simulation, state = rgba (accumulated texture). PASS 0 init (t1 initial), PASS 1 step (t0 state, t1 vector, t2 inject).
// Semi-Lagrangian RK2 back-trace through the vector field (tile fractions / s), optional vorticity confinement of the field,
// exponential dissipation, light diffusion, injection, clamp.
#include "simgrid"
#if PASS == 0
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let uv = in.pos.xy / vec2f(P.sim_res);
  var v = vec4f(0.0);
  if (P.has_initial == 1u) { v = sg_in(t1, uv, P.periodic_b == 1u); }
  return vec4f(v.rgb, 0.0);
}
#else
fn vel(x: vec2f, per: bool) -> vec2f {
  if (P.has_vector == 0u) { return vec2f(0.0); }
  return sg_bil(t1, x / vec2f(P.sim_res) * vec2f(textureDimensions(t1)), per).xy * P.flow_scale;
}
fn curl_at(x: vec2f, per: bool) -> f32 {
  let n = vec2f(P.sim_res);
  let e = vec2f(1.0, 0.0);
  let f = vec2f(0.0, 1.0);
  return (vel(x + e, per).y - vel(x - e, per).y) * 0.5 * n.x - (vel(x + f, per).x - vel(x - f, per).x) * 0.5 * n.y;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let per = P.periodic_b == 1u;
  let n = vec2f(P.sim_res);
  let x = vec2f(c) + vec2f(0.5);
  let uv = x / n;
  var v0 = vel(x, per);
  if (P.vorticity > 0.0 && P.has_vector == 1u) {
    let w = curl_at(x, per);
    let gx = (abs(curl_at(x + vec2f(1.0, 0.0), per)) - abs(curl_at(x - vec2f(1.0, 0.0), per))) * 0.5;
    let gy = (abs(curl_at(x + vec2f(0.0, 1.0), per)) - abs(curl_at(x - vec2f(0.0, 1.0), per))) * 0.5;
    let g = vec2f(gx, gy);
    let nn = g / max(length(g), 1e-6);
    v0 = v0 + P.vorticity * vec2f(nn.y * w, -nn.x * w) / max(n.x, n.y);
  }
  // RK2 back-trace (pixels): x_p = x - dt v(x - dt/2 v(x)) * n
  let mid = x - 0.5 * P.dt * v0 * n;
  let v1 = vel(mid, per) + (v0 - vel(x, per));
  let xp = x - P.dt * v1 * n;
  var s = sg_bil(t0, xp, per);
  if (P.diffuse > 0.0) {
    let avg = 0.25 * (sg_ld(t0, c + vec2i(1, 0), per) + sg_ld(t0, c - vec2i(1, 0), per) + sg_ld(t0, c + vec2i(0, 1), per) + sg_ld(t0, c - vec2i(0, 1), per));
    s = mix(s, avg, P.diffuse);
  }
  s = s * exp(-P.dt * P.dissipation);
  if (P.has_inject == 1u) { s = s + sg_in(t2, uv, per) * P.inject_gain * P.dt; }
  s = clamp(s, vec4f(-P.max_value), vec4f(P.max_value));
  return vec4f(s.rgb, 0.0);
}
#endif
