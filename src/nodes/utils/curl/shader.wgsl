// utils.curl: dvy/dx - dvx/dy (y points down). CPU mirror: curlCentral()
#include "uvfield"
fn shade(uv: vec2f) -> vec4f {
  let n = vec2f(textureDimensions(t0));
  let px = 1.0 / n;
  let r = vec_sample(t0, uv + vec2f(px.x, 0.0), F.tile, F.filter_mode).y;
  let l = vec_sample(t0, uv - vec2f(px.x, 0.0), F.tile, F.filter_mode).y;
  let u = vec_sample(t0, uv + vec2f(0.0, px.y), F.tile, F.filter_mode).x;
  let d = vec_sample(t0, uv - vec2f(0.0, px.y), F.tile, F.filter_mode).x;
  return vec4f(((r - l) * 0.5 * n.x - (u - d) * 0.5 * n.y) * P.gain, 0.0, 0.0, 1.0);
}
