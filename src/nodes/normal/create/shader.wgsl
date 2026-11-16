// normal.create — normal map from a height map. Taps at +-e pixels (bilinear, wrap by Tiling) with a 4-way central
// difference (kernel 0) or an 8-way Sobel (1) / Scharr (2) kernel, all normalised to "height change per step e":
//   slope = dh_per_step / e_iso   (e_iso = e / smaller side)   n = normalize(-sx*k, +-sy*k, 1),  k = strength * height_scale
// Image y points DOWN. OpenGL (+Y up) convention: n.y = +dh/dy_down * k; DirectX (-Y): n.y = -dh/dy_down * k.
// Output = n * 0.5 + 0.5 (encoded normal). CPU mirror: normalFromHeight() in definition.ts.
#include "util"
#include "sampling"

fn hh(uv: vec2f) -> f32 {
  let v = tex_linear(t0, uv, F.tile).r;
  return select(v, 1.0 - v, P.invert == 1u);
}

fn shade(uv: vec2f) -> vec4f {
  let res = F.full_res;
  let e_px = max(P.radius * min(res.x, res.y), 1.0);
  let step = vec2f(e_px) / res;
  let ex = vec2f(step.x, 0.0);
  let ey = vec2f(0.0, step.y);
  var g = vec2f(0.0);
  if (P.kernel == 0u) {
    g = vec2f(hh(uv + ex) - hh(uv - ex), hh(uv + ey) - hh(uv - ey)) * 0.5;
  } else {
    let tl = hh(uv - ex - ey);
    let tc = hh(uv - ey);
    let tr = hh(uv + ex - ey);
    let ml = hh(uv - ex);
    let mr = hh(uv + ex);
    let bl = hh(uv - ex + ey);
    let bc = hh(uv + ey);
    let br = hh(uv + ex + ey);
    if (P.kernel == 1u) {
      g = vec2f((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)) * 0.125;
    } else {
      g = vec2f((3.0 * tr + 10.0 * mr + 3.0 * br) - (3.0 * tl + 10.0 * ml + 3.0 * bl), (3.0 * bl + 10.0 * bc + 3.0 * br) - (3.0 * tl + 10.0 * tc + 3.0 * tr)) * 0.03125;
    }
  }
  let e_iso = e_px / min(res.x, res.y);
  let k = P.strength * P.height_scale / e_iso;
  let ys = select(1.0, -1.0, P.directx == 1u);
  let n = normalize(vec3f(-g.x * k, g.y * k * ys, 1.0));
  return vec4f(n * 0.5 + vec3f(0.5), 1.0);
}
