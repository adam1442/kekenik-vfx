// ss_main.wgsl — fragment entry used in 'shade' mode. The node shader provides `fn shade(uv: vec2f) -> vec4f`;
// this wrapper adds HQ supersampling (F.ss x F.ss sub-pixel samples, box filter).
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let n = max(F.ss, 1u);
  var acc = vec4f(0.0);
  for (var j = 0u; j < n; j = j + 1u) {
    for (var i = 0u; i < n; i = i + 1u) {
      let o = (vec2f(f32(i), f32(j)) + 0.5) / f32(n) - 0.5;
      acc = acc + shade(frame_uv(in.pos.xy + o));
    }
  }
  return acc / f32(n * n);
}
