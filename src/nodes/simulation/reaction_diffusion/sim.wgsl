// Reaction Diffusion (Gray-Scott), state = (A, B, 0, 1). PASS 0 init (t1 seed mask), PASS 1 step (t0 state, t1 seed mask, t2 feed map, t3 kill map).
// dA = Da lap(A) - A B^2 + f (1 - A);  dB = Db lap(B) + A B^2 - (f + k) B.  9-point laplacian, explicit Euler, dt clamped for stability.
#include "simgrid"
const PERIODIC_TILE_GUARD: u32 = 1u;
#if PASS == 0
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let n = vec2f(P.sim_res);
  let uv = (vec2f(c) + vec2f(0.5)) / n;
  let asp = n / min(n.x, n.y);
  var b = 0.0;
  switch (P.seed_mode) {
    case 0u: {
      let cell = c / max(P.seed_cells, 1);
      b = select(0.0, 1.0, sg_rand(cell, P.seed, 0u) < P.seed_density);
    }
    case 1u: {
      b = select(0.0, 1.0, length((uv - P.seed_pos) * asp) < P.seed_radius);
    }
    case 2u: {
      let g = f32(max(P.seed_points, 1));
      let cell = vec2i(floor(uv * g));
      let sp = (vec2f(cell) + vec2f(0.3) + 0.4 * vec2f(sg_rand(cell, P.seed, 1u), sg_rand(cell, P.seed, 2u))) / g;
      b = select(0.0, 1.0, length((uv - sp) * asp) < P.seed_radius);
    }
    default: {}
  }
  if (P.has_seed_mask == 1u) {
    b = max(b, select(0.0, 1.0, sg_in(t1, uv, P.periodic_b == 1u).r > 0.5));
  }
  return vec4f(1.0 - 0.5 * b, b * 0.25 + 0.0, 0.0, 1.0);
}
#else
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  let per = P.periodic_b == 1u;
  let n = vec2f(P.sim_res);
  let uv = (vec2f(c) + vec2f(0.5)) / n;
  let s = textureLoad(t0, c, 0);
  let lap = sg_lap9(t0, c, per);
  var f = P.feed;
  var k = P.kill;
  if (P.has_feed_map == 1u) { f = f + (sg_in(t2, uv, per).r - 0.5) * 2.0 * P.map_range; }
  if (P.has_kill_map == 1u) { k = k + (sg_in(t3, uv, per).r - 0.5) * 2.0 * P.map_range; }
  let a = s.x;
  let b = s.y;
  let abb = a * b * b;
  let dt = min(P.step_size, 1.2 / max(max(P.diff_a, P.diff_b), 1e-3));
  var na = a + dt * (P.diff_a * lap.x - abb + f * (1.0 - a));
  var nb = b + dt * (P.diff_b * lap.y + abb - (f + k) * b);
  if (P.mask_continuous == 1u && P.has_seed_mask == 1u && sg_in(t1, uv, per).r > 0.5) {
    nb = max(nb, 0.25);
    na = min(na, 0.5);
  }
  return vec4f(clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 0.0, 1.0);
}
#endif
