// Motion Vector Encode / Decode. OUT 0 encode (t0 Vector -> Color RG, B = 0, A = 1), OUT 1 decode (t0 Color -> Vector).
// Encoded = 0.5 + 0.5 * v / scale (neutral 0.5) or the signed value v / scale; Y can be flipped; 8 / 16-bit quantisation is applied
// inside so the exported file reproduces exactly what the node shows. CPU mirror: encodeMotion() / decodeMotion() in _shared/vectorref.ts
#include "vectorlib"
fn quant(x: f32) -> f32 {
  if (P.depth == 0u) { return round(x * 255.0) / 255.0; }
  if (P.depth == 1u) { return round(x * 65535.0) / 65535.0; }
  return x;
}
fn shade(uv: vec2f) -> vec4f {
  let s = max(P.scale, 1e-6);
  let fy = select(1.0, -1.0, P.flip == 1u);
#if OUT == 0
  let v = vec_sample(t0, uv, F.tile, F.filter_mode);
  var e = vec2f(v.x, v.y * fy) / s;
  if (P.signed_out == 0u) { e = clamp(e * 0.5 + 0.5, vec2f(0.0), vec2f(1.0)); }
  return vec4f(quant(e.x), quant(e.y), 0.0, 1.0);
#else
  let c = tex_sample(t0, uv, F.tile, F.filter_mode).xy;
  var d = c;
  if (P.signed_out == 0u) { d = (c - 0.5) * 2.0; }
  return vec4f(d.x * s, d.y * s * fy, 0.0, 1.0);
#endif
}
