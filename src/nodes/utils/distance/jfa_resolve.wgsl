// utils.distance — resolve. t0 = JFA of INSIDE seeds (nearest inside pixel; distance 0 inside), t1 = JFA of OUTSIDE seeds
// (only when signed). P.which: 0 distance, 1 id, 2 nearest uv. Distances are in pixels / min(width, height).
#include "hash"

fn unpack(c: vec4f) -> vec2i {
  return vec2i(i32(round(c.x)) * 1024 + i32(round(c.y)), i32(round(c.z)) * 1024 + i32(round(c.w)));
}

fn wrapped_dist(c: vec4f, p: vec2i, n: vec2i) -> f32 {
  var d = vec2f(unpack(c) - p);
  if (F.tile.x == 1u) {
    d.x = d.x - f32(n.x) * round(d.x / f32(n.x));
  }
  if (F.tile.y == 1u) {
    d.y = d.y - f32(n.y) * round(d.y / f32(n.y));
  }
  return length(d);
}

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(F.res);
  let p = vec2i(floor(uv * F.res));
  let side = min(F.res.x, F.res.y);
  let a = textureLoad(t0, p, 0);       // nearest inside pixel
  let has_a = a.x >= 0.0;
  var d_out = 1.0e9;                    // distance to the nearest inside pixel (0 for inside pixels)
  if (has_a) {
    d_out = wrapped_dist(a, p, n);
  }
  var d_in = 0.0;                       // distance to the nearest outside pixel (0 for outside pixels)
  var b = vec4f(-1.0);
  var has_b = false;
  if (P.signed_mode == 1u) {
    b = textureLoad(t1, p, 0);
    has_b = b.x >= 0.0;
    d_in = select(1.0e9, wrapped_dist(b, p, n), has_b);
  }
  if (P.which == 0u) {
    let big = P.max_dist * side;       // used when a seed class does not exist at all
    var sd = big;
    if (has_a) {
      sd = select(0.0, d_out - 0.5, d_out > 0.0);
    }
    if (P.signed_mode == 1u) {
      var inner = 0.0;                 // outside pixels are their own nearest outside seed -> 0
      if (d_in > 0.0) {
        inner = select(big, d_in - 0.5, has_b);
      }
      sd = sd - inner;
    }
    sd = sd / side;
    var v = sd;
    if (P.norm_on == 1u) {
      let u = clamp(sd / max(P.max_dist, 0.00001), -1.0, 1.0);
      v = select(clamp(u, 0.0, 1.0), 0.5 + 0.5 * u, P.signed_mode == 1u);
    }
    return vec4f(v, 0.0, 0.0, 1.0);
  }
  // id / uv refer to the nearest seed: unsigned -> nearest inside pixel; signed -> nearest pixel of the OPPOSITE class.
  var s = a;
  var ok = has_a;
  if (P.signed_mode == 1u && d_out <= 0.0) {
    s = b;
    ok = has_b;
  }
  if (!ok) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let sp = unpack(s);
  if (P.which == 1u) {
    return vec4f(u01(hash_u(u32(sp.x), u32(sp.y), 3u, P.seed)), 0.0, 0.0, 1.0);
  }
  return vec4f((vec2f(sp) + vec2f(0.5)) / F.res, 0.0, 1.0);
}
