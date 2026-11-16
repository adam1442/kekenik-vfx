// uv.spline — flow ALONG up to four splines (tables built by grayscale/spline/stroke.ts: pts[i] = (x, y, half width, t),
// ranges[s] = (start, count, closed), bbox[s]). The nearest capsule segment gives the tangent; inside the half width the
// flow is full strength, then it fades over `soft * half width` with the chosen falloff. mode 0 = along the spline
// (content moves in the direction of the spline), 1 = away from the spine, 2 = towards it. strength > 0 as described, `reverse` flips.
// Positions are scaled by the aspect so distances are isotropic. Tiling copies / bbox culling as in grayscale.spline. t0 = strength mod.
#include "util"
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let q = uv * asp;
  var best_sd = 1.0e9;
  var best_hw = 0.0;
  var best_d = 0.0;
  var best_tan = vec2f(1.0, 0.0);
  var best_away = vec2f(0.0, 1.0);
  for (var s = 0; s < 4; s = s + 1) {
    let cnt = i32(P.ranges[s].y);
    if (cnt < 2) {
      continue;
    }
    let start = i32(P.ranges[s].x);
    let closed = P.ranges[s].z > 0.5;
    let bb = P.bbox[s];
    for (var oy = P.oy0; oy <= P.oy1; oy = oy + 1) {
      for (var ox = P.ox0; ox <= P.ox1; ox = ox + 1) {
        let off = vec2f(f32(ox), f32(oy));
        if (uv.x < bb.x + off.x || uv.x > bb.z + off.x || uv.y < bb.y + off.y || uv.y > bb.w + off.y) {
          continue;
        }
        for (var i = 0; i < cnt - 1; i = i + 1) {
          let A = P.pts[start + i];
          let B = P.pts[start + i + 1];
          let a = (A.xy + off) * asp;
          let b = (B.xy + off) * asp;
          let ba = b - a;
          let len2 = dot(ba, ba);
          let len = sqrt(len2);
          let tt = select(0.0, dot(q - a, ba) / len2, len2 > 0.000000000001);
          let first = (i == 0) && !closed;
          let last = (i == cnt - 2) && !closed;
          var tc = clamp(tt, 0.0, 1.0);
          if ((first && tt < 0.0) || (last && tt > 1.0)) {
            tc = clamp(tt, 0.0, 1.0);
          }
          let c = a + ba * tc;
          let d = length(q - c);
          let hw = mix(A.z, B.z, tc);
          let sd = d - hw;
          if (sd < best_sd) {
            best_sd = sd;
            best_hw = hw;
            best_d = d;
            best_tan = select(vec2f(1.0, 0.0), ba / len, len > 0.0000001);
            best_away = select(vec2f(0.0, 1.0), (q - c) / d, d > 0.0000001);
          }
        }
      }
    }
  }
  if (best_sd > 1.0e8) {
    return uvf_pack(vec2f(0.0), uv, P.uv_mode);
  }
  let px = 1.0 / min(F.full_res.x, F.full_res.y);
  let ms = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let s = modulate(P.strength, ms, P.strength_mod_k);
  let ext = max(P.soft * best_hw, px);
  let t = 1.0 - clamp((best_d - best_hw) / ext, 0.0, 1.0);
  let f = uvf_falloff(t, P.falloff);
  var dir = best_tan;
  if (P.mode == 1u) {
    dir = best_away;
  } else if (P.mode == 2u) {
    dir = -best_away;
  }
  if (P.reverse_dir == 1u) {
    dir = -dir;
  }
  return uvf_pack(-dir * s * f / asp, uv, P.uv_mode);
}
