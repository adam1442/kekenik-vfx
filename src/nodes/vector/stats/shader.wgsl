// vector.stats — MODE 0: first block reduction of a Vector (mean xy, max length); MODE 1: reduction of reduced blocks;
// MODE 2: outputs (t0 = 1x1 result, t1 = original) OUT 0 mean vector, 1 max length * gain, 2 |v| / max.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
#if MODE == 2
  let r = textureLoad(t0, vec2i(0, 0), 0);
#if OUT == 0
  return vec4f(r.x, r.y, 0.0, 1.0);
#elif OUT == 1
  return vec4f(r.z * P.gain, 0.0, 0.0, 1.0);
#else
  let v = vec_sample(t1, uv, F.tile, F.filter_mode);
  return vec4f(length(v) / max(r.z, 1e-9), 0.0, 0.0, 1.0);
#endif
#else
  // this pass renders into a (ceil(w/8), ceil(h/8)) target: pixel -> its 8x8 source block (edge blocks average the valid texels only)
  let dst = vec2i(floor(uv * vec2f(F.full_res)));
  let src = vec2i(textureDimensions(t0));
  var mean = vec2f(0.0);
  var mx = 0.0;
  var cnt = 0.0;
  for (var j = 0; j < 8; j = j + 1) {
    for (var i = 0; i < 8; i = i + 1) {
      let p = dst * 8 + vec2i(i, j);
      if (p.x >= src.x || p.y >= src.y) { continue; }
      let s = textureLoad(t0, p, 0);
#if MODE == 0
      mean = mean + s.xy;
      mx = max(mx, length(s.xy));
#else
      mean = mean + s.xy;
      mx = max(mx, s.z);
#endif
      cnt = cnt + 1.0;
    }
  }
  return vec4f(mean / max(cnt, 1.0), mx, 1.0);
#endif
}
