// islands.to_uv — per-island LOCAL UV field (absolute convention: the coordinate to read an image from) and island mask.
// which 0 = uv field, 1 = mask. Local position l (0..1 over the island box, island_local). Steps: optional box mirror / 90 degree turn when the
// island is taller than wide / random 90 degree steps, rotation (angle + random), then fit: 0 stretch (rotates in normalised box space),
// 1 fit (uniform, whole image visible, letterbox), 2 fill (uniform, island covered). Then scale / offset. Outside islands: identity.
#include "sampling"
#include "island"
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let m = tex_sample(t0, uv, F.tile, 0u);
  if (P.which == 1u) {
    return vec4f(select(0.0, 1.0, island_valid(m)), 0.0, 0.0, 1.0);
  }
  if (!island_valid(m)) {
    return uvf_pack(vec2f(0.0), uv, P.uv_mode);
  }
  let h = island_hash(m, P.seed);
  var l = island_local(m, uv, F.tile);
  var sz = max(m.zw * F.res, vec2f(1.0));
  if (P.mirror == 1u && u01(pcg(h ^ 0x1b873593u)) < 0.5) {
    l.x = 1.0 - l.x;
  }
  var ang = P.angle + (u01(pcg(h ^ 0x85ebca6bu)) - 0.5) * TAU * P.angle_random;
  if (P.random_90 == 1u) {
    ang = ang + floor(u01(pcg(h ^ 0xc2b2ae35u)) * 4.0) * 0.5 * PI;
  }
  if (P.align_long == 1u && sz.y > sz.x) {
    ang = ang + 0.5 * PI;
  }
  let c = l - vec2f(0.5);
  let ca = cos(ang);
  let sa = sin(ang);
  var s = vec2f(0.0);
  if (P.fit == 0u) {
    s = vec2f(ca * c.x + sa * c.y, -sa * c.x + ca * c.y) + vec2f(0.5);
  } else {
    let q = c * sz;
    let r = vec2f(ca * q.x + sa * q.y, -sa * q.x + ca * q.y);
    let side = select(min(sz.x, sz.y), max(sz.x, sz.y), P.fit == 1u);
    s = r / side + vec2f(0.5);
  }
  s = (s - vec2f(0.5)) / max(P.scale, 0.0001) + vec2f(0.5) + P.offset;
  return uvf_pack(s - uv, uv, P.uv_mode);
}
