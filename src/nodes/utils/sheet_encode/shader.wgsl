// utils.sheet_encode — shows the baked sheet (any size) at the node's output size with bilinear filtering.
// P.has = 0 => nothing baked yet: transparent black.
fn shade(uv: vec2f) -> vec4f {
  if (P.has == 0u) { return vec4f(0.0); }
  let dims = vec2f(textureDimensions(t0));
  let p = uv * dims - vec2f(0.5);
  let f = floor(p);
  let fr = p - f;
  let hi = vec2i(dims) - vec2i(1);
  let i0 = clamp(vec2i(f), vec2i(0), hi);
  let i1 = clamp(vec2i(f) + vec2i(1), vec2i(0), hi);
  let a = textureLoad(t0, vec2i(i0.x, i0.y), 0);
  let b = textureLoad(t0, vec2i(i1.x, i0.y), 0);
  let c = textureLoad(t0, vec2i(i0.x, i1.y), 0);
  let d = textureLoad(t0, vec2i(i1.x, i1.y), 0);
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}
