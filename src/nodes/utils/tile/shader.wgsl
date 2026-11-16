// utils.tile — repeat / mirror the input in an integer grid with per-tile random offset, rotation, scale and flips, brick style
// row / column offsets, and a tile-id output (P.which = 1). All random values hash the WRAPPED integer cell id, so the result
// is periodic for any tile count (row / column offsets and mirroring need EVEN counts to close the seam).
#include "sampling"
#include "hash"

fn parity(i: i32) -> bool {
  return (((i % 2) + 2) % 2) == 1;
}

fn shade(uv: vec2f) -> vec4f {
  let n = vec2f(P.tiles);
  var p = (uv - P.offset) * n;
  let r0 = i32(floor(p.y));
  var px = p.x + select(0.0, P.row_offset, parity(r0));
  let c0 = i32(floor(px));
  let py = p.y + select(0.0, P.col_offset, parity(c0));
  let cell = vec2i(c0, i32(floor(py)));
  var local = vec2f(fract(px), fract(py));
  let wc = vec2u(u32(((cell.x % P.tiles.x) + P.tiles.x) % P.tiles.x), u32(((cell.y % P.tiles.y) + P.tiles.y) % P.tiles.y));
  let h0 = hash_u(wc.x, wc.y, 11u, P.seed);
  if (P.which == 1u) {
    return vec4f(u01(h0), 0.0, 0.0, 1.0);
  }
  let h1 = pcg(h0 ^ 0x85ebca6bu);
  let h2 = pcg(h1 ^ 0xc2b2ae35u);
  let h3 = pcg(h2 ^ 0x27d4eb2fu);
  let h4 = pcg(h3 ^ 0x165667b1u);
  let h5 = pcg(h4 ^ 0x9e3779b9u);
  var c = local - vec2f(0.5);
  if (P.mirror == 1u) {
    if (parity(cell.x)) {
      c.x = -c.x;
    }
    if (parity(cell.y)) {
      c.y = -c.y;
    }
  }
  if (P.rand_flip == 1u) {
    if (u01(h4) > 0.5) {
      c.x = -c.x;
    }
    if (u01(h5) > 0.5) {
      c.y = -c.y;
    }
  }
  let sc = 1.0 + (u01(h3) * 2.0 - 1.0) * P.rand_scale;
  c = c / max(sc, 0.01);
  var ang = (u01(h2) * 2.0 - 1.0) * P.rand_rot;
  if (P.rot90 == 1u) {
    ang = ang + floor(u01(pcg(h2)) * 4.0) * 1.5707963;
  }
  let cs = cos(ang);
  let sn = sin(ang);
  c = vec2f(cs * c.x + sn * c.y, -sn * c.x + cs * c.y);
  c = c - (vec2f(u01(h1), u01(pcg(h1))) * 2.0 - vec2f(1.0)) * P.rand_offset * 0.5;
  let s = c + vec2f(0.5);
  if (P.fill == 0u) {
    return tex_sample(t0, s, vec2u(1u, 1u), F.filter_mode);
  }
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) {
    return vec4f(0.0);
  }
  return tex_sample(t0, s, vec2u(0u, 0u), F.filter_mode);
}
