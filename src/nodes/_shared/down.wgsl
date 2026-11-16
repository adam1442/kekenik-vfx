// _shared/down.wgsl — exact 2x2 box downsample (t0 has exactly twice the size of the target). Wrap-agnostic: every
// output texel averages 4 whole input texels, so tiling is preserved exactly when both sizes are even.
fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res)) * 2;
  let a = textureLoad(t0, p, 0);
  let b = textureLoad(t0, p + vec2i(1, 0), 0);
  let c = textureLoad(t0, p + vec2i(0, 1), 0);
  let d = textureLoad(t0, p + vec2i(1, 1), 0);
  return (a + b + c + d) * 0.25;
}
