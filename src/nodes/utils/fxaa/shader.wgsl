// utils.fxaa — FXAA 2.0-style single pass (Lottes). Luma from .r (gray) or Rec.709 (color). Wrap-aware taps.
#include "sampling"
#include "color"

fn lum(c: vec4f) -> f32 {
#if COLOR == 1
  return luminance(c.rgb);
#else
  return c.r;
#endif
}

fn shade(uv: vec2f) -> vec4f {
  let px = 1.0 / F.res;
  let cM = tex_linear(t0, uv, F.tile);
  let cNW = tex_linear(t0, uv + vec2f(-1.0, -1.0) * px, F.tile);
  let cNE = tex_linear(t0, uv + vec2f(1.0, -1.0) * px, F.tile);
  let cSW = tex_linear(t0, uv + vec2f(-1.0, 1.0) * px, F.tile);
  let cSE = tex_linear(t0, uv + vec2f(1.0, 1.0) * px, F.tile);
  let lM = lum(cM);
  let lNW = lum(cNW);
  let lNE = lum(cNE);
  let lSW = lum(cSW);
  let lSE = lum(cSE);
  let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(P.min_threshold, lMax * P.threshold)) {
    return cM;
  }
  var dir = vec2f(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  let dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 * P.reduce_mul), 0.0078125);
  let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2f(-P.span), vec2f(P.span)) * px;
  let rgbA = 0.5 * (tex_linear(t0, uv + dir * (1.0 / 3.0 - 0.5), F.tile) + tex_linear(t0, uv + dir * (2.0 / 3.0 - 0.5), F.tile));
  let rgbB = rgbA * 0.5 + 0.25 * (tex_linear(t0, uv + dir * -0.5, F.tile) + tex_linear(t0, uv + dir * 0.5, F.tile));
  let lB = lum(rgbB);
  var r = rgbB;
  if (lB < lMin || lB > lMax) {
    r = rgbA;
  }
  return mix(cM, r, P.strength);
}
