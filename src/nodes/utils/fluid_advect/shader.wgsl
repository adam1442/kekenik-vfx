// utils.fluid_advect — multi-step curl-noise ADVECTION of the input (Gray / Color). Gives the thin curling tendrils of
// stylised fluid smoke from ANY simple input (disc, star, line, ...): the input is looked up at a position that has been
// pushed backwards along a divergence-free velocity field N times (semi-Lagrangian advection, no feedback buffers).
//   q0 = uv;   q_{i+1} = q_i - v_i(q_i) * w_i          v_i = curl( fBm(q_i * scale * freq_gain^i) )
// Every step uses a finer lattice (freq_gain) and a smaller weight (step_decay), so large swirls are refined by smaller curls.
// t0 = input, t1 = optional modulation of `strength`. All lattices are periodic when the node tiles (integer cell counts
// per step) and loop seamlessly in Z (evolution 0 -> 1 with z_cells layers).
#include "noise"
#include "util"
#include "sampling"

// Periodic fBm of perlin3 (about [-1, 1]).
fn fbm_a(p: vec2f, per: vec2i, z: f32, salt: u32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  var q = p;
  var pr = per;
  for (var o = 0; o < P.octaves; o = o + 1) {
    sum = sum + amp * perlin3(vec3f(q, z), vec3i(pr.x, pr.y, P.z_cells), P.seed + salt + u32(o) * 7919u);
    norm = norm + amp;
    amp = amp * P.roughness;
    q = q * 2.0;
    pr = pr * 2;
  }
  return sum / max(norm, 0.0001);
}

fn shade(uv: vec2f) -> vec4f {
  let asp = F.full_res / min(F.full_res.x, F.full_res.y);
  let tx = F.tile.x == 1u;
  let ty = F.tile.y == 1u;
  let ms = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  let strength = modulate(P.strength, ms, P.strength_mod_k);
  let z = P.evolution * f32(P.z_cells);
  let n = clamp(P.steps, 1, 16);
  // Normalise the step weights so that `strength` is the total displacement whatever the number of steps.
  var wsum = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    wsum = wsum + pow(P.step_decay, f32(i));
  }
  var q = uv;
  for (var i = 0; i < n; i = i + 1) {
    let fi = f32(i);
    var sc = P.scale * pow(P.freq_gain, fi);
    sc = vec2f(select(sc.x, round(max(sc.x, 1.0)), tx), select(sc.y, round(max(sc.y, 1.0)), ty));
    let per = vec2i(select(0, i32(sc.x), tx), select(0, i32(sc.y), ty));
    let p = (q - vec2f(0.5) + P.offset) * sc;
    let salt = u32(i) * 40503u;
    let e = 0.02;
    let a_y1 = fbm_a(p + vec2f(0.0, e), per, z, salt);
    let a_y0 = fbm_a(p - vec2f(0.0, e), per, z, salt);
    let a_x1 = fbm_a(p + vec2f(e, 0.0), per, z, salt);
    let a_x0 = fbm_a(p - vec2f(e, 0.0), per, z, salt);
    let k = 0.6 / (2.0 * e);
    let curl = vec2f(a_y1 - a_y0, -(a_x1 - a_x0)) * k;
    let grd = vec2f(a_x1 - a_x0, a_y1 - a_y0) * k;
    let v = mix(curl, grd, clamp(P.divergence, 0.0, 1.0));
    let w = pow(P.step_decay, fi) / wsum;
    q = q - (v * strength * w) / asp - P.drift * w;
  }
  return tex_sample(t0, q, F.tile, F.filter_mode);
}
