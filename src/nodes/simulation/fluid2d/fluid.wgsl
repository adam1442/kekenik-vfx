// Fluid 2D solver passes. ONE file, ONE entry (`fs_main`, raw mode), the pass is chosen with `#define PASS n`.
// Every pass renders ONE render target with fragment shading and reads its inputs with textureLoad ONLY (works for
// r32float / rgba32float / rgba16float, no filtering features needed). Bindings are generated: F (Frame), P (Params), t0.. (textures).
//
// STATE (two textures, rgba16float or rgba32float):
//   A = (vx, vy, density, temperature)    velocity in TILE FRACTIONS / SECOND (the Vector pin unit)
//   B = (fuel, soot, pressure, obstacle_prev)
// Inside the projection velocities are converted to "cells per step": u_cells = v * n * dt.
//
// PASS ids and texture bindings:
//  0 ADV      t0 src  t1 vel(A)  t2 R0  t3 R1  t4 obstacle      advection stage P.adv_stage (0 forward SL, 1 backward SL, 2 MacCormack correction + clamp)
//  1 FORCES   t0 A  t1 B  t2 obstacle  t3 vel emit  t4 force field   gravity, wind, buoyancy, turbulence, swirl, drag, emitters' velocity
//  2 CURL     t0 A                                              r32float vorticity
//  3 CONF     t0 A  t1 curl                                     vorticity confinement
//  4 DIFF     t0 A(iterate)  t1 A0                              Jacobi step of the viscous diffusion
//  5 DIV      t0 A  t1 B  t2 obstacle                           divergence (minus expansion source) in cells / step
//  6 RED      t0 src  t1 src2                                   8x8 block reduction (P.red_op: 0 sum, 1 max, 2 dot, 3 max |v| of A)
//  7 SUBMEAN  t0 field  t1 sum(1x1)                             remove the mean (compatibility of the Neumann / periodic problem)
//  8 JAC      t0 p  t1 rhs  t2 obstacle                         Jacobi sweep
//  9 GS       t0 p  t1 rhs  t2 obstacle                         red-black Gauss-Seidel half sweep (P.rb_color)
// 10 RESID    t0 p  t1 rhs  t2 obstacle                         residual rhs - L p
// 11 RESTR    t0 fine residual                                  2x2 average * P.rhs_scale (coarse rhs)
// 12 PROLONG  t0 p_fine  t1 e_coarse                            p += bilinear(e)
// 13 GRAD     t0 A  t1 p  t2 obstacle  t3 B                     u -= grad p, solid cells get the obstacle velocity
// 14 CA       t0 A  t1 B  t2 density emit  t3 temperature emit  t4 kill  t5 obstacle    density / temperature update
// 15 CB       t0 A  t1 B  t2 fuel emit  t3 pressure  t4 obstacle  t5 kill               fuel / soot update, stores pressure + obstacle
// 16 AXPY     t0 x  t1 y  t2 scalar(1x1)                        op 0: x + sgn*s*y ; op 1: y + s*x
// 17 SCAL     t0 a(1x1)  t1 b(1x1)                              a / b (guarded)
// 18 MATVEC   t0 p  t1 obstacle                                 A p = -L p (SPD) for the conjugate gradient
// 19 NEG      t0                                                sgn * t0
// 20 ZERO
// 21 INITA    t0 initial density  t1 initial velocity           state A at reset
// 22 BLEND    t0 a  t1 b                                        loop cross-fade of a state texture (P.blend_vec: xy as a vector)


fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn h01(v: u32) -> f32 {
  return f32(pcg(v) >> 8u) / 16777216.0;
}

fn dims(t: texture_2d<f32>) -> vec2i {
  return vec2i(textureDimensions(t));
}
fn wrap_p(p: vec2i, n: vec2i) -> vec2i {
  if (P.bmode == 2u) {
    return vec2i(((p.x % n.x) + n.x) % n.x, ((p.y % n.y) + n.y) % n.y);
  }
  return clamp(p, vec2i(0), n - vec2i(1));
}
fn outside(p: vec2i, n: vec2i) -> bool {
  return p.x < 0 || p.y < 0 || p.x >= n.x || p.y >= n.y;
}
fn ld(t: texture_2d<f32>, p: vec2i) -> vec4f {
  return textureLoad(t, wrap_p(p, dims(t)), 0);
}
// bilinear sample, `pc` in cell coordinates (cell centres at integer + 0.5)
fn bil(t: texture_2d<f32>, pc: vec2f) -> vec4f {
  let n = dims(t);
  let q = pc - vec2f(0.5);
  let i0 = vec2i(floor(q));
  let f = q - vec2f(i0);
  let a = textureLoad(t, wrap_p(i0, n), 0);
  let b = textureLoad(t, wrap_p(i0 + vec2i(1, 0), n), 0);
  let c = textureLoad(t, wrap_p(i0 + vec2i(0, 1), n), 0);
  let d = textureLoad(t, wrap_p(i0 + vec2i(1, 1), n), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
fn samp_uv(t: texture_2d<f32>, uv: vec2f) -> vec4f {
  return bil(t, uv * vec2f(dims(t)));
}

// ---- obstacle -----------------------------------------------------------------------------------------------------
fn has_flag(bit: u32) -> bool {
  return (P.flags & (1u << bit)) != 0u;
}
// obstacle mask at a SIM cell (any texture size: nearest texel of the input), 1 = solid
fn solid_at(t: texture_2d<f32>, p: vec2i, n: vec2i) -> bool {
  if (!has_flag(4u)) { return false; }
  let q = wrap_p(p, n);
  let uv = (vec2f(q) + vec2f(0.5)) / vec2f(n);
  let m = textureLoad(t, clamp(vec2i(uv * vec2f(dims(t))), vec2i(0), dims(t) - vec2i(1)), 0).r;
  return m > 0.5;
}
fn solid_val(t: texture_2d<f32>, p: vec2i, n: vec2i) -> f32 {
  return select(0.0, 1.0, solid_at(t, p, n));
}
// obstacle velocity (tile / s) from the frame difference (normal-flow estimate); prev = B.w of the same cell
fn obst_vel(t: texture_2d<f32>, tb: texture_2d<f32>, p: vec2i, n: vec2i) -> vec2f {
  if (!has_flag(4u) || P.obst_move == 0u) { return vec2f(0.0); }
  let m = solid_val(t, p, n);
  let mp = ld(tb, p).w;
  let gx = 0.5 * (solid_val(t, p + vec2i(1, 0), n) - solid_val(t, p - vec2i(1, 0), n)) * f32(n.x);
  let gy = 0.5 * (solid_val(t, p + vec2i(0, 1), n) - solid_val(t, p - vec2i(0, 1), n)) * f32(n.y);
  let g = vec2f(gx, gy);
  let dm = (m - mp) / max(P.dt_frame, 1e-6);
  let v = -0.5 * dm * g / (dot(g, g) + 1e-3);
  let l = length(v);
  return select(v, v * (P.vmax / l), l > P.vmax);
}

// ---- built-in emitters ---------------------------------------------------------------------------------------------
// em_a = (x, y, radius / half width, half height)   em_b = (shape, density, temperature, fuel)   em_c = (vx, vy, noise amount, noise scale)
// em_d = (softness, active, x2, y2)                 em_e = (expansion, 0, 0, 0)       shape: 0 circle, 1 rect, 2 line
fn snoise(p: vec2f, t: f32) -> f32 {
  // periodic value-noise substitute: 4 sines with integer wave numbers (tileable in x, y) and integer time harmonics (loopable)
  var s = 0.0;
  for (var i = 0u; i < 4u; i = i + 1u) {
    let h = P.seed * 17u + i * 5u;
    let k = vec2f(floor(1.0 + 3.0 * h01(h + 1u)) * select(-1.0, 1.0, h01(h + 2u) > 0.5), floor(1.0 + 3.0 * h01(h + 3u)) * select(-1.0, 1.0, h01(h + 4u) > 0.5));
    s = s + sin(TAU * dot(k, p) + TAU * h01(h + 5u) + P.turb_omega * f32(i + 1u) * t);
  }
  return 0.5 + 0.25 * s;
}
fn mdist(a: vec2f, b: vec2f) -> vec2f {
  var d = a - b;
  if (P.bmode == 2u) { d = d - round(d); }
  return d;
}
fn em_mask(i: u32, uv: vec2f) -> f32 {
  let d4 = P.em_d[i];
  if (d4.y < 0.5) { return 0.0; }
  let a = P.em_a[i];
  let shape = P.em_b[i].x;
  let asp = F.res.x / F.res.y;
  let q = mdist(uv, a.xy) * vec2f(asp, 1.0);
  let soft = clamp(d4.x, 0.001, 1.0);
  var m = 0.0;
  if (shape < 1.5 && shape > 0.5) {
    // rectangle: half size (a.z, a.w) in tile fractions
    let e = abs(q) - vec2f(a.z * asp, a.w);
    let dist = length(max(e, vec2f(0.0))) + min(max(e.x, e.y), 0.0);
    let edge = max(soft * min(a.z * asp, a.w), 1e-4);
    m = 1.0 - smoothstep(-edge, 0.0, dist);
  } else {
    var dist = length(q);
    if (shape > 1.5) {
      // line from (x, y) to (x2, y2), thickness radius a.z
      let ab = mdist(d4.zw, a.xy) * vec2f(asp, 1.0);
      let tt = clamp(dot(q, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
      dist = length(q - ab * tt);
    }
    let r = max(a.z, 1e-4);
    m = 1.0 - smoothstep(r * (1.0 - soft), r, dist);
  }
  let nz = P.em_c[i];
  if (nz.z > 0.0) { m = m * mix(1.0, snoise(uv * max(nz.w, 1.0), P.time), nz.z); }
  return clamp(m, 0.0, 1.0);
}

// ---- combustion (shared by DIV / CA / CB: they must agree) ---------------------------------------------------------
fn ignite(t: f32) -> f32 {
  return clamp((t - P.comb.x) / max(0.1 * abs(P.comb.x), 0.02), 0.0, 1.0);
}
fn react_rate(fuel: f32, t: f32) -> f32 {
  return P.comb.y * max(fuel, 0.0) * ignite(t);
}

// ---- curl noise (analytic divergence-free, periodic in x/y, loopable in time) -------------------------------------
fn curl_noise(uv: vec2f, t: f32, scale: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var m = 0u; m < 12u; m = m + 1u) {
    let oct = m / 6u;
    let s = P.seed * 131u + m * 7u;
    let sc = scale * (1.0 + f32(oct));
    let ang = TAU * h01(s + 1u);
    let mag = max(1.0, round(sc * (0.5 + 0.5 * h01(s + 2u))));
    var k = vec2f(round(mag * cos(ang)), round(mag * sin(ang)));
    if (k.x == 0.0 && k.y == 0.0) { k = vec2f(1.0, 0.0); }
    let ph = TAU * h01(s + 3u);
    let mt = f32(i32(h01(s + 4u) * 5.0) - 2);
    let arg = TAU * dot(k, uv) + ph + P.turb_omega * mt * t;
    let amp = select(1.0, 0.5, oct == 1u) / (mag * TAU);
    g = g + amp * cos(arg) * TAU * k;
  }
  // velocity = (dpsi/dy, -dpsi/dx), normalised to roughly unit RMS
  return vec2f(g.y, -g.x) * 0.5;
}

// ---- neighbour rules for the pressure Poisson equation -------------------------------------------------------------
// Returns the pressure of neighbour `q` of the centre cell `c` (value pc); `sub` counts neighbours replaced by the centre (Neumann).
var<private> nsub: f32;
fn p_nb(tp: texture_2d<f32>, to: texture_2d<f32>, q: vec2i, pc: f32, n: vec2i) -> f32 {
  if (outside(q, n)) {
    if (P.bmode == 2u) { return textureLoad(tp, wrap_p(q, n), 0).r; }
    if (P.bmode == 0u) { nsub = nsub + 1.0; return pc; }
    return 0.0;                                  // open: Dirichlet p = 0 outside
  }
  if (P.use_obst == 1u && solid_at(to, q, n)) { nsub = nsub + 1.0; return pc; }
  return textureLoad(tp, q, 0).r;
}
fn is_solid_c(to: texture_2d<f32>, c: vec2i, n: vec2i) -> bool {
  return P.use_obst == 1u && solid_at(to, c, n);
}

#if PASS == 0
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2f(F.res);
  let x = vec2f(c) + vec2f(0.5);
  let ni = vec2i(F.res);
  let here = textureLoad(t0, c, 0);
  var res = here;
  // departure point: adv_dir = +1 backtrace (x - v dt), -1 forward (x + v dt); RK1 / RK2 / RK3
  let h = P.adv_dir * P.dt;
  let k1 = bil(t1, x).xy;
  var d = k1;
  if (P.rk == 2u) {
    d = bil(t1, x - 0.5 * h * k1 * n).xy;
  } else if (P.rk >= 3u) {
    let k2 = bil(t1, x - 0.5 * h * k1 * n).xy;
    let k3 = bil(t1, x - 0.75 * h * k2 * n).xy;
    d = (2.0 * k1 + 3.0 * k2 + 4.0 * k3) / 9.0;
  }
  let xp = x - h * d * n;
  if (P.adv_stage == 0u) {
    res = bil(t0, xp);
  } else if (P.adv_stage == 1u) {
    res = bil(t0, xp);
  } else {
    // MacCormack: R0 + 0.5 (src - R1), clamped to the min/max of the source around the departure point
    let q = xp - vec2f(0.5);
    let i0 = vec2i(floor(q));
    let a = ld(t0, i0);
    let b = ld(t0, i0 + vec2i(1, 0));
    let cc = ld(t0, i0 + vec2i(0, 1));
    let dd = ld(t0, i0 + vec2i(1, 1));
    let lo = min(min(a, b), min(cc, dd));
    let hi = max(max(a, b), max(cc, dd));
    let r0 = textureLoad(t2, c, 0);
    let r1 = textureLoad(t3, c, 0);
    res = clamp(r0 + 0.5 * P.adv_blend * (here - r1), lo, hi);
  }
  if (solid_at(t4, c, ni)) { res = vec4f(0.0); }
  if (P.adv_is_b == 1u) { res = vec4f(res.x, res.y, here.z, here.w); }   // pressure / obstacle_prev are not advected
  return res;
}
#endif

#if PASS == 1
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let ni = vec2i(F.res);
  let uv = (vec2f(c) + vec2f(0.5)) / F.res;
  let a = textureLoad(t0, c, 0);
  let b = textureLoad(t1, c, 0);
  var v = a.xy;
  let dt = P.dt;
  // gravity + wind (acceleration, tile / s^2); wind already contains the animated gust factor
  v = v + (P.gravity + P.wind) * dt;
  // buoyancy: hot and light gas rises (up = -y in image space)
  let buoy = P.buoy.x * (-a.z) + P.buoy.y * (a.w - P.buoy.z);
  v = v + vec2f(0.0, -buoy) * dt;
  // curl-noise turbulence as an acceleration field
  if (P.turb.x > 0.0) {
    v = v + curl_noise(uv, P.time, P.turb.y) * P.turb.x * dt;
  }
  // swirl / vortex source: tangential acceleration around a point
  if (P.swirl.w != 0.0) {
    let d = mdist(uv, P.swirl.xy) * vec2f(F.res.x / F.res.y, 1.0);
    let r = max(P.swirl.z, 1e-4);
    let fall = exp(-dot(d, d) / (r * r));
    v = v + vec2f(-d.y, d.x) * (fall / r) * P.swirl.w * dt;
  }
  // built-in emitters: velocity relaxes towards the emitter velocity inside the mask
  for (var i = 0u; i < 4u; i = i + 1u) {
    let ev = P.em_c[i].xy;
    if (dot(ev, ev) > 0.0) {
      let m = em_mask(i, uv);
      v = mix(v, ev, clamp(m * dt * 12.0, 0.0, 1.0));
    }
  }
  if (has_flag(3u)) { // velocity emit pin: acceleration
    v = v + samp_uv(t3, uv).xy * P.in_gain.w * dt * 8.0;
  }
  if (has_flag(5u)) { // force field pin (added every step)
    v = v + samp_uv(t4, uv).xy * dt;
  }
  // drag + damping (exponential, step independent)
  v = v * exp(-(P.drag + P.damp) * dt);
  return vec4f(v, a.zw);
}
#endif

#if PASS == 2
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = F.res;
  let dvy_dx = (ld(t0, c + vec2i(1, 0)).y - ld(t0, c - vec2i(1, 0)).y) * 0.5 * n.x;
  let dvx_dy = (ld(t0, c + vec2i(0, 1)).x - ld(t0, c - vec2i(0, 1)).x) * 0.5 * n.y;
  return vec4f(dvy_dx - dvx_dy, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 3
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let a = textureLoad(t0, c, 0);
  let w = textureLoad(t1, c, 0).r;
  let gx = 0.5 * (abs(ld(t1, c + vec2i(1, 0)).r) - abs(ld(t1, c - vec2i(1, 0)).r));
  let gy = 0.5 * (abs(ld(t1, c + vec2i(0, 1)).r) - abs(ld(t1, c - vec2i(0, 1)).r));
  let g = vec2f(gx, gy);
  let l = length(g);
  var f = vec2f(0.0);
  if (l > 1e-6) {
    let nn = g / l;
    // acceleration (tile / s^2) = eps * h * (N x w), h = scale * cell size
    let h = P.vort_scale / max(F.res.x, F.res.y);
    f = P.vort_eps * h * vec2f(nn.y * w, -nn.x * w);
  }
  return vec4f(a.xy + f * P.dt, a.zw);
}
#endif

#if PASS == 4
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let a0 = textureLoad(t1, c, 0);
  let s = ld(t0, c + vec2i(1, 0)).xy + ld(t0, c - vec2i(1, 0)).xy + ld(t0, c + vec2i(0, 1)).xy + ld(t0, c - vec2i(0, 1)).xy;
  let k = P.visc * P.dt * F.res.x * F.res.y;
  return vec4f((a0.xy + k * s) / (1.0 + 4.0 * k), a0.zw);
}
#endif

#if PASS == 5
fn nb_vel(p: vec2i, vc: vec2f, axis: vec2f, n: vec2i) -> vec2f {
  if (outside(p, n)) {
    if (P.bmode == 2u) { return ld(t0, p).xy; }
    if (P.bmode == 0u) { return vc - axis * (2.0 * dot(vc, axis)); }     // wall: reflect the normal component
    return vc;                                                             // open: zero gradient
  }
  if (solid_at(t2, p, n)) {
    let w = obst_vel(t2, t1, p, n);
    if (P.noslip == 1u) { return 2.0 * w - vc; }
    return vc + axis * (2.0 * (dot(w, axis) - dot(vc, axis)));
  }
  return textureLoad(t0, p, 0).xy;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  if (solid_at(t2, c, n)) { return vec4f(0.0); }
  let a = textureLoad(t0, c, 0);
  let vc = a.xy;
  let r = nb_vel(c + vec2i(1, 0), vc, vec2f(1.0, 0.0), n);
  let l = nb_vel(c - vec2i(1, 0), vc, vec2f(-1.0, 0.0), n);
  let u = nb_vel(c + vec2i(0, 1), vc, vec2f(0.0, 1.0), n);
  let d = nb_vel(c - vec2i(0, 1), vc, vec2f(0.0, -1.0), n);
  let s = vec2f(F.res) * P.dt;                   // tile / s -> cells / step
  var div = 0.5 * ((r.x - l.x) * s.x + (u.y - d.y) * s.y);
  let b = textureLoad(t1, c, 0);
  var src = P.comb.w * react_rate(b.x, a.w) * P.dt;
  let uv = (vec2f(c) + vec2f(0.5)) / F.res;
  for (var i = 0u; i < 4u; i = i + 1u) {
    let ex = P.em_e[i].x;
    if (ex != 0.0) { src = src + em_mask(i, uv) * ex * P.dt; }
  }
  return vec4f(div - src, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 6
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let o = vec2i(in.pos.xy) * 8;
  let n = dims(t0);
  var acc = 0.0;
  for (var j = 0; j < 8; j = j + 1) {
    for (var i = 0; i < 8; i = i + 1) {
      let p = o + vec2i(i, j);
      if (p.x >= n.x || p.y >= n.y) { continue; }
      let v = textureLoad(t0, p, 0);
      if (P.red_op == 0u) { acc = acc + v.r; }
      else if (P.red_op == 1u) { acc = max(acc, v.r); }
      else if (P.red_op == 2u) { acc = acc + v.r * textureLoad(t1, p, 0).r; }
      else { acc = max(acc, length(v.xy)); }
    }
  }
  return vec4f(acc, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 7
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let s = textureLoad(t1, vec2i(0, 0), 0).r;
  let cnt = F.res.x * F.res.y;
  return vec4f(textureLoad(t0, c, 0).r - s / cnt, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 8 || PASS == 9 || PASS == 10
fn gather(c: vec2i, n: vec2i, pc: f32) -> f32 {
  nsub = 0.0;
  return p_nb(t0, t2, c + vec2i(1, 0), pc, n) + p_nb(t0, t2, c - vec2i(1, 0), pc, n) + p_nb(t0, t2, c + vec2i(0, 1), pc, n) + p_nb(t0, t2, c - vec2i(0, 1), pc, n);
}
#endif

#if PASS == 8
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  if (is_solid_c(t2, c, n)) { return vec4f(0.0); }
  let pc = textureLoad(t0, c, 0).r;
  let s = gather(c, n, pc);
  let dg = 4.0 - nsub;
  let rhs = textureLoad(t1, c, 0).r;
  return vec4f(select(0.0, (s - nsub * pc - rhs) / dg, dg > 0.5), 0.0, 0.0, 0.0);
}
#endif

#if PASS == 9
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  let pc = textureLoad(t0, c, 0).r;
  if (is_solid_c(t2, c, n)) { return vec4f(0.0); }
  if (u32((c.x + c.y) & 1) != P.rb_color) { return vec4f(pc, 0.0, 0.0, 0.0); }
  let s = gather(c, n, pc);
  let dg = 4.0 - nsub;
  let rhs = textureLoad(t1, c, 0).r;
  return vec4f(select(0.0, (s - nsub * pc - rhs) / dg, dg > 0.5), 0.0, 0.0, 0.0);
}
#endif

#if PASS == 10
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  if (is_solid_c(t2, c, n)) { return vec4f(0.0); }
  let pc = textureLoad(t0, c, 0).r;
  let s = gather(c, n, pc);
  let rhs = textureLoad(t1, c, 0).r;
  return vec4f(rhs - (s - 4.0 * pc), 0.0, 0.0, 0.0);
}
#endif

#if PASS == 11
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let o = vec2i(in.pos.xy) * 2;
  let nf = dims(t0);
  let q = clamp(o, vec2i(0), nf - vec2i(1));
  let q1 = clamp(o + vec2i(1), vec2i(0), nf - vec2i(1));
  let s = textureLoad(t0, q, 0).r + textureLoad(t0, vec2i(q1.x, q.y), 0).r + textureLoad(t0, vec2i(q.x, q1.y), 0).r + textureLoad(t0, q1, 0).r;
  return vec4f(0.25 * s * P.rhs_scale, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 12
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let e = bil(t1, (vec2f(c) + vec2f(0.5)) * 0.5).r;
  return vec4f(textureLoad(t0, c, 0).r + e, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 13
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  let a = textureLoad(t0, c, 0);
  if (solid_at(t2, c, n)) { return vec4f(obst_vel(t2, t3, c, n), 0.0, 0.0); }
  let pc = textureLoad(t1, c, 0).r;
  nsub = 0.0;
  let pr = p_nb(t1, t2, c + vec2i(1, 0), pc, n);
  let pl = p_nb(t1, t2, c - vec2i(1, 0), pc, n);
  let pu = p_nb(t1, t2, c + vec2i(0, 1), pc, n);
  let pd = p_nb(t1, t2, c - vec2i(0, 1), pc, n);
  let s = vec2f(F.res) * P.dt;
  var v = a.xy - 0.5 * vec2f(pr - pl, pu - pd) / s;
  if (P.bmode == 0u) {                                   // closed domain: no flow through the walls
    if (c.x == 0 || c.x == n.x - 1) { v.x = 0.0; }
    if (c.y == 0 || c.y == n.y - 1) { v.y = 0.0; }
  }
  return vec4f(v, a.zw);
}
#endif

#if PASS == 14
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  let uv = (vec2f(c) + vec2f(0.5)) / F.res;
  let a = textureLoad(t0, c, 0);
  let b = textureLoad(t1, c, 0);
  if (solid_at(t5, c, n)) { return vec4f(a.xy, 0.0, 0.0); }
  let dt = P.dt;
  var dens = a.z;
  var temp = a.w;
  let burn = min(max(b.x, 0.0), react_rate(b.x, temp) * dt);
  temp = temp + burn * P.comb.z;                          // heat release
  dens = dens + burn * P.cool.y;                          // smoke generated by burning
  // cooling: exponential towards ambient + radiative (quadratic) term
  let dT = temp - P.buoy.z;
  temp = P.buoy.z + dT * exp(-P.cool.x * dt) - P.cool.z * dT * abs(dT) * dt;
  // emission (amount per second): built-in emitters, then the pins
  for (var i = 0u; i < 4u; i = i + 1u) {
    let m = em_mask(i, uv);
    dens = dens + m * P.em_b[i].y * dt;
    temp = temp + m * P.em_b[i].z * dt;
  }
  if (has_flag(0u)) { dens = dens + samp_uv(t2, uv).r * P.in_gain.x * dt; }
  if (has_flag(1u)) { temp = temp + samp_uv(t3, uv).r * P.in_gain.y * dt; }
  // dissipation per second
  dens = dens * exp(-P.diss.x * dt);
  temp = temp * exp(-P.diss.y * dt);
  let kill = select(0.0, samp_uv(t4, uv).r, has_flag(6u));
  dens = dens * (1.0 - kill);
  temp = temp * (1.0 - kill);
  dens = clamp(dens, 0.0, P.cmax.x);
  temp = clamp(temp, min(P.buoy.z, 0.0), P.cmax.y);
  var v = a.xy * exp(-P.diss.w * dt);
  let vl = length(v);
  if (vl > P.cmax.w) { v = v * (P.cmax.w / vl); }          // deterministic CFL / safety limiter on the speed
  return vec4f(v, dens, temp);
}
#endif

#if PASS == 15
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  let uv = (vec2f(c) + vec2f(0.5)) / F.res;
  let a = textureLoad(t0, c, 0);
  let b = textureLoad(t1, c, 0);
  let p = textureLoad(t3, c, 0).r;
  let ob = solid_val(t4, c, n);
  if (ob > 0.5) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let dt = P.dt;
  var fuel = b.x;
  var soot = b.y;
  let burn = min(max(fuel, 0.0), react_rate(fuel, a.w) * dt);
  fuel = fuel - burn;
  soot = soot + burn * P.cool.w;
  for (var i = 0u; i < 4u; i = i + 1u) {
    fuel = fuel + em_mask(i, uv) * P.em_b[i].w * dt;
  }
  if (has_flag(2u)) { fuel = fuel + samp_uv(t2, uv).r * P.in_gain.z * dt; }
  fuel = fuel * exp(-P.diss.z * dt);
  soot = soot * exp(-P.soot_decay * dt);
  let kill = select(0.0, samp_uv(t5, uv).r, has_flag(6u));
  fuel = fuel * (1.0 - kill);
  soot = soot * (1.0 - kill);
  return vec4f(clamp(fuel, 0.0, P.cmax.z), clamp(soot, 0.0, P.cmax.x), p, ob);
}
#endif

#if PASS == 16
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let s = textureLoad(t2, vec2i(0, 0), 0).r;
  let x = textureLoad(t0, c, 0).r;
  let y = textureLoad(t1, c, 0).r;
  if (P.op == 0u) { return vec4f(x + P.sgn * s * y, 0.0, 0.0, 0.0); }
  return vec4f(y + s * x, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 17
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let a = textureLoad(t0, vec2i(0, 0), 0).r;
  let b = textureLoad(t1, vec2i(0, 0), 0).r;
  return vec4f(select(0.0, a / b, abs(b) > 1e-30), 0.0, 0.0, 0.0);
}
#endif

#if PASS == 18
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2i(F.res);
  let pc = textureLoad(t0, c, 0).r;
  if (is_solid_c(t1, c, n)) { return vec4f(pc, 0.0, 0.0, 0.0); }
  nsub = 0.0;
  let s = p_nb(t0, t1, c + vec2i(1, 0), pc, n) + p_nb(t0, t1, c - vec2i(1, 0), pc, n) + p_nb(t0, t1, c + vec2i(0, 1), pc, n) + p_nb(t0, t1, c - vec2i(0, 1), pc, n);
  return vec4f(4.0 * pc - s, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 19
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  return vec4f(P.sgn * textureLoad(t0, vec2i(in.pos.xy), 0).r, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 20
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  return vec4f(0.0);
}
#endif

#if PASS == 21
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let uv = (in.pos.xy) / F.res;
  var dens = 0.0;
  var vel = vec2f(0.0);
  if (has_flag(0u)) { dens = samp_uv(t0, uv).r * P.in_gain.x; }
  if (has_flag(7u)) { vel = samp_uv(t1, uv).xy; }
  return vec4f(vel, dens, P.buoy.z + dens * P.init_temp);
}
#endif

#if PASS == 22
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let a = textureLoad(t0, c, 0);
  let b = textureLoad(t1, c, 0);
  let w = P.blend_w;
  var r = mix(a, b, w);
  if (P.blend_vec == 1u) {
    let m = r.xy;
    let ml = length(m);
    let mag = mix(length(a.xy), length(b.xy), w);
    if (ml > 1e-9) { r = vec4f(m / ml * mag, r.zw); }
  }
  return r;
}
#endif

#if PASS == 23
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  return vec4f(textureLoad(t0, vec2i(in.pos.xy), 0).z, 0.0, 0.0, 0.0);
}
#endif

#if PASS == 24
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  return vec4f(1.0);
}
#endif
