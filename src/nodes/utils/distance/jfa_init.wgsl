// utils.distance — JFA seed pass. Output = packed pixel coordinate of the pixel itself when it is a seed, else invalid.
// Packing (exact in half floats): x = xhi * 1024 + xlo, y = yhi * 1024 + ylo, rgba = (xhi, xlo, yhi, ylo); invalid = -1.
// P.seed_class: 0 = seeds are INSIDE pixels (value >= threshold, xor invert), 1 = seeds are OUTSIDE pixels.
fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let v = textureLoad(t0, p, 0).r;
  var inside = v >= P.threshold;
  if (P.invert == 1u) {
    inside = !inside;
  }
  let seed = select(!inside, inside, P.seed_class == 0u);
  if (!seed) {
    return vec4f(-1.0);
  }
  return vec4f(f32(p.x / 1024), f32(p.x % 1024), f32(p.y / 1024), f32(p.y % 1024));
}
