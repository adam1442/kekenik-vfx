// vector.lic — t0 vector, t1 optional noise. Midpoint (RK2) streamline in both directions, weighted noise average.
#include "vectorlib"
fn fld(p: vec2f) -> vec2f {
  return vec_sample(t0, p, F.tile, F.filter_mode);
}
fn nz(p: vec2f) -> f32 {
  if (P.has_noise == 1u) { return tex_sample(t1, p, F.tile, F.filter_mode).r; }
  let c = max(round(F.full_res * P.noise_cells), vec2f(2.0));
  let ip = vec2i(floor(p * c));
  let per = vec3i(select(0, i32(c.x), F.tile.x == 1u), select(0, i32(c.y), F.tile.y == 1u), 0);
  return u01(lattice_hash(vec3i(ip.x, ip.y, 0), per, P.seed));
}
fn kern(s: f32) -> f32 {
  if (P.kernel == 0u) { return 1.0; }
  if (P.kernel == 1u) { return 1.0 - s; }
  return 0.5 + 0.5 * cos(3.14159265 * s);
}
fn shade(uv: vec2f) -> vec4f {
  let n = max(P.steps, 2);
  let h = P.length / f32(n);
  var acc = nz(uv);
  var wsum = 1.0;
  for (var d = 0; d < 2; d = d + 1) {
    let sg = select(1.0, -1.0, d == 1);
    var p = uv;
    for (var i = 1; i <= 64; i = i + 1) {
      if (i > n) { break; }
      let v = fld(p);
      let l = length(v);
      if (l < 1e-6) { break; }
      let step_len = select(h * clamp(l * 4.0, 0.0, 4.0), h, P.constant_speed == 1u);
      let pm = p + sg * (v / l) * step_len * 0.5;
      let v2 = fld(pm);
      p = p + sg * vl_norm(v2) * step_len;
      let s = f32(i) / f32(n);
      var w = kern(s);
      if (P.ripple > 0.0) { w = w * (0.5 + 0.5 * cos(VL_TAU * (P.ripple * s * sg + P.phase))); }
      acc = acc + w * nz(p);
      wsum = wsum + w;
    }
  }
  let r = acc / max(wsum, 1e-4);
  return vec4f(clamp((r - 0.5) * P.contrast + 0.5, 0.0, 1.0), 0.0, 0.0, 1.0);
}
