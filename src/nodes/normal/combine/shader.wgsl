// normal.combine — blend two normal maps (decoded n = rgb * 2 - 1). mode 0 reoriented (RNM, Barre-Brisebois / Hill),
// 1 detail (UDN: xy added, base z kept), 2 whiteout (xy added, z multiplied), 3 linear (vectors added), 4 partial derivative.
// Detail xy is scaled by P.detail_strength first. result = mix(base, blended, opacity * mask). CPU mirror: combineNormals().
#include "sampling"

fn dec(c: vec4f) -> vec3f {
  return normalize(c.rgb * 2.0 - vec3f(1.0) + vec3f(0.0, 0.0, 0.000001));
}

fn shade(uv: vec2f) -> vec4f {
  let b = dec(tex_sample(t0, uv, F.tile, F.filter_mode));
  if (P.has_detail == 0u) {
    return vec4f(b * 0.5 + vec3f(0.5), 1.0);
  }
  var d = dec(tex_sample(t1, uv, F.tile, F.filter_mode));
  d = normalize(vec3f(d.xy * P.detail_strength, d.z));
  var r = b;
  if (P.mode == 0u) {
    let t = b + vec3f(0.0, 0.0, 1.0);
    let u = d * vec3f(-1.0, -1.0, 1.0);
    r = t * dot(t, u) / t.z - u;
  } else if (P.mode == 1u) {
    r = vec3f(b.xy + d.xy, b.z);
  } else if (P.mode == 2u) {
    r = vec3f(b.xy + d.xy, b.z * d.z);
  } else if (P.mode == 3u) {
    r = b + d;
  } else {
    r = vec3f(b.xy * d.z + d.xy * b.z, b.z * d.z);
  }
  r = normalize(r);
  var w = P.opacity;
  if (P.has_mask == 1u) {
    w = w * tex_sample(t2, uv, F.tile, F.filter_mode).r;
  }
  let o = normalize(mix(b, r, w));
  return vec4f(o * 0.5 + vec3f(0.5), 1.0);
}
