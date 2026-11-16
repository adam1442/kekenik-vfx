// grayscale.xdog — extended difference of gaussians. t0 = G(sigma), t1 = G(k * sigma).
// S = (1 + p) * G1 - p * G2;   soft:  S >= eps ? 1 : 1 + tanh(phi * (S - eps));   hard: S >= eps ? 1 : 0.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let pp = vec2i(floor(uv * vec2f(n)));
  let g1 = tex_load(t0, pp, F.tile).r;
  let g2 = tex_load(t1, pp, F.tile).r;
  let s = (1.0 + P.sharp) * g1 - P.sharp * g2;
  var r = 1.0;
  if (s < P.epsilon) {
    if (P.hard == 1u) {
      r = 0.0;
    } else {
      r = clamp(1.0 + tanh(P.phi * (s - P.epsilon)), 0.0, 1.0);
    }
  }
  if (P.invert == 1u) {
    r = 1.0 - r;
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
