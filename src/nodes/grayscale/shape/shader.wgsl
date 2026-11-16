// grayscale.shape — SDF primitives with soft edge, bevel profile, outlines and repeat.
// Bindings are generated (see passes.ts): F = Frame, P = Params (layout in definition.ts), t0 = optional UV map.
// All distances are in PIXELS of the (repeat) cell, negative inside. Shapes are authored y-UP (flip applied once in
// shade()) so that "up" on screen is up. Types (enum order == definition.ts):
//   0 circle 1 ellipse 2 rounded rect 3 polygon 4 star 5 ring 6 arc 7 pie 8 cross 9 line 10 heart 11 drop 12 bolt 13 crescent
#include "sdf"
#include "shapes2d"
#include "sampling"
#include "util"

fn lut_at(i: i32) -> f32 {
  return P.profile_lut[i >> 2u][i & 3];
}
fn lut_eval(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * 63.0;
  let i = min(i32(floor(f)), 62);
  return mix(lut_at(i), lut_at(i + 1), f - f32(i));
}

fn sd_arc(p0: vec2f, sc: vec2f, ra: f32, rb: f32) -> f32 {
  let p = vec2f(abs(p0.x), p0.y);
  let near_end = sc.y * p.x > sc.x * p.y;
  return select(abs(length(p) - ra), length(p - sc * ra), near_end) - rb;
}

fn sd_pie(p0: vec2f, c: vec2f, r: f32) -> f32 {
  let p = vec2f(abs(p0.x), p0.y);
  let l = length(p) - r;
  let m = length(p - c * clamp(dot(p, c), 0.0, r));
  return max(l, m * select(-1.0, 1.0, c.y * p.x - c.x * p.y > 0.0));
}

fn dot2(v: vec2f) -> f32 {
  return dot(v, v);
}

// iq heart: bounding box x in [-0.604, 0.604], y in [0, 1.104].
fn sd_heart_unit(p0: vec2f) -> f32 {
  let p = vec2f(abs(p0.x), p0.y);
  if (p.y + p.x > 1.0) {
    return sqrt(dot2(p - vec2f(0.25, 0.75))) - 0.35355339;
  }
  return sqrt(min(dot2(p - vec2f(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * select(-1.0, 1.0, p.x > p.y);
}

fn sd_round_cone(p0: vec2f, r1: f32, r2: f32, h: f32) -> f32 {
  let p = vec2f(abs(p0.x), p0.y);
  let b = (r1 - r2) / h;
  let a = sqrt(max(1.0 - b * b, 0.0));
  let k = dot(p, vec2f(-b, a));
  if (k < 0.0) {
    return length(p) - r1;
  }
  if (k > a * h) {
    return length(p - vec2f(0.0, h)) - r2;
  }
  return dot(p, vec2f(a, b)) - r1;
}

fn sd_moon(p0: vec2f, d: f32, ra: f32, rb: f32) -> f32 {
  let p = vec2f(p0.x, abs(p0.y));
  let a = (d * d + ra * ra - rb * rb) / (2.0 * d);
  let b = sqrt(max(ra * ra - a * a, 0.0));
  if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0)) {
    return length(p - vec2f(a, b));
  }
  return max(length(p) - ra, -(length(p - vec2f(d, 0.0)) - rb));
}

fn sd_bolt(p: vec2f, h: vec2f) -> f32 {
  var v = array<vec2f, 7>(
    vec2f(0.05, 1.0), vec2f(0.55, 1.0), vec2f(0.15, 0.15), vec2f(0.50, 0.15),
    vec2f(-0.40, -1.0), vec2f(-0.10, -0.10), vec2f(-0.55, -0.10)
  );
  var d = 1e20;
  var s = 1.0;
  var j = 6;
  for (var i = 0; i < 7; i = i + 1) {
    let vi = v[i] * h;
    let vj = v[j] * h;
    let e = vj - vi;
    let w = p - vi;
    let b = w - e * clamp(dot(w, e) / max(dot(e, e), 0.000001), 0.0, 1.0);
    d = min(d, dot(b, b));
    let c1 = p.y >= vi.y;
    let c2 = p.y < vj.y;
    let c3 = e.x * w.y > e.y * w.x;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) {
      s = -s;
    }
    j = i;
  }
  return s * sqrt(d);
}

// Signed distance (pixels) of the selected shape. p: y-up pixel offset from the shape centre, h: half size in pixels.
fn shape_sd(p: vec2f, h: vec2f) -> f32 {
  let m = min(h.x, h.y);
  let n = f32(max(P.sides, 3));
  switch (P.shape) {
    case 0u: {
      return length(p) - m;
    }
    case 1u: {
      let k0 = length(p / h);
      let k1 = length(p / (h * h));
      return k0 * (k0 - 1.0) / max(k1, 0.000001);
    }
    case 2u: {
      return sd_round_box(p, h, min(P.rounding * m, m));
    }
    case 3u: {
      let ap = m * cos(PI / n);
      let rr = P.rounding * ap * 0.9;
      return sd_reg_polygon(p, (ap - rr) / cos(PI / n), n) - rr;
    }
    case 4u: {
      let rr = P.rounding * m * 0.25;
      return sd_star(p, m - rr, n, mix(2.0, n, clamp(P.pinch, 0.0, 1.0))) - rr;
    }
    case 5u: {
      let w = max(P.thickness, 0.02) * m;
      return abs(length(p) - (m - 0.5 * w)) - 0.5 * w;
    }
    case 6u: {
      let w = max(P.thickness, 0.02) * m;
      let a = radians(P.aperture) * 0.5;
      return sd_arc(p, vec2f(sin(a), cos(a)), m - 0.5 * w, 0.5 * w);
    }
    case 7u: {
      let a = radians(P.aperture) * 0.5;
      return sd_pie(p, vec2f(sin(a), cos(a)), m);
    }
    case 8u: {
      let t = clamp(P.thickness, 0.02, 1.0);
      let b1 = vec2f(h.x, h.y * t);
      let b2 = vec2f(h.x * t, h.y);
      let r1 = min(P.rounding * min(b1.x, b1.y), min(b1.x, b1.y));
      let r2 = min(P.rounding * min(b2.x, b2.y), min(b2.x, b2.y));
      return min(sd_round_box(p, b1, r1), sd_round_box(p, b2, r2));
    }
    case 9u: {
      let ext = vec2f(max(h.x - m, 0.0), max(h.y - m, 0.0));
      return sd_segment(p, -ext, ext) - m;
    }
    case 10u: {
      let q = vec2f(p.x / h.x * 0.6035, (p.y + h.y) / (2.0 * h.y) * 1.104);
      return sd_heart_unit(q) * min(2.0 * h.y / 1.104, h.x / 0.6035);
    }
    case 11u: {
      let r1 = min(h.x, h.y * 0.9);
      let r2 = max(0.5, 0.03 * m);
      let hh = 2.0 * h.y - r1 - r2;
      return sd_round_cone(p - vec2f(0.0, -h.y + r1), r1, r2, hh);
    }
    case 12u: {
      return sd_bolt(p, h);
    }
    default: {
      let ra = m;
      let rb = ra * 0.85;
      let d = mix(ra + rb - 0.05 * ra, ra - rb + 0.03 * ra, clamp(P.thickness, 0.0, 1.0));
      return sd_moon(p, d, ra, rb);
    }
  }
}

fn coverage(d: f32, soft: f32) -> f32 {
  // 1 inside, falling to 0 over `soft` pixels measured INWARD from the edge, with a half-pixel AA shift.
  let t = clamp((-d + 0.5) / soft, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn shade(uv: vec2f) -> vec4f {
  var puv = uv;
  if (P.has_uv == 1u) {
    puv = mix(uv, tex_sample(t0, uv, F.tile, F.filter_mode).rg, P.uv_amount);
  }
  // ---- cell coordinates (cell units, shape centre at 0). Repeat counts are whole numbers => exact periodicity.
  let rep = max(round(P.repeat), vec2f(1.0));
  let cu = (puv - P.position) * rep;
  var local = cu;
  if (rep.x > 1.0 || F.tile.x == 1u) {
    local.x = cu.x - round(cu.x);
  }
  if (rep.y > 1.0 || F.tile.y == 1u) {
    local.y = cu.y - round(cu.y);
  }
  let cellpx = F.full_res / rep;
  var p = local * cellpx;
  // rotation (clockwise on screen) in pixel space
  let a = radians(P.rotation);
  let sn = sin(a);
  let cs = cos(a);
  p = vec2f(p.x * cs + p.y * sn, -p.x * sn + p.y * cs);
  p = vec2f(p.x, -p.y); // y-up shape space
  let h = max(P.size * cellpx * 0.5, vec2f(0.5));
  let m = min(h.x, h.y);

  let d = shape_sd(p, h);
  let soft = max(P.softness * m, 1.0);
  let ow = max(P.outline_width * m, 1.0);
  var v = 0.0;
  switch (P.output_mode) {
    case 1u: {
      v = coverage(d, soft) * (1.0 - coverage(d + ow, soft));
    }
    case 2u: {
      v = max(coverage(d - ow, soft) - coverage(d, soft), 0.0);
    }
    case 3u: {
      v = coverage(d - 0.5 * ow, soft) * (1.0 - coverage(d + 0.5 * ow, soft));
    }
    default: {
      v = coverage(d, soft);
      if (P.bevel > 0.0) {
        v = v * lut_eval(clamp(-d / max(P.bevel * m, 1.0), 0.0, 1.0));
      }
    }
  }
  v = v * P.intensity;
  if (P.invert == 1u) {
    v = 1.0 - v;
  }
  return vec4f(clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0);
}
