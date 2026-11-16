// grayscale.caustics — animated, tileable, loopable water caustics.
// Iterated domain warp (after the classic "tileable water caustic" construction) with these deliberate changes:
//  * the pattern coordinate is NOT wrapped with mod(): q = (uv + offset - 0.5) * scale * TAU with an INTEGER scale on
//    tiling axes, so q advances by a multiple of TAU across the image and every term (sin / cos of q-derived values)
//    repeats exactly -> seamless (the classic version has a 2% seam because it uses p itself inside the weight);
//  * the per-iteration time speeds are INTEGER multiples of one loop (table below) so evolution 0% == 100% exactly.
#include "util"

const TAU_C: f32 = 6.28318530717959;

fn shade(uv: vec2f) -> vec4f {
  var sc = P.scale;
  if (F.tile.x == 1u) {
    sc.x = max(round(sc.x), 1.0);
  }
  if (F.tile.y == 1u) {
    sc.y = max(round(sc.y), 1.0);
  }
  let q = (uv + P.offset - vec2f(0.5)) * sc * TAU_C;
  var speeds = array<f32, 8>(-2.0, -1.0, 0.0, 1.0, 1.0, 2.0, -1.0, 2.0);
  var i = q;
  var c = 1.0;
  let iters = max(P.iterations, 1);
  for (var n = 0; n < iters; n = n + 1) {
    let t = P.evolution * TAU_C * speeds[n & 7] * f32(P.speed);
    i = q + P.distortion * vec2f(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    let a = sin(i.x + t);
    let b = cos(i.y + t);
    c = c + P.focus * abs(a * b) * inverseSqrt(a * a + b * b + 0.000001);
  }
  c = c / f32(iters);
  var v = 1.17 - pow(max(c, 0.0), 1.4);
  v = pow(abs(v), P.sharpness) * P.brightness;
  v = clamp((v - P.floor_level) / max(1.0 - P.floor_level, 0.0001), 0.0, 1.0);
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(v, 0.0, 0.0, 1.0);
}
