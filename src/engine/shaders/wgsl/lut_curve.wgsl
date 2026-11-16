// lut_curve.wgsl — 256-entry curve LUT lookup. BINDING DEPENDENT: reads the Params field
//   { name: 'lut', type: 'vec4f', count: 64 }   (see LUT256_VEC4 in engine/shaders/lut.ts, filled with bakeCurveUniform256()).
fn lut256_at(i: i32) -> f32 {
  return P.lut[i >> 2u][i & 3];
}
// x in [0,1] (clamped) -> curve value, linear interpolation between the 256 baked samples.
fn curve_lut(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * 255.0;
  let i = min(i32(floor(f)), 254);
  return mix(lut256_at(i), lut256_at(i + 1), f - f32(i));
}
