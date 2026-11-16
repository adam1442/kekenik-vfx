// uv.noise — tileable, loopable noise WARP. mode 0 = vector (two independent fBm channels), 1 = curl (divergence free,
// flow-like swirls), 2 = angle (noise -> direction, constant speed: flowmap look). Periodic on tiling axes (integer
// lattice frequency per octave) and loops in Z (evolution 0 == 1, z_cells layers).
#include "noise"
#include "util"
#include "uvfield"

fn fbm_n(p: vec2f, per: vec2i, zc: i32, z: f32, seed: u32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  var q = p;
  var pr = per;
  for (var o = 0; o < P.octaves; o = o + 1) {
    sum = sum + amp * perlin3(vec3f(q, z), vec3i(pr.x, pr.y, zc), seed + u32(o) * 7919u);
    norm = norm + amp;
    amp = amp * P.roughness;
    q = q * f32(P.lacunarity);
    pr = pr * P.lacunarity;
  }
  return sum / norm;
}

fn shade(uv: vec2f) -> vec4f {
  let asp = uvf_aspect(F.full_res);
  let tx = F.tile.x == 1u;
  let ty = F.tile.y == 1u;
  let sc = vec2f(select(P.scale.x, round(max(P.scale.x, 1.0)), tx), select(P.scale.y, round(max(P.scale.y, 1.0)), ty));
  let per = vec2i(select(0, i32(sc.x), tx), select(0, i32(sc.y), ty));
  let p = (uv - vec2f(0.5) + P.offset) * sc;
  let z = P.evolution * f32(P.z_cells);
  let ms = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let s = modulate(P.strength, ms, P.strength_mod_k);
  var d = vec2f(0.0);
  if (P.mode == 0u) {
    d = vec2f(fbm_n(p, per, P.z_cells, z, P.seed), fbm_n(p + vec2f(31.7, 17.3), per, P.z_cells, z, P.seed ^ 0x51ed270bu)) * 1.5;
  } else if (P.mode == 1u) {
    let e = 0.02;
    let dy = fbm_n(p + vec2f(0.0, e), per, P.z_cells, z, P.seed) - fbm_n(p - vec2f(0.0, e), per, P.z_cells, z, P.seed);
    let dx = fbm_n(p + vec2f(e, 0.0), per, P.z_cells, z, P.seed) - fbm_n(p - vec2f(e, 0.0), per, P.z_cells, z, P.seed);
    d = vec2f(dy, -dx) * (0.6 / (2.0 * e));
  } else {
    let a = TAU * (0.5 + 0.75 * fbm_n(p, per, P.z_cells, z, P.seed));
    d = vec2f(cos(a), sin(a));
  }
  return uvf_pack(d * s / asp, uv, P.uv_mode);
}
