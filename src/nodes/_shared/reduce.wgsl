// _shared/reduce.wgsl — asynchronous GPU reduction (no CPU readback). Three entry points over ONE storage buffer:
//   init      writes neutral values,
//   main      16x16 workgroups reduce their tile in WORKGROUP SHARED MEMORY (tree), thread 0 merges with atomics,
//   finalize  decodes the atomics in place into plain f32 values that fragment passes read as `array<f32>`.
// Result layout (f32 after finalize):
//   [0] xmin  [1] ymin  [2] xmax+1  [3] ymax+1   pixel-edge bounds of "content" pixels (whole image when none)
//   [4] vmin  [5] vmax                            min / max of the measured value over ALL pixels
//   [6] content pixel count   [7] 1 when content exists, else 0
// `source`: 0 red/gray, 1 luminance, 2 alpha, 3 any channel (max rgba), 4 rgb range (lo = min rgb, hi = max rgb).
// Content = hi value > threshold (when use_threshold = 1) else every pixel.
struct RU {
  threshold: f32,
  source: u32,
  use_threshold: u32,
  pad: u32,
};
@group(0) @binding(0) var<uniform> U: RU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> acc: array<atomic<u32>>;

var<workgroup> w_xmin: array<u32, 256>;
var<workgroup> w_ymin: array<u32, 256>;
var<workgroup> w_xmax: array<u32, 256>;
var<workgroup> w_ymax: array<u32, 256>;
var<workgroup> w_vmin: array<u32, 256>;
var<workgroup> w_vmax: array<u32, 256>;
var<workgroup> w_cnt: array<u32, 256>;

// Order-preserving float <-> uint mapping (so atomicMin / atomicMax work for any sign).
fn f2o(f: f32) -> u32 {
  let b = bitcast<u32>(f);
  return select(b | 0x80000000u, ~b, (b & 0x80000000u) != 0u);
}
fn o2f(o: u32) -> f32 {
  return bitcast<f32>(select(~o, o & 0x7fffffffu, (o & 0x80000000u) != 0u));
}

fn measure(c: vec4f) -> vec2f {
  switch (U.source) {
    case 1u: {
      let l = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
      return vec2f(l, l);
    }
    case 2u: { return vec2f(c.a, c.a); }
    case 3u: {
      let m = max(max(c.r, c.g), max(c.b, c.a));
      return vec2f(m, m);
    }
    case 4u: { return vec2f(min(c.r, min(c.g, c.b)), max(c.r, max(c.g, c.b))); }
    default: { return vec2f(c.r, c.r); }
  }
}

@compute @workgroup_size(1)
fn init() {
  atomicStore(&acc[0], 0xffffffffu);
  atomicStore(&acc[1], 0xffffffffu);
  atomicStore(&acc[2], 0u);
  atomicStore(&acc[3], 0u);
  atomicStore(&acc[4], 0xffffffffu);
  atomicStore(&acc[5], 0u);
  atomicStore(&acc[6], 0u);
  atomicStore(&acc[7], 0u);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  let dim = textureDimensions(src);
  var xmin = 0xffffffffu;
  var ymin = 0xffffffffu;
  var xmax = 0u;
  var ymax = 0u;
  var vmin = 0xffffffffu;
  var vmax = 0u;
  var cnt = 0u;
  if (gid.x < dim.x && gid.y < dim.y) {
    let m = measure(textureLoad(src, vec2i(gid.xy), 0));
    vmin = f2o(m.x);
    vmax = f2o(m.y);
    if (U.use_threshold == 0u || m.y > U.threshold) {
      xmin = gid.x;
      xmax = gid.x;
      ymin = gid.y;
      ymax = gid.y;
      cnt = 1u;
    }
  }
  w_xmin[li] = xmin;
  w_ymin[li] = ymin;
  w_xmax[li] = xmax;
  w_ymax[li] = ymax;
  w_vmin[li] = vmin;
  w_vmax[li] = vmax;
  w_cnt[li] = cnt;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s = s >> 1u) {
    if (li < s) {
      w_xmin[li] = min(w_xmin[li], w_xmin[li + s]);
      w_ymin[li] = min(w_ymin[li], w_ymin[li + s]);
      w_xmax[li] = max(w_xmax[li], w_xmax[li + s]);
      w_ymax[li] = max(w_ymax[li], w_ymax[li + s]);
      w_vmin[li] = min(w_vmin[li], w_vmin[li + s]);
      w_vmax[li] = max(w_vmax[li], w_vmax[li + s]);
      w_cnt[li] = w_cnt[li] + w_cnt[li + s];
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    atomicMin(&acc[0], w_xmin[0]);
    atomicMin(&acc[1], w_ymin[0]);
    atomicMax(&acc[2], w_xmax[0]);
    atomicMax(&acc[3], w_ymax[0]);
    atomicMin(&acc[4], w_vmin[0]);
    atomicMax(&acc[5], w_vmax[0]);
    atomicAdd(&acc[6], w_cnt[0]);
  }
}

@compute @workgroup_size(1)
fn finalize() {
  let dim = textureDimensions(src);
  let cnt = atomicLoad(&acc[6]);
  var x0 = 0.0;
  var y0 = 0.0;
  var x1 = f32(dim.x);
  var y1 = f32(dim.y);
  var valid = 0.0;
  if (cnt > 0u) {
    x0 = f32(atomicLoad(&acc[0]));
    y0 = f32(atomicLoad(&acc[1]));
    x1 = f32(atomicLoad(&acc[2]) + 1u);
    y1 = f32(atomicLoad(&acc[3]) + 1u);
    valid = 1.0;
  }
  let v0 = o2f(atomicLoad(&acc[4]));
  let v1 = o2f(atomicLoad(&acc[5]));
  atomicStore(&acc[0], bitcast<u32>(x0));
  atomicStore(&acc[1], bitcast<u32>(y0));
  atomicStore(&acc[2], bitcast<u32>(x1));
  atomicStore(&acc[3], bitcast<u32>(y1));
  atomicStore(&acc[4], bitcast<u32>(v0));
  atomicStore(&acc[5], bitcast<u32>(v1));
  atomicStore(&acc[6], bitcast<u32>(f32(cnt)));
  atomicStore(&acc[7], bitcast<u32>(valid));
}
