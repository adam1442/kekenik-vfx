// export.multimask — channel packing. t0..t3 = sources of R, G, B, A (Color; Gray is converted by the engine).
// Per slot: select a source channel (0 r, 1 g, 2 b, 3 a, 4 luma, 5 zero, 6 one), levels (black / white / gamma), optional invert.
// CPU mirror: packChannel() in src/export/pixels.ts (unit tested).
fn pick_channel(c: vec4f, s: u32) -> f32 {
  switch (s) {
    case 0u: { return c.r; }
    case 1u: { return c.g; }
    case 2u: { return c.b; }
    case 3u: { return c.a; }
    case 4u: { return dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722)); }
    case 5u: { return 0.0; }
    default: { return 1.0; }
  }
}

fn slot_value(c: vec4f, s: u32, black: f32, white: f32, gamma: f32, inv: u32) -> f32 {
  let v = pick_channel(c, s);
  let span = white - black;
  var x = 0.0;
  if (abs(span) < 0.00000001) {
    x = select(0.0, 1.0, v >= white);
  } else {
    x = (v - black) / span;
  }
  x = clamp(x, 0.0, 1.0);
  if (gamma != 1.0 && gamma > 0.0) { x = pow(x, 1.0 / gamma); }
  return select(x, 1.0 - x, inv == 1u);
}

fn shade(uv: vec2f) -> vec4f {
  let p = vec2i(floor(uv * F.res));
  var c0 = vec4f(P.defv.x);
  var c1 = vec4f(P.defv.y);
  var c2 = vec4f(P.defv.z);
  var c3 = vec4f(P.defv.w);
  if ((P.mask & 1u) != 0u) { c0 = textureLoad(t0, p, 0); }
  if ((P.mask & 2u) != 0u) { c1 = textureLoad(t1, p, 0); }
  if ((P.mask & 4u) != 0u) { c2 = textureLoad(t2, p, 0); }
  if ((P.mask & 8u) != 0u) { c3 = textureLoad(t3, p, 0); }
  let r = slot_value(c0, P.src0, P.black.x, P.white.x, P.gamma.x, P.inv0);
  let g = slot_value(c1, P.src1, P.black.y, P.white.y, P.gamma.y, P.inv1);
  let b = slot_value(c2, P.src2, P.black.z, P.white.z, P.gamma.z, P.inv2);
  let a = slot_value(c3, P.src3, P.black.w, P.white.w, P.gamma.w, P.inv3);
  return vec4f(r, g, b, a);
}
