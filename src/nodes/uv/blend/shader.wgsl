// uv.blend — combine two UV fields on their DELTAS (tile space). t0 = A, t1 = B (optional), t2 = mask (optional Gray).
// op 0 mix, 1 add, 2 subtract, 3 multiply (A * B / ref, ref = P.refv), 4 compose (B applied AFTER A: B sampled at uv + dA),
// 5 max magnitude. w = opacity * mask; result = mix(dA, op(dA, dB), w). Missing B behaves as the neutral field.
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let da = uvf_sample(t0, uv, F.tile, F.filter_mode, P.mode_a) * P.scale_a;
  var db = vec2f(0.0);
  if (P.has_b == 1u && P.op != 4u) {
    db = uvf_sample(t1, uv, F.tile, F.filter_mode, P.mode_b) * P.scale_b;
  }
  var w = P.opacity;
  if (P.has_mask == 1u) {
    w = w * tex_sample(t2, uv, F.tile, F.filter_mode).r;
  }
  var r = da;
  if (P.op == 0u) {
    r = mix(da, db, w);
  } else {
    var c = da;
    if (P.op == 1u) {
      c = da + db;
    } else if (P.op == 2u) {
      c = da - db;
    } else if (P.op == 3u) {
      c = da * (db / max(P.refv, 0.000001));
      if (P.has_b == 0u) {
        c = da;
      }
    } else if (P.op == 4u) {
      c = da;
      if (P.has_b == 1u) {
        c = da + uvf_sample(t1, uv + da, F.tile, F.filter_mode, P.mode_b) * P.scale_b;
      }
    } else {
      c = select(da, db, dot(db, db) > dot(da, da));
    }
    r = mix(da, c, w);
  }
  return uvf_pack(r, uv, P.uv_mode);
}
