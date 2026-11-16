// sampling.wgsl — wrap/clamp aware point / bilinear / bicubic sampling built on textureLoad ONLY.
// Why textureLoad: it works for every float format (r16float ... rgba32float) without needing the
// float32-filterable feature or sampler bindings, and wrapping is exact per axis (tile.x / tile.y == 1 -> wrap).
// Pixel-centre convention: texel i covers uv in [i/n, (i+1)/n].

fn tex_wrap_coord(i: vec2i, n: vec2i, tile: vec2u) -> vec2i {
  var r = i;
  if (tile.x == 1u) {
    r.x = ((i.x % n.x) + n.x) % n.x;
  } else {
    r.x = clamp(i.x, 0, n.x - 1);
  }
  if (tile.y == 1u) {
    r.y = ((i.y % n.y) + n.y) % n.y;
  } else {
    r.y = clamp(i.y, 0, n.y - 1);
  }
  return r;
}

fn tex_load(t: texture_2d<f32>, i: vec2i, tile: vec2u) -> vec4f {
  let n = vec2i(textureDimensions(t));
  return textureLoad(t, tex_wrap_coord(i, n, tile), 0);
}

fn tex_point(t: texture_2d<f32>, uv: vec2f, tile: vec2u) -> vec4f {
  let n = vec2f(textureDimensions(t));
  return tex_load(t, vec2i(floor(uv * n)), tile);
}

fn tex_linear(t: texture_2d<f32>, uv: vec2f, tile: vec2u) -> vec4f {
  let n = vec2f(textureDimensions(t));
  let p = uv * n - vec2f(0.5);
  let fl = floor(p);
  let f = p - fl;
  let i0 = vec2i(fl);
  let a = tex_load(t, i0, tile);
  let b = tex_load(t, i0 + vec2i(1, 0), tile);
  let c = tex_load(t, i0 + vec2i(0, 1), tile);
  let d = tex_load(t, i0 + vec2i(1, 1), tile);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Catmull-Rom weights for the 4 taps around a sample position.
fn cubic_weights(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1.0,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2
  );
}

fn tex_cubic(t: texture_2d<f32>, uv: vec2f, tile: vec2u) -> vec4f {
  let n = vec2f(textureDimensions(t));
  let p = uv * n - vec2f(0.5);
  let fl = floor(p);
  let f = p - fl;
  let i0 = vec2i(fl) - vec2i(1, 1);
  let wx = cubic_weights(f.x);
  let wy = cubic_weights(f.y);
  var acc = vec4f(0.0);
  for (var j = 0; j < 4; j = j + 1) {
    var row = vec4f(0.0);
    for (var i = 0; i < 4; i = i + 1) {
      row = row + tex_load(t, i0 + vec2i(i, j), tile) * wx[i];
    }
    acc = acc + row * wy[j];
  }
  return acc;
}

// mode: 0 point, 1 linear, 2 cubic (Frame.filter_mode).
fn tex_sample(t: texture_2d<f32>, uv: vec2f, tile: vec2u, mode: u32) -> vec4f {
  if (mode == 0u) {
    return tex_point(t, uv, tile);
  }
  if (mode == 1u) {
    return tex_linear(t, uv, tile);
  }
  return tex_cubic(t, uv, tile);
}
