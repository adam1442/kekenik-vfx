// grayscale.lightning — procedural, animatable lightning bolt with branches, glow and a "strike" reveal.
// Bindings are generated (see passes.ts): F = Frame, P = Params (layout in definition.ts), t0 = optional UV map.
//
// Model: the bolt is a single-valued polyline displaced PERPENDICULAR to the straight axis start -> end:
//     offset(t) = jag * L * env(t) * fractal_linear_noise(t)       t in [0,1] along the axis, L = axis length (px)
// The noise is a sum of octaves of LINEAR interpolated lattice values (=> sharp zig-zag kinks, the classic bolt look).
// `evolution` cross-fades between integer "layers" of lattice values (smooth morph), `seed` jumps to a new bolt.
// Distance to the curve is approximated by |s - offset(t)| / sqrt(1 + slope^2) (exact for straight segments), with
// round caps at both ends. Branches are the same construction attached to the main bolt (up to 6).
// Everything is evaluated in PIXELS of the full image so the look is resolution independent.
#include "hash"
#include "sampling"
#include "util"


// Lattice value in [-1, 1] for lattice index i, octave o, bolt salt, evolution layer.
fn lat(i: i32, o: u32, salt: u32, layer: i32) -> f32 {
  let h = hash_u(u32(i + 8192), o + salt * 16u, u32(layer + 8192), F.seed + P.seed * 7919u);
  return u01(h) * 2.0 - 1.0;
}

// Returns (value in about [-1, 1], slope d value / d t).
fn jag(t: f32, salt: u32) -> vec2f {
  var v = 0.0;
  var sl = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  let ev = P.evolution;
  let e0 = floor(ev);
  let ef = ev - e0;
  let es = ef * ef * (3.0 - 2.0 * ef);
  let l0 = i32(e0);
  let oct = clamp(P.octaves, 1, 8);
  for (var o = 0; o < oct; o = o + 1) {
    let f = f32(max(P.segments, 1)) * exp2(f32(o));
    let x = t * f;
    let i = i32(floor(x));
    let fr = x - f32(i);
    let a0 = mix(lat(i, u32(o), salt, l0), lat(i, u32(o), salt, l0 + 1), es);
    let a1 = mix(lat(i + 1, u32(o), salt, l0), lat(i + 1, u32(o), salt, l0 + 1), es);
    v = v + amp * mix(a0, a1, fr);
    sl = sl + amp * (a1 - a0) * f;
    norm = norm + amp;
    amp = amp * clamp(P.roughness, 0.0, 1.0);
  }
  return vec2f(v, sl) / max(norm, 0.0001);
}

// Envelope that pins the displacement: both ends for the main bolt, only the start for branches.
fn envelope(t: f32, pin_end: bool) -> f32 {
  let a = smoothstep(0.0, 0.16, t);
  if (pin_end) {
    return a * smoothstep(1.0, 0.84, t);
  }
  return a;
}

// Point on the main bolt at parameter t (needed to attach branches).
fn main_point(a0: vec2f, a1: vec2f, t: f32) -> vec2f {
  let ax = a1 - a0;
  let len = max(length(ax), 1.0);
  let a = ax / len;
  let n = vec2f(-a.y, a.x);
  let off = jag(t, 1u).x * P.jag * len * envelope(t, true);
  return a0 + a * (len * t) + n * off;
}

// Distance (px) from p to the displaced segment a0 -> a1, and the clamped parameter along it: returns (d, t, t_unclamped).
fn bolt_dist(p: vec2f, a0: vec2f, a1: vec2f, jag_amp: f32, salt: u32, pin_end: bool) -> vec3f {
  let ax = a1 - a0;
  let len = max(length(ax), 1.0);
  let a = ax / len;
  let n = vec2f(-a.y, a.x);
  let r = p - a0;
  let t = dot(r, a) / len;
  let s = dot(r, n);
  let tt = clamp(t, 0.0, 1.0);
  let env = envelope(tt, pin_end);
  let j = jag(tt, salt);
  let off = j.x * jag_amp * len * env;
  let slope = j.y * jag_amp * env;
  let dperp = abs(s - off) * inverseSqrt(1.0 + slope * slope);
  let dcap = length(vec2f(s - off, (t - tt) * len));
  let outside = t < 0.0 || t > 1.0;
  return vec3f(select(dperp, dcap, outside), tt, t);
}

fn shade(uv: vec2f) -> vec4f {
  var puv = uv;
  if (P.has_uv == 1u) {
    puv = mix(uv, tex_sample(t0, uv, F.tile, F.filter_mode).rg, P.uv_amount);
  }
  // Tiling: use the periodic image of the pixel that is nearest to the bolt centre.
  let mid = (P.start + P.end) * 0.5;
  var rel = puv - mid;
  if (F.tile.x == 1u) {
    rel.x = rel.x - round(rel.x);
  }
  if (F.tile.y == 1u) {
    rel.y = rel.y - round(rel.y);
  }
  let p = (mid + rel) * F.full_res;
  let a0 = P.start * F.full_res;
  let a1 = P.end * F.full_res;
  let side = min(F.full_res.x, F.full_res.y);
  let wpx = max(P.width * side, 0.35);
  let gr = max(P.glow_radius * side, 1.0);
  let soft = clamp(P.softness, 0.0, 1.0);
  let rev = clamp(P.reveal, 0.0, 1.0);
  let rs = max(P.reveal_soft, 0.001);
  let rr = rev * (1.0 + rs);

  // ---------------------------------------------------------------- main bolt
  let m = bolt_dist(p, a0, a1, P.jag, 1u, true);
  let wm = wpx * mix(1.0, P.taper, m.y);
  let vis = 1.0 - smoothstep(rr - rs, rr, max(m.z, 0.0));
  var core = (1.0 - smoothstep(wm * (1.0 - soft) - 0.5, wm + 0.5, m.x)) * vis;
  var halo = exp(-(m.x * m.x) / (2.0 * gr * gr)) * vis;
  // Bright "head" while the strike is travelling.
  if (rev < 1.0) {
    let head = exp(-pow((m.z - rev * (1.0 + rs)) * length(a1 - a0) / (gr * 2.0), 2.0)) * exp(-(m.x * m.x) / (2.0 * gr * gr));
    halo = max(halo, head * 1.2);
  }

  // ---------------------------------------------------------------- branches
  let nb = clamp(P.branches, 0, 6);
  for (var b = 0; b < nb; b = b + 1) {
    let hb = hash_u(u32(b) + 11u, 3u, 5u, F.seed + P.seed * 7919u);
    let t0 = mix(0.12, 0.82, u01(hb));
    let sgn = select(-1.0, 1.0, u01(pcg(hb)) > 0.5);
    let ang = radians(P.branch_angle * (0.6 + 0.8 * u01(pcg(hb + 1u)))) * sgn;
    let blen = length(a1 - a0) * P.branch_length * (0.55 + 0.45 * u01(pcg(hb + 2u)));
    let ax = normalize(a1 - a0);
    let cs = cos(ang);
    let sn = sin(ang);
    let dir = vec2f(ax.x * cs - ax.y * sn, ax.x * sn + ax.y * cs);
    let pb = main_point(a0, a1, t0);
    let pe = pb + dir * blen;
    let bd = bolt_dist(p, pb, pe, P.jag * P.branch_jag, 2u + u32(b), false);
    let wb = wpx * P.branch_width * (1.0 - 0.75 * bd.y);
    // Branch grows after the main strike passed its attachment point.
    let rbb = clamp((rr - t0) / max(1.0 + rs - t0, 0.05), 0.0, 1.0) * (1.0 + rs);
    let visb = 1.0 - smoothstep(rbb - rs, rbb, max(bd.z, 0.0));
    let fade = 1.0 - 0.6 * bd.y;
    core = max(core, (1.0 - smoothstep(wb * (1.0 - soft) - 0.5, wb + 0.5, bd.x)) * visb * fade);
    halo = max(halo, exp(-(bd.x * bd.x) / (2.0 * gr * gr * 0.5)) * visb * fade * 0.7);
  }

  var v = (core + halo * P.glow) * P.intensity;
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0);
}
