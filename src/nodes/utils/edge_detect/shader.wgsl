// utils.edge_detect — Sobel / Prewitt / Scharr / Laplacian on luminance (gray: .r). Taps are bilinear at +-width pixels,
// so width can be fractional and edges wrap when tiling. Output Gray.
#include "sampling"
#include "color"

fn lum(c: vec4f) -> f32 {
#if COLOR == 1
  return luminance(c.rgb);
#else
  return c.r;
#endif
}

fn tap(uv: vec2f, o: vec2f) -> f32 {
  return lum(tex_linear(t0, uv + o, F.tile));
}

fn shade(uv: vec2f) -> vec4f {
  let w = max(P.width * min(F.res.x, F.res.y), 0.25);
  let d = vec2f(w) / F.res;
  let tl = tap(uv, vec2f(-d.x, -d.y));
  let tc = tap(uv, vec2f(0.0, -d.y));
  let tr = tap(uv, vec2f(d.x, -d.y));
  let ml = tap(uv, vec2f(-d.x, 0.0));
  let mc = tap(uv, vec2f(0.0, 0.0));
  let mr = tap(uv, vec2f(d.x, 0.0));
  let bl = tap(uv, vec2f(-d.x, d.y));
  let bc = tap(uv, vec2f(0.0, d.y));
  let br = tap(uv, vec2f(d.x, d.y));
  var mag = 0.0;
  if (P.kind == 0u) {
    // Sobel
    let gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    let gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
    mag = length(vec2f(gx, gy)) * 0.25;
  } else if (P.kind == 1u) {
    // Prewitt
    let gx = (tr + mr + br) - (tl + ml + bl);
    let gy = (bl + bc + br) - (tl + tc + tr);
    mag = length(vec2f(gx, gy)) * (1.0 / 3.0);
  } else if (P.kind == 2u) {
    // Scharr
    let gx = (3.0 * tr + 10.0 * mr + 3.0 * br) - (3.0 * tl + 10.0 * ml + 3.0 * bl);
    let gy = (3.0 * bl + 10.0 * bc + 3.0 * br) - (3.0 * tl + 10.0 * tc + 3.0 * tr);
    mag = length(vec2f(gx, gy)) * (1.0 / 16.0);
  } else {
    // Laplacian (8-neighbour)
    mag = abs(8.0 * mc - (tl + tc + tr + ml + mr + bl + bc + br)) * (1.0 / 8.0);
  }
  var e = mag * P.intensity;
  if (P.tolerance > 0.0) {
    e = smoothstep(P.tolerance, P.tolerance + max(P.softness, 0.0001), e);
  }
  e = clamp(e, 0.0, 1.0);
  if (P.invert == 1u) {
    e = 1.0 - e;
  }
  return vec4f(e, 0.0, 0.0, 1.0);
}
