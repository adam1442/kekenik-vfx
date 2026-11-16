// _shared/polar.wgsl — Cartesian <-> Polar mapping used by utils.cartesian_to_polar, utils.polar_to_cartesian and
// uv.cartesian_to_polar. Defines: MODE 0 = Cartesian -> Polar, 1 = Polar -> Cartesian; OUTPUT 0 = image
// (t0 sampled through the mapping), 1 = UV field (uv node, MODE 0 only). CPU mirror: _shared/polar.ts (polarC2P / polarP2C).
//
// Cartesian -> Polar (C2P): output pixel p -> d = (p - center) * aspect  (isotropic, units of the smaller side)
//    r_n   = metric(d) / (0.5 * scale)                      0 at the centre, 1 on the inscribed circle (scale = 1)
//    theta = atan2(d) - rotation - spiral * r_n * TAU       spiral = turns of extra twist per unit radius
//    u     = fract(theta / TAU) / aperture                   (aperture = angle / 360)
//    v     = (persp(r_n ^ 2^-pinch) - 0.5) * radial_scaling + 0.5 + radial_centering
//    out-of-range (u > 1, v outside 0..1): clamp | repeat | transparent;  then angular / radial tiling;
//    colour = source(u, v) with the overlap cross-fade (non-tiling inputs).
// Polar -> Cartesian (P2C) is the exact inverse: output (u, v) -> angle / radius -> point on the source image.
#include "sampling"
#include "uvfield"

// Perspective ("tunnel") mapping of the normalised radius: v = 1 - (1/(r+e) - 1/(1+e)) / (1/e - 1/(1+e)),
// e = 0.25 (1 - a) / a. Monotonic, 0 -> 0, 1 -> 1; small `a` is nearly linear (a < 0.02 is exactly linear).
fn persp_e() -> f32 {
  let a = clamp(P.persp, 0.02, 0.98);
  return 0.25 * (1.0 - a) / a;
}
fn persp_fwd(r: f32) -> f32 {
  if (P.persp < 0.02) {
    return r;
  }
  let e = persp_e();
  let k = 1.0 / e - 1.0 / (1.0 + e);
  return 1.0 - (1.0 / (r + e) - 1.0 / (1.0 + e)) / k;
}
fn persp_inv(v: f32) -> f32 {
  if (P.persp < 0.02) {
    return v;
  }
  let e = persp_e();
  let k = 1.0 / e - 1.0 / (1.0 + e);
  let w = max((1.0 - v) * k + 1.0 / (1.0 + e), 0.0001);
  return max(1.0 / w - e, 0.0);
}

// Distance metric: 0 Euclidean (circular), 1 Chebyshev (square), 2 squircle (p-norm with exponent P.squircle).
fn metric_dist(d: vec2f) -> f32 {
  let a = abs(d);
  if (P.metric == 1u) {
    return max(a.x, a.y);
  }
  if (P.metric == 2u) {
    let n = max(P.squircle, 1.0);
    return pow(pow(a.x, n) + pow(a.y, n), 1.0 / n);
  }
  return length(d);
}

// C2P: (u, v, out-of-range flag, 0) for a pixel position uv, BEFORE the overlap cross-fade.
fn c2p_coords(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let d = (uv - P.center) * asp;
  let rn = metric_dist(d) / (0.5 * max(P.scale, 0.0001));
  let th = atan2(d.y, d.x) - P.rotation - P.spiral * rn * TAU;
  var a = th / TAU;
  a = a - floor(a);
  var rp = pow(rn, exp2(-P.pinch));
  rp = persp_fwd(rp);
  var v = (rp - 0.5) * P.rscale + 0.5 + P.rcenter;
  var u = a / max(P.ap, 0.0001);
  var oob = 0.0;
  if (u > 1.0 || v < 0.0 || v > 1.0) {
    oob = 1.0;
  }
  if (P.oob == 1u) {
    u = u - floor(u);
    v = v - floor(v);
  } else {
    u = clamp(u, 0.0, 1.0);
    v = clamp(v, 0.0, 1.0);
  }
  if (P.ang_tiles > 1.0) {
    u = u * P.ang_tiles;
    u = u - floor(u);
  }
  if (P.rad_tiles > 1.0) {
    v = v * P.rad_tiles;
    v = v - floor(v);
  }
  return vec4f(u, v, oob, 0.0);
}

// Source lookup with the seam overlap (see header). x range used = 1 - ov, the last `ov` of the source is blended in.
fn sample_overlap(u: f32, v: f32) -> vec4f {
  let ov = clamp(P.ov_range, 0.0, 0.5);
  if (ov <= 0.0001) {
    return tex_sample(t0, vec2f(u, v), F.tile, F.filter_mode);
  }
  let per = 1.0 - ov;
  let x = u * per;
  let zw = max(ov * P.ov_scale, 0.0001);
  let c0 = tex_sample(t0, vec2f(x, v), F.tile, F.filter_mode);
  if (x >= zw) {
    return c0;
  }
  let w = smoothstep(0.0, 1.0, x / zw);
  let c1 = tex_sample(t0, vec2f(x + per, v), F.tile, F.filter_mode);
  return mix(c1, c0, w);
}

// P2C: source position (uv space) that output pixel (u, v) shows.
fn p2c_coords(uv: vec2f) -> vec2f {
  let asp = uvf_aspect(F.full_res);
  let u0 = uv.x / max(P.ang_tiles, 1.0);
  let v0 = uv.y / max(P.rad_tiles, 1.0);
  let rp = (v0 - 0.5 - P.rcenter) / P.rscale + 0.5;
  let rn = pow(max(persp_inv(rp), 0.0), exp2(P.pinch));
  let th = u0 * P.ap * TAU + P.rotation + P.spiral * rn * TAU;
  let w = vec2f(cos(th), sin(th));
  let pt = w * (rn * 0.5 * max(P.scale, 0.0001)) / max(metric_dist(w), 0.0001);
  return P.center + pt / asp;
}

fn shade(uv: vec2f) -> vec4f {
#if OUTPUT == 1
  let c = c2p_coords(uv);
  return uvf_pack(c.xy - uv, uv, P.uv_mode);
#else
#if MODE == 0
  let c = c2p_coords(uv);
  if (P.oob == 2u && c.z > 0.5) {
    return vec4f(0.0);
  }
  return sample_overlap(c.x, c.y);
#else
  let s = p2c_coords(uv);
  var tile = vec2u(0u, 0u);
  if (P.oob == 1u) {
    tile = vec2u(1u, 1u);
  }
  if (P.oob == 2u && (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0)) {
    return vec4f(0.0);
  }
  return tex_sample(t0, s, tile, F.filter_mode);
#endif
#endif
}
