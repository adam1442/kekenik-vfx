// vector.combine — t0 = A, t1 = B, t2 = mask. Missing inputs are the neutral (0,0) field / mask 1.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  var a = vec2f(0.0);
  var b = vec2f(0.0);
  if (P.has_a == 1u) { a = vec_sample(t0, uv, F.tile, F.filter_mode) * P.gain_a; }
  if (P.has_b == 1u) { b = vec_sample(t1, uv, F.tile, F.filter_mode) * P.gain_b; }
  var m = 1.0;
  if (P.has_mask == 1u) { m = tex_sample(t2, uv, F.tile, F.filter_mode).r; }
  var r = a;
  switch (P.mode) {
    case 0u: { r = a + b * m; }
    case 1u: { r = a - b * m; }
    case 2u: { r = a * mix(vec2f(1.0), b, m); }
    case 3u: { r = mix(a, b, P.mix * m); }
    case 4u: { r = mix(a, select(a, b, length(b) > length(a)), m); }
    default: { r = mix(a, select(a, b, length(b) < length(a)), m); }
  }
  return vec4f(r, 0.0, 1.0);
}
