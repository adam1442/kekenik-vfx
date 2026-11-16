// color.premultiply — alpha convention converter. t0 = input colour. Mode: 0 premultiply, 1 unpremultiply, 2 additive, 3 opaque.
#include "sampling"

fn shade(uv: vec2f) -> vec4f {
  let c = tex_sample(t0, uv, F.tile, F.filter_mode);
  switch (P.mode) {
    case 0u: { return vec4f(c.rgb * c.a, c.a); }
    case 1u: {
      let s = select(0.0, 1.0 / c.a, c.a > max(P.epsilon, 1e-8));
      return vec4f(c.rgb * s, c.a);
    }
    case 2u: { return vec4f(c.rgb * c.a, 0.0); }
    default: { return vec4f(c.rgb, 1.0); }
  }
}
