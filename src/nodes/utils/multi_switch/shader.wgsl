// utils.multi_switch — selects (or crossfades between) input a (t0..t7) and input b by index; `t` = mix amount.
#include "sampling"

fn pick(i: i32, uv: vec2f) -> vec4f {
  switch (i) {
    case 0: { return tex_sample(t0, uv, F.tile, F.filter_mode); }
    case 1: { return tex_sample(t1, uv, F.tile, F.filter_mode); }
    case 2: { return tex_sample(t2, uv, F.tile, F.filter_mode); }
    case 3: { return tex_sample(t3, uv, F.tile, F.filter_mode); }
    case 4: { return tex_sample(t4, uv, F.tile, F.filter_mode); }
    case 5: { return tex_sample(t5, uv, F.tile, F.filter_mode); }
    case 6: { return tex_sample(t6, uv, F.tile, F.filter_mode); }
    default: { return tex_sample(t7, uv, F.tile, F.filter_mode); }
  }
}

fn shade(uv: vec2f) -> vec4f {
  var c = vec4f(0.0);
  if ((P.connected & (1u << u32(P.a))) != 0u) {
    c = pick(P.a, uv);
  }
  if (P.mix_t > 0.0) {
    var d = vec4f(0.0);
    if ((P.connected & (1u << u32(P.b))) != 0u) {
      d = pick(P.b, uv);
    }
    c = mix(c, d, P.mix_t);
  }
  return c;
}
