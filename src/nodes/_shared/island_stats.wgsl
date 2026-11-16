// islands.generate — per-island statistics by atomics in an open-addressing hash table keyed by the island's root pixel.
// Entry points over TWO storage buffers: `acc` (atomic u32, STRIDE 12 per slot) and `dec` (f32, decoded for fragment shaders):
//   init        zero / neutral values, dec key = -1 (empty)
//   accumulate  one thread per pixel: find / insert the slot of its island (<= 64 probes), atomicMin / Max the bounding box
//               of the pixel offset RELATIVE TO THE ROOT (wrapped to [-N/2, N/2) on tiling axes, bias 32768), atomicAdd count
//               and the offset sums split in two 8-bit limbs (no overflow below 16.7 M pixels per island)
//   finalize    decode into `dec`:  [0] key lo 24 bits  [1] key hi  [2..3] min offset x, y  [4..5] max offset x, y
//               [6] pixel count  [7..8] centre of mass offset x, y (relative to the root pixel)  [9..11] unused
// Slot of island root index r: pcg(r + 1) & cap_mask, linear probing. Islands that do not fit (table full) are skipped here
// and rendered with a single-pixel fallback by the map shader.
#include "hash"

struct IU {
  w: u32,
  h: u32,
  cap_mask: u32,
  tile_x: u32,
  tile_y: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
};
@group(0) @binding(0) var<uniform> U: IU;
@group(0) @binding(1) var labels: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> acc: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> dec: array<f32>;

const STRIDE: u32 = 12u;
const BIAS: i32 = 32768;

fn unpack(c: vec4f) -> vec2i {
  return vec2i(i32(round(c.x)) * 1024 + i32(round(c.y)), i32(round(c.z)) * 1024 + i32(round(c.w)));
}

@compute @workgroup_size(64)
fn init(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s > U.cap_mask) {
    return;
  }
  let b = s * STRIDE;
  atomicStore(&acc[b], 0u);
  atomicStore(&acc[b + 1u], 0xffffffffu);
  atomicStore(&acc[b + 2u], 0xffffffffu);
  for (var i = 3u; i < STRIDE; i = i + 1u) {
    atomicStore(&acc[b + i], 0u);
  }
  dec[b] = -1.0;
  for (var i = 1u; i < STRIDE; i = i + 1u) {
    dec[b + i] = 0.0;
  }
}

@compute @workgroup_size(8, 8)
fn accumulate(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= U.w || gid.y >= U.h) {
    return;
  }
  let p = vec2i(gid.xy);
  let c = textureLoad(labels, p, 0);
  if (c.x < 0.0) {
    return;
  }
  let root = unpack(c);
  let key = u32(root.y) * U.w + u32(root.x) + 1u;
  var slot = pcg(key) & U.cap_mask;
  var found = false;
  for (var i = 0u; i < 64u; i = i + 1u) {
    let r = atomicCompareExchangeWeak(&acc[slot * STRIDE], 0u, key);
    if (r.exchanged || r.old_value == key) {
      found = true;
      break;
    }
    if (r.old_value == 0u) {
      continue; // spurious failure of the weak exchange: retry the same slot
    }
    slot = (slot + 1u) & U.cap_mask;
  }
  if (!found) {
    return;
  }
  var d = p - root;
  if (U.tile_x == 1u) {
    if (d.x * 2 > i32(U.w)) {
      d.x = d.x - i32(U.w);
    } else if (d.x * 2 < -i32(U.w)) {
      d.x = d.x + i32(U.w);
    }
  }
  if (U.tile_y == 1u) {
    if (d.y * 2 > i32(U.h)) {
      d.y = d.y - i32(U.h);
    } else if (d.y * 2 < -i32(U.h)) {
      d.y = d.y + i32(U.h);
    }
  }
  let ox = u32(d.x + BIAS);
  let oy = u32(d.y + BIAS);
  let b = slot * STRIDE;
  atomicMin(&acc[b + 1u], ox);
  atomicMin(&acc[b + 2u], oy);
  atomicMax(&acc[b + 3u], ox);
  atomicMax(&acc[b + 4u], oy);
  atomicAdd(&acc[b + 5u], 1u);
  atomicAdd(&acc[b + 6u], ox & 255u);
  atomicAdd(&acc[b + 7u], ox >> 8u);
  atomicAdd(&acc[b + 8u], oy & 255u);
  atomicAdd(&acc[b + 9u], oy >> 8u);
}

@compute @workgroup_size(64)
fn finalize(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s > U.cap_mask) {
    return;
  }
  let b = s * STRIDE;
  let key = atomicLoad(&acc[b]);
  if (key == 0u) {
    dec[b] = -1.0;
    return;
  }
  let ridx = key - 1u;
  let cnt = f32(max(atomicLoad(&acc[b + 5u]), 1u));
  dec[b] = f32(ridx & 0xffffffu);
  dec[b + 1u] = f32(ridx >> 24u);
  dec[b + 2u] = f32(atomicLoad(&acc[b + 1u])) - f32(BIAS);
  dec[b + 3u] = f32(atomicLoad(&acc[b + 2u])) - f32(BIAS);
  dec[b + 4u] = f32(atomicLoad(&acc[b + 3u])) - f32(BIAS);
  dec[b + 5u] = f32(atomicLoad(&acc[b + 4u])) - f32(BIAS);
  dec[b + 6u] = cnt;
  dec[b + 7u] = (f32(atomicLoad(&acc[b + 7u])) * 256.0 + f32(atomicLoad(&acc[b + 6u]))) / cnt - f32(BIAS);
  dec[b + 8u] = (f32(atomicLoad(&acc[b + 9u])) * 256.0 + f32(atomicLoad(&acc[b + 8u]))) / cnt - f32(BIAS);
}
