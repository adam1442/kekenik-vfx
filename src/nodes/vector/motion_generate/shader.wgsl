// Motion Vector Generate (pyramidal Horn-Schunck with warping). Every pass renders into a texture of its own size: normalised
// target uv = uv * F.full_res / P.dst, integer pixel = floor(uv * F.full_res). CPU mirror: opticalFlow() in _shared/flowref.ts
//  MODE 0 PREP   t0 sheet -> gray level 0 of one cell (P.rect), pre-blur, channel selection
//  MODE 1 DOWN   t0 finer gray -> coarser gray
//  MODE 2 ITER   t0 A, t1 B, t2 flow (px at this level) -> flow
//  MODE 3 UP     t0 coarse flow -> flow x2 (bilinear, vectors scaled by the size ratio)
//  MODE 4 MEDIAN t0 flow -> 3x3 median per component
//  MODE 5 FINAL  t0 flow (px of the cell) -> tile fractions of the cell (Vector)
//  MODE 6 OCC    t0 forward flow, t1 backward flow -> occlusion 0..1 (forward / backward inconsistency)
//  MODE 7 ZERO
#include "vectorlib"
fn tl() -> vec2u {
  return vec2u(P.wrap_tile, P.wrap_tile);
}
fn tuv(uv: vec2f) -> vec2f {
  return uv * F.full_res / P.dst;
}
fn pxi(uv: vec2f) -> vec2i {
  return vec2i(floor(uv * F.full_res));
}
fn chan(c: vec4f) -> f32 {
  switch (P.channel) {
    case 0u: { return dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722)); }
    case 1u: { return (c.r + c.g + c.b) / 3.0; }
    case 2u: { return c.r; }
    case 3u: { return c.g; }
    case 4u: { return c.b; }
    default: { return c.a; }
  }
}
fn shade(uv: vec2f) -> vec4f {
  let c = pxi(uv);
  let u = tuv(uv);
#if MODE == 0
  var acc = 0.0;
  let r = P.pre_blur / P.dst;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      var q = u + vec2f(f32(i), f32(j)) * r;
      q = select(clamp(q, vec2f(0.0), vec2f(1.0)), fract(q), P.wrap_tile == 1u);
      acc = acc + chan(tex_linear(t0, P.rect.xy + q * P.rect.zw, vec2u(0u, 0u)));
    }
  }
  return vec4f(acc / 9.0, 0.0, 0.0, 1.0);
#elif MODE == 1
  return vec4f(tex_linear(t0, u, tl()).x, 0.0, 0.0, 1.0);
#elif MODE == 2
  let n = vec2f(textureDimensions(t0));
  let f = tex_load(t2, c, tl()).xy;
  let x = vec2f(c) + vec2f(0.5);
  let h = max(P.window, 1.0);
  let ax = tex_linear(t0, (x + vec2f(h, 0.0)) / n, tl()).x - tex_linear(t0, (x - vec2f(h, 0.0)) / n, tl()).x;
  let ay = tex_linear(t0, (x + vec2f(0.0, h)) / n, tl()).x - tex_linear(t0, (x - vec2f(0.0, h)) / n, tl()).x;
  let xw = x + f;
  let bx = tex_linear(t1, (xw + vec2f(h, 0.0)) / n, tl()).x - tex_linear(t1, (xw - vec2f(h, 0.0)) / n, tl()).x;
  let by = tex_linear(t1, (xw + vec2f(0.0, h)) / n, tl()).x - tex_linear(t1, (xw - vec2f(0.0, h)) / n, tl()).x;
  let ix = (ax + bx) / (4.0 * h);
  let iy = (ay + by) / (4.0 * h);
  let it = tex_linear(t1, xw / n, tl()).x - tex_linear(t0, x / n, tl()).x;
  let ub = 0.25 * (tex_load(t2, c + vec2i(1, 0), tl()).xy + tex_load(t2, c - vec2i(1, 0), tl()).xy + tex_load(t2, c + vec2i(0, 1), tl()).xy + tex_load(t2, c - vec2i(0, 1), tl()).xy);
  let r0 = it + ix * (ub.x - f.x) + iy * (ub.y - f.y);
  var w = 1.0;
  if (P.method == 1u) { w = 0.05 / sqrt(r0 * r0 + 0.0025); }
  let den = P.smoothness * P.smoothness + w * (ix * ix + iy * iy);
  var nu = ub - vec2f(ix, iy) * (w * r0) / den;
  // trust region (CPU mirror: STEP_LIMIT in flowref.ts): one iteration changes the flow by at most 0.75 px of this level
  let dn = nu - f;
  let dl = length(dn);
  if (dl > 0.75) { nu = f + dn * (0.75 / dl); }
  let l = length(nu);
  if (l > P.lvl_max) { nu = nu * (P.lvl_max / l); }
  return vec4f(nu, 0.0, 1.0);
#elif MODE == 3
  let s = vec2f(textureDimensions(t0));
  return vec4f(tex_linear(t0, u, tl()).xy * (P.dst / s), 0.0, 1.0);
#elif MODE == 4
  var xs: array<f32, 9>;
  var ys: array<f32, 9>;
  var k = 0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let s = tex_load(t0, c + vec2i(i, j), tl()).xy;
      xs[k] = s.x;
      ys[k] = s.y;
      k = k + 1;
    }
  }
  for (var a = 0; a < 9; a = a + 1) {
    for (var b = 0; b < 8 - a; b = b + 1) {
      if (xs[b] > xs[b + 1]) { let t = xs[b]; xs[b] = xs[b + 1]; xs[b + 1] = t; }
      if (ys[b] > ys[b + 1]) { let t = ys[b]; ys[b] = ys[b + 1]; ys[b + 1] = t; }
    }
  }
  return vec4f(xs[4], ys[4], 0.0, 1.0);
#elif MODE == 5
  return vec4f(tex_load(t0, c, tl()).xy / P.dst, 0.0, 1.0);
#elif MODE == 6
  let fw = tex_load(t0, c, tl()).xy;
  let x = vec2f(c) + vec2f(0.5);
  let q = (x + fw) / P.dst;
  let bw = tex_linear(t1, q, tl()).xy;
  var occ = smoothstep(P.occ_thr, 2.0 * P.occ_thr, length(fw + bw));
  if (P.wrap_tile == 0u && (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0)) { occ = 1.0; }
  return vec4f(occ, 0.0, 0.0, 1.0);
#else
  return vec4f(0.0, 0.0, 0.0, 1.0);
#endif
}
