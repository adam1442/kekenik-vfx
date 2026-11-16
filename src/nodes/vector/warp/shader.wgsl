// vector.warp — t0 image, t1 vector. OUT 0 warped image, OUT 1 absolute UV (uv pin).
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  var v = vec_sample(t1, uv, F.tile, F.filter_mode);
  if (P.normalize == 1u) { v = vl_norm(v); }
  let d = v * P.scale;
#if OUT == 1
  return vec4f(uv - d, 0.0, 1.0);
#else
  let g = tex_sample(t0, uv - d, F.tile, F.filter_mode);
#if COLOR == 1
  if (P.chroma > 0.0) {
    let r = tex_sample(t0, uv - d * (1.0 - P.chroma), F.tile, F.filter_mode).r;
    let b = tex_sample(t0, uv - d * (1.0 + P.chroma), F.tile, F.filter_mode).b;
    return vec4f(r, g.g, b, g.a);
  }
#endif
  return g;
#endif
}
