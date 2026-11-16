// vector.advect — t0 image, t1 vector (tile fractions / s), t2 strength mask. COLOR: 0 gray, 1 color. CPU mirror: advectStep() in _shared/vectorref.ts
#include "vectorlib"
fn img(p: vec2f) -> vec4f {
  return tex_sample(t0, p, F.tile, F.filter_mode);
}
fn fld(p: vec2f) -> vec2f {
  if (P.has_vector == 0u) { return vec2f(0.0); }
  return vec_sample(t1, p, F.tile, F.filter_mode);
}
fn shade(uv: vec2f) -> vec4f {
  var k = P.strength;
  if (P.has_strength_mask == 1u) { k = k * tex_sample(t2, uv, F.tile, F.filter_mode).r; }
  let sg = select(-1.0, 1.0, P.direction == 1u);
  if (P.mode == 0u) {
    return img(uv + fld(uv) * (k * sg));
  }
  if (P.mode == 1u) {
    let n = max(P.steps, 1);
    let h = k * sg / f32(n);
    var p = uv;
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= n) { break; }
      let k1 = fld(p);
      if (P.method == 0u) {
        p = p + k1 * h;
      } else if (P.method == 1u) {
        p = p + fld(p + k1 * (0.5 * h)) * h;
      } else {
        let k2 = fld(p + k1 * (0.5 * h));
        let k3 = fld(p + k2 * (0.5 * h));
        let k4 = fld(p + k3 * h);
        p = p + (k1 + 2.0 * k2 + 2.0 * k3 + k4) * (h / 6.0);
      }
    }
    return img(p);
  }
  // looping flow map: two phases half a cycle apart, triangle weights (sum = 1)
  var off = 0.0;
  if (P.scatter > 0.0) { off = (vl_potential(uv, vec2f(6.0), 2, 0.5, 0.0, 1, P.seed, F.tile) * 0.5 + 0.5) * P.scatter; }
  let ph0 = fract(P.phase + off);
  let ph1 = fract(ph0 + 0.5);
  let v = fld(uv) * (k * sg);
  let a = img(uv + v * (ph0 - 0.5));
  let b = img(uv + v * (ph1 - 0.5));
  return a * vl_tri(ph0) + b * vl_tri(ph1);
}
