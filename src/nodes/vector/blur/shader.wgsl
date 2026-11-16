// vector.blur — one separable direction per pass (#define DIR 0 = X, 1 = Y). Radius in units of the smaller side.
#include "vectorlib"
fn shade(uv: vec2f) -> vec4f {
  let res = vec2f(textureDimensions(t0));
  let r = P.radius * min(res.x, res.y) / res;
  let dir = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), DIR == 1);
  var acc = vec2f(0.0);
  var wsum = 0.0;
  let n = max(P.taps, 1);
  for (var i = -n; i <= n; i = i + 1) {
    let x = f32(i) / f32(n);
    var w = 1.0;
    if (P.kernel == 0u) { w = exp(-4.5 * x * x); }
    acc = acc + vec_sample(t0, uv + dir * r * x, F.tile, F.filter_mode) * w;
    wsum = wsum + w;
  }
  return vec4f(acc / wsum, 0.0, 1.0);
}
