// uv.from_grayscale — height gradient -> warp. Sobel (8-neighbour) gradient over radius `e` (bilinear taps, wrap by Tiling):
//   g = height change over distance e;  slope = g / e (height per tile width).
// mode 0 slope: delta = slope * strength * dirsign;  mode 1 normalized: unit direction * strength (fades in below `flat`).
// dirsign: downhill = content moves down the slope (lookup uphill, +gradient), uphill = the reverse. `rotate` turns the vector
// (90 deg = along contour lines). Output is divided by aspect so strength is a fraction of the smaller side.
#include "util"
#include "uvfield"

fn h_at(uv: vec2f) -> f32 {
  return tex_linear(t0, uv, F.tile).r;
}

fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let e = max(P.radius, 0.5 / min(F.full_res.x, F.full_res.y));
  let ex = vec2f(e, 0.0) / asp;
  let ey = vec2f(0.0, e) / asp;
  let tl = h_at(uv - ex - ey);
  let tc = h_at(uv - ey);
  let tr = h_at(uv + ex - ey);
  let ml = h_at(uv - ex);
  let mr = h_at(uv + ex);
  let bl = h_at(uv - ex + ey);
  let bc = h_at(uv + ey);
  let br = h_at(uv + ex + ey);
  var g = vec2f((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl), (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)) * 0.125;
  let ms = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  let s = modulate(P.strength, ms, P.strength_mod_k);
  let c = cos(P.rot);
  let sn = sin(P.rot);
  g = vec2f(c * g.x - sn * g.y, sn * g.x + c * g.y);
  var v = vec2f(0.0);
  if (P.mode == 0u) {
    v = g / e * s;
  } else {
    let l = length(g);
    v = select(vec2f(0.0), g / l, l > 0.0000001) * s * smoothstep(0.0, max(P.flat_eps, 0.000001) * e, l);
  }
  let sign_dir = select(1.0, -1.0, P.uphill == 1u);
  return uvf_pack(v * sign_dir / asp, uv, P.uv_mode);
}
