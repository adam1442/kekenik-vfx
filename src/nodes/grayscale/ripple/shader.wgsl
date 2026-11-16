// grayscale.ripple — shockwave / ripple profile. t0 = optional UV map, t1 = intensity modulation.
// d = r - R_eff(theta) is the signed distance to the ring (+ outside). Outside: sharp leading edge; inside: solid band `width`, then a soft tail.
// Wobble: 4 angular harmonics (integer lobes => periodic in theta) whose phases move by an INTEGER number of turns per unit `evolution` => loops.
#include "hash"
#include "sampling"
#include "util"


fn rel_px(p: vec2f) -> vec2f {
  var rel = p - P.center;
  if (F.tile.x == 1u) {
    rel.x = rel.x - floor(rel.x + 0.5);
  }
  if (F.tile.y == 1u) {
    rel.y = rel.y - floor(rel.y + 0.5);
  }
  return rel * F.full_res;
}

// Angular radius distortion in about [-0.5, 0.5].
fn wob(theta: f32) -> f32 {
  var s = 0.0;
  for (var h = 0; h < 4; h = h + 1) {
    let f = max(1.0, round(P.wobble_freq * (0.4 + 0.3 * f32(h))));
    let ph = TAU * u01(hash_u(u32(h), 5u, 9u, F.seed + P.seed * 7919u));
    let dir = select(-1.0, 1.0, (h & 1) == 0);
    s = s + sin(f * theta + ph + TAU * P.evolution * dir) * (1.0 / (1.0 + 0.4 * f32(h)));
  }
  return s * 0.3;
}

fn profile(d: f32, w: f32, tail_px: f32) -> f32 {
  if (d >= 0.0) {
    let fs = max(w * (1.0 - clamp(P.front, 0.0, 1.0)), 0.5);
    return 1.0 - smoothstep(0.0, fs, d);
  }
  let dd = -d;
  if (dd <= w) {
    return 1.0;
  }
  let t = clamp((dd - w) / max(tail_px, 0.5), 0.0, 1.0);
  return (1.0 - t) * (1.0 - t);
}

fn shade(uv: vec2f) -> vec4f {
  var puv = uv;
  if (P.has_uv == 1u) {
    puv = mix(uv, tex_sample(t0, uv, F.tile, F.filter_mode).rg, P.uv_amount);
  }
  let side = min(F.full_res.x, F.full_res.y);
  let d = rel_px(puv);
  let r = length(d);
  let theta = atan2(d.y, d.x);
  let w = max(P.width * side, 0.75);
  let wb = select(0.0, wob(theta) * P.wobble, P.wobble > 0.0);
  var v = 0.0;
  let cnt = clamp(P.count, 1, 12);
  for (var j = 0; j < cnt; j = j + 1) {
    let rj = P.radius * side - f32(j) * P.spacing * side;
    if (rj <= 0.0) {
      continue;
    }
    let reff = rj * (1.0 + wb);
    let amp = pow(clamp(P.decay, 0.0, 1.0), f32(j));
    v = max(v, amp * profile(r - reff, w, P.tail * rj));
  }
  let m = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  v = clamp(v * modulate(P.intensity, m, P.intensity_mod_k), 0.0, 1.0);
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(v, 0.0, 0.0, 1.0);
}
