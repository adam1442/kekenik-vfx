// utils.math — per-pixel math on Gray. t0 = A, t1 = B (optional), t2 = "value" modulation.
// op index order = MATH_OPS in definition.ts. B = texel of t1 when connected, otherwise the constant P.value
// (modulated per pixel by t2 with modulate()). Every division / power is guarded so the output is always finite.
#include "sampling"
#include "util"

fn safe_pow(x: f32, e: f32) -> f32 {
  return min(pow(max(x, 0.0), e), 10000.0);
}

fn soft_step(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / select(e1 - e0, 1e-6, abs(e1 - e0) < 1e-6), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn apply_op(a: f32, b: f32) -> f32 {
  switch (P.op) {
    case 0u: { return a + b; }
    case 1u: { return a - b; }
    case 2u: { return a * b; }
    case 3u: { return select(a / b, 0.0, abs(b) < 1e-6); }
    case 4u: { return safe_pow(a, b); }
    case 5u: { return min(a, b); }
    case 6u: { return max(a, b); }
    case 7u: { return abs(a - b); }
    case 8u: { return a + (b - a) * P.value2; }
    case 9u: { return select(a - b * floor(a / b), 0.0, abs(b) < 1e-6); }
    case 10u: { return select(0.0, 1.0, a >= b); }
    case 11u: { return soft_step(b, b + max(P.value2, 1e-4), a); }
    case 12u: {
      let d = P.in_hi - P.in_lo;
      let t = select((a - P.in_lo) / d, 0.0, abs(d) < 1e-6);
      return P.out_lo + t * (P.out_hi - P.out_lo);
    }
    case 13u: { return clamp(a, min(b, P.value2), max(b, P.value2)); }
    case 14u: { return abs(a); }
    case 15u: { return 1.0 - a; }
    case 16u: { return safe_pow(a, 1.0 / max(b, 1e-4)); }
    default: { return a; }
  }
}

fn shade(uv: vec2f) -> vec4f {
  let a = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let m = tex_sample(t2, uv, F.tile, F.filter_mode).r;
  var b = modulate(P.value, m, P.value_mod_k);
  if (P.has_b == 1u) {
    b = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  }
  var r = apply_op(a, b);
  if (P.clamp_out == 1u) {
    r = clamp(r, 0.0, 1.0);
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
