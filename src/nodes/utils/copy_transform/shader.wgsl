// utils.copy_transform — scatter N transformed copies of the input pattern, FAST: grid-bucketed pixel shader.
// The image is split into G x G cells (G = ceil(sqrt(N))). Copy k lives in cell (k * a) mod G^2 (a coprime with G^2, so the N
// copies occupy N DISTINCT cells); each pixel only visits the (2R+1)^2 cells around it, R from the maximum copy extent.
// Cost is O(R^2) per pixel, independent of N. A cell is active when (L * inv_a) mod M < N (L = linear cell id).
// t0 = pattern (a stamp: UV 0..1 is the copy's own rectangle), t1 = scale map (Gray, sampled at copy centre, optional),
// t2 = distribution mask (Gray, copy kept when mask(centre) > random, optional).
#include "sampling"
#include "hash"

fn shade(uv: vec2f) -> vec4f {
  let G = P.grid;
  let side = min(F.res.x, F.res.y);
  let aspect = F.res / side;               // uv delta -> side units
  let base = vec2i(floor((uv - P.offset) * f32(G)));
  var acc = vec4f(0.0);
  var top_k = -1;
  var top_c = vec4f(0.0);
  var under = vec4f(0.0);
  for (var j = -P.reach; j <= P.reach; j = j + 1) {
    for (var i = -P.reach; i <= P.reach; i = i + 1) {
      var cell = base + vec2i(i, j);
      if (F.tile.x == 1u) {
        cell.x = ((cell.x % G) + G) % G;
      } else if (cell.x < 0 || cell.x >= G) {
        continue;
      }
      if (F.tile.y == 1u) {
        cell.y = ((cell.y % G) + G) % G;
      } else if (cell.y < 0 || cell.y >= G) {
        continue;
      }
      let lin = u32(cell.y * G + cell.x);
      let k = (lin * P.inv_a) % P.cells_total;
      if (k >= P.count) {
        continue;
      }
      let h0 = hash_u(k, 17u, 3u, P.seed);
      let h1 = pcg(h0 ^ 0x68e31da4u);
      let h2 = pcg(h1 ^ 0xb5297a4du);
      let h3 = pcg(h2 ^ 0x1b56c4e9u);
      let h4 = pcg(h3 ^ 0x7feb352du);
      let h5 = pcg(h4 ^ 0x846ca68bu);
      var cen = (vec2f(cell) + vec2f(0.5) + (vec2f(u01(h0), u01(h1)) - vec2f(0.5)) * P.jitter) / f32(G) + P.offset;
      var sc = mix(P.scale_min, P.scale_max, u01(h2)) * P.size;
      if (P.has_scale_map == 1u) {
        sc = sc * tex_sample(t1, fract(cen), vec2u(1u, 1u), 1u).r;
      }
      if (P.has_mask == 1u) {
        if (tex_sample(t2, fract(cen), vec2u(1u, 1u), 1u).r <= u01(h5)) {
          continue;
        }
      }
      var d = uv - cen;
      if (F.tile.x == 1u) {
        d.x = d.x - round(d.x);
      }
      if (F.tile.y == 1u) {
        d.y = d.y - round(d.y);
      }
      let ds = d * aspect;                  // side units
      let rot = mix(P.rot_min, P.rot_max, u01(h3));
      let cs = cos(rot);
      let sn = sin(rot);
      let q = vec2f(cs * ds.x + sn * ds.y, -sn * ds.x + cs * ds.y) / max(sc, 0.00001) + vec2f(0.5);
      if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) {
        continue;
      }
      var c = tex_sample(t0, q, vec2u(0u, 0u), F.filter_mode) * mix(P.value_min, P.value_max, u01(h4));
      if (P.combine == 0u) {
        acc = max(acc, c);
      } else if (P.combine == 1u) {
        acc = acc + c;
      } else {
#if COLOR == 1
        let cov = c.a;
#else
        let cov = clamp(c.r, 0.0, 1.0);
#endif
        if (cov > 0.001) {
          if (i32(k) > top_k) {
            under = max(under, top_c);
            top_k = i32(k);
            top_c = c;
          } else {
            under = max(under, c);
          }
        }
      }
    }
  }
  if (P.combine == 2u) {
    if (top_k < 0) {
      return vec4f(0.0);
    }
#if COLOR == 1
    let cov2 = clamp(top_c.a, 0.0, 1.0);
#else
    let cov2 = clamp(top_c.r, 0.0, 1.0);
#endif
    return mix(under, top_c, cov2);
  }
  return acc;
}
