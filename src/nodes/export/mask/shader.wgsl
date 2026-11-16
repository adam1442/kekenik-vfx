// export.mask — export-ready copy of a Gray texture (single channel).
fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let v = textureLoad(t0, p, 0).r;
  return vec4f(v, 0.0, 0.0, 1.0);
}
