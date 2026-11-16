// utils.rgb_to_grayscale — weights (w.xyz) dot rgb, or max / min of rgb. P.mode: 0 weights, 1 max, 2 min.
fn shade(uv: vec2f) -> vec4f {
  let c = textureLoad(t0, vec2i(floor(uv * F.res)), 0);
  var v = dot(c.rgb, P.weights);
  if (P.mode == 1u) { v = max(c.r, max(c.g, c.b)); }
  if (P.mode == 2u) { v = min(c.r, min(c.g, c.b)); }
  if (P.use_alpha == 1u) { v = v * c.a; }
  return vec4f(v, 0.0, 0.0, 1.0);
}
