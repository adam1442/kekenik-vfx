// export.color — export-ready copy of a Color texture (alpha can be forced opaque). The file writer reads THIS output,
// premultiplication / colour space / quantisation happen on the CPU strips (exact, see src/export/pixels.ts).
fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  var c = textureLoad(t0, p, 0);
  if (P.opaque == 1u) { c.a = 1.0; }
  return c;
}
