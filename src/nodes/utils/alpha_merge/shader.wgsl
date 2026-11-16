// utils.alpha_merge — rgb of t0 (Color) + alpha from t1 (Gray). Alpha is an ordinary channel.
fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let c = textureLoad(t0, p, 0);
  var a = P.default_alpha;
  if (P.has_alpha == 1u) {
    a = textureLoad(t1, p, 0).r;
  }
  if (P.premultiply == 1u) {
    return vec4f(c.rgb * a, a);
  }
  return vec4f(c.rgb, a);
}
