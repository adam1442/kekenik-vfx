// Structure tensor of the luminance (Sobel gradient): rgb = (E, F, G) = (gx*gx, gx*gy, gy*gy). Wrap-aware.
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
  let p = vec2i(floor(uv * F.res));
  let tl = lum(tex_load(t0, p + vec2i(-1, -1), F.tile));
  let tc = lum(tex_load(t0, p + vec2i(0, -1), F.tile));
  let tr = lum(tex_load(t0, p + vec2i(1, -1), F.tile));
  let ml = lum(tex_load(t0, p + vec2i(-1, 0), F.tile));
  let mr = lum(tex_load(t0, p + vec2i(1, 0), F.tile));
  let bl = lum(tex_load(t0, p + vec2i(-1, 1), F.tile));
  let bc = lum(tex_load(t0, p + vec2i(0, 1), F.tile));
  let br = lum(tex_load(t0, p + vec2i(1, 1), F.tile));
  let gx = ((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)) * 0.125;
  let gy = ((bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)) * 0.125;
  return vec4f(gx * gx, gx * gy, gy * gy, 1.0);
}
