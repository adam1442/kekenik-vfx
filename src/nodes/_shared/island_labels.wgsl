// islands — packs the union-find result into the exact label texture. s0 = parent buffer read as f32 (values are normal float
// bit patterns by construction, see island_ccl.wgsl). Output (xhi, xlo, yhi, ylo) of the root pixel (x = xhi * 1024 + xlo), -1 on background.
fn shade(uv: vec2f) -> vec4f {
  let p = vec2u(floor(uv * F.res));
  let w = u32(F.res.x);
  let k = bitcast<u32>(s0[p.y * w + p.x]);
  if (k == 0x7f000000u) {
    return vec4f(-1.0);
  }
  let r = k - 0x3f800000u;
  let rx = r % w;
  let ry = r / w;
  return vec4f(f32(rx / 1024u), f32(rx % 1024u), f32(ry / 1024u), f32(ry % 1024u));
}
