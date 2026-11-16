// grayscale.spline — strokes of up to four splines, evaluated as a union of capsules with a varying radius.
// Uniform tables (see stroke.ts): pts[i] = (x, y, half width, t along), ranges[s] = (start, count, closed), bbox[s] = UV box.
// Positions are scaled by `asp` (= resolution / smaller side) so distances and widths are isotropic.
// Tiling: the CPU supplies the integer image offsets (ox0..ox1, oy0..oy1) whose copies can reach [0,1]^2; each copy is
// skipped per pixel when the pixel is outside its (shifted) bounding box, so a stroke away from the border costs 1 copy.
// mode 0: mask (cross-section profile x intensity), mode 1: end-to-end gradient (t along the closest stroke).
fn shade(uv: vec2f) -> vec4f {
  let asp = F.full_res / min(F.full_res.x, F.full_res.y);
  let q = uv * asp;
  var best_sd = 1.0e9;
  var best_hw = 0.0;
  var best_d = 0.0;
  var best_t = 0.0;
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
          if (P.cap == 1u) {
            // butt: nothing beyond the end planes of an open stroke
            if ((first && tt < 0.0) || (last && tt > 1.0)) {
              continue;
            }
          } else if (P.cap == 2u && len > 0.0000001) {
            // square: extend the end segments by one half width
            let ea = select(0.0, A.z / len, first);
            let eb = select(0.0, B.z / len, last);
            tc = clamp(tt, -ea, 1.0 + eb);
          }
          let c = a + ba * tc;
          let d = length(q - c);
          let k = clamp(tc, 0.0, 1.0);
          let hw = mix(A.z, B.z, k);
          let sd = d - hw;
          if (sd < best_sd) {
            best_sd = sd;
            best_hw = hw;
            best_d = d;
            best_t = mix(A.w, B.w, k);
          }
        }
      }
    }
  }
  if (best_sd > 1.0e8) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let px = 1.0 / min(F.full_res.x, F.full_res.y);
  let edge_w = P.softness * best_hw + px;
  let cov = smoothstep(0.0, 1.0, clamp((best_hw + 0.5 * px - best_d) / edge_w, 0.0, 1.0));
  let e = clamp(best_d / max(best_hw, 0.000001), 0.0, 1.0);
  var v = cov;
  if (P.profile == 1u) {
    v = cov * sqrt(max(1.0 - e * e, 0.0));
  } else if (P.profile == 2u) {
    v = cov * (1.0 - e);
  }
  var r = v * P.intensity;
  if (P.mode == 1u) {
    r = select(0.0, best_t, cov > 0.001);
  } else if (P.invert == 1u) {
    r = 1.0 - r;
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
