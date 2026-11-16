// utils.glow stage 1: soft-knee bright pass of t0.
fn shade(uv: vec2f) -> vec4f {
  let c = textureLoad(t0, vec2i(floor(uv * F.res)), 0);
#if COLOR == 1
  let l = max(c.r, max(c.g, c.b));
#else
  let l = c.r;
#endif
  let knee = max(P.knee, 0.00001);
  var soft = clamp(l - P.threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  let contrib = max(soft, l - P.threshold) / max(l, 0.00001);
  return c * max(contrib, 0.0);
}
