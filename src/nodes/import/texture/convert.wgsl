// import.texture: samples the uploaded image (t0, wrap-aware through F.tile / F.filter_mode) and writes one of the outputs.
// mode: 0 colour copy / resample, 1 gray (chan), 2 alpha, 3 normal, 4 uv.   chan: 0 luma, 1 r, 2 g, 3 b, 4 a.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let c = tex_sample(t0, uv, F.tile, F.filter_mode);
  let m = i32(P.mode + 0.5);
  if (m == 1) {
    let ch = i32(P.chan + 0.5);
    var v = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
    if (ch == 1) { v = c.r; } else if (ch == 2) { v = c.g; } else if (ch == 3) { v = c.b; } else if (ch == 4) { v = c.a; }
    return vec4f(v, 0.0, 0.0, 1.0);
  }
  if (m == 2) {
    return vec4f(c.a, 0.0, 0.0, 1.0);
  }
  if (m == 3) {
    var n = c.rgb * 2.0 - vec3f(1.0);
    if (P.flip_green > 0.5) { n.y = -n.y; }
    n = normalize(n + vec3f(0.0, 0.0, 1e-5));
    return vec4f(n * 0.5 + vec3f(0.5), 1.0);
  }
  if (m == 4) {
    if (P.uv_biased > 0.5) {
      return vec4f(uv + (c.rg - vec2f(0.5)) * 2.0 * P.uv_range, 0.0, 1.0);
    }
    return vec4f(c.rg, 0.0, 1.0);
  }
  return c;
}
