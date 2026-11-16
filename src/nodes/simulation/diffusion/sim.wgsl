// Diffusion / Heat, state = (T, 0, 0, 1). PASS 0 init (t1 initial), PASS 1 step (t0 state, t1 source, t2 sink, t3 direction, t4 conductivity).
// dT = div(D grad T) in non-divergence form: Dxx Txx + 2 Dxy Txy + Dyy Tyy with D = perp I + (par - perp) t t^T (t = unit direction).
#include "simgrid"
#if PASS == 0
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let uv = in.pos.xy / vec2f(P.sim_res);
  var t = 0.0;
  if (P.has_initial == 1u) { t = sg_in(t1, uv, P.periodic_b == 1u).r * P.init_scale; }
  return vec4f(t, 0.0, 0.0, 1.0);
}
#else
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let per = P.periodic_b == 1u;
  let n = vec2f(P.sim_res);
  let uv = (vec2f(c) + vec2f(0.5)) / n;
  let tc = textureLoad(t0, c, 0).x;
  let tr = sg_ld(t0, c + vec2i(1, 0), per).x;
  let tl = sg_ld(t0, c - vec2i(1, 0), per).x;
  let td = sg_ld(t0, c + vec2i(0, 1), per).x;
  let tu = sg_ld(t0, c - vec2i(0, 1), per).x;
  var dpar = 1.0;
  var dperp = 1.0;
  var dir = vec2f(1.0, 0.0);
  if (P.has_direction == 1u) {
    let v = sg_in(t3, uv, per).xy;
    let l = length(v);
    if (l > 1e-8) { dir = v / l; }
    dpar = P.aniso_par;
    dperp = P.aniso_perp;
  }
  let dxx = dperp + (dpar - dperp) * dir.x * dir.x;
  let dyy = dperp + (dpar - dperp) * dir.y * dir.y;
  let dxy = (dpar - dperp) * dir.x * dir.y;
  let txx = tr + tl - 2.0 * tc;
  let tyy = td + tu - 2.0 * tc;
  let txy = 0.25 * (sg_ld(t0, c + vec2i(1, 1), per).x - sg_ld(t0, c + vec2i(1, -1), per).x - sg_ld(t0, c + vec2i(-1, 1), per).x + sg_ld(t0, c + vec2i(-1, -1), per).x);
  var cond = 1.0;
  if (P.has_conductivity == 1u) { cond = sg_in(t4, uv, per).r; }
  let d = P.diffusion * max(n.x, n.y) * max(n.x, n.y) * cond;
  var t = tc + P.dt * d * (dxx * txx + dyy * tyy + 2.0 * dxy * txy);
  t = t * exp(-P.dt * P.decay);
  if (P.has_source == 1u) { t = t + P.dt * P.source_gain * sg_in(t1, uv, per).r; }
  if (P.has_sink == 1u) { t = t * exp(-P.dt * P.sink_rate * sg_in(t2, uv, per).r); }
  if (!(abs(t) < 1.0e6)) { t = 0.0; }
  return vec4f(t, 0.0, 0.0, 1.0);
}
#endif
