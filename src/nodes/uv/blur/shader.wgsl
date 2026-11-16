// uv.blur helper — convert a UV field between storage modes: read with P.from_mode, write with P.to_mode.
// Pass 1 converts the input to OFFSET (delta) form, the blur runs on deltas (blurring absolute coordinates would smear the
// identity ramp at non-tiling borders), pass 2 stores the blurred deltas in the requested output mode.
#include "uvfield"

fn shade(uv: vec2f) -> vec4f {
  let d = uvf_sample(t0, uv, F.tile, 0u, P.from_mode);
  return uvf_pack(d, uv, P.to_mode);
}
