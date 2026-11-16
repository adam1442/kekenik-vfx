// Per-channel histogram (R,G,B,A,L x 256 bins) of a region, workgroup-local bins flushed with atomics.
struct HP {
  rect: vec4u,   // x, y, w, h of the analysed region in texels
  step: u32,     // sample stride (keeps huge regions bounded)
  kind: u32,     // 0 color, 1 gray, 2 uv, 3 normal
};
@group(0) @binding(0) var<uniform> hp: HP;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> bins: array<atomic<u32>>;
var<workgroup> local_bins: array<atomic<u32>, 1280>;

fn bin_of(v: f32) -> u32 {
  return u32(clamp(v, 0.0, 1.0) * 255.0 + 0.5);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  for (var i = li; i < 1280u; i = i + 64u) {
    atomicStore(&local_bins[i], 0u);
  }
  workgroupBarrier();
  let px = gid.xy * hp.step;
  if (px.x < hp.rect.z && px.y < hp.rect.w) {
    let c = textureLoad(tex, vec2i(i32(hp.rect.x + px.x), i32(hp.rect.y + px.y)), 0);
    var v = c;
    if (hp.kind == 1u) { v = vec4f(c.r, c.r, c.r, 1.0); }
    if (hp.kind == 2u) { v = vec4f(c.r, c.g, 0.0, 1.0); }
    let luma = dot(v.rgb, vec3f(0.2126, 0.7152, 0.0722));
    atomicAdd(&local_bins[bin_of(v.r)], 1u);
    atomicAdd(&local_bins[256u + bin_of(v.g)], 1u);
    atomicAdd(&local_bins[512u + bin_of(v.b)], 1u);
    atomicAdd(&local_bins[768u + bin_of(v.a)], 1u);
    atomicAdd(&local_bins[1024u + bin_of(luma)], 1u);
  }
  workgroupBarrier();
  for (var i = li; i < 1280u; i = i + 64u) {
    let n = atomicLoad(&local_bins[i]);
    if (n > 0u) {
      atomicAdd(&bins[i], n);
    }
  }
}
