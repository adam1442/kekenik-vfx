// vector.spline — nearest polyline segment (aspect corrected, wrapped when tiling): tangent / attract / shear flow with falloff.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  if (P.npts < 2u) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let asp = uvf_aspect(F.full_res);
  var best = 1e9;
  var tang = vec2f(0.0);
  var nrm = vec2f(0.0);
  var side = 0.0;
  let nseg = select(P.npts - 1u, P.npts, P.closed == 1u);
  for (var i = 0u; i < nseg; i = i + 1u) {
    let a = P.pts[i].xy;
    let b = P.pts[(i + 1u) % P.npts].xy;
    let d = uvf_wrap(uv - a, F.tile) * asp;
    let ab = uvf_wrap(b - a, F.tile) * asp;
    let l2 = max(dot(ab, ab), 1e-12);
    let t = clamp(dot(d, ab) / l2, 0.0, 1.0);
    let diff = d - ab * t;
    let dist = length(diff);
    if (dist < best) {
      best = dist;
      tang = ab / sqrt(l2);
      nrm = diff / max(dist, 1e-6);
      side = sign(ab.x * d.y - ab.y * d.x);
    }
  }
  let prof = uvf_falloff(1.0 - best / max(P.width, 1e-4), P.falloff);
  let v = tang * (P.along + P.shear * side) - nrm * P.attract;
  return vec4f(v * prof, 0.0, 1.0);
}
