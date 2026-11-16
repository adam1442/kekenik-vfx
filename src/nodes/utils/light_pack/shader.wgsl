// utils.light_pack — bakes 3 directional lights from a height map into RGB (+ alpha). t0 = height, t1 = alpha (optional).
// Normal: central differences over one texel, expressed per UV unit (resolution independent), n = normalize(-dh/dx * s, -dh/dy * s, 1).
// Light direction for azimuth az (CCW from +X on screen, screen y is DOWN) and elevation el: L = (cos az cos el, -sin az cos el, sin el).
// Wrapped diffuse: lit = saturate((N.L + wrap) / (1 + wrap)); channel = ambient + (1 - ambient) * lit.
#include "sampling"

fn light_dir(az_deg: f32, el_deg: f32) -> vec3f {
  let az = radians(az_deg);
  let el = radians(el_deg);
  return vec3f(cos(az) * cos(el), -sin(az) * cos(el), sin(el));
}

fn lit(n: vec3f, az_deg: f32) -> f32 {
  let nl = dot(n, light_dir(az_deg, P.elevation));
  let l = clamp((nl + P.wrap) / (1.0 + P.wrap), 0.0, 1.0);
  return P.ambient + (1.0 - P.ambient) * l;
}

fn shade(uv: vec2f) -> vec4f {
  let px = 1.0 / F.res;
  let h0 = tex_sample(t0, uv, F.tile, F.filter_mode).r;
  let hx = tex_sample(t0, uv + vec2f(px.x, 0.0), F.tile, F.filter_mode).r - tex_sample(t0, uv - vec2f(px.x, 0.0), F.tile, F.filter_mode).r;
  let hy = tex_sample(t0, uv + vec2f(0.0, px.y), F.tile, F.filter_mode).r - tex_sample(t0, uv - vec2f(0.0, px.y), F.tile, F.filter_mode).r;
  // slope per UV unit: (difference over 2 texels) / (2 texels in UV) = difference * res / 2
  let g = vec2f(hx * F.res.x, hy * F.res.y) * 0.5 * P.strength * 0.01;
  let n = normalize(vec3f(-g.x, -g.y, 1.0));
  var a = h0;
  if (P.has_alpha == 1u) {
    a = tex_sample(t1, uv, F.tile, F.filter_mode).r;
  }
  let la = lit(n, P.angle_a);
  let lb = lit(n, P.angle_b);
  let lc = lit(n, P.angle_c);
  if (P.output_mode == 1u) {
    let m = (la + lb + lc) / 3.0;
    return vec4f(m, m, m, a);
  }
  return vec4f(la, lb, lc, a);
}
