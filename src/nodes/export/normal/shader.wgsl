// export.normal — normal map export transform. Input = ENCODED normal (n * 0.5 + 0.5, +Y = OpenGL).
// lay 0 xyz (keep), 1 reconstruct Z from XY, 2 rg (Z written as 0, BC5 style). dx = 1 flips green (DirectX).
// CPU mirror: exportNormal() in src/export/pixels.ts (unit tested).
fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let e = textureLoad(t0, p, 0).xyz;
  var n = e * 2.0 - 1.0;
  if (P.lay != 0u) { n.z = sqrt(max(0.0, 1.0 - n.x * n.x - n.y * n.y)); }
  let l = length(n);
  if (l > 0.00000001) { n = n / l; }
  if (P.dx == 1u) { n.y = -n.y; }
  var o = n * 0.5 + 0.5;
  if (P.lay == 2u) { o.z = 0.0; }
  return vec4f(o, 1.0);
}
