// uv.flow — flowmap advection with LOOPING TWO-PHASE blending. t0 = flow field (UV, mode P.uv_in; its DELTA d is the lookup
// offset, so content moves along -d: chain UV Directional / Noise / Spline into it), t1 = optional source image, t2 = strength mod.
// time t = phase (+ loop_phase * cycles when `use_loop`) + per-pixel phase noise; phase A = fract(t), phase B = fract(t + 0.5);
// uv_a = uv + d * S * (phaseA - 0.5), uv_b likewise; weight of A = 1 - |2 phaseA - 1| (0 exactly when A resets), so
//   result = mix(source(uv_b), source(uv_a), weight)   and everything is periodic in t with period 1  -> seamless loops.
// which: 0 uv_a, 1 uv_b, 2 weight (of A), 3 result (needs t1).
#include "noise"
#include "util"
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  var d = vec2f(0.0);
  if (P.has_flow == 1u) {
    d = uvf_sample(t0, uv, F.tile, F.filter_mode, P.uv_in);
  }
  let ms = tex_sample(t2, uv, F.tile, F.filter_mode).r;
  let s = modulate(P.strength, ms, P.strength_mod_k);
  var t = P.phase;
  if (P.use_loop == 1u) {
    t = t + F.loop_phase * f32(P.cycles);
  }
  if (P.noise_amount > 0.0) {
    let cells = max(P.noise_cells, 1);
    let per = vec3i(select(0, cells, F.tile.x == 1u), select(0, cells, F.tile.y == 1u), 0);
    let n = value_noise3(vec3f(uv * f32(cells), 0.5), per, P.seed);
    t = t + n * P.noise_amount;
  }
  let pa = fract(t);
  let pb = fract(t + 0.5);
  var wa = 1.0 - abs(2.0 * pa - 1.0);
  if (P.smooth_w == 1u) {
    wa = wa * wa * (3.0 - 2.0 * wa);
  }
  let da = d * s * (pa - 0.5);
  let db = d * s * (pb - 0.5);
  if (P.which == 0u) {
    return uvf_pack(da, uv, P.uv_mode);
  }
  if (P.which == 1u) {
    return uvf_pack(db, uv, P.uv_mode);
  }
  if (P.which == 2u) {
    return vec4f(wa, 0.0, 0.0, 1.0);
  }
  if (P.has_src == 0u) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  let ca = tex_sample(t1, uv + da, F.tile, F.filter_mode);
  let cb = tex_sample(t1, uv + db, F.tile, F.filter_mode);
  return mix(cb, ca, wa);
}
