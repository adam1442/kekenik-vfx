// grayscale.starburst — N tapered rays + core + halo. t0 = optional UV map. Pixel units of the FULL image (tiled rendering safe).
// Nearest ray: ang = angle - rotation, k = round(ang / (2pi/N)), a = ang - k*step (|a| <= step/2); distance to that ray's axis = r*|sin(a)|.
#include "hash"
#include "sampling"
#include "util"


// Pixel offset from the centre; with tiling the periodic image nearest to the centre is used.
fn rel_px(p: vec2f) -> vec2f {
  var rel = p - P.center;
  if (F.tile.x == 1u) {
    rel.x = rel.x - floor(rel.x + 0.5);
  }
  if (F.tile.y == 1u) {
    rel.y = rel.y - floor(rel.y + 0.5);
  }
  return rel * F.full_res;
}

fn shade(uv: vec2f) -> vec4f {
  var puv = uv;
  if (P.has_uv == 1u) {
    puv = mix(uv, tex_sample(t0, uv, F.tile, F.filter_mode).rg, P.uv_amount);
  }
  let side = min(F.full_res.x, F.full_res.y);
  let d = rel_px(puv);
  let r = length(d);
  let rad = max(P.radius * side, 1.0);
  let n = max(P.rays, 1);
  let step_a = TAU / f32(n);
  let ang = atan2(d.y, d.x) - radians(P.rotation);
  let kf = round(ang / step_a);
  let a = ang - kf * step_a;
  let k = ((i32(kf) % n) + n) % n;
  let h = u01(hash_u(u32(k), 7u, 1u, F.seed + P.seed * 7919u));
  var len = rad * mix(1.0, 0.35 + 0.65 * h, clamp(P.length_random, 0.0, 1.0)) * max(P.twinkle, 0.0);
  if ((k & 1) == 1) {
    len = len * P.alt_scale;
  }
  len = max(len, 1.0);
  let t = clamp(r / len, 0.0, 1.0);
  let dperp = r * abs(sin(a));
  // Half width: ray_width * rad at the centre, thinning towards the tip.
  let w = max(P.ray_width * rad * pow(1.0 - t, P.taper), 0.0);
  let soft = clamp(P.softness, 0.0, 1.0);
  let across = 1.0 - smoothstep(w * (1.0 - soft) - 0.5, w + 0.5, dperp);
  let along = pow(1.0 - t, P.falloff) * select(0.0, 1.0, r < len);
  let fwd = select(0.0, 1.0, cos(a) >= 0.0);   // a single ray (n = 1) must not mirror itself
  let ray = clamp(across * along * fwd, 0.0, 1.0);

  let core = clamp(exp(-pow(r / max(P.core_size * side, 1.0), 2.0)) * P.core_glow, 0.0, 1.0);
  let halo = clamp(exp(-pow(r / max(P.halo_radius * side, 1.0), 2.0)) * P.halo, 0.0, 1.0);
  // Screen-combine so the result stays within 0..1.
  var v = 1.0 - (1.0 - max(ray, core)) * (1.0 - halo);
  v = clamp(v * P.intensity, 0.0, 1.0);
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(v, 0.0, 0.0, 1.0);
}
