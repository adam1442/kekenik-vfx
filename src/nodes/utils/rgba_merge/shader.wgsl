// utils.rgba_merge — t0..t3 = Gray R, G, B, A. Unconnected channels use P.defaults (xyzw).
fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  var o = P.defaults;
  if ((P.mask & 1u) != 0u) { o.x = textureLoad(t0, p, 0).r; }
  if ((P.mask & 2u) != 0u) { o.y = textureLoad(t1, p, 0).r; }
  if ((P.mask & 4u) != 0u) { o.z = textureLoad(t2, p, 0).r; }
  if ((P.mask & 8u) != 0u) { o.w = textureLoad(t3, p, 0).r; }
  return o;
}
