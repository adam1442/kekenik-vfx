// utils.sheet_decode — sample one (or two blended) flipbook frames from a sheet.
// P.rect_a / rect_b = [u0, v0, du, dv] of the frame CONTENT (v down, like the texture rows), P.mix = weight of b.
fn dec_fetch(uv_in: vec2f, rect: vec4f) -> vec4f {
  let dims = vec2f(textureDimensions(t0));
  let uv = rect.xy + clamp(uv_in, vec2f(0.0), vec2f(1.0)) * rect.zw;
  let lo = vec2i(floor(rect.xy * dims + vec2f(0.001)));
  let hi = vec2i(ceil((rect.xy + rect.zw) * dims - vec2f(0.001))) - vec2i(1);
  let p = uv * dims - vec2f(0.5);
  let f = floor(p);
  let fr = p - f;
  let i0 = clamp(vec2i(f), lo, hi);
  let i1 = clamp(vec2i(f) + vec2i(1), lo, hi);
  let a = textureLoad(t0, vec2i(i0.x, i0.y), 0);
  let b = textureLoad(t0, vec2i(i1.x, i0.y), 0);
  let c = textureLoad(t0, vec2i(i0.x, i1.y), 0);
  let d = textureLoad(t0, vec2i(i1.x, i1.y), 0);
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}

fn shade(uv: vec2f) -> vec4f {
  var c = dec_fetch(uv, P.rect_a);
  if (P.mix > 0.0001) {
    c = mix(c, dec_fetch(uv, P.rect_b), P.mix);
  }
  return c;
}
