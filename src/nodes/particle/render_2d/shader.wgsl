// particle.render_2d — instanced sprite quads (raw mode: own vertex + fragment entry points).
// Bindings (generated): F frame, P params, t0 = optional sprite / atlas texture, s0 = particle records (STRIDE floats each):
//   [u, v, sizeU, rot, r, g, b, a, age, id, vu, vv]   u/v in image space (v DOWN), sizeU = sprite width / image width,
//   vu/vv = displacement per loop in uv units.
const STRIDE: u32 = 12u;

struct PVOut {
  @builtin(position) pos: vec4f,
  @location(0) lp: vec2f,
  @location(1) col: vec4f,
  @location(2) age: f32,
  @location(3) pid: f32,
};

fn corner(vi: u32) -> vec2f {
  // two triangles covering [-1,1]^2
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  return c[vi];
}

@vertex
fn vs_particle(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PVOut {
  var o: PVOut;
  let n = max(P.count, 1u);
  let pidx = ii % n;
  let copy = ii / n;                       // tiling copy 0 .. copies-1
  let cxi = copy % P.copies_x;
  let cyi = copy / P.copies_x;
  var ox = 0.0;
  var oy = 0.0;
  if (P.copies_x == 3u) { ox = f32(cxi) - 1.0; }
  if (P.copies_y == 3u) { oy = f32(cyi) - 1.0; }
  let b = pidx * STRIDE;
  let center = vec2f(s0[b], s0[b + 1u]) + vec2f(ox, oy);
  let size_u = s0[b + 2u];
  let rot = s0[b + 3u];
  let col = vec4f(s0[b + 4u], s0[b + 5u], s0[b + 6u], s0[b + 7u]);
  let vel_px = vec2f(s0[b + 10u], s0[b + 11u]) * F.res;      // pixels per loop
  let c = corner(vi);
  let half_px = max(size_u * F.res.x * 0.5, 0.0);
  var off = c * half_px;
  // sprite rotation (pixel space, v down => rotate with a flipped sign)
  let cs = cos(rot);
  let sn = sin(rot);
  off = vec2f(off.x * cs + off.y * sn, -off.x * sn + off.y * cs);
  // motion stretch along the velocity direction (additive length, P.trail = fraction of a loop)
  let speed = length(vel_px);
  if (P.trail > 0.0 && speed > 1e-4) {
    let dir = vel_px / speed;
    let par = dot(off, dir);
    let extra = speed * P.trail;
    off = off + dir * (sign(par) * extra * 0.5 + 0.0) * select(0.0, 1.0, abs(par) > 1e-6);
  }
  let uv = center + off / F.res;
  o.pos = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  o.lp = c;
  o.col = col;
  o.age = s0[b + 8u];
  o.pid = s0[b + 9u];
  return o;
}

fn sprite_fetch(uv_in: vec2f, rect: vec4f) -> vec4f {
  let dims = vec2f(textureDimensions(t0));
  let uv = rect.xy + clamp(uv_in, vec2f(0.0), vec2f(1.0)) * rect.zw;
  let lo = vec2i(floor(rect.xy * dims + vec2f(0.001)));
  let hi = vec2i(ceil((rect.xy + rect.zw) * dims - vec2f(0.001))) - vec2i(1);
  let p = uv * dims - vec2f(0.5);
  let f = floor(p);
  let fr = p - f;
  let i0 = clamp(vec2i(f), lo, hi);
  let i1 = clamp(vec2i(f) + vec2i(1), lo, hi);
  let a = textureLoad(t0, vec2i(i0.x, i0.y), 0);
  let b = textureLoad(t0, vec2i(i1.x, i0.y), 0);
  let c = textureLoad(t0, vec2i(i0.x, i1.y), 0);
  let d = textureLoad(t0, vec2i(i1.x, i1.y), 0);
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}

@fragment
fn fs_main(in: PVOut) -> @location(0) vec4f {
  var rgb = vec3f(1.0);
  var a = 1.0;
  let soft = clamp(P.soft, 0.001, 1.0);
  if (P.shape == 0u) {                       // soft disc
    a = 1.0 - smoothstep(1.0 - soft, 1.0, length(in.lp));
  } else if (P.shape == 1u) {                // rounded square
    a = 1.0 - smoothstep(1.0 - soft, 1.0, max(abs(in.lp.x), abs(in.lp.y)));
  } else if (P.shape == 2u) {                // ring
    a = 1.0 - smoothstep(0.25 * (1.0 - soft), 0.25, abs(length(in.lp) - 0.75));
  } else if (P.shape == 3u) {                // diamond
    a = 1.0 - smoothstep(1.0 - soft, 1.0, abs(in.lp.x) + abs(in.lp.y));
  } else {                                   // sprite / atlas texture
    let frames = max(P.s_frames, 1u);
    var fi = 0u;
    if (P.sprite_mode == 1u) { fi = min(u32(floor(clamp(in.age, 0.0, 0.9999) * f32(frames))), frames - 1u); }
    if (P.sprite_mode == 2u) { fi = min(u32(floor(fract(in.pid * 0.6180339 + 0.37) * f32(frames))), frames - 1u); }
    let cols = max(P.s_cols, 1u);
    let rows = max(P.s_rows, 1u);
    let rect = vec4f(f32(fi % cols) / f32(cols), f32(fi / cols) / f32(rows), 1.0 / f32(cols), 1.0 / f32(rows));
    let suv = vec2f(in.lp.x * 0.5 + 0.5, 0.5 - in.lp.y * 0.5);
    let s = sprite_fetch(suv, rect);
    rgb = s.rgb;
    a = select(s.a, max(s.r, max(s.g, s.b)) * s.a, P.sprite_luma == 1u);
  }
  let alpha = clamp(a * in.col.a * P.opacity, 0.0, 1.0);
  return vec4f(rgb * in.col.rgb * alpha * P.intensity, alpha);
}
