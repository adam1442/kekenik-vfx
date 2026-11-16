// grayscale.polar_scatter — shapes / input pattern scattered in rings and radial arrays.
// Bindings are generated (see passes.ts): F = Frame, P = Params (layout in definition.ts), t0 = size mod,
// t1 = visibility mod, t2 = input pattern.
// Per pixel: for each ring (<= 64) an early radial test rejects rings the pixel cannot touch; inside a ring only the
// elements around the pixel's polar angle are visited (<= 9), never the whole array. When the graph tiles, the 3x3
// neighbouring images of the centre are evaluated on tiling axes so elements wrap across the borders.
// Space: "min-dim units" (smaller image side = 1), y down, angles clockwise from +x (like the gizmos).
#include "hash"
#include "sdf"
#include "shapes2d"
#include "sampling"
#include "util"

fn rn(h: u32, k: u32) -> f32 {
  return u01(pcg(h ^ (k * 0x9e3779b1u + 0x7f4a7c15u)));
}

// Number of elements in ring i.
fn ring_elements(i: i32, ri: f32) -> i32 {
  var n = f32(P.count) * pow(max(P.ring_growth, 0.01), f32(i));
  if (P.count_mode == 1u) {
    n = n * ri / max(P.radius_max, 0.0001);
  }
  return clamp(i32(round(n)), 1, 512);
}

// Coverage of the built-in shape at unit local coordinates lp ([-1,1]^2 = footprint box); d < 0 inside.
fn shape_value(lp: vec2f, aa: f32) -> f32 {
  let q = vec2f(lp.x, -lp.y); // y-up for polygon / star
  let n = f32(max(P.sides, 3));
  var d = 0.0;
  switch (P.shape) {
    case 0u: {
      d = length(lp) - 1.0;
    }
    case 1u: {
      d = sd_box(lp, vec2f(1.0));
    }
    case 2u: {
      d = sd_reg_polygon(q, 1.0, n);
    }
    case 3u: {
      d = sd_star(q, 1.0, n, mix(2.0, n, clamp(P.pinch, 0.0, 1.0)));
    }
    case 4u: {
      let w = max(P.thickness, 0.02);
      d = abs(length(lp) - (1.0 - 0.5 * w)) - 0.5 * w;
    }
    default: {
      let t = clamp(P.thickness, 0.02, 1.0);
      d = min(sd_box(lp, vec2f(1.0, t)), sd_box(lp, vec2f(t, 1.0)));
    }
  }
  let soft = max(P.softness, aa);
  let x = clamp((-d + 0.5 * aa) / soft, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

fn shade(uv: vec2f) -> vec4f {
  let mn = min(F.full_res.x, F.full_res.y);
  let aspect = F.full_res / mn;
  let rings = clamp(P.ring_count, 1, 64);
  let spacing = select(max(P.radius_max - P.radius_min, 0.1), (P.radius_max - P.radius_min) / f32(max(rings - 1, 1)), rings > 1);
  let rj_amp = P.radius_jitter * 0.5 * spacing;
  let size_max = max(P.size, 0.0) * max(max(P.ring_scale, 1.0), 1.0);
  let he_max = 0.5 * size_max * max(P.stretch, 1.0);
  let reach = he_max * 1.4143 + rj_amp + 0.002;
  let full_circle = P.angle_range >= 359.99;
  let arc = radians(min(P.angle_range, 360.0));
  let mid = arc * 0.5;
  let ox_n = select(0, 1, F.tile.x == 1u);
  let oy_n = select(0, 1, F.tile.y == 1u);
  var acc = 0.0;
  for (var oy = -oy_n; oy <= oy_n; oy = oy + 1) {
    for (var ox = -ox_n; ox <= ox_n; ox = ox + 1) {
      let pd = (uv - P.center + vec2f(f32(ox), f32(oy))) * aspect;
      let r = length(pd);
      let ang = atan2(pd.y, pd.x);
      for (var i = 0; i < rings; i = i + 1) {
        let t_ring = select(0.0, f32(i) / f32(rings - 1), rings > 1);
        let ri = mix(P.radius_min, P.radius_max, t_ring);
        if (abs(r - ri) > reach) {
          continue;
        }
        let n = ring_elements(i, ri);
        let astep = select(select(arc / f32(max(n - 1, 1)), arc / f32(n), full_circle), TAU, n == 1 && full_circle);
        let sgn = select(1.0, -1.0, P.spin_alternate == 1u && (i % 2) == 1);
        let a0 = radians(P.angle_start) + radians(P.spiral) * f32(i) + TAU * P.spin * P.phase * sgn;
        var rel = ang - a0 - mid;
        rel = rel - TAU * floor((rel + PI) / TAU) + mid; // wrap into [mid - pi, mid + pi)
        let u = rel / max(astep, 0.00001);
        let k0 = i32(floor(u + 0.5));
        let wnd = clamp(i32(ceil(he_max / max(ri * astep, 0.00001) + 0.5 * P.angle_jitter)), 1, 4);
        let span = 2 * wnd + 1;
        let cnt = min(n, span);
        for (var jj = 0; jj < cnt; jj = jj + 1) {
          var k = jj;
          if (n > span) {
            k = k0 - wnd + jj;
          }
          if (!full_circle && (k < 0 || k > n - 1)) {
            continue;
          }
          let kw = ((k % n) + n) % n;
          let h = hash_u(u32(i), u32(kw), 0u, P.seed);
          // ---- element placement
          let th = a0 + f32(k) * astep + (rn(h, 1u) - 0.5) * P.angle_jitter * astep;
          let re = ri + (rn(h, 2u) - 0.5) * 2.0 * rj_amp;
          let dir = vec2f(cos(th), sin(th));
          let ctr = dir * re;
          let uvc = P.center + ctr / aspect;
          // ---- visibility (chance, modulated at the element centre)
          var chance = P.visibility;
          if (P.visibility_mod_k != 0.0) {
            chance = modulate(chance, tex_sample(t1, uvc, F.tile, F.filter_mode).r, P.visibility_mod_k);
          }
          if (rn(h, 0u) >= chance) {
            continue;
          }
          // ---- size
          var sz = P.size;
          if (P.size_mod_k != 0.0) {
            sz = modulate(sz, tex_sample(t0, uvc, F.tile, F.filter_mode).r, P.size_mod_k);
          }
          sz = sz * mix(1.0, P.ring_scale, t_ring) * (1.0 - rn(h, 3u) * P.size_rand);
          let half_ext = vec2f(0.5 * sz * P.stretch, 0.5 * sz);
          if (half_ext.x <= 0.00001 || half_ext.y <= 0.00001) {
            continue;
          }
          // ---- rotation
          var rot = radians(P.rotation) + radians(P.rot_per_ring) * f32(i) + radians(P.rot_random) * (rn(h, 4u) * 2.0 - 1.0);
          if (P.align_radial == 1u) {
            rot = rot + th;
          }
          let dl = pd - ctr;
          let cs = cos(rot);
          let sn = sin(rot);
          let lp = vec2f(dl.x * cs + dl.y * sn, -dl.x * sn + dl.y * cs) / half_ext;
          var v = 0.0;
          if (P.has_pattern == 1u) {
            if (abs(lp.x) < 1.0 && abs(lp.y) < 1.0) {
              v = tex_sample(t2, lp * 0.5 + vec2f(0.5), vec2u(0u, 0u), F.filter_mode).r;
            }
          } else if (abs(lp.x) < 1.5 && abs(lp.y) < 1.5) {
            let aa = 1.0 / max(min(half_ext.x, half_ext.y) * mn, 1.0);
            v = shape_value(lp, aa);
          }
          v = v * mix(P.int_min, P.int_max, rn(h, 5u)) * P.intensity;
          if (P.blend == 0u) {
            acc = acc + v;
          } else {
            acc = max(acc, v);
          }
        }
      }
    }
  }
  return vec4f(clamp(acc, 0.0, 1.0), 0.0, 0.0, 1.0);
}
