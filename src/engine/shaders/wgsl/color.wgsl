// color.wgsl — color space conversions. All intermediate textures are LINEAR; sRGB only at display/export.

fn srgb_to_linear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

fn linear_to_srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

// h in [0,1), s, v
fn rgb_to_hsv(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let d = mx - mn;
  var h = 0.0;
  if (d > 0.000001) {
    if (mx == c.r) {
      h = ((c.g - c.b) / d + 6.0) % 6.0;
    } else if (mx == c.g) {
      h = (c.b - c.r) / d + 2.0;
    } else {
      h = (c.r - c.g) / d + 4.0;
    }
    h = h / 6.0;
  }
  var s = 0.0;
  if (mx > 0.000001) {
    s = d / mx;
  }
  return vec3f(h, s, mx);
}

fn hsv_to_rgb(c: vec3f) -> vec3f {
  let k = vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0);
  let p = abs(fract(vec3f(c.x) + k) * 6.0 - vec3f(3.0));
  return c.z * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), c.y);
}

// Gray (stored in .r of a gray texture) to color.
fn gray_to_color(v: f32) -> vec4f {
  return vec4f(v, v, v, 1.0);
}
