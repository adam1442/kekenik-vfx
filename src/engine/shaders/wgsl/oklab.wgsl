// oklab.wgsl — OKLab conversions for LINEAR sRGB (pure module). Inputs may be HDR (>1); negatives are clamped to 0.
fn lin_to_oklab(c: vec3f) -> vec3f {
  let cc = max(c, vec3f(0.0));
  let l = pow(0.4122214708 * cc.r + 0.5363325363 * cc.g + 0.0514459929 * cc.b, 0.33333333);
  let m = pow(0.2119034982 * cc.r + 0.6806995451 * cc.g + 0.1073969566 * cc.b, 0.33333333);
  let s = pow(0.0883024619 * cc.r + 0.2817188376 * cc.g + 0.6299787005 * cc.b, 0.33333333);
  return vec3f(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  );
}
fn oklab_to_lin(c: vec3f) -> vec3f {
  let l = pow(max(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z, 0.0), 3.0);
  let m = pow(max(c.x - 0.1055613458 * c.y - 0.0638541728 * c.z, 0.0), 3.0);
  let s = pow(max(c.x - 0.0894841775 * c.y - 1.2914855480 * c.z, 0.0), 3.0);
  return vec3f(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}
