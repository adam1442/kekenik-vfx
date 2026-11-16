// Region min / max / mean per channel in two passes: partial_main (one partial per 8x8 workgroup, no atomics) and
// final_main (one workgroup folds all partials). Both entries share one binding layout.
struct SP {
  rect: vec4u,
  step: u32,
  kind: u32,
  groups_x: u32,
  groups: u32,
};
@group(0) @binding(0) var<uniform> sp: SP;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> partial: array<vec4f>; // 4 per workgroup: min, max, sum, (count,0,0,0)
@group(0) @binding(3) var<storage, read_write> result: array<vec4f>;  // min, max, mean, (count,0,0,0)

var<workgroup> wmin: array<vec4f, 64>;
var<workgroup> wmax: array<vec4f, 64>;
var<workgroup> wsum: array<vec4f, 64>;
var<workgroup> wcnt: array<f32, 64>;

const BIG: f32 = 3.0e38;

@compute @workgroup_size(8, 8)
fn partial_main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  var mn = vec4f(BIG);
  var mx = vec4f(-BIG);
  var sm = vec4f(0.0);
  var cnt = 0.0;
  let px = gid.xy * sp.step;
  if (px.x < sp.rect.z && px.y < sp.rect.w) {
    let c = textureLoad(tex, vec2i(i32(sp.rect.x + px.x), i32(sp.rect.y + px.y)), 0);
    var v = c;
    if (sp.kind == 1u) { v = vec4f(c.r, c.r, c.r, 1.0); }
    if (sp.kind == 2u) { v = vec4f(c.r, c.g, 0.0, 1.0); }
    mn = v;
    mx = v;
    sm = v;
    cnt = 1.0;
  }
  wmin[li] = mn;
  wmax[li] = mx;
  wsum[li] = sm;
  wcnt[li] = cnt;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (li < s) {
      wmin[li] = min(wmin[li], wmin[li + s]);
      wmax[li] = max(wmax[li], wmax[li + s]);
      wsum[li] = wsum[li] + wsum[li + s];
      wcnt[li] = wcnt[li] + wcnt[li + s];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    let g = wid.y * sp.groups_x + wid.x;
    partial[g * 4u] = wmin[0];
    partial[g * 4u + 1u] = wmax[0];
    partial[g * 4u + 2u] = wsum[0];
    partial[g * 4u + 3u] = vec4f(wcnt[0], 0.0, 0.0, 0.0);
  }
}

@compute @workgroup_size(64)
fn final_main(@builtin(local_invocation_index) li: u32) {
  var mn = vec4f(BIG);
  var mx = vec4f(-BIG);
  var sm = vec4f(0.0);
  var cnt = 0.0;
  for (var g = li; g < sp.groups; g = g + 64u) {
    let c = partial[g * 4u + 3u].x;
    if (c > 0.0) {
      mn = min(mn, partial[g * 4u]);
      mx = max(mx, partial[g * 4u + 1u]);
      sm = sm + partial[g * 4u + 2u];
      cnt = cnt + c;
    }
  }
  wmin[li] = mn;
  wmax[li] = mx;
  wsum[li] = sm;
  wcnt[li] = cnt;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (li < s) {
      wmin[li] = min(wmin[li], wmin[li + s]);
      wmax[li] = max(wmax[li], wmax[li + s]);
      wsum[li] = wsum[li] + wsum[li + s];
      wcnt[li] = wcnt[li] + wcnt[li + s];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    result[0] = wmin[0];
    result[1] = wmax[0];
    result[2] = wsum[0] / max(wcnt[0], 1.0);
    result[3] = vec4f(wcnt[0], 0.0, 0.0, 0.0);
  }
}
