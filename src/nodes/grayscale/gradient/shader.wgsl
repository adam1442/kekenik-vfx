// grayscale.gradient — linear, radial, angular, diamond, square, reflected and spiral gradients.
// Bindings are generated (see passes.ts): F = Frame, P = Params (layout in definition.ts), t0 = optional UV map.
// Types (enum order == definition.ts): 0 linear 1 radial 2 angular 3 diamond 4 square 5 reflected 6 spiral.
// Tiling: radial-family types use wrap_delta (nearest repeated centre) so they are exactly periodic; linear types snap
// their gradient frequency to whole periods per tiling axis and wrap (repeat / mirror) instead of clamping.
#include "sdf"
#include "sampling"
#include "util"

fn lut_at(i: i32) -> f32 {
  return P.curve_lut[i >> 2u][i & 3];
}
fn lut_eval(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * 63.0;
  let i = min(i32(floor(f)), 62);
  return mix(lut_at(i), lut_at(i + 1), f - f32(i));
}

fn snap_period(x: f32, mirror: bool) -> f32 {
  if (mirror) {
    return 2.0 * round(x * 0.5);
  }
  return round(x);
}

fn shade(uv: vec2f) -> vec4f {
  var puv = uv;
  if (P.has_uv == 1u) {
    puv = mix(uv, tex_sample(t0, uv, F.tile, F.filter_mode).rg, P.uv_amount);
  }
  let mn = min(F.full_res.x, F.full_res.y);
  let aspect = F.full_res / mn;
  let tiling = F.tile.x == 1u || F.tile.y == 1u;
  var wrap_mode = P.wrap_mode;
  var t = 0.0;
  if (P.gtype == 0u || P.gtype == 5u) {
    let g = P.end - P.start;
    var f = g / max(dot(g, g), 0.00000001) * P.repeat;
    if (tiling) {
      // Whole periods across the image on tiling axes; a reflected ramp is a triangle wave there.
      let mirror = wrap_mode == 2u || P.gtype == 5u;
      if (F.tile.x == 1u) {
        f.x = snap_period(f.x, mirror);
      }
      if (F.tile.y == 1u) {
        f.y = snap_period(f.y, mirror);
      }
      wrap_mode = select(1u, 2u, mirror);
    }
    t = dot(puv - P.start, f) + P.offset;
    if (P.gtype == 5u && !tiling) {
      t = abs(dot(puv - P.start, f)) + P.offset;
    }
  } else {
    let d = wrap_delta(puv - P.center, F.tile) * aspect;
    let r = length(d) / max(P.radius, 0.000001);
    var t0 = r;
    if (P.gtype == 3u) {
      t0 = (abs(d.x) + abs(d.y)) / max(P.radius, 0.000001);
    } else if (P.gtype == 4u) {
      t0 = max(abs(d.x), abs(d.y)) / max(P.radius, 0.000001);
    } else if (P.gtype == 2u || P.gtype == 6u) {
      let turn = atan2(d.y, d.x) / TAU - P.angle / 360.0;
      t0 = turn - floor(turn);
      if (P.gtype == 6u) {
        let s = t0 + r * P.turns;
        t0 = s - floor(s);
      }
    }
    t = t0 * P.repeat + P.offset;
  }
  // wrap mode: 0 clamp, 1 repeat, 2 mirror
  var x = clamp(t, 0.0, 1.0);
  if (wrap_mode == 1u) {
    x = t - floor(t);
  } else if (wrap_mode == 2u) {
    let m = (t * 0.5 - floor(t * 0.5)) * 2.0;
    x = select(m, 2.0 - m, m > 1.0);
  }
  var v = x;
  if (P.curve_on == 1u) {
    v = lut_eval(x);
  }
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0);
}
