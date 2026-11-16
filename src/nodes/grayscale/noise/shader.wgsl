// grayscale.noise (v2) — tileable, loopable fBm of 13 base noise types.
// Bindings are generated (see passes.ts): F = Frame, P = Params (layout in definition.ts),
//   t0 = contrast modulation texture, t1 = optional UV map (domain warp).
// Types (enum order == definition.ts): 0 value, 1 perlin, 2 simplex, 3 cubic, 4 billow, 5 ridged, 6 gabor,
//   7 worley F1, 8 worley F2, 9 worley F2-F1, 10 cracks, 11 cell id, 12 voronoi (distance to cell border).
// Every type is periodic on tiling axes (integer lattice frequency) and loops in Z (evolution 0 == 1).
// CPU mirror for value/perlin: ./reference.ts (known-answer tests compare GPU vs CPU).
#include "noise"
#include "sampling"
#include "util"

const SQRT3_2: f32 = 0.8660254037844386;
// Normalisation of the periodic simplex kernel sum to roughly [-1, 1] (measured: max abs 0.0625, std 0.034 over random gradients).
const SIMPLEX_NORM: f32 = 14.0;

/* ------------------------------------------------------------------ helpers */

fn floor_div(a: i32, b: i32) -> i32 {
  return (a - wrap_i(a, b)) / b;
}

// Flow-noise speed: integer number of turns per loop (1..zc) so that evolution 1 returns to the start.
fn turns_per_loop(h: u32, zc: i32) -> f32 {
  return f32(1 + i32((h >> 13u) % u32(max(zc, 1))));
}

/* ------------------------------------------------------------------ cubic (B-spline) value noise */

fn bspline_w(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  let omt = 1.0 - t;
  return vec4f(omt * omt * omt / 6.0, (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0, (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0, t3 / 6.0);
}

fn cubic_noise3(p: vec3f, period: vec3i, seed: u32) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let i = vec3i(ip);
  let wx = bspline_w(f.x);
  let wy = bspline_w(f.y);
  let zt = f.z * f.z * (3.0 - 2.0 * f.z);
  var a0 = 0.0;
  var a1 = 0.0;
  for (var j = 0; j < 4; j = j + 1) {
    for (var k = 0; k < 4; k = k + 1) {
      let c = i + vec3i(k - 1, j - 1, 0);
      let w = wx[k] * wy[j];
      a0 = a0 + w * u01(lattice_hash(c, period, seed));
      a1 = a1 + w * u01(lattice_hash(c + vec3i(0, 0, 1), period, seed));
    }
  }
  // B-spline smoothing narrows the distribution: stretch it back around 0.5.
  return clamp(0.5 + (mix(a0, a1, zt) - 0.5) * 1.5, 0.0, 1.0);
}

/* ------------------------------------------------------------------ periodic simplex (equilateral triangle lattice) */
// Lattice vectors a = (1,0), b = (1/2, sqrt3/2). With W cells across and H (even) rows, the shift (W,0) and (-H/2,H) in
// skewed lattice indices are exact periods -> seamless on a rectangular tile. Z = gradient rotation (flow noise).

fn simplex_hash(c: vec2i, W: i32, H: i32, seed: u32) -> u32 {
  var i = c.x;
  var j = c.y;
  if (H > 0) {
    let k = floor_div(j, H);
    j = j - k * H;
    i = i + k * (H / 2);
  }
  if (W > 0) {
    i = wrap_i(i, W);
  }
  return hash_u(bitcast<u32>(i), bitcast<u32>(j), 7u, seed);
}

fn simplex_corner(c: vec2i, d: vec2f, W: i32, H: i32, ev: f32, zc: i32, seed: u32) -> f32 {
  let t = 0.75 - dot(d, d);
  if (t <= 0.0) {
    return 0.0;
  }
  let h = simplex_hash(c, W, H, seed);
  let ang = TAU * (u01(h) + ev * turns_per_loop(h, zc));
  let t2 = t * t;
  return t2 * t2 * dot(vec2f(cos(ang), sin(ang)), d);
}

fn simplex_noise(p: vec2f, ev: f32, period: vec2i, zc: i32, seed: u32) -> f32 {
  let s = p.x - 0.5 * p.y;
  let t = p.y;
  let i = vec2i(floor(vec2f(s, t)));
  let fs = s - floor(s);
  let ft = t - floor(t);
  var sum = 0.0;
  // Two triangles per rhombus, split along the short diagonal (a <-> b).
  var o0 = vec2i(0, 0);
  var o1 = vec2i(1, 0);
  var o2 = vec2i(0, 1);
  if (fs + ft >= 1.0) {
    o0 = vec2i(1, 1);
  }
  let offs = array<vec2i, 3>(o0, o1, o2);
  for (var k = 0; k < 3; k = k + 1) {
    let o = offs[k];
    let ds = fs - f32(o.x);
    let dt = ft - f32(o.y);
    let d = vec2f(ds + 0.5 * dt, dt * SQRT3_2);
    sum = sum + simplex_corner(i + o, d, period.x, period.y, ev, zc, seed);
  }
  return clamp(0.5 + 0.5 * sum * SIMPLEX_NORM, 0.0, 1.0);
}

/* ------------------------------------------------------------------ gabor (sparse convolution) */

fn gabor_noise(p: vec2f, ev: f32, period: vec2i, zc: i32, seed: u32) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let i = vec2i(ip);
  let per3 = vec3i(period.x, period.y, 0);
  var sum = 0.0;
  for (var dj = -1; dj <= 1; dj = dj + 1) {
    for (var di = -1; di <= 1; di = di + 1) {
      let c = vec2i(di, dj);
      let h0 = lattice_hash(vec3i(i + c, 0), per3, seed);
      for (var k = 0u; k < 2u; k = k + 1u) {
        let h = pcg(h0 + k * 0x68e31da4u);
        let h2 = pcg(h ^ 0xb5297a4du);
        let h3 = pcg(h2 ^ 0x1b56c4e9u);
        let pos = vec2f(u01(h), u01(h2));
        let delta = f - (vec2f(c) + pos);
        let r2 = dot(delta, delta);
        if (r2 < 1.0) {
          let spin = TAU * ev * turns_per_loop(h3, zc);
          let ang = mix(radians(P.gabor_angle), TAU * u01(h3), P.gabor_spread) + spin;
          let dir = vec2f(cos(ang), sin(ang));
          let ph = TAU * (u01(pcg(h3 + 1u)) + ev * turns_per_loop(pcg(h3 + 2u), zc));
          sum = sum + exp(-4.9 * r2) * cos(TAU * P.gabor_freq * dot(delta, dir) + ph);
        }
      }
    }
  }
  return clamp(0.5 + 0.28 * sum, 0.0, 1.0);
}

/* ------------------------------------------------------------------ cellular (Worley / Voronoi) */

fn cell_metric(d: vec2f) -> f32 {
  if (P.metric == 0u) {
    return length(d);
  }
  if (P.metric == 1u) {
    return (abs(d.x) + abs(d.y)) * 0.70710678;
  }
  return max(abs(d.x), abs(d.y));
}

// Feature point of lattice cell c (position inside the cell, 0..1), animated along Z by interpolating two random layers.
fn cell_point(c: vec2i, ev: f32, period: vec2i, zc: i32, seed: u32) -> vec2f {
  let zf = ev * f32(zc);
  let zi = i32(floor(zf));
  let zt = zf - floor(zf);
  let per3 = vec3i(period.x, period.y, zc);
  let a = lattice_rand2(vec3i(c, zi), per3, seed);
  let b = lattice_rand2(vec3i(c, zi + 1), per3, seed);
  let pt = mix(a, b, zt * zt * (3.0 - 2.0 * zt));
  return vec2f(0.5) + (pt - vec2f(0.5)) * P.jitter;
}

fn cell_hash_id(c: vec2i, period: vec2i, seed: u32) -> f32 {
  return u01(pcg(lattice_hash(vec3i(c, 0), vec3i(period, 0), seed ^ 0x2545f491u)));
}

fn cellular_noise(ty: u32, p: vec2f, ev: f32, period: vec2i, zc: i32, seed: u32) -> f32 {
  let ip = floor(p);
  let f = p - ip;
  let i = vec2i(ip);
  var f1 = 8.0;
  var f2 = 8.0;
  var c1 = vec2i(0, 0);
  var pt1 = vec2f(0.0);
  // 3x3 neighbourhood (exact for euclidean metric with jitter <= 1; manhattan/chebyshev F2 may show tiny artefacts).
  for (var dj = -1; dj <= 1; dj = dj + 1) {
    for (var di = -1; di <= 1; di = di + 1) {
      let c = vec2i(di, dj);
      let pt = cell_point(i + c, ev, period, zc, seed);
      let d = cell_metric(vec2f(c) + pt - f);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        c1 = c;
        pt1 = pt;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  if (ty == 7u) {
    return clamp(f1, 0.0, 1.0);
  }
  if (ty == 8u) {
    return clamp(f2 * 0.75, 0.0, 1.0);
  }
  if (ty == 9u) {
    return clamp((f2 - f1) * 1.6, 0.0, 1.0);
  }
  if (ty == 10u) {
    // Cracks: thin bright network where the two nearest points are equally far.
    let w = max(P.edge_width, 0.0001);
    return 1.0 - smoothstep(0.0, w, f2 - f1);
  }
  if (ty == 11u) {
    return cell_hash_id(i + c1, period, seed);
  }
  // 12: distance to the Voronoi cell border (euclidean, two-pass method), 5x5 around the nearest cell.
  let pf = f;
  let p1 = vec2f(c1) + pt1;
  var md = 8.0;
  for (var dj = -2; dj <= 2; dj = dj + 1) {
    for (var di = -2; di <= 2; di = di + 1) {
      let c = c1 + vec2i(di, dj);
      let pk = vec2f(c) + cell_point(i + c, ev, period, zc, seed);
      let diff = pk - p1;
      let l2 = dot(diff, diff);
      if (l2 > 0.00001) {
        md = min(md, dot(0.5 * (p1 + pk) - pf, diff / sqrt(l2)));
      }
    }
  }
  return clamp(md * 2.0, 0.0, 1.0);
}

/* ------------------------------------------------------------------ one octave of any type */

fn noise_octave(ty: u32, p2: vec2f, ev: f32, period: vec2i, zc: i32, seed: u32) -> f32 {
  let p3 = vec3f(p2, ev * f32(zc));
  let per3 = vec3i(period.x, period.y, zc);
  switch (ty) {
    case 0u: {
      return value_noise3(p3, per3, seed);
    }
    case 1u: {
      return clamp(perlin3(p3, per3, seed) * 0.5 + 0.5, 0.0, 1.0);
    }
    case 2u: {
      return simplex_noise(p2, ev, period, zc, seed);
    }
    case 3u: {
      return cubic_noise3(p3, per3, seed);
    }
    case 4u: {
      // Billow: puffy clouds = |perlin|.
      return clamp(abs(perlin3(p3, per3, seed)) * 1.6, 0.0, 1.0);
    }
    case 5u: {
      // Ridged: sharp crests = (1 - |perlin|)^2.
      let r = 1.0 - clamp(abs(perlin3(p3, per3, seed)) * 1.6, 0.0, 1.0);
      return r * r;
    }
    case 6u: {
      return gabor_noise(p2, ev, period, zc, seed);
    }
    default: {
      return cellular_noise(ty, p2, ev, period, zc, seed);
    }
  }
}

fn quarter_turns(deg: f32) -> i32 {
  return ((i32(round(deg / 90.0)) % 4) + 4) % 4;
}

fn shade(uv: vec2f) -> vec4f {
  // ---- 1. optional UV map + procedural domain warp (both periodic in uv, so tiling is preserved)
  var puv = uv;
  if (P.has_uv == 1u) {
    let um = tex_sample(t1, uv, F.tile, F.filter_mode).rg;
    puv = mix(uv, um, P.uv_amount);
  }
  if (P.warp_amount != 0.0) {
    let wf = max(P.warp_freq, 1);
    let wper = vec3i(select(0, wf, F.tile.x == 1u), select(0, wf, F.tile.y == 1u), P.z_cells);
    let wp = vec3f(puv * f32(wf), P.evolution * f32(P.z_cells));
    let wx = value_noise3(wp, wper, P.seed ^ 0xa511e9b3u);
    let wy = value_noise3(wp + vec3f(17.3, 5.1, 0.0), wper, P.seed ^ 0x63d83595u);
    puv = puv + (vec2f(wx, wy) - vec2f(0.5)) * 2.0 * P.warp_amount;
  }

  // ---- 2. pattern transform: base = (R(-rot) * (uv + offset - 0.5) + 0.5) * scale (see gizmo.ts)
  var tile = F.tile;
  var d = puv + P.offset - vec2f(0.5);
  if (tile.x == 1u || tile.y == 1u) {
    // Seamless mode: only quarter turns (exact in UV space). Odd turns swap the axes the lattice has to wrap on.
    let q = quarter_turns(P.rotation);
    if (q == 1) {
      d = vec2f(d.y, -d.x);
      tile = vec2u(tile.y, tile.x);
    } else if (q == 2) {
      d = -d;
    } else if (q == 3) {
      d = vec2f(-d.y, d.x);
      tile = vec2u(tile.y, tile.x);
    }
  } else if (P.rotation != 0.0) {
    // Free rotation in PIXEL space (aspect correct) when nothing tiles.
    let a = radians(P.rotation);
    let sn = sin(a);
    let cs = cos(a);
    let pd = d * F.full_res;
    d = vec2f(pd.x * cs + pd.y * sn, -pd.x * sn + pd.y * cs) / F.full_res;
  }
  // Anisotropy: + squeezes the pattern horizontally (x frequency up), - vertically. Applied before lattice rounding.
  var sc = P.scale * vec2f(pow(4.0, max(P.anisotropy, 0.0)), pow(4.0, max(-P.anisotropy, 0.0)));
  var period = vec2i(0, 0);
  if (tile.x == 1u) {
    sc.x = max(round(sc.x), 1.0);
    period.x = i32(sc.x);
  }
  if (tile.y == 1u) {
    sc.y = max(round(sc.y), 1.0);
    if (P.noise_type == 2u) {
      // The triangle lattice needs an even number of rows to wrap vertically.
      sc.y = max(2.0 * round(sc.y * 0.5), 2.0);
    }
    period.y = i32(sc.y);
  }
  let base = (d + vec2f(0.5)) * sc;

  // ---- 3. fBm
  var sum = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  var f = 1;
  let any_tile = tile.x == 1u || tile.y == 1u;
  for (var i = 0; i < P.octaves; i = i + 1) {
    if (f32(f) * max(sc.x, sc.y) > 16384.0) {
      break;
    }
    var pp = base * f32(f);
    var per = period * f;
    let ang = P.octave_rotation * f32(i);
    if (ang != 0.0) {
      if (any_tile) {
        // Tiling: quarter turns only (the lattice must stay axis aligned to remain periodic).
        let q = quarter_turns(ang);
        if (q == 1) {
          pp = vec2f(pp.y, -pp.x);
          per = vec2i(per.y, per.x);
        } else if (q == 2) {
          pp = -pp;
        } else if (q == 3) {
          pp = vec2f(-pp.y, pp.x);
          per = vec2i(per.y, per.x);
        }
      } else {
        let a = radians(ang);
        let sn = sin(a);
        let cs = cos(a);
        pp = vec2f(pp.x * cs + pp.y * sn, -pp.x * sn + pp.y * cs);
      }
    }
    // Z axis = evolution/time. Period z_cells*f cells => evolution 0 and 1 are identical (seamless loop).
    let zc = P.z_cells * f;
    sum = sum + amp * noise_octave(P.noise_type, pp, P.evolution, per, zc, P.seed + u32(i) * 1013u);
    norm = norm + amp;
    amp = amp * P.roughness;
    f = f * P.lacunarity;
  }
  var v = sum / max(norm, 0.000001);

  // ---- 4. remap / contrast / bias / invert
  v = (v - P.remap_lo) / max(P.remap_hi - P.remap_lo, 0.0001);
  let m = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let contrast = modulate(P.contrast, m, P.contrast_mod_k);
  v = (v - 0.5) * contrast + 0.5 + P.brightness;
  if (abs(P.bias - 0.5) > 0.0001) {
    // Schlick bias: >0.5 pushes values up, <0.5 down; 0 and 1 stay fixed.
    let vb = clamp(v, 0.0, 1.0);
    v = vb / ((1.0 / max(P.bias, 0.0001) - 2.0) * (1.0 - vb) + 1.0);
  }
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0);
}
