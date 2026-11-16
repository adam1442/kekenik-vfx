// grayscale.curvature — convex / concave from a heightmap. t0 = height, t1 = gaussian-blurred height.
// lap = height - blurred height is > 0 on convex features (hills, edges) and < 0 in concave ones (pits, creases);
// for a gaussian kernel it is proportional to -(sigma^2 / 2) * laplacian(height).
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let p = vec2i(floor(uv * vec2f(n)));
  let lap = (tex_load(t0, p, F.tile).r - tex_load(t1, p, F.tile).r) * P.gain;
  var r = 0.5 + 0.5 * clamp(lap, -1.0, 1.0);
  if (P.kind == 0u) {
    r = clamp(lap, 0.0, 1.0);
  } else if (P.kind == 1u) {
    r = clamp(-lap, 0.0, 1.0);
  }
  if (P.invert == 1u) {
    r = 1.0 - r;
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
