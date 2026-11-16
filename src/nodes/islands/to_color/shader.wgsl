// islands.to_color — one colour per island from the Island Map (t0). mode 0 random HSV (ranges), 1 gradient lookup by the island's random
// value, 2 colour sampled from t1 at the island's bounding-box centre (point sampling) — a flat colour per island. Background = P.bg.
#include "sampling"
#include "island"
#include "color"
#include "lut_gradient"

fn shade(uv: vec2f) -> vec4f {
  let m = tex_sample(t0, uv, F.tile, 0u);
  if (!island_valid(m)) {
    return P.bg;
  }
  let h = island_hash(m, P.seed);
  let r0 = u01(h);
  var col = vec4f(1.0);
  if (P.mode == 0u) {
    let r1 = u01(pcg(h ^ 0x68bc21ebu));
    let r2 = u01(pcg(h ^ 0x02e5be93u));
    let hue = fract(mix(P.hue_range.x, P.hue_range.y, r0));
    col = vec4f(hsv_to_rgb(vec3f(hue, mix(P.sat_range.x, P.sat_range.y, r1), mix(P.val_range.x, P.val_range.y, r2))), 1.0);
  } else if (P.mode == 1u) {
    col = gradient_lut(r0);
  } else {
    var c = island_center(m);
    if (F.tile.x == 1u) {
      c.x = c.x - floor(c.x);
    }
    if (F.tile.y == 1u) {
      c.y = c.y - floor(c.y);
    }
    col = tex_sample(t1, c, F.tile, 0u);
  }
  return col;
}
