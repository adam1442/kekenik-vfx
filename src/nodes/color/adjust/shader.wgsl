// color.adjust — t0 = input colour, t1 = hue mod, t2 = saturation mod, t3 = brightness mod, t4 = mask.
// Order: exposure -> tint -> hue / saturation (OKLab chroma plane) -> value -> contrast (power about pivot) -> gamma -> brightness.
// Alpha is never touched. HDR safe (no clamping).
// the per-pixel body is `fuse()` (single source of truth): the standalone shader is a thin wrapper, the fusion engine inlines
// the same region into fused chains. `fuse` may read ONLY uv, src, P, its extra textures (same uv) and the frame F.
#include "sampling"
#include "util"
#include "color"
#include "oklab"

// @fuse-begin
fn fuse(uv: vec2f, src: vec4f, P: Params, x_hue: texture_2d<f32>, x_sat: texture_2d<f32>, x_bri: texture_2d<f32>, x_mask: texture_2d<f32>) -> vec4f {
  var hue = P.hue;
  if (P.hue_mod_k != 0.0) {
    hue = modulate(hue, tex_sample(x_hue, uv, F.tile, F.filter_mode).r, P.hue_mod_k);
  }
  var sat = P.saturation;
  if (P.saturation_mod_k != 0.0) {
    sat = modulate(sat, tex_sample(x_sat, uv, F.tile, F.filter_mode).r, P.saturation_mod_k);
  }
  var bright = P.brightness;
  if (P.brightness_mod_k != 0.0) {
    bright = modulate(bright, tex_sample(x_bri, uv, F.tile, F.filter_mode).r, P.brightness_mod_k);
  }
  var c = src.rgb * exp2(P.exposure);
  c = mix(c, c * P.tint.rgb, P.tint_amount);
  if (abs(hue) > 0.000001 || abs(sat - 1.0) > 0.000001) {
    let lab = lin_to_oklab(c);
    let ang = radians(hue);
    let cs = cos(ang);
    let sn = sin(ang);
    let ab = vec2f(lab.y * cs - lab.z * sn, lab.y * sn + lab.z * cs) * max(sat, 0.0);
    c = oklab_to_lin(vec3f(lab.x, ab.x, ab.y));
  }
  c = c * P.value;
  if (abs(P.contrast - 1.0) > 0.000001) {
    c = vec3f(0.18) * pow(max(c / vec3f(0.18), vec3f(0.0)), vec3f(P.contrast));
  }
  if (abs(P.gamma - 1.0) > 0.000001) {
    c = pow(max(c, vec3f(0.0)), vec3f(1.0 / max(P.gamma, 0.0001)));
  }
  c = c + vec3f(bright);
  if (P.has_mask == 1u) {
    c = mix(src.rgb, c, clamp(tex_sample(x_mask, uv, F.tile, F.filter_mode).r, 0.0, 1.0));
  }
  return vec4f(c, src.a);
}
// @fuse-end

fn shade(uv: vec2f) -> vec4f {
  let src = tex_sample(t0, uv, F.tile, F.filter_mode);
  return fuse(uv, src, P, t1, t2, t3, t4);
}
