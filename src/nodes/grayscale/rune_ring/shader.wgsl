// grayscale.rune_ring — procedural glyph ring. t0 = optional UV map, t1 = intensity modulation.
// Polar cell of the pixel: cell = floor(angle / 2pi * count), u = position inside the wedge (0..1). The glyph lives in a box of size `sz`
// (px) centred at radius R: local.x runs along the arc, local.y radially. A glyph = `complexity` segments between nodes of a g x g lattice
// chosen by hashes of (cell, segment, seed); the distance to the nearest segment gives round-capped strokes. Only ONE glyph is evaluated per pixel.
#include "hash"
#include "sampling"
#include "util"


fn rel_px(p: vec2f) -> vec2f {
  var rel = p - P.center;
  if (F.tile.x == 1u) {
    rel.x = rel.x - floor(rel.x + 0.5);
  }
  if (F.tile.y == 1u) {
    rel.y = rel.y - floor(rel.y + 0.5);
  }
  return rel * F.full_res;
}

fn seg_dist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

// Lattice node index -> position in the glyph box [-s/2, s/2]^2.
fn glyph_node(idx: u32, g: i32, s: f32) -> vec2f {
  let ix = i32(idx) % g;
  let iy = i32(idx) / g;
  let den = f32(max(g - 1, 1));
  return vec2f((f32(ix) / den - 0.5) * s, (f32(iy) / den - 0.5) * s);
}

fn glyph_sdf(p: vec2f, cell: u32, s: f32) -> f32 {
  let g = clamp(P.grid, 2, 5);
  let nn = u32(g * g);
  let nseg = clamp(P.complexity, 1, 8);
  var best = 1.0e6;
  for (var j = 0; j < nseg; j = j + 1) {
    let hj = hash_u(cell, u32(j) + 1u, 17u, F.seed + P.seed * 7919u);
    var ia = hj % nn;
    var ib = pcg(hj) % nn;
    if (ia == ib) {
      ib = (ib + 1u + (hj >> 8u) % (nn - 1u)) % nn;
    }
    if (j == 0 && P.stem == 1u) {
      // Vertical stem: top and bottom node of the middle column.
      let mid = u32(g / 2);
      ia = mid;
      ib = mid + u32((g - 1) * g);
    }
    let a = glyph_node(ia, g, s);
    let b = glyph_node(ib, g, s);
    best = min(best, seg_dist(p, a, b));
    if (P.mirror == 1u) {
      best = min(best, seg_dist(p, vec2f(-a.x, a.y), vec2f(-b.x, b.y)));
    }
  }
  return best;
}

fn shade(uv: vec2f) -> vec4f {
  var puv = uv;
  if (P.has_uv == 1u) {
    puv = mix(uv, tex_sample(t0, uv, F.tile, F.filter_mode).rg, P.uv_amount);
  }
  let side = min(F.full_res.x, F.full_res.y);
  let d = rel_px(puv);
  let r = length(d);
  let rr = max(P.radius * side, 2.0);
  let hh = max(P.glyph_height * side, 4.0);
  let n = max(P.count, 1);
  let ang = atan2(d.y, d.x) - radians(P.rotation);
  let cellf = ang / TAU * f32(n);
  let ci = floor(cellf);
  let u = cellf - ci;
  let cell = u32(((i32(ci) % n) + n) % n);
  let arc = TAU * rr / f32(n);
  let sz = min(hh, arc * (1.0 - clamp(P.gap, 0.0, 0.9)));
  let hw = max(P.stroke * side * 0.5, 0.5);
  let soft = clamp(P.softness, 0.0, 1.0);
  let local = vec2f((u - 0.5) * arc, r - rr);

  var glyph = 0.0;
  if (abs(local.y) <= sz * 0.5 + hw + 2.0) {
    let sdf = glyph_sdf(local, cell, sz);
    glyph = 1.0 - smoothstep(hw * (1.0 - soft) - 0.5, hw + 0.5, sdf);
  }
  // Per-glyph reveal (build-up) and flicker.
  let hg = u01(hash_u(cell, 99u, 3u, F.seed + P.seed * 7919u));
  let thr = hg * 0.8;
  let vis = clamp((P.reveal - thr) / 0.2, 0.0, 1.0);
  let bright = 1.0 - P.flicker * u01(hash_u(cell, 101u, 5u, F.seed + P.seed * 7919u));
  var v = glyph * vis * bright;

  if (P.ring_lines == 1u) {
    let rw = hw * 0.8;
    let rd = abs(abs(r - rr) - hh * 0.62);
    v = max(v, (1.0 - smoothstep(rw * (1.0 - soft) - 0.5, rw + 0.5, rd)) * clamp(P.reveal * 4.0, 0.0, 1.0));
  }
  let m = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  v = clamp(v * modulate(P.intensity, m, P.intensity_mod_k), 0.0, 1.0);
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(v, 0.0, 0.0, 1.0);
}
