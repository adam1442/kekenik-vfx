// range-aware histogram for the Levels / Curve widgets. 5 channels x 256 bins (R, G, B, A, Luma), strided sampling,
// workgroup-local atomics flushed once per workgroup. Values outside [lo, hi] clamp into the edge bins and are counted as overflow;
// the per-channel maximum (non-negative floats: IEEE bit patterns order like integers) feeds the HDR auto range.
// Result layout (u32): [0..1279] bins, [1280..1284] overflow high, [1285..1289] overflow low, [1290..1294] max (f32 bits).
struct HP {
  size: vec2u,   // texture size in texels
  step: u32,     // sample stride
  kind: u32,     // 0 color (rgba), 1 gray (r)
  lo: f32,
  hi: f32,
};
@group(0) @binding(0) var<uniform> hp: HP;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> res: array<atomic<u32>>;
var<workgroup> lbins: array<atomic<u32>, 1295>;

fn bin_of(v: f32) -> u32 {
  return u32(clamp(floor((v - hp.lo) / (hp.hi - hp.lo) * 256.0), 0.0, 255.0));
}

fn put(c: u32, v: f32) {
  // NaN / Inf are skipped (v != v is true only for NaN; the magnitude test removes +-Inf).
  if (v != v || abs(v) > 3.0e38) {
    return;
  }
  atomicAdd(&lbins[c * 256u + bin_of(v)], 1u);
  if (v > hp.hi) {
    atomicAdd(&lbins[1280u + c], 1u);
  }
  if (v < hp.lo) {
    atomicAdd(&lbins[1285u + c], 1u);
  }
  if (v > 0.0) {
    atomicMax(&lbins[1290u + c], bitcast<u32>(v));
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  for (var i = li; i < 1295u; i = i + 64u) {
    atomicStore(&lbins[i], 0u);
  }
  workgroupBarrier();
  let px = gid.xy * hp.step;
  if (px.x < hp.size.x && px.y < hp.size.y) {
    let c = textureLoad(tex, vec2i(px), 0);
    var v = c;
    if (hp.kind == 1u) {
      v = vec4f(c.r, c.r, c.r, 1.0);
    }
    put(0u, v.r);
    put(1u, v.g);
    put(2u, v.b);
    put(3u, v.a);
    put(4u, dot(v.rgb, vec3f(0.2126, 0.7152, 0.0722)));
  }
  workgroupBarrier();
  for (var i = li; i < 1295u; i = i + 64u) {
    let n = atomicLoad(&lbins[i]);
    if (n > 0u) {
      if (i >= 1290u) {
        atomicMax(&res[i], n);
      } else {
        atomicAdd(&res[i], n);
      }
    }
  }
}
