// anim_blit.wgsl — Sheet Encode: render one flipbook CELL from an evaluated frame (and optionally cross-fade it with a second one).
// F.res = cell size in pixels. The frame content occupies the cell minus `pad` pixels on every side; the padding ring replicates the
// edge pixels (clamp), which keeps mip-maps and bilinear filtering of the finished sheet free of bleeding.
// P: pad (px), w (cross-fade weight of t1), a_gray / b_gray (source is a single-channel Gray texture), has_b.
fn blit_fetch(t: texture_2d<f32>, uv: vec2f, gray: u32) -> vec4f {
  let dims = vec2f(textureDimensions(t));
  let p = uv * dims - vec2f(0.5);
  let f = floor(p);
  let fr = p - f;
  let hi = vec2i(dims) - vec2i(1);
  let i0 = clamp(vec2i(f), vec2i(0), hi);
  let i1 = clamp(vec2i(f) + vec2i(1), vec2i(0), hi);
  let a = textureLoad(t, vec2i(i0.x, i0.y), 0);
  let b = textureLoad(t, vec2i(i1.x, i0.y), 0);
  let c = textureLoad(t, vec2i(i0.x, i1.y), 0);
  let d = textureLoad(t, vec2i(i1.x, i1.y), 0);
  var v = mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
  if (gray == 1u) { v = vec4f(v.r, v.r, v.r, 1.0); }
  return v;
}

fn shade(uv: vec2f) -> vec4f {
  let px = uv * F.res;
  let inner = (px - vec2f(P.pad)) / max(F.res - vec2f(2.0 * P.pad), vec2f(1.0));
  let suv = clamp(inner, vec2f(0.0), vec2f(1.0));
  var c = blit_fetch(t0, suv, P.a_gray);
  if (P.has_b == 1u) {
    c = mix(c, blit_fetch(t1, suv, P.b_gray), P.w);
  }
  return c;
}
