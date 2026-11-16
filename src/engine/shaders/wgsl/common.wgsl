// common.wgsl — structs, constants and the fullscreen-triangle vertex shader. No bindings here.
// Image convention: uv (0,0) = top-left texel corner, y grows DOWN (same as textureLoad coordinates).

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let c = corners[vi];
  var o: VsOut;
  o.pos = vec4f(c, 0.0, 1.0);
  o.uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  return o;
}
