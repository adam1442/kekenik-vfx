// utils.rgba_split — one channel of t0 into a Gray texture.
fn shade(uv: vec2f) -> vec4f {
  let c = textureLoad(t0, vec2i(floor(uv * F.res)), 0);
  var v = c.r;
  if (P.ch == 1u) { v = c.g; }
  if (P.ch == 2u) { v = c.b; }
  if (P.ch == 3u) { v = c.a; }
  return vec4f(v, 0.0, 0.0, 1.0);
}
