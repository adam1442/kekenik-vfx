// Viewport presenter: draws a texture to the canvas (tiling preview, channel view, exposure, checker for alpha).
#include "sampling"
#include "color"

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let uv = in.uv * P.tiles;
  let wrap = vec2u(P.wrap, P.wrap);
  var c = tex_sample(t0, uv, wrap, P.filter_mode);
  if (P.is_gray == 1u) {
    c = vec4f(c.r, c.r, c.r, 1.0);
  }
  if (P.is_uv == 1u) {
    c = vec4f(c.r, c.g, 0.0, 1.0);
  }
  c = vec4f(c.rgb * exp2(P.exposure), c.a);
  var rgb = c.rgb;
  var a = c.a;
  switch (P.channel) {
    case 1u: { rgb = vec3f(c.r); a = 1.0; }
    case 2u: { rgb = vec3f(c.g); a = 1.0; }
    case 3u: { rgb = vec3f(c.b); a = 1.0; }
    case 4u: { rgb = vec3f(c.a); a = 1.0; }
    case 5u: { rgb = vec3f(luminance(c.rgb)); a = 1.0; }
    default: {}
  }
  if (P.srgb == 1u) {
    rgb = linear_to_srgb(clamp(rgb, vec3f(0.0), vec3f(1.0)));
  }
  // Checkerboard behind transparent pixels.
  let cell = floor(in.pos.xy / 8.0);
  let chk = select(0.18, 0.28, (i32(cell.x) + i32(cell.y)) % 2 == 0);
  let outc = mix(vec3f(chk), rgb, clamp(a, 0.0, 1.0));
  return vec4f(outc, 1.0);
}
