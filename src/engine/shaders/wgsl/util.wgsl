// util.wgsl — small math helpers.

fn sat(x: f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn remap(x: f32, in_lo: f32, in_hi: f32, out_lo: f32, out_hi: f32) -> f32 {
  return out_lo + (x - in_lo) / (in_hi - in_lo) * (out_hi - out_lo);
}

// Per-pixel parameter modulation. `m` = value of the modulation Gray texture, `k` = modulation
// intensity: 0 = ignore the input, 1 = fully multiply by m, negative = multiply by the inverted input (1 - m).
fn modulate(value: f32, m: f32, k: f32) -> f32 {
  let mm = select(m, 1.0 - m, k < 0.0);
  return value * mix(1.0, mm, min(abs(k), 1.0));
}
