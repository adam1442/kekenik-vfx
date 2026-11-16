// subgraph Input boundary: a constant (P.c) or, for UV pins, the identity field (mode > 0.5).
fn shade(uv: vec2f) -> vec4f {
  if (P.mode > 0.5) {
    return vec4f(uv, 0.0, 1.0);
  }
  return P.c;
}
