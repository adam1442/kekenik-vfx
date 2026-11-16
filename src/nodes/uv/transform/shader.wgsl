// uv.transform — translate / rotate / scale / skew WARP FIELD. Sampling an image with this field equals running
// utils.transform with the same parameters (content moves by +translate, rotates by +rotation, scales by `scale`).
// t0 = optional UV field whose lookup coordinates are transformed (P.has_uv, mode P.uv_in). Linear part (P.minv) = row-major
// inverse of R * Skew * Scale in aspect-corrected space, computed on the CPU (transformInverse()).
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  var u = uv;
  if (P.has_uv == 1u) {
    u = uv + uvf_sample(t0, uv, F.tile, F.filter_mode, P.uv_in);
  }
  let asp = uvf_aspect(F.full_res);
  let q = (u - P.pivot - P.translate) * asp;
  let r = vec2f(P.minv.x * q.x + P.minv.y * q.y, P.minv.z * q.x + P.minv.w * q.y);
  let s = r / asp + P.pivot;
  return uvf_pack(s - uv, uv, P.uv_mode);
}
