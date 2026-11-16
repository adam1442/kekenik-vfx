// islands.generate — fragment outputs from the label texture (t0) and the DECODED stats table (s0, see island_stats.wgsl).
// which: 0 Island Map (bbox min xy, bbox size xy in UV), 1 Size (gray: area / image area / size_ref, clamped),
//        2 Centre (UV field, centre of mass wrapped into 0..1 on tiling axes, stored with P.uv_mode),
//        3 ID (gray: island_rand of the Island Map — t1 must be the Island Map).
// Islands missing from the table (more than `Max islands`) fall back to a one pixel bounding box so nothing breaks.
#include "island"
#include "uvfield"

const STRIDE: u32 = 12u;

fn unpack(c: vec4f) -> vec2i {
  return vec2i(i32(round(c.x)) * 1024 + i32(round(c.y)), i32(round(c.z)) * 1024 + i32(round(c.w)));
}

fn find_slot(ridx: u32) -> i32 {
  var slot = pcg(ridx + 1u) & P.cap_mask;
  let klo = f32(ridx & 0xffffffu);
  let khi = f32(ridx >> 24u);
  for (var i = 0u; i < 64u; i = i + 1u) {
    let b = slot * STRIDE;
    let k0 = s0[b];
    if (k0 < 0.0) {
      return -1;
    }
    if (k0 == klo && s0[b + 1u] == khi) {
      return i32(slot);
    }
    slot = (slot + 1u) & P.cap_mask;
  }
  return -1;
}

fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  if (P.which == 3u) {
    let m = textureLoad(t1, p, 0);
    if (!island_valid(m)) {
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    return vec4f(island_rand(m, P.seed), 0.0, 0.0, 1.0);
  }
  let c = textureLoad(t0, p, 0);
  if (c.x < 0.0) {
    if (P.which == 2u) {
      return uvf_pack(vec2f(0.0), uv, P.uv_mode);
    }
    return vec4f(0.0, 0.0, 0.0, select(0.0, 1.0, P.which == 1u));
  }
  let root = unpack(c);
  let slot = find_slot(u32(root.y) * u32(F.full_res.x) + u32(root.x));
  var bmin = vec2f(p);
  var size = vec2f(1.0);
  var cen = vec2f(p) + vec2f(0.5);
  var cnt = 1.0;
  if (slot >= 0) {
    let b = u32(slot) * STRIDE;
    let mn = vec2f(s0[b + 2u], s0[b + 3u]);
    let mx = vec2f(s0[b + 4u], s0[b + 5u]);
    bmin = vec2f(root) + mn;
    size = mx - mn + vec2f(1.0);
    cen = vec2f(root) + vec2f(s0[b + 7u], s0[b + 8u]) + vec2f(0.5);
    cnt = s0[b + 6u];
  }
  if (P.which == 0u) {
    return vec4f(bmin / F.full_res, size / F.full_res);
  }
  if (P.which == 1u) {
    let frac = cnt / (F.full_res.x * F.full_res.y);
    return vec4f(clamp(frac / max(P.size_ref, 0.000001), 0.0, 1.0), 0.0, 0.0, 1.0);
  }
  var cu = cen / F.full_res;
  if (F.tile.x == 1u) {
    cu.x = cu.x - floor(cu.x);
  }
  if (F.tile.y == 1u) {
    cu.y = cu.y - floor(cu.y);
  }
  return uvf_pack(cu - uv, uv, P.uv_mode);
}
