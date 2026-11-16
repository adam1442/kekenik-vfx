// utils.kaleidoscope — angular mirror / rotational symmetry (mandala, crystal, magic circle) or mirrored tiling.
// t0 = input. mode 0 = radial: the angle around `center` is folded into `segments` wedges (mirror = true reflects every
// second wedge so the seams are continuous, mirror = false repeats the wedge = pure N-fold rotational symmetry).
// mode 1 = grid: the image is mirror-repeated `tiles` times per axis.
// The lookup goes through tex_sample so the node tiles / clamps like every other node.
#include "common"
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  if (P.mode == 1u) {
    var t = (uv - vec2f(0.5)) * P.tiles / max(P.zoom, 0.001) + vec2f(0.5) + P.shift;
    // triangle-wave fold = mirror repeat
    let f = abs(fract(t * 0.5) * 2.0 - 1.0);
    return tex_sample(t0, 1.0 - f, F.tile, F.filter_mode);
  }
  let side = min(F.res.x, F.res.y);
  let asp = F.res / side;
  let d = (uv - P.center) * asp;
  let r = length(d);
  var a = atan2(d.y, d.x) - radians(P.rotation);
  let n = f32(clamp(P.segments, 1, 64));
  let seg = TAU / n;
  let cell = floor(a / seg);
  var fa = a - cell * seg;
  if (P.mirror == 1u && (i32(cell) & 1) == 1) {
    fa = seg - fa;
  }
  let a2 = fa + radians(P.angle_offset);
  let rr = r / max(P.zoom, 0.001) + P.radius_offset;
  let dir = vec2f(cos(a2), sin(a2));
  return tex_sample(t0, P.source + dir * rr / asp, F.tile, F.filter_mode);
}
