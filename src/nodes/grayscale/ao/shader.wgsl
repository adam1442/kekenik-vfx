// grayscale.ao — heightmap ambient occlusion (horizon based, "screen-space-like"). t0 = height.
// For `dirs` directions around the pixel the highest elevation angle of the terrain is tracked while marching `steps`
// samples out to `radius_px` (quadratic spacing: dense near the pixel). Every time the horizon rises above the running
// maximum (initialised with the bias angle) the increment of sin(elevation) is added, attenuated with distance.
// White = open, dark = occluded. Wrap-aware through F.tile (integer taps).
#include "sampling"

const TAU_C: f32 = 6.28318530717959;

fn ig_noise(p: vec2f) -> f32 {
  // interleaved gradient noise (cheap, no texture): decorrelates the direction set between neighbouring pixels
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn shade(uv: vec2f) -> vec4f {
  let n = vec2i(textureDimensions(t0));
  let p = vec2i(floor(uv * vec2f(n)));
  let h0 = tex_load(t0, p, F.tile).r;
  let z_scale = P.height_scale * min(F.full_res.x, F.full_res.y); // height units -> pixels
  let jit = select(0.0, ig_noise(vec2f(p)), P.jitter == 1u);
  let sbias = sin(P.bias);
  var occ = 0.0;
  for (var d = 0; d < P.dirs; d = d + 1) {
    let ang = (f32(d) + jit) / f32(P.dirs) * TAU_C;
    let dir = vec2f(cos(ang), sin(ang));
    var hmax = sbias;
    var oc = 0.0;
    for (var s = 1; s <= P.steps; s = s + 1) {
      let t = f32(s) / f32(P.steps);
      let off = round(dir * (P.radius_px * t * t));
      if (off.x == 0.0 && off.y == 0.0) {
        continue;
      }
      let hs = tex_load(t0, p + vec2i(off), F.tile).r;
      let dz = (hs - h0) * z_scale;
      let dist = length(off);
      let se = dz / sqrt(dz * dz + dist * dist);
      if (se > hmax) {
        oc = oc + (se - hmax) * (1.0 - t * t);
        hmax = se;
      }
    }
    occ = occ + oc;
  }
  occ = occ / f32(P.dirs);
  var ao = pow(clamp(1.0 - P.strength * occ, 0.0, 1.0), P.power);
  if (P.invert == 1u) {
    ao = 1.0 - ao;
  }
  return vec4f(ao, 0.0, 0.0, 1.0);
}
