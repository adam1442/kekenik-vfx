// frame.wgsl — helpers that read the generated `F: Frame` uniform (see passes.ts for the Frame layout).
// Included by the pass helper right after the bindings are declared.

// Full-image UV of a fragment position (in.pos.xy). Works for tiled rendering (region_origin != 0).
fn frame_uv(frag: vec2f) -> vec2f {
  return (frag + F.region_origin) / F.full_res;
}

// Pixel coordinate inside the FULL image (not the tile).
fn frame_pixel(frag: vec2f) -> vec2f {
  return frag + F.region_origin;
}

// Looping time as an angle (0..TAU); seamless when the animation repeats.
fn loop_angle() -> f32 {
  return F.loop_phase * 6.28318530717959;
}
