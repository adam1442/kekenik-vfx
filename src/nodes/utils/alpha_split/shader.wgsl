// utils.alpha_split — which 0: rgb with alpha 1 (Color), which 1: alpha as Gray.
fn shade(uv: vec2f) -> vec4f {
  let c = textureLoad(t0, vec2i(floor(uv * F.res)), 0);
  if (P.which == 1u) {
    return vec4f(c.a, 0.0, 0.0, 1.0);
  }
  if (P.unpremultiply == 1u && c.a > 0.00001) {
    return vec4f(c.rgb / c.a, 1.0);
  }
  return vec4f(c.rgb, 1.0);
}
