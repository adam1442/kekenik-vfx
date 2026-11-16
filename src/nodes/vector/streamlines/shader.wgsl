// vector.streamlines — a pixel is on the streamline of seed S when tracing the field from the pixel (both ways) passes within `tol` of S.
// One jittered seed per grid cell (kept inside the middle half of the cell so checking the cell of the current point is exact).
#include "vectorlib"
fn fld(p: vec2f) -> vec2f {
  return vec_sample(t0, p, F.tile, F.filter_mode);
}
fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let cells = f32(max(P.density, 2));
  let n = max(P.steps, 8);
  let half_len = P.length * 0.5;
  let h = half_len / f32(n);
  let tol = min(max(P.width * 0.5, h * 0.75), 0.24 / cells);
  let per = vec3i(select(0, P.density, F.tile.x == 1u), select(0, P.density, F.tile.y == 1u), 0);
  var cover = 0.0;
  for (var d = 0; d < 2; d = d + 1) {
    let sg = select(1.0, -1.0, d == 1);
    var p = uv;
    for (var i = 0; i <= 128; i = i + 1) {
      if (i > n) { break; }
      let ic = vec2i(floor(p * cells));
      let r = lattice_rand2(vec3i(ic.x, ic.y, 0), per, P.seed);
      let sp = (vec2f(ic) + 0.5 + (r - 0.5) * 0.5 * P.jitter) / cells;
      let dist = length(uvf_wrap(p - sp, F.tile) * asp);
      if (dist < tol) {
        let s = f32(i) / f32(n);
        let edge = 1.0 - smoothstep(0.5 * tol, tol, dist);
        cover = max(cover, edge * pow(max(1.0 - s, 0.0), P.fade));
      }
      let v = fld(p);
      let l = length(v);
      if (l < 1e-6) { break; }
      let pm = p + sg * (v / l) * h * 0.5;
      p = p + sg * vl_norm(fld(pm)) * h;
    }
  }
  return vec4f(cover, 0.0, 0.0, 1.0);
}
