// Lightning mask: nearest segment of the bolt (aspect corrected, wrapped when tiling). t: none.
// P.segs[i] = (ax, ay, bx, by), P.wids[i] = (width a, width b, brightness, 0), full widths in UV (smaller side).
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  var core = 0.0;
  var glow = 0.0;
  for (var i = 0u; i < P.nseg; i = i + 1u) {
    let s = P.segs[i];
    let w = P.wids[i];
    let d = uvf_wrap(uv - s.xy, F.tile) * asp;
    let ab = uvf_wrap(s.zw - s.xy, F.tile) * asp;
    let t = clamp(dot(d, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
    let dist = length(d - ab * t);
    let half_w = max(mix(w.x, w.y, t) * 0.5, 1e-5);
    let x = dist / half_w;
    core = max(core, w.z * (1.0 - smoothstep(1.0 - P.softness, 1.0, x)));
    glow = max(glow, w.z * exp(-x * x * 0.05));
  }
  return vec4f(clamp(max(core, glow * P.glow), 0.0, 1.0), 0.0, 0.0, 1.0);
}
