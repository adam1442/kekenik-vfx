// utils.kuwahara — Anisotropic Kuwahara (Kyprianidis et al.), 8 soft sectors. t0 = source, t1 = smoothed structure tensor.
// The window is an ellipse aligned with the local edge direction (minor axis across the edge, stretched by the
// anisotropy). Each sample contributes to its (up to) two neighbouring sectors with triangular weights (sum = 1) times a
// gaussian radial weight. Sector mean / variance -> output = sum(alpha_k * mean_k) / sum(alpha_k) with
// alpha_k = 1 / (1 + (variance_k * scale)^(sharpness/2)). Wrap-aware window (tex_load with F.tile).
#include "sampling"

const NS: i32 = 8;

fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  let J = tex_load(t1, p, F.tile).rgb;
  let tmp = sqrt(max((J.x - J.z) * (J.x - J.z) + 4.0 * J.y * J.y, 0.0));
  let l1 = 0.5 * (J.x + J.z + tmp);
  let l2 = 0.5 * (J.x + J.z - tmp);
  // minor eigenvector (direction of the edge): (l1 - E, -F)
  var t = vec2f(l1 - J.x, -J.y);
  if (dot(t, t) < 1e-12) {
    t = vec2f(0.0, 1.0);
  }
  let phi = atan2(t.y, t.x);
  let A = select(0.0, (l1 - l2) / (l1 + l2), l1 + l2 > 1e-9);
  // Window half-axes are capped at 16 px: strongly anisotropic windows stretch up to 2x the radius.
  let a = min(P.radius * (P.alpha + A) / P.alpha, 16.0);
  let b = min(P.radius * P.alpha / (P.alpha + A), 16.0);
  let cs = cos(phi);
  let sn = sin(phi);
  let ri = i32(ceil(max(a, b)));
  var m: array<vec4f, 8>;
  var s: array<vec4f, 8>;
  var w: array<f32, 8>;
  for (var k = 0; k < NS; k = k + 1) {
    m[k] = vec4f(0.0);
    s[k] = vec4f(0.0);
    w[k] = 0.0;
  }
  let sector = 6.283185307 / f32(NS);
  for (var j = -ri; j <= ri; j = j + 1) {
    for (var i = -ri; i <= ri; i = i + 1) {
      let v = vec2f(f32(i), f32(j));
      let q = vec2f((cs * v.x + sn * v.y) / a, (-sn * v.x + cs * v.y) / b);
      let d2 = dot(q, q);
      if (d2 > 1.0) {
        continue;
      }
      let c = tex_load(t0, p + vec2i(i, j), F.tile);
      let g = exp(-3.0 * d2);
      var ang = atan2(q.y, q.x);
      if (ang < 0.0) {
        ang = ang + 6.283185307;
      }
      let fk = ang / sector;
      let k0 = i32(floor(fk)) % NS;
      let k1 = (k0 + 1) % NS;
      let fr = fk - floor(fk);
      // triangular basis centred on k0 + 0.5 sectors -> two neighbours get (1 - fr') and fr'
      let u = fr - 0.5;
      var wa = 0.0;
      var wb = 0.0;
      var ka = k0;
      var kb = k1;
      if (u >= 0.0) {
        wa = 1.0 - u;
        wb = u;
      } else {
        ka = (k0 + NS - 1) % NS;
        kb = k0;
        wa = -u;
        wb = 1.0 + u;
      }
      m[ka] = m[ka] + c * (g * wa);
      s[ka] = s[ka] + c * c * (g * wa);
      w[ka] = w[ka] + g * wa;
      m[kb] = m[kb] + c * (g * wb);
      s[kb] = s[kb] + c * c * (g * wb);
      w[kb] = w[kb] + g * wb;
    }
  }
  var outc = vec4f(0.0);
  var asum = 0.0;
  for (var k = 0; k < NS; k = k + 1) {
    if (w[k] <= 0.000001) {
      continue;
    }
    let mean = m[k] / w[k];
    let var4 = max(s[k] / w[k] - mean * mean, vec4f(0.0));
#if COLOR == 1
    let sd = (var4.r + var4.g + var4.b) / 3.0;
#else
    let sd = var4.r;
#endif
    let al = 1.0 / (1.0 + pow(sd * 255.0 * 255.0 * 0.0039 + 0.000001, P.sharpness * 0.5));
    outc = outc + mean * al;
    asum = asum + al;
  }
  if (asum <= 0.0) {
    return tex_load(t0, p, F.tile);
  }
  return outc / asum;
}
