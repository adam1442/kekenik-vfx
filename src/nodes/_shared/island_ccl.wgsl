// islands — connected components by UNION-FIND in compute shaders (replaces min-label propagation: that needs O(side) rounds
// on serpentine / spiral islands, this converges in a handful of rounds; see tests/islands.test.ts).
//   parent[i] (atomic u32) = 0x3f800000 + index of a pixel of the same island with a smaller-or-equal index (a root points to itself);
//                            0x7f000000 on background. The 0x3f800000 bias makes every stored value a NORMAL f32 bit pattern so
//                            a fragment shader can read the buffer as f32 and bitcast back without NaN / denormal hazards.
//   init      parent = self (mask pixels) / background marker
//   hook      per mask pixel and neighbour: ra = root(pixel), rb = root(neighbour); if different, atomicMin(parent[max], min)
//   compress  parent[i] = root(i) (full path compression; hook and compress are separate dispatches, so they never race)
// Roots only ever decrease, so every observed state is a valid forest; after convergence the root of an island is its first
// pixel in raster order. Chains are followed for at most 64 steps (an unfinished chain is still a valid link).
// Neighbour wrap on tiling axes; never across a non-tiling border. CPU mirror: cclModel() in _shared/islands.ts.
struct CU {
  w: u32,
  h: u32,
  conn: u32,
  tile_x: u32,
  tile_y: u32,
  invert: u32,
  threshold: f32,
  pad: u32,
};
@group(0) @binding(0) var<uniform> U: CU;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> parent: array<atomic<u32>>;

const KBASE: u32 = 0x3f800000u;
const BG: u32 = 0x7f000000u;

fn find_root(i: u32) -> u32 {
  var x = i;
  for (var s = 0u; s < 64u; s = s + 1u) {
    let p = atomicLoad(&parent[x]) - KBASE;
    if (p == x) {
      break;
    }
    x = p;
  }
  return x;
}

@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= U.w || gid.y >= U.h) {
    return;
  }
  let i = gid.y * U.w + gid.x;
  // the mask may have another size than the node (Texture tab): nearest sample
  let sp = vec2i((vec2f(gid.xy) + vec2f(0.5)) / vec2f(f32(U.w), f32(U.h)) * vec2f(textureDimensions(src)));
  var on = textureLoad(src, sp, 0).r >= U.threshold;
  if (U.invert == 1u) {
    on = !on;
  }
  atomicStore(&parent[i], select(BG, KBASE + i, on));
}

@compute @workgroup_size(8, 8)
fn hook(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= U.w || gid.y >= U.h) {
    return;
  }
  let i = gid.y * U.w + gid.x;
  if (atomicLoad(&parent[i]) == BG) {
    return;
  }
  let p = vec2i(gid.xy);
  var ra = find_root(i);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var k = -1; k <= 1; k = k + 1) {
      if ((j == 0 && k == 0) || (U.conn == 0u && j != 0 && k != 0)) {
        continue;
      }
      var q = p + vec2i(k, j);
      if (q.x < 0 || q.x >= i32(U.w)) {
        if (U.tile_x == 0u) {
          continue;
        }
        q.x = (q.x + i32(U.w)) % i32(U.w);
      }
      if (q.y < 0 || q.y >= i32(U.h)) {
        if (U.tile_y == 0u) {
          continue;
        }
        q.y = (q.y + i32(U.h)) % i32(U.h);
      }
      let ni = u32(q.y) * U.w + u32(q.x);
      if (atomicLoad(&parent[ni]) == BG) {
        continue;
      }
      let rb = find_root(ni);
      if (ra != rb) {
        let hi = max(ra, rb);
        let lo = min(ra, rb);
        atomicMin(&parent[hi], KBASE + lo);
        if (hi == ra) {
          ra = lo;
        }
      }
    }
  }
}

@compute @workgroup_size(8, 8)
fn compress(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= U.w || gid.y >= U.h) {
    return;
  }
  let i = gid.y * U.w + gid.x;
  if (atomicLoad(&parent[i]) == BG) {
    return;
  }
  atomicStore(&parent[i], KBASE + find_root(i));
}
