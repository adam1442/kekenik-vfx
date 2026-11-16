// utils.multi_blend — base (t0) then up to 8 layers (t1..t8) composited in order. Each layer has its own blend mode and
// opacity; `layer_mask` bit i says "layer i is connected and enabled". -DGRAY=1 for the Gray variant (see blend.wgsl).
#include "sampling"
#include "blend"

fn apply(acc: vec4f, c: vec4f, mode: u32, op: f32) -> vec4f {
  return mix(acc, blend_op(mode, acc, blend_prep(c), P.smoothness), clamp(op, 0.0, 1.0));
}

fn shade(uv: vec2f) -> vec4f {
  var acc = vec4f(0.0);
  if (P.has_base == 1u) {
    acc = blend_prep(tex_sample(t0, uv, F.tile, F.filter_mode));
  }
  if ((P.layer_mask & 1u) != 0u) { acc = apply(acc, tex_sample(t1, uv, F.tile, F.filter_mode), P.mode0, P.op0); }
  if ((P.layer_mask & 2u) != 0u) { acc = apply(acc, tex_sample(t2, uv, F.tile, F.filter_mode), P.mode1, P.op1); }
  if ((P.layer_mask & 4u) != 0u) { acc = apply(acc, tex_sample(t3, uv, F.tile, F.filter_mode), P.mode2, P.op2); }
  if ((P.layer_mask & 8u) != 0u) { acc = apply(acc, tex_sample(t4, uv, F.tile, F.filter_mode), P.mode3, P.op3); }
  if ((P.layer_mask & 16u) != 0u) { acc = apply(acc, tex_sample(t5, uv, F.tile, F.filter_mode), P.mode4, P.op4); }
  if ((P.layer_mask & 32u) != 0u) { acc = apply(acc, tex_sample(t6, uv, F.tile, F.filter_mode), P.mode5, P.op5); }
  if ((P.layer_mask & 64u) != 0u) { acc = apply(acc, tex_sample(t7, uv, F.tile, F.filter_mode), P.mode6, P.op6); }
  if ((P.layer_mask & 128u) != 0u) { acc = apply(acc, tex_sample(t8, uv, F.tile, F.filter_mode), P.mode7, P.op7); }
  if (P.clamp_output == 1u) {
    acc = clamp(acc, vec4f(0.0), vec4f(1.0));
  }
  return acc;
}
