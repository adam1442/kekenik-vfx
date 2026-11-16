// blend.wgsl — blend modes. Applied per channel on all 4 channels (alpha is just another channel in Kekenik).
// Mode ids MUST match BLEND_MODES in src/engine/graph/common-params.ts.
const BM_COPY: u32 = 0u;
const BM_ADD: u32 = 1u;
const BM_SUBTRACT: u32 = 2u;
const BM_MULTIPLY: u32 = 3u;
const BM_MAX: u32 = 4u;
const BM_MIN: u32 = 5u;
const BM_SMOOTH_MIN: u32 = 6u;
const BM_SMOOTH_MAX: u32 = 7u;
const BM_SCREEN: u32 = 8u;
const BM_OVERLAY: u32 = 9u;
const BM_DIFFERENCE: u32 = 10u;
const BM_DIVIDE: u32 = 11u;
const BM_EXCLUSION: u32 = 12u;
const BM_SOFT_LIGHT: u32 = 13u;
const BM_HARD_LIGHT: u32 = 14u;
const BM_COLOR_DODGE: u32 = 15u;
const BM_COLOR_BURN: u32 = 16u;
const BM_LINEAR_LIGHT: u32 = 17u;
const BM_HUE: u32 = 18u;
const BM_SATURATION: u32 = 19u;
const BM_COLOR: u32 = 20u;
const BM_LUMINOSITY: u32 = 21u;

// ---- non-separable modes (W3C compositing spec). They work on rgb; alpha is blended like any other channel.
fn bl_lum(c: vec3f) -> f32 {
  return dot(c, vec3f(0.3, 0.59, 0.11));
}
fn bl_clip(c: vec3f) -> vec3f {
  let l = bl_lum(c);
  let n = min(c.r, min(c.g, c.b));
  let x = max(c.r, max(c.g, c.b));
  var r = c;
  if (n < 0.0) {
    r = vec3f(l) + (r - vec3f(l)) * l / max(l - n, 0.000001);
  }
  if (x > 1.0) {
    r = vec3f(l) + (r - vec3f(l)) * (1.0 - l) / max(x - l, 0.000001);
  }
  return r;
}
fn bl_setlum(c: vec3f, l: f32) -> vec3f {
  return bl_clip(c + vec3f(l - bl_lum(c)));
}
fn bl_sat(c: vec3f) -> f32 {
  return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
}
fn bl_setsat(c: vec3f, s: f32) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  if (mx > mn) {
    return (c - vec3f(mn)) * s / (mx - mn);
  }
  return vec3f(0.0);
}

// Gray textures only carry .r (g = b = 0). With -DGRAY=1 every channel is replaced by .r first so that the
// non-separable modes behave sensibly (hue/saturation/color keep the background, luminosity takes the foreground).
fn blend_prep(c: vec4f) -> vec4f {
#if GRAY == 1
  return vec4f(c.r, c.r, c.r, c.a);
#else
  return c;
#endif
}

// Polynomial smooth minimum. k = smoothness (0 -> hard min).
fn smin4(a: vec4f, b: vec4f, k: f32) -> vec4f {
  if (k <= 0.00001) {
    return min(a, b);
  }
  let h = max(vec4f(k) - abs(a - b), vec4f(0.0)) / k;
  return min(a, b) - h * h * k * 0.25;
}

fn smax4(a: vec4f, b: vec4f, k: f32) -> vec4f {
  return -smin4(-a, -b, k);
}

// bg = what is underneath (Background pin), fg = the node's own result.
fn blend_op(mode: u32, bg: vec4f, fg: vec4f, k: f32) -> vec4f {
  var r = fg;
  switch (mode) {
    case 0u: { r = fg; }
    case 1u: { r = bg + fg; }
    case 2u: { r = bg - fg; }
    case 3u: { r = bg * fg; }
    case 4u: { r = max(bg, fg); }
    case 5u: { r = min(bg, fg); }
    case 6u: { r = smin4(bg, fg, k); }
    case 7u: { r = smax4(bg, fg, k); }
    case 8u: { r = vec4f(1.0) - (vec4f(1.0) - bg) * (vec4f(1.0) - fg); }
    case 9u: {
      r = select(vec4f(1.0) - 2.0 * (vec4f(1.0) - bg) * (vec4f(1.0) - fg), 2.0 * bg * fg, bg < vec4f(0.5));
    }
    case 10u: { r = abs(bg - fg); }
    case 11u: { r = bg / max(fg, vec4f(0.0001)); }
    case 12u: { r = bg + fg - 2.0 * bg * fg; }
    case 13u: { r = (vec4f(1.0) - 2.0 * fg) * bg * bg + 2.0 * fg * bg; }
    case 14u: {
      r = select(vec4f(1.0) - (vec4f(1.0) - bg) * (vec4f(1.0) - (2.0 * fg - vec4f(1.0))), 2.0 * bg * fg, fg <= vec4f(0.5));
    }
    case 15u: { r = min(bg / max(vec4f(1.0) - fg, vec4f(0.0001)), vec4f(16.0)); }
    case 16u: { r = vec4f(1.0) - min((vec4f(1.0) - bg) / max(fg, vec4f(0.0001)), vec4f(16.0)); }
    case 17u: { r = bg + 2.0 * fg - vec4f(1.0); }
    case 18u: { r = vec4f(bl_setlum(bl_setsat(fg.rgb, bl_sat(bg.rgb)), bl_lum(bg.rgb)), fg.a); }
    case 19u: { r = vec4f(bl_setlum(bl_setsat(bg.rgb, bl_sat(fg.rgb)), bl_lum(bg.rgb)), fg.a); }
    case 20u: { r = vec4f(bl_setlum(fg.rgb, bl_lum(bg.rgb)), fg.a); }
    case 21u: { r = vec4f(bl_setlum(bg.rgb, bl_lum(fg.rgb)), fg.a); }
    default: { r = fg; }
  }
  return r;
}

// Cross mix: 0 = background only, 0.5 = the pure blend result ("even"), 1 = foreground only.
fn blend_cross(mode: u32, bg_in: vec4f, fg_in: vec4f, cross_mix: f32, k: f32) -> vec4f {
  let bg = blend_prep(bg_in);
  let fg = blend_prep(fg_in);
  let b = blend_op(mode, bg, fg, k);
  let c = clamp(cross_mix, 0.0, 1.0);
  if (c <= 0.5) {
    return mix(bg, b, c * 2.0);
  }
  return mix(b, fg, (c - 0.5) * 2.0);
}
