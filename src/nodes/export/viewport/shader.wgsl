// export.viewport — passes the connected Color texture (2D views) or transparent black (3D views, the mesh is rendered by the exporter).
fn shade(uv: vec2f) -> vec4f {
  if (P.has_tex == 0u) { return vec4f(0.0); }
  let p = vec2i(floor(uv * F.res));
  return textureLoad(t0, p, 0);
}
