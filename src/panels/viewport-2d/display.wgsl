// 2D viewport display shader (raw mode: we write fs_main). Bindings are generated: F (Frame), P (Params, see
// display.ts DISPLAY_LAYOUT), t0 = image A, t1 = image B (A/B compare; dummy when unused), t2 = simulation overlay field (dummy when
// P.ov_mode == 0): a Vector pin (arrows / streamlines) or a Gray field (heat overlay).
// All maths is in DEVICE pixels. Image space "ip" = pixels of the full-resolution reference image, uv = ip / img.
// Kinds: 0 color, 1 gray, 2 uv, 3 normal, 4 vector.
#include "sampling"
#include "color"

fn screen_to_ip(frag: vec2f) -> vec2f {
  let s = (frag - P.center) / P.zoom;
  let q = vec2f(P.inv.x * s.x + P.inv.y * s.y, P.inv.z * s.x + P.inv.w * s.y);
  return q + P.img * 0.5;
}

fn wrap_uv(uv: vec2f) -> vec2f {
  return vec2f(select(uv.x, fract(uv.x), P.wrap.x == 1u), select(uv.y, fract(uv.y), P.wrap.y == 1u));
}

fn to_rgba(c: vec4f, kind: u32) -> vec4f {
  if (kind == 1u) { return vec4f(c.r, c.r, c.r, 1.0); }
  if (kind == 2u) { return vec4f(c.r, c.g, 0.0, 1.0); }
  if (kind == 3u) { return vec4f(c.rgb, 1.0); }
  if (kind == 4u) {
    // Vector: colour wheel, angle = hue, magnitude / range_hi = value
    let m = length(c.rg);
    let hue = fract(atan2(c.g, c.r) / 6.28318530717959);
    return vec4f(hsv_to_rgb(vec3f(hue, select(0.0, 1.0, m > 1e-9), clamp(m / max(P.range_hi, 1e-6), 0.0, 1.0))), 1.0);
  }
  return c;
}

fn sample_img(which: u32, uvw: vec2f, mode: u32) -> vec4f {
  // flipbook: P.sub = (x0, y0, w, h) of the displayed frame inside the sheet (identity otherwise)
  let uv = P.sub.xy + uvw * P.sub.zw;
  if (which == 0u) {
    return to_rgba(tex_sample(t0, uv, P.wrap, mode), P.a_kind);
  }
  return to_rgba(tex_sample(t1, uv, P.wrap, mode), P.b_kind);
}

fn heat(t01: f32) -> vec3f {
  let x = clamp(t01, 0.0, 1.0);
  if (P.heat_pal == 1u) {
    // magma-like: black -> purple -> orange -> pale yellow
    let a = mix(vec3f(0.0, 0.0, 0.02), vec3f(0.32, 0.07, 0.42), smoothstep(0.0, 0.33, x));
    let b = mix(a, vec3f(0.93, 0.36, 0.3), smoothstep(0.33, 0.66, x));
    return mix(b, vec3f(0.99, 0.94, 0.7), smoothstep(0.66, 1.0, x));
  }
  // turbo-like
  let a = mix(vec3f(0.05, 0.03, 0.25), vec3f(0.1, 0.3, 0.95), smoothstep(0.0, 0.2, x));
  let b = mix(a, vec3f(0.08, 0.85, 0.9), smoothstep(0.2, 0.4, x));
  let c = mix(b, vec3f(0.5, 0.92, 0.2), smoothstep(0.4, 0.6, x));
  let d = mix(c, vec3f(0.98, 0.62, 0.1), smoothstep(0.6, 0.8, x));
  return mix(d, vec3f(0.95, 0.15, 0.08), smoothstep(0.8, 1.0, x));
}

fn uv_vec(uvw: vec2f) -> vec2f {
  let c = tex_point(t0, P.sub.xy + uvw * P.sub.zw, P.wrap).rg;
  if (P.a_kind == 4u) { return c * 0.02; }          // Vector pin: tile fractions / s -> small displacement (arrow gain scales it)
  if (P.uv_mode == 0u) { return c - uvw; }          // absolute coordinates: displacement from identity
  if (P.uv_mode == 1u) { return c; }                // signed offset
  return c * 2.0 - vec2f(1.0);                      // flowmap: 0..1 encoded direction
}

// overlay Vector field (e.g. Fluid 2D velocity, tile fractions / s) -> small displacement, like a Vector pin shown directly
fn ov_vec(uvw: vec2f) -> vec2f {
  return tex_point(t2, P.sub.xy + uvw * P.sub.zw, P.wrap).rg * 0.02;
}
fn field_vec(uvw: vec2f, use_ov: bool) -> vec2f {
  if (use_ov) { return ov_vec(uvw); }
  return uv_vec(uvw);
}

// uv displacement -> screen-pixel vector
fn vec_screen(v: vec2f) -> vec2f {
  let ip = v * P.img;
  return vec2f(P.fwd.x * ip.x + P.fwd.y * ip.y, P.fwd.z * ip.x + P.fwd.w * ip.y) * P.zoom;
}

fn seg_dist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn maxc(v: vec4f) -> f32 {
  return max(max(abs(v.r), abs(v.g)), abs(v.b));
}

// Seam error across the wrap boundary: how much the jump between the last and first texel column/row exceeds the
// normal local variation (one texel step) of the image. 0 = continuous.
fn seam_err(vertical_line: bool, other: f32) -> f32 {
  let n = vec2i(textureDimensions(t0));
  if (vertical_line) {
    let row = clamp(i32(other * f32(n.y)), 0, n.y - 1);
    let a = to_rgba(textureLoad(t0, vec2i(n.x - 1, row), 0), P.a_kind);
    let b = to_rgba(textureLoad(t0, vec2i(0, row), 0), P.a_kind);
    let c = to_rgba(textureLoad(t0, vec2i(max(n.x - 2, 0), row), 0), P.a_kind);
    return max(0.0, maxc(a - b) - maxc(c - a));
  }
  let col = clamp(i32(other * f32(n.x)), 0, n.x - 1);
  let a = to_rgba(textureLoad(t0, vec2i(col, n.y - 1), 0), P.a_kind);
  let b = to_rgba(textureLoad(t0, vec2i(col, 0), 0), P.a_kind);
  let c = to_rgba(textureLoad(t0, vec2i(col, max(n.y - 2, 0)), 0), P.a_kind);
  return max(0.0, maxc(a - b) - maxc(c - a));
}

fn lit_sphere(frag: vec2f, base: vec3f) -> vec3f {
  let r = P.sphere_rect;
  let rel = (frag - r.xy) / r.zw;
  if (rel.x < 0.0 || rel.y < 0.0 || rel.x > 1.0 || rel.y > 1.0) { return base; }
  let pq = rel * 2.0 - vec2f(1.0);
  let rr = dot(pq, pq);
  var out_c = mix(base, vec3f(0.05, 0.055, 0.065), 0.88);
  let edge_k = 1.0 - smoothstep(0.985, 1.0, rr);
  if (edge_k > 0.0) {
    let nz = sqrt(max(1.0 - rr, 0.0));
    let ns = vec3f(pq.x, -pq.y, nz);
    let suv = fract((pq * 0.5 + vec2f(0.5)) * P.sphere_tile);
    var dn = tex_sample(t0, P.sub.xy + suv * P.sub.zw, vec2u(1u, 1u), 1u).rgb * 2.0 - vec3f(1.0);
    if (P.flip_g == 1u) { dn.y = -dn.y; }
    // whiteout blend of the map's detail normal onto the sphere normal
    let nn = normalize(vec3f(ns.xy + dn.xy, ns.z * max(dn.z, 0.05)));
    let l = normalize(P.light.xyz);
    let diff = max(dot(nn, l), 0.0);
    let h = normalize(l + vec3f(0.0, 0.0, 1.0));
    let spec = pow(max(dot(nn, h), 0.0), 40.0) * 0.35;
    let lit = vec3f(0.78, 0.8, 0.85) * (0.06 + diff * P.light.w) + vec3f(spec);
    out_c = mix(out_c, lit, edge_k);
  }
  return out_c;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let frag = in.pos.xy;
  let ip = screen_to_ip(frag);
  let uv = ip / P.img;
  let inside = all(uv >= P.reg_lo) && all(uv < P.reg_hi);

  // checker / solid background (device px, 8 CSS px cells)
  let cell = floor(frag / (8.0 * P.dpr));
  // theme tokens: chk_a = even cells, chk_b = odd cells (uniforms, so the checkerboard follows the Dark / Light theme)
  var bg = select(P.chk_b.rgb, P.chk_a.rgb, (i32(cell.x) + i32(cell.y)) % 2 == 0);
  if (P.bg_mode != 0u) { bg = P.bg_color.rgb; }

  var col = P.outside_color.rgb;
  if (inside) {
    let uvw = wrap_uv(uv);
    var mode = P.filter_mode;
    let texel_px = P.zoom * P.img.x / max(P.tex_size.x * P.sub.z, 1.0);
    if (P.auto_nearest == 1u && texel_px >= 4.0) { mode = 0u; }
    var which = 0u;
    if (P.cmp_mode == 1u && frag.x >= P.cmp_pos) { which = 1u; }
    if (P.cmp_mode == 2u && frag.y >= P.cmp_pos) { which = 1u; }
    var kind = P.a_kind;
    if (which == 1u) { kind = P.b_kind; }
    var c = sample_img(which, uvw, mode);
    if (kind == 3u && P.flip_g == 1u) { c.g = 1.0 - c.g; }
    var rgb = c.rgb * exp2(P.exposure);
    var a = c.a;
    var is_heat = false;
    if (P.channel != 0u) {
      var v = c.r;
      if (P.channel == 2u) { v = c.g; }
      if (P.channel == 3u) { v = c.b; }
      if (P.channel == 4u) { v = c.a; }
      if (P.channel == 5u) { v = luminance(c.rgb); }
      v = v * exp2(P.exposure);
      rgb = vec3f(v);
      a = 1.0;
    }
    if (P.viz == 1u) {
      var v = rgb.r;
      if (P.channel == 0u && kind == 0u) { v = luminance(rgb); }
      rgb = heat((v - P.range_lo) / max(P.range_hi - P.range_lo, 1e-6));
      is_heat = true;
    }
    if (P.srgb == 1u && !is_heat) { rgb = linear_to_srgb(clamp(rgb, vec3f(0.0), vec3f(1.0))); }
    rgb = pow(max(rgb, vec3f(0.0)), vec3f(1.0 / max(P.gamma, 0.05)));

    // Simulation heat overlay (pressure / divergence / curl of the same node): signed field, 0 = transparent-neutral blue/orange ramp
    if (P.ov_mode == 3u && which == 0u) {
      let ov = tex_sample(t2, P.sub.xy + uvw * P.sub.zw, P.wrap, mode).r;
      let t01 = 0.5 + 0.5 * clamp(ov * P.ov_gain, -1.0, 1.0);
      rgb = mix(rgb, heat(t01), 0.55 * clamp(abs(ov * P.ov_gain) * 4.0, 0.0, 1.0));
    }

    // UV vector visualisations drawn over the colour; a velocity overlay (P.ov_mode 1 arrows / 2 streamlines) works over ANY image
    var vmode = 0u;
    var use_ov = false;
    if ((kind == 2u || kind == 4u) && which == 0u && (P.viz == 2u || P.viz == 3u)) { vmode = P.viz; }
    if (vmode == 0u && which == 0u && (P.ov_mode == 1u || P.ov_mode == 2u)) {
      vmode = P.ov_mode + 1u;
      use_ov = true;
    }
    if (vmode != 0u) {
      if (vmode == 2u) {
        let cellp = P.arrow_cell * P.dpr;
        let cc = (floor(frag / cellp) + vec2f(0.5)) * cellp;
        let uvc = screen_to_ip(cc) / P.img;
        let d = vec_screen(field_vec(wrap_uv(uvc), use_ov)) * P.arrow_gain;
        let l = length(d);
        let len = clamp(l, 0.0, cellp * 0.46);
        let dir = select(vec2f(1.0, 0.0), d / max(l, 1e-6), l > 1e-6);
        let a0 = cc - dir * len * 0.5;
        let a1 = cc + dir * len * 0.5;
        let hs = min(len * 0.4, 7.0 * P.dpr);
        let n = vec2f(-dir.y, dir.x);
        var dist = seg_dist(frag, a0, a1);
        dist = min(dist, seg_dist(frag, a1, a1 - dir * hs + n * hs * 0.55));
        dist = min(dist, seg_dist(frag, a1, a1 - dir * hs - n * hs * 0.55));
        if (l < 0.5) { dist = length(frag - cc) - 0.5 * P.dpr; }
        let cov = 1.0 - smoothstep(0.6 * P.dpr, 1.5 * P.dpr, dist);
        rgb = mix(rgb * 0.5, vec3f(1.0), cov);
      } else {
        // streamlines: line integral convolution of white noise along the field (12 steps each way)
        var acc = 0.0;
        var wsum = 0.0;
        for (var dirn = 0; dirn < 2; dirn = dirn + 1) {
          var p = frag;
          for (var i = 0; i < 12; i = i + 1) {
            let v = vec_screen(field_vec(wrap_uv(screen_to_ip(p) / P.img), use_ov));
            let l = length(v);
            if (l < 1e-5) { break; }
            let sgn = select(1.0, -1.0, dirn == 1);
            p = p + sgn * (v / l) * P.lic_step * P.dpr;
            let w = 1.0 - f32(i) / 12.0;
            acc = acc + w * hash21(floor(p / (max(P.lic_grain, 0.5) * P.dpr)));
            wsum = wsum + w;
          }
        }
        let lic = select(0.5, acc / max(wsum, 1e-5), wsum > 0.0);
        rgb = rgb * (0.25 + 1.1 * smoothstep(0.25, 0.75, lic));
      }
    }

    // alpha over background
    var al = clamp(a, 0.0, 1.0);
    if (P.alpha_mode == 2u) { al = 1.0; }
    if (P.alpha_mode == 1u) { col = rgb + bg * (1.0 - al); } else { col = mix(bg, rgb, al); }

    // pixel grid (only when texels are big enough to matter)
    if (P.grid == 1u && texel_px >= 8.0) {
      let f = fract(uvw * P.tex_size * P.sub.zw);
      let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * texel_px;
      col = mix(col, vec3f(0.5), 0.35 * (1.0 - smoothstep(0.0, 1.0 * P.dpr, e)));
    }
  }

  // seam highlight on the tile borders (integer uv lines): green = continuous, red = visible seam
  if (P.seam == 1u) {
    let rx = round(uv.x);
    let ry = round(uv.y);
    let dpx_x = abs(uv.x - rx) * P.img.x * P.zoom;
    let dpx_y = abs(uv.y - ry) * P.img.y * P.zoom;
    let in_x = rx >= P.reg_lo.x - 0.001 && rx <= P.reg_hi.x + 0.001;
    let in_y = ry >= P.reg_lo.y - 0.001 && ry <= P.reg_hi.y + 0.001;
    var cov = 0.0;
    var err = 0.0;
    if (in_x && dpx_x < 1.5 * P.dpr && uv.y >= P.reg_lo.y && uv.y < P.reg_hi.y) {
      cov = 1.0 - dpx_x / (1.5 * P.dpr);
      err = seam_err(true, fract(uv.y));
    }
    if (in_y && dpx_y < 1.5 * P.dpr && uv.x >= P.reg_lo.x && uv.x < P.reg_hi.x) {
      let c2 = 1.0 - dpx_y / (1.5 * P.dpr);
      if (c2 > cov) {
        cov = c2;
        err = seam_err(false, fract(uv.x));
      }
    }
    let sc = mix(vec3f(0.1, 0.95, 0.5), vec3f(1.0, 0.1, 0.1), clamp(err * 10.0, 0.0, 1.0));
    col = mix(col, sc, 0.9 * cov);
  }

  if (P.sphere_rect.z > 0.0) { col = lit_sphere(frag, col); }
  return vec4f(col, 1.0);
}
