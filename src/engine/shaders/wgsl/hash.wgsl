// hash.wgsl — PCG integer hashing and PERIODIC lattice hashing (the basis of every tileable generator).
// CPU mirror: src/engine/shaders/reference/noise.ts (known-answer tests compare GPU vs CPU).

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

// Hash of 3 integers + seed.
fn hash_u(a: u32, b: u32, c: u32, seed: u32) -> u32 {
  return pcg(a + pcg(b + pcg(c + pcg(seed))));
}

// Uniform float in [0,1) with 24 bits (exactly representable in f32).
fn u01(h: u32) -> f32 {
  return f32(h >> 8u) * (1.0 / 16777216.0);
}

// Wrap integer lattice coordinate into [0, period). period <= 0 means "no wrapping" (non-tiling axis).
fn wrap_i(i: i32, period: i32) -> i32 {
  if (period <= 0) {
    return i;
  }
  let m = i % period;
  return select(m, m + period, m < 0);
}

// Periodic lattice hash: the value at lattice point c repeats every `period` cells on each axis.
fn lattice_hash(c: vec3i, period: vec3i, seed: u32) -> u32 {
  let w = vec3i(wrap_i(c.x, period.x), wrap_i(c.y, period.y), wrap_i(c.z, period.z));
  return hash_u(bitcast<u32>(w.x), bitcast<u32>(w.y), bitcast<u32>(w.z), seed);
}

// Two independent floats in [0,1) per lattice point (e.g. jittered points for cellular patterns).
fn lattice_rand2(c: vec3i, period: vec3i, seed: u32) -> vec2f {
  let h = lattice_hash(c, period, seed);
  return vec2f(u01(h), u01(pcg(h ^ 0x9e3779b9u)));
}
