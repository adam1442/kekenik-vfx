// fractal_core — SHARED splat-fractal implementation.
// Included by grayscale.fractal (gray output) and color.fractal (`#define FRACTAL_COLOR 1`: per-splat colour).
// Needs the generated bindings (F, P, t0..t9), therefore it is listed in BINDING_DEPENDENT_MODULES.
// Colour build additionally needs Params fields: color_mode u32, hue_min/hue_max/col_sat/col_val/color_gain f32,
// alpha_mode u32 and glut: array<vec4f, 256> (gradient LUT, see lut_gradient.wgsl).
// Bindings are generated (see passes.ts): F = Frame, P = Params (layout in definition.ts), textures:
//   t0 z_position mod | t1 ramp mod | t2 gain mod | t3 uv mod | t4 scale mod | t5 intensity mod | t6 visibility mod
//   t7 atlas mod | t8 input pattern / atlas | t9 UV map
// Per octave only the (2R+1)^2 cells around the pixel are visited (R = P.reach, 1..2, computed on the CPU from the
// size/jitter ranges): there is never a loop over all splats. All randomness comes from the PERIODIC lattice hash,
// so tiling axes wrap exactly; Z slices ("layers") are hashed separately and their attributes are interpolated.
#include "hash"
#include "sampling"
#include "util"
#if FRACTAL_COLOR
#include "lut_gradient"
#include "color"
// Coverage-weighted mean colour of the splats of the octave that was just evaluated (set by octave_value).
var<private> g_octcol: vec3f;
#endif

// ---- per-invocation configuration (set once per shade() call)
var<private> g_tile: vec2u;   // tiling flags of the PATTERN axes (swapped for odd quarter turns)
var<private> g_sc: vec2f;     // base cells per axis (integers on tiling axes)
var<private> g_an: vec2f;     // anisotropy frequency factors
var<private> g_rotq: i32;     // quarter turns (tiling) or -1 = free rotation
var<private> g_lac: f32;      // effective lacunarity (integer when tiling)

fn quarter_turns(deg: f32) -> i32 {
  return ((i32(round(deg / 90.0)) % 4) + 4) % 4;
}

// uv (already distorted) -> pattern space (origin = pattern centre, anisotropy applied).
fn to_pattern(uvd: vec2f) -> vec2f {
  var d = uvd - vec2f(0.5) - P.position;
  if (g_rotq == 1) {
    d = vec2f(d.y, -d.x);
  } else if (g_rotq == 2) {
    d = -d;
  } else if (g_rotq == 3) {
    d = vec2f(-d.y, d.x);
  } else if (g_rotq < 0 && P.rotation != 0.0) {
    let a = radians(P.rotation);
    let sn = sin(a);
    let cs = cos(a);
    let pd = d * F.full_res;
    d = vec2f(pd.x * cs + pd.y * sn, -pd.x * sn + pd.y * cs) / F.full_res;
  }
  return d * g_an;
}

// Exact inverse of to_pattern (used to find the image position of a splat centre for modulation / single pixel).
fn from_pattern(q: vec2f) -> vec2f {
  var d = q / g_an;
  if (g_rotq == 1) {
    d = vec2f(-d.y, d.x);
  } else if (g_rotq == 2) {
    d = -d;
  } else if (g_rotq == 3) {
    d = vec2f(d.y, -d.x);
  } else if (g_rotq < 0 && P.rotation != 0.0) {
    let a = radians(P.rotation);
    let sn = sin(a);
    let cs = cos(a);
    let pd = d * F.full_res;
    d = vec2f(pd.x * cs - pd.y * sn, pd.x * sn + pd.y * cs) / F.full_res;
  }
  return d + vec2f(0.5) + P.position;
}

/* ------------------------------------------------------------------ shape profiles */

fn lut_at(i: i32) -> f32 {
  return P.shape_lut[i >> 2u][i & 3];
}
fn lut_eval(x: f32) -> f32 {
  let f = clamp(x, 0.0, 1.0) * 63.0;
  let i = min(i32(floor(f)), 62);
  return mix(lut_at(i), lut_at(i + 1), f - f32(i));
}

fn cross2(a: vec2f, b: vec2f) -> f32 {
  return a.x * b.y - a.y * b.x;
}

// Polygon metric: 1.0 exactly on the edge of a regular n-gon with circumradius 1.
fn polygon_metric(lp: vec2f, n: f32) -> f32 {
  let r = length(lp);
  if (r < 0.000001) {
    return 0.0;
  }
  let an = TAU / n;
  let a = atan2(lp.y, lp.x);
  let b = ((a % an) + an) % an - an * 0.5;
  return r * cos(b) / cos(an * 0.5);
}

// Star metric: 1.0 on the boundary of an n-pointed star (outer radius 1, inner radius `sec`).
fn star_metric(lp: vec2f, n: f32, sec: f32) -> f32 {
  let r = length(lp);
  if (r < 0.000001) {
    return 0.0;
  }
  let sector = TAU / n;
  let a = atan2(lp.y, lp.x);
  let b0 = ((a % sector) + sector) % sector;
  let b = min(b0, sector - b0);
  let half_s = sector * 0.5;
  let p0 = vec2f(1.0, 0.0);
  let p1 = sec * vec2f(cos(half_s), sin(half_s));
  let e = p1 - p0;
  let dir = vec2f(cos(b), sin(b));
  let t = cross2(p0, e) / max(cross2(dir, e), 0.0001);
  return r / max(t, 0.0001);
}

// Splat profile at local coordinates lp (|lp|_inf < 1 = inside the splat footprint), before the shape curve.
fn splat_profile(lp: vec2f, elem: f32) -> f32 {
  if (P.has_pattern == 1u) {
    // Input pattern / atlas element replaces the shape.
    if (abs(lp.x) >= 1.0 || abs(lp.y) >= 1.0) {
      return 0.0;
    }
    let cols = max(P.atlas_cols, 1);
    let rows = max(P.atlas_rows, 1);
    let n = cols * rows;
    let idx = min(i32(floor(fract(elem) * f32(n))), n - 1);
    let puv = (lp * 0.5 + vec2f(0.5) + vec2f(f32(idx % cols), f32(idx / cols))) / vec2f(f32(cols), f32(rows));
    return tex_sample(t8, puv, vec2u(0u, 0u), F.filter_mode).r;
  }
  let inner = clamp(P.inner, 0.0, 0.99);
  var rm = 0.0;
  if (P.shape == 0u) {
    rm = length(lp);
  } else if (P.shape == 1u) {
    rm = max(abs(lp.x), abs(lp.y));
  } else if (P.shape == 2u) {
    rm = mix(polygon_metric(lp, f32(P.sides)), length(lp), P.rounding);
  } else {
    let sec = clamp(P.secondary, 0.02, 1.0);
    rm = mix(star_metric(lp, f32(P.sides), sec), length(lp) / (0.5 * (1.0 + sec)), P.rounding);
  }
  return clamp((1.0 - rm) / (1.0 - inner), 0.0, 1.0);
}

/* ------------------------------------------------------------------ per-splat random attributes */

struct Attr {
  a: vec4f, // visibility, jitter x, jitter y, size
  b: vec4f, // h scale, v scale, rotation, intensity
  c: vec4f, // flip h, flip v, atlas element, unused
};

fn rn(h: u32, k: u32) -> f32 {
  return u01(pcg(h ^ (k * 0x9e3779b1u + 0x7f4a7c15u)));
}

fn attr_at(c: vec2i, per: vec2i, o: i32, zi: i32, layers: i32) -> Attr {
  let h = lattice_hash(vec3i(c.x, c.y, zi), vec3i(per.x, per.y, layers), P.seed + u32(o) * 0x9e3779b1u);
  var A: Attr;
  A.a = vec4f(rn(h, 0u), rn(h, 1u), rn(h, 2u), rn(h, 3u));
  A.b = vec4f(rn(h, 4u), rn(h, 5u), rn(h, 6u), rn(h, 7u));
  A.c = vec4f(rn(h, 8u), rn(h, 9u), rn(h, 10u), rn(h, 11u)); // .w = per-splat colour random (colour build)
  return A;
}

#if FRACTAL_COLOR
// Colour of one splat. rnd = per-splat random (stable per Z layer), prof = splat profile value at this pixel.
fn splat_col(rnd: f32, prof: f32) -> vec3f {
  if (P.color_mode == 0u) {
    return gradient_lut(rnd).rgb;
  }
  if (P.color_mode == 1u) {
    return srgb_to_linear(hsv_to_rgb(vec3f(fract(mix(P.hue_min, P.hue_max, rnd)), P.col_sat, P.col_val)));
  }
  return gradient_lut(prof).rgb;
}
#endif

fn smax(a: f32, b: f32, k: f32) -> f32 {
  if (k <= 0.00001) {
    return max(a, b);
  }
  let h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}

// Orientation (radians) of the UV map's local x axis at uvp: Per-Splat / Per-Pixel "align to UVs".
fn uv_orient(uvp: vec2f) -> f32 {
  let dx = vec2f(1.5 / F.full_res.x, 0.0);
  let a = tex_sample(t9, uvp + dx, F.tile, F.filter_mode).rg - tex_sample(t9, uvp - dx, F.tile, F.filter_mode).rg;
  return atan2(a.y * F.full_res.y, a.x * F.full_res.x);
}

/* ------------------------------------------------------------------ one octave */

fn octave_value(q: vec2f, uv: vec2f, o: i32, n: vec2f, zi: i32, zt: f32, layers: i32) -> f32 {
  let g = (q + vec2f(0.5)) * n;
  let c0 = vec2i(floor(g));
  let per = vec2i(select(0, i32(round(n.x)), g_tile.x == 1u), select(0, i32(round(n.y)), g_tile.y == 1u));
  let reach = P.reach;
  let need_uvc = P.visibility_mod_k != 0.0 || P.size_mod_k != 0.0 || P.intensity_mod_k != 0.0 || P.atlas_pick_mod_k != 0.0 || P.shape == 4u || (P.has_uv == 1u && P.uv_align == 1u);
  var acc = 0.0;
#if FRACTAL_COLOR
  var colacc = vec3f(0.0);
  var wacc = 0.0;
#endif
  for (var dj = -reach; dj <= reach; dj = dj + 1) {
    for (var di = -reach; di <= reach; di = di + 1) {
      let c = c0 + vec2i(di, dj);
      var A = attr_at(c, per, o, zi, layers);
      if (layers > 1) {
        let A1 = attr_at(c, per, o, zi + 1, layers);
        A.a = mix(A.a, A1.a, zt);
        A.b = mix(A.b, A1.b, zt);
        A.c = mix(A.c, A1.c, zt);
      }
      // ---- splat centre in cell space: jitter + quincunx
      let jit = (vec2f(A.a.y, A.a.z) - vec2f(0.5)) * P.pos_random * P.pos_scale;
      var ctr = vec2f(c) + vec2f(0.5) + jit;
      if (P.quincunx == 1u && (((c.y % 2) + 2) % 2) == 1) {
        ctr.x = ctr.x + 0.5;
      } else if (P.quincunx == 2u && (((c.x % 2) + 2) % 2) == 1) {
        ctr.y = ctr.y + 0.5;
      }
      // ---- image-space position of the centre (only when something needs it)
      var uvc = uv;
      if (need_uvc) {
        uvc = from_pattern(ctr / n - vec2f(0.5));
        if (F.tile.x == 1u) {
          uvc.x = uvc.x - floor(uvc.x);
        }
        if (F.tile.y == 1u) {
          uvc.y = uvc.y - floor(uvc.y);
        }
      }
      // ---- visibility (chance + soft threshold)
      var chance = P.visibility;
      if (P.visibility_mod_k != 0.0) {
        chance = modulate(chance, tex_sample(t6, uvc, F.tile, F.filter_mode).r, P.visibility_mod_k);
      }
      let w = max(P.vis_width, 0.0);
      let vis = clamp((chance * (1.0 + w) - A.a.x) / max(w, 0.0001), 0.0, 1.0);
      if (vis <= 0.0) {
        continue;
      }
      // ---- size (random range x modulated multiplier)
      var smul = P.size;
      if (P.size_mod_k != 0.0) {
        smul = modulate(P.size, tex_sample(t4, uvc, F.tile, F.filter_mode).r, P.size_mod_k);
      }
      let s = mix(P.scale_min, P.scale_max, A.a.w) * smul;
      let half_ext = 0.5 * s * vec2f(mix(P.hscale_min, P.hscale_max, A.b.x), mix(P.vscale_min, P.vscale_max, A.b.y));
      if (half_ext.x <= 0.00001 || half_ext.y <= 0.00001) {
        continue;
      }
      // ---- rotation (+ align to UV map per splat)
      var rot = radians(mix(P.rot_min, P.rot_max, A.b.z));
      if (P.has_uv == 1u && P.uv_align == 1u) {
        var amt = P.uv_amount;
        if (P.uv_amount_mod_k != 0.0) {
          amt = modulate(amt, tex_sample(t3, uvc, F.tile, F.filter_mode).r, P.uv_amount_mod_k);
        }
        rot = rot + uv_orient(uvc) * amt;
      }
      // ---- intensity
      var inten = mix(P.int_min, P.int_max, A.b.w);
      var imul = P.intensity;
      if (P.intensity_mod_k != 0.0) {
        imul = modulate(imul, tex_sample(t5, uvc, F.tile, F.filter_mode).r, P.intensity_mod_k);
      }
      inten = inten * imul;
      // ---- local coordinates inside the splat footprint
      let dl = g - ctr;
      let cs = cos(rot);
      let sn = sin(rot);
      var lp = vec2f(dl.x * cs + dl.y * sn, -dl.x * sn + dl.y * cs) / half_ext;
      if (A.c.x < P.flip_h) {
        lp.x = -lp.x;
      }
      if (A.c.y < P.flip_v) {
        lp.y = -lp.y;
      }
      var v = 0.0;
#if FRACTAL_COLOR
      var pvv = 1.0;
#endif
      if (P.shape == 4u && P.has_pattern == 0u) {
        // Single pixel: lit only in the pixel that contains the splat centre.
        let pc = floor(uvc * F.full_res);
        let pp = floor(uv * F.full_res);
        v = select(0.0, 1.0, pc.x == pp.x && pc.y == pp.y);
      } else if (abs(lp.x) < 1.0 && abs(lp.y) < 1.0) {
        var elem = A.c.z;
        if (P.atlas_pick_mod_k != 0.0) {
          elem = mix(elem, tex_sample(t7, uvc, F.tile, F.filter_mode).r, min(abs(P.atlas_pick_mod_k), 1.0)) + P.atlas_pick;
        }
        let pv = splat_profile(lp, elem);
#if FRACTAL_COLOR
        pvv = pv;
#endif
        v = select(pv, lut_eval(pv), P.shape_curve_on == 1u);
      }
      v = v * vis * inten;
#if FRACTAL_COLOR
      let scol = splat_col(A.c.w, pvv);
      if (P.splat_blend == 0u) {
        colacc = colacc + scol * v;
        wacc = wacc + v;
      } else if (v >= acc && v > 0.0) {
        colacc = scol;
        wacc = 1.0;
      }
#endif
      if (P.splat_blend == 0u) {
        acc = acc + v;
      } else {
        acc = smax(acc, v, P.max_smooth);
      }
    }
  }
#if FRACTAL_COLOR
  g_octcol = select(vec3f(1.0), colacc / max(wacc, 0.000001), wacc > 0.000001);
#endif
  return acc;
}

fn shade(uv: vec2f) -> vec4f {
  // ---- configuration (tiling => quarter turns, integer cell counts, integer lacunarity, no anisotropy)
  var tile = F.tile;
  let tiling = tile.x == 1u || tile.y == 1u;
  g_rotq = -1;
  if (tiling) {
    g_rotq = quarter_turns(P.rotation);
    if (g_rotq == 1 || g_rotq == 3) {
      tile = vec2u(tile.y, tile.x);
    }
  }
  g_tile = tile;
  var sc = P.scale;
  if (tile.x == 1u) {
    sc.x = max(round(sc.x), 1.0);
  }
  if (tile.y == 1u) {
    sc.y = max(round(sc.y), 1.0);
  }
  // Quincunx alternates every other row/column: the wrapped axis needs an even count.
  if (P.quincunx == 1u && tile.y == 1u) {
    sc.y = max(2.0 * round(sc.y * 0.5), 2.0);
  }
  if (P.quincunx == 2u && tile.x == 1u) {
    sc.x = max(2.0 * round(sc.x * 0.5), 2.0);
  }
  g_sc = sc;
  g_an = vec2f(1.0);
  if (!tiling) {
    g_an = vec2f(pow(4.0, max(P.anisotropy, 0.0)), pow(4.0, max(-P.anisotropy, 0.0)));
  }
  g_lac = select(P.lacunarity, max(round(P.lacunarity), 2.0), tiling);

  // ---- UV map: per-pixel deformation (Per Pixel) of the lookup position
  var uvd = uv;
  if (P.has_uv == 1u && P.uv_align == 2u) {
    var amt = P.uv_amount;
    if (P.uv_amount_mod_k != 0.0) {
      amt = modulate(amt, tex_sample(t3, uv, F.tile, F.filter_mode).r, P.uv_amount_mod_k);
    }
    uvd = mix(uv, tex_sample(t9, uv, F.tile, F.filter_mode).rg, amt);
  }
  let q = to_pattern(uvd);

  // ---- Z position (per pixel modulatable) and layer selection
  var layers = 1;
  var zi = 0;
  var zt = 0.0;
  if (P.add_z == 1u) {
    var z = P.z_position;
    if (P.z_position_mod_k != 0.0) {
      z = modulate(z, tex_sample(t0, uv, F.tile, F.filter_mode).r, P.z_position_mod_k);
    }
    layers = max(P.z_layers, 1);
    let zf = (z - floor(z)) * f32(layers);
    zi = i32(floor(zf));
    zt = zf - floor(zf);
    zt = zt * zt * (3.0 - 2.0 * zt);
  }

  // ---- per-pixel gain / ramp
  var gain = P.gain;
  if (P.gain_mod_k != 0.0) {
    gain = modulate(gain, tex_sample(t2, uv, F.tile, F.filter_mode).r, P.gain_mod_k);
  }
  var ramp = P.ramp;
  if (P.ramp_mod_k != 0.0) {
    ramp = modulate(ramp, tex_sample(t1, uv, F.tile, F.filter_mode).r, P.ramp_mod_k);
  }

  // ---- octave loop
  var total = 0.0;
#if FRACTAL_COLOR
  var ctot = vec3f(1.0);
  var cw = 0.0;
#endif
  var amp = 1.0;
  var norm = 0.0;
  var lacpow = 1.0;
  for (var o = 0; o < P.octaves; o = o + 1) {
    let n = sc * lacpow;
    if (max(n.x, n.y) > 4096.0) {
      break;
    }
    let oc = clamp(octave_value(q, uv, o, n, zi, zt, layers), 0.0, 1.0);
    let ocv = select(oc, 1.0 - oc, amp < 0.0);
    let w = clamp(ramp * abs(amp), 0.0, 1.0);
#if FRACTAL_COLOR
    // Octave colours: Add / FBM = contribution-weighted mean, Max = colour of the winning octave, others = mix by weight.
    let oclr = g_octcol;
    if (o == 0) {
      ctot = oclr;
      cw = abs(amp) * oc;
    } else if (P.octave_mode == 1u) {
      if (amp * oc > total) {
        ctot = oclr;
      }
    } else if (P.octave_mode == 0u || P.octave_mode == 2u) {
      let wn = abs(amp) * oc;
      ctot = (ctot * cw + oclr * wn) / max(cw + wn, 0.000001);
      cw = cw + wn;
    } else {
      ctot = mix(ctot, oclr, clamp(w * oc, 0.0, 1.0));
    }
#endif
    if (P.octave_mode == 0u) {
      total = total + amp * oc;
    } else if (P.octave_mode == 1u) {
      total = select(smax(total, amp * oc, P.max_smooth), amp * oc, o == 0);
    } else if (P.octave_mode == 2u) {
      total = total + amp * oc;
      norm = norm + abs(amp);
    } else if (o == 0) {
      total = ocv;
    } else if (P.octave_mode == 3u) {
      total = mix(total, ocv, w);
    } else if (P.octave_mode == 4u) {
      total = total * mix(1.0, ocv, w);
    } else {
      total = 1.0 - (1.0 - total) * (1.0 - ocv * w);
    }
    amp = amp * gain;
    lacpow = lacpow * g_lac;
  }
  if (P.octave_mode == 2u) {
    total = total / max(norm, 0.000001);
  }
#if FRACTAL_COLOR
  let cov = clamp(total, 0.0, 1.0);
  return vec4f(ctot * cov * P.color_gain, select(1.0, cov, P.alpha_mode == 1u));
#else
  return vec4f(clamp(total, 0.0, 1.0), 0.0, 0.0, 1.0);
#endif
}
