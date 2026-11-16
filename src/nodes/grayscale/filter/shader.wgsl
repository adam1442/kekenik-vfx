// grayscale.filter — combine / kernel pass. t0 = source, t1 = blurred source (sharpen / high-pass only).
// op: 0 sharpen (unsharp mask), 1 high-pass, 2 emboss (3x3 Sobel along a direction), 3 median 3x3, 4 median 5x5.
// All taps use integer coordinates + F.tile wrapping, so the kernels are exact and seamless.
#include "sampling"

fn px(p: vec2i, o: vec2i) -> f32 {
  return tex_load(t0, p + o, F.tile).r;
}

fn median_n(p: vec2i, r: i32) -> f32 {
  var a: array<f32, 25>;
  var n = 0;
  for (var dy = -r; dy <= r; dy = dy + 1) {
    for (var dx = -r; dx <= r; dx = dx + 1) {
      a[n] = px(p, vec2i(dx, dy));
      n = n + 1;
    }
  }
  let half_n = n / 2;
  // partial selection sort: after half_n+1 rounds a[half_n] is the median
  for (var i = 0; i <= half_n; i = i + 1) {
    var mi = i;
    for (var j = i + 1; j < n; j = j + 1) {
      if (a[j] < a[mi]) {
        mi = j;
      }
    }
    let tmp = a[i];
    a[i] = a[mi];
    a[mi] = tmp;
  }
  return a[half_n];
}

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let p = vec2i(floor(uv * vec2f(n)));
  let v = px(p, vec2i(0, 0));
  var r = v;
  if (P.op == 0u) {
    let b = tex_load(t1, p, F.tile).r;
    r = v + P.amount * (v - b);
  } else if (P.op == 1u) {
    let b = tex_load(t1, p, F.tile).r;
    r = 0.5 + P.amount * (v - b);
  } else if (P.op == 2u) {
    let gx = (px(p, vec2i(1, -1)) + 2.0 * px(p, vec2i(1, 0)) + px(p, vec2i(1, 1))) - (px(p, vec2i(-1, -1)) + 2.0 * px(p, vec2i(-1, 0)) + px(p, vec2i(-1, 1)));
    let gy = (px(p, vec2i(-1, 1)) + 2.0 * px(p, vec2i(0, 1)) + px(p, vec2i(1, 1))) - (px(p, vec2i(-1, -1)) + 2.0 * px(p, vec2i(0, -1)) + px(p, vec2i(1, -1)));
    // image y grows down: light direction angle is measured counter-clockwise on screen
    let dir = vec2f(cos(P.angle), -sin(P.angle));
    r = 0.5 + P.amount * 0.25 * dot(vec2f(gx, gy), dir);
  } else if (P.op == 3u) {
    r = median_n(p, 1);
  } else {
    r = median_n(p, 2);
  }
  return vec4f(r, 0.0, 0.0, 1.0);
}
