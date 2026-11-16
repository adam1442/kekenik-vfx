// utils.lattice — free-form deformation by a 4x4 control lattice with Catmull-Rom (interpolating) weights.
// P.d[i] holds two control displacements: points 2i (xy) and 2i+1 (zw); point (cx, cy) has index cy * 4 + cx.
// Periodic mode: control points sit at i/4 and indices wrap (seamless for any displacement). Clamped mode: points at i/3.
// Source lookup = uv - displacement, i.e. dragging a control point drags the content with it.
#include "sampling"

fn ctrl(ix: i32, iy: i32) -> vec2f {
  let idx = iy * 4 + ix;
  let v = P.d[idx / 2];
  return select(v.xy, v.zw, (idx % 2) == 1);
}

fn shade(uv: vec2f) -> vec4f {
  var gx = 0.0;
  var gy = 0.0;
  var i0 = 0;
  var j0 = 0;
  var tx = 0.0;
  var ty = 0.0;
  if (P.periodic == 1u) {
    gx = uv.x * 4.0;
    gy = uv.y * 4.0;
    i0 = i32(floor(gx));
    j0 = i32(floor(gy));
    tx = gx - floor(gx);
    ty = gy - floor(gy);
  } else {
    gx = clamp(uv.x, 0.0, 1.0) * 3.0;
    gy = clamp(uv.y, 0.0, 1.0) * 3.0;
    i0 = min(i32(floor(gx)), 2);
    j0 = min(i32(floor(gy)), 2);
    tx = gx - f32(i0);
    ty = gy - f32(j0);
  }
  let wx = cubic_weights(tx);
  let wy = cubic_weights(ty);
  var d = vec2f(0.0);
  for (var j = 0; j < 4; j = j + 1) {
    var ry = j0 + j - 1;
    for (var i = 0; i < 4; i = i + 1) {
      var rx = i0 + i - 1;
      if (P.periodic == 1u) {
        rx = ((rx % 4) + 4) % 4;
        ry = ((j0 + j - 1) % 4 + 4) % 4;
      } else {
        rx = clamp(rx, 0, 3);
        ry = clamp(j0 + j - 1, 0, 3);
      }
      d = d + ctrl(rx, ry) * (wx[i] * wy[j]);
    }
  }
  return tex_sample(t0, uv - d * P.amount, F.tile, F.filter_mode);
}
