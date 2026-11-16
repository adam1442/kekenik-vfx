// noise.wgsl — periodic 3D value / gradient noise primitives.
// `period` is the lattice period in cells per axis (0 = not periodic). With integer frequency == period the
// pattern wraps seamlessly. The 3rd axis is typically time: period.z = number of z cells per loop.
#include "hash"

fn fade5(t: vec3f) -> vec3f {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Value noise in [0,1].
fn value_noise3(p: vec3f, period: vec3i, seed: u32) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let i = vec3i(ip);
  let u = fade5(f);
  let c000 = u01(lattice_hash(i + vec3i(0, 0, 0), period, seed));
  let c100 = u01(lattice_hash(i + vec3i(1, 0, 0), period, seed));
  let c010 = u01(lattice_hash(i + vec3i(0, 1, 0), period, seed));
  let c110 = u01(lattice_hash(i + vec3i(1, 1, 0), period, seed));
  let c001 = u01(lattice_hash(i + vec3i(0, 0, 1), period, seed));
  let c101 = u01(lattice_hash(i + vec3i(1, 0, 1), period, seed));
  let c011 = u01(lattice_hash(i + vec3i(0, 1, 1), period, seed));
  let c111 = u01(lattice_hash(i + vec3i(1, 1, 1), period, seed));
  let x00 = mix(c000, c100, u.x);
  let x10 = mix(c010, c110, u.x);
  let x01 = mix(c001, c101, u.x);
  let x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// One of 12 edge-centred gradients (Perlin's improved set), chosen from hash bits.
fn grad3(h: u32) -> vec3f {
  let a = f32(h & 1u) * 2.0 - 1.0;
  let b = f32((h >> 1u) & 1u) * 2.0 - 1.0;
  let c = f32((h >> 2u) & 1u) * 2.0 - 1.0;
  let k = (h >> 3u) % 3u;
  var g = vec3f(a, b, c);
  if (k == 0u) {
    g.x = 0.0;
  } else if (k == 1u) {
    g.y = 0.0;
  } else {
    g.z = 0.0;
  }
  return g;
}

fn perlin_corner(i: vec3i, o: vec3i, d: vec3f, period: vec3i, seed: u32) -> f32 {
  return dot(grad3(lattice_hash(i + o, period, seed) >> 4u), d - vec3f(o));
}

// Gradient (Perlin) noise, approximately in [-1,1].
fn perlin3(p: vec3f, period: vec3i, seed: u32) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let i = vec3i(ip);
  let u = fade5(f);
  let n000 = perlin_corner(i, vec3i(0, 0, 0), f, period, seed);
  let n100 = perlin_corner(i, vec3i(1, 0, 0), f, period, seed);
  let n010 = perlin_corner(i, vec3i(0, 1, 0), f, period, seed);
  let n110 = perlin_corner(i, vec3i(1, 1, 0), f, period, seed);
  let n001 = perlin_corner(i, vec3i(0, 0, 1), f, period, seed);
  let n101 = perlin_corner(i, vec3i(1, 0, 1), f, period, seed);
  let n011 = perlin_corner(i, vec3i(0, 1, 1), f, period, seed);
  let n111 = perlin_corner(i, vec3i(1, 1, 1), f, period, seed);
  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
