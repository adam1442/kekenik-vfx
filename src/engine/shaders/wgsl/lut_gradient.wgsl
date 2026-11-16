// lut_gradient.wgsl — 256-texel RGBA gradient LUT lookup. BINDING DEPENDENT: reads the Params field
//   { name: 'glut', type: 'vec4f', count: 256 }   (filled with bakeGradientUniform256(); LINEAR RGBA, alpha = 4th channel).
// x in [0,1] (clamped) -> RGBA, linear interpolation between neighbouring texels.
fn gradient_lut(x: f32) -> vec4f {
  let f = clamp(x, 0.0, 1.0) * 255.0;
  let i = min(i32(floor(f)), 254);
  return mix(P.glut[i], P.glut[i + 1], f - f32(i));
}
