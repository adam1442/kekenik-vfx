// utils.grid — generator. pattern 0 square grid, 1 bricks, 2 hex cells. Lines = distance to the nearest cell edge (in UV of the
// smaller cell side) < width; cell value = 1 - random * hash(wrapped cell id) (periodic, tiling-safe for integer counts).
// P.which: 0 = main output, 1 = cell id (random Gray per cell).
#include "hash"

const SQ3: f32 = 1.7320508;

fn parity(i: i32) -> bool {
  return (((i % 2) + 2) % 2) == 1;
}
fn wrap_u(i: i32, n: i32) -> u32 {
  return u32(((i % n) + n) % n);
}

fn shade(uv: vec2f) -> vec4f {
  let n = vec2f(P.cells);
  var edge_uv = 1.0;   // distance to the nearest edge in UV (min side)
  var hid = 0u;
  if (P.pattern == 2u) {
    // Hex lattice: period (1, sqrt3) per cell in lattice units; (cells.x, cells.y) cells tile the image exactly.
    let pp = (uv - P.offset) * vec2f(n.x, n.y * SQ3);
    let r = vec2f(1.0, SQ3);
    let h = r * 0.5;
    let a = pp - r * floor(pp / r) - h;
    let bp = pp - h;
    let b = bp - r * floor(bp / r) - h;
    let gv = select(b, a, dot(a, a) < dot(b, b));
    let q = abs(gv);
    let hd = max(dot(q, normalize(vec2f(1.0, SQ3))), q.x);
    edge_uv = (0.5 - hd) / n.x;
    let cid = (pp - gv);
    let ix = i32(round(cid.x * 2.0));
    let iy = i32(round(cid.y / SQ3 * 2.0));
    hid = hash_u(wrap_u(ix, P.cells.x * 2), wrap_u(iy, P.cells.y * 2), 5u, P.seed);
  } else {
    var p = (uv - P.offset) * n;
    let row = i32(floor(p.y));
    if (P.pattern == 1u && parity(row)) {
      p.x = p.x + P.brick_offset;
    }
    let cell = vec2i(i32(floor(p.x)), row);
    let l = p - floor(p);
    let dx = min(l.x, 1.0 - l.x) / n.x;
    let dy = min(l.y, 1.0 - l.y) / n.y;
    edge_uv = min(dx, dy);
    hid = hash_u(wrap_u(cell.x, P.cells.x), wrap_u(cell.y, P.cells.y), 5u, P.seed);
  }
  if (P.which == 1u) {
    return vec4f(u01(hid), 0.0, 0.0, 1.0);
  }
  let half_w = 0.5 * P.line_width * min(1.0 / n.x, 1.0 / n.y);
  let soft = max(P.softness * min(1.0 / n.x, 1.0 / n.y) * 0.5, 0.000001);
  let line = 1.0 - smoothstep(half_w - soft * 0.5, half_w + soft * 0.5, edge_uv);
  let cellv = 1.0 - P.random_amount * u01(hid);
  var v = line;
  if (P.output_kind == 1u) {
    v = cellv;
  } else if (P.output_kind == 2u) {
    v = mix(cellv, P.line_level, line);
  }
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(v, 0.0, 0.0, 1.0);
}
