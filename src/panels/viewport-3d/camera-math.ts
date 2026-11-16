import { cameraBasis, defaultCamera, type CameraData } from '../../engine/mesh/camera';
import { v3, type V3 } from '../../engine/mesh/math3';

/**
 * Orbit / pan / zoom / fly camera with smooth damping (pure logic, unit-tested). Z up. Spherical coordinates around `target`:
 *   eye = target + dist * (cos(pitch) sin(yaw), -cos(pitch) cos(yaw), sin(pitch))
 * so yaw = 0 / pitch = 0 is the FRONT view (looking along +Y), positive pitch looks down.
 * `goal` is where the user wants to be, `cur` follows it with frame-rate independent exponential smoothing.
 */
export interface OrbitState {
  target: V3;
  yaw: number;
  pitch: number;
  dist: number;
  orthoSize: number;
}
export const STANDARD_VIEWS = { front: [0, 0], back: [180, 0], right: [90, 0], left: [-90, 0], top: [0, 89.99], bottom: [0, -89.99] } as const;
export type StandardView = keyof typeof STANDARD_VIEWS;
const MAX_PITCH = 89.99;
const wrapDeg = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

export class OrbitCamera {
  goal: OrbitState = { target: [0, 0, 0.5], yaw: 35, pitch: 22, dist: 6, orthoSize: 4 };
  cur: OrbitState = { ...this.goal, target: [...this.goal.target] };
  fovY = 40;
  ortho = false;
  near = 0.02;
  far = 4000;
  /** Seconds for 95% of the way to the goal (0 = no damping). */
  damping = 0.12;

  /** True while `cur` has not reached `goal` (the viewport keeps rendering). */
  get animating(): boolean {
    const a = this.cur, b = this.goal;
    return Math.abs(a.yaw - b.yaw) > 0.01 || Math.abs(a.pitch - b.pitch) > 0.01 || Math.abs(a.dist / b.dist - 1) > 1e-4 || Math.abs(a.orthoSize / b.orthoSize - 1) > 1e-4 || v3.len(v3.sub(a.target, b.target)) > 1e-4 * b.dist;
  }
  /** Advance the smoothing by dt seconds. Returns true when anything changed. */
  update(dt: number): boolean {
    if (!this.animating) return false;
    const k = this.damping <= 0 ? 1 : 1 - Math.exp((-3 * dt) / this.damping);
    const a = this.cur, b = this.goal;
    a.yaw += wrapDeg(b.yaw - a.yaw) * k;
    a.pitch += (b.pitch - a.pitch) * k;
    a.dist *= Math.pow(b.dist / a.dist, k);
    a.orthoSize *= Math.pow(b.orthoSize / a.orthoSize, k);
    a.target = v3.lerp(a.target, b.target, k);
    if (!this.animating) this.cur = { ...b, target: [...b.target] };
    return true;
  }
  snap(): void {
    this.cur = { ...this.goal, target: [...this.goal.target] };
  }

  orbit(dxPx: number, dyPx: number): void {
    this.goal.yaw = wrapDeg(this.goal.yaw - dxPx * 0.35);
    this.goal.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.goal.pitch + dyPx * 0.35));
  }
  /** Pan by a pixel delta: the point under the cursor follows the cursor. */
  pan(dxPx: number, dyPx: number, viewHeightPx: number): void {
    const cam = this.toCamera(1, true);
    const b = cameraBasis(cam);
    const unitsPerPx = this.ortho ? this.goal.orthoSize / viewHeightPx : (2 * this.goal.dist * Math.tan((this.fovY * Math.PI) / 360)) / viewHeightPx;
    this.goal.target = v3.add(this.goal.target, v3.add(v3.scale(b.right, -dxPx * unitsPerPx), v3.scale(b.up, dyPx * unitsPerPx)));
  }
  /** Wheel zoom (factor per notch ~ 0.9). In perspective the distance changes, in ortho the visible height. */
  zoom(notches: number): void {
    const f = Math.pow(0.88, notches);
    this.goal.dist = Math.max(1e-3, Math.min(1e5, this.goal.dist * f));
    this.goal.orthoSize = Math.max(1e-3, Math.min(1e5, this.goal.orthoSize * f));
  }
  /** Fly: move target + eye together along the view basis. f/r/u in -1..1, speed in units per second. */
  fly(f: number, r: number, u: number, dt: number, speed: number): void {
    const b = cameraBasis(this.toCamera(1, true));
    const d = v3.add(v3.scale(b.forward, f), v3.add(v3.scale(b.right, r), v3.scale(b.up, u)));
    this.goal.target = v3.add(this.goal.target, v3.scale(d, speed * dt));
  }
  setView(v: StandardView): void {
    const [yaw, pitch] = STANDARD_VIEWS[v];
    this.goal.yaw = yaw;
    this.goal.pitch = pitch;
  }
  /** Look along direction `d` (unit vector pointing from the target to the camera). */
  setFromDirection(d: V3): void {
    const n = v3.norm(d);
    this.goal.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, (Math.asin(Math.max(-1, Math.min(1, n[2]))) * 180) / Math.PI));
    if (Math.hypot(n[0], n[1]) > 1e-4) this.goal.yaw = (Math.atan2(n[0], -n[1]) * 180) / Math.PI;
  }
  /** Frame a bounding sphere (F). */
  frame(center: V3, radius: number): void {
    const r = Math.max(radius, 1e-3);
    this.goal.target = [...center];
    this.goal.dist = Math.max(0.01, (r * 1.15) / Math.sin((this.fovY * Math.PI) / 360));
    this.goal.orthoSize = r * 2.3;
  }
  /** Copy the pose of a camera node (look-through). */
  adopt(c: CameraData): void {
    const d = v3.sub(c.position, c.target);
    this.goal.target = [...c.target];
    this.goal.dist = Math.max(1e-3, v3.len(d));
    this.setFromDirection(d);
    this.fovY = c.fovY;
    this.ortho = c.ortho;
    this.goal.orthoSize = c.orthoSize;
    this.snap();
  }
  /** Current (smoothed) pose as a CameraData. `goalPose` returns the target pose (used for pan/fly basis). */
  toCamera(aspect: number, goalPose = false): CameraData {
    void aspect;
    const s = goalPose ? this.goal : this.cur;
    const y = (s.yaw * Math.PI) / 180, p = (s.pitch * Math.PI) / 180;
    const pos: V3 = [s.target[0] + s.dist * Math.cos(p) * Math.sin(y), s.target[1] - s.dist * Math.cos(p) * Math.cos(y), s.target[2] + s.dist * Math.sin(p)];
    const base = defaultCamera();
    return { ...base, position: pos, target: [...s.target], up: [0, 0, 1], fovY: this.fovY, ortho: this.ortho, orthoSize: s.orthoSize, near: this.ortho ? -this.far : this.near, far: this.far, roll: 0 };
  }
  /** Near/far that follow the scene size: avoids z-fighting for tiny meshes and clipping for huge ones. */
  fitClip(radius: number): void {
    this.near = Math.max(1e-4, this.goal.dist * 0.002);
    this.far = Math.max(100, (this.goal.dist + radius) * 40);
  }
  serialize(): { yaw: number; pitch: number; dist: number; target: V3; fov: number; ortho: boolean; orthoSize: number } {
    return { yaw: this.goal.yaw, pitch: this.goal.pitch, dist: this.goal.dist, target: [...this.goal.target], fov: this.fovY, ortho: this.ortho, orthoSize: this.goal.orthoSize };
  }
  restore(s: Partial<ReturnType<OrbitCamera['serialize']>> | undefined): void {
    if (!s) return;
    if (typeof s.yaw === 'number') this.goal.yaw = s.yaw;
    if (typeof s.pitch === 'number') this.goal.pitch = s.pitch;
    if (typeof s.dist === 'number' && s.dist > 0) this.goal.dist = s.dist;
    if (Array.isArray(s.target) && s.target.length === 3) this.goal.target = [s.target[0], s.target[1], s.target[2]];
    if (typeof s.fov === 'number') this.fovY = s.fov;
    if (typeof s.ortho === 'boolean') this.ortho = s.ortho;
    if (typeof s.orthoSize === 'number' && s.orthoSize > 0) this.goal.orthoSize = s.orthoSize;
    this.snap();
  }
}

/* ------------------------------------------------------------------------------------------------ view cube / axis gizmo */
export interface AxisDot {
  /** Unit direction from the target to the camera for this face / axis. */
  dir: V3;
  label: string;
  color: string;
  /** Screen position relative to the widget centre (px) and depth (+ = towards the camera). */
  x: number;
  y: number;
  depth: number;
  positive: boolean;
}
const AXIS_DEFS: { dir: V3; label: string; color: string; positive: boolean }[] = [
  { dir: [1, 0, 0], label: 'X', color: '#e5484d', positive: true },
  { dir: [-1, 0, 0], label: '-X', color: '#e5484d', positive: false },
  { dir: [0, 1, 0], label: 'Y', color: '#46a758', positive: true },
  { dir: [0, -1, 0], label: '-Y', color: '#46a758', positive: false },
  { dir: [0, 0, 1], label: 'Z', color: '#3e63dd', positive: true },
  { dir: [0, 0, -1], label: '-Z', color: '#3e63dd', positive: false },
];
/** Projects the six axis ends for the axis gizmo (radius in px). Sorted back to front. */
export function axisDots(cam: CameraData, radius: number): AxisDot[] {
  const b = cameraBasis(cam);
  return AXIS_DEFS.map((a) => ({ ...a, x: v3.dot(a.dir, b.right) * radius, y: -v3.dot(a.dir, b.up) * radius, depth: -v3.dot(a.dir, b.forward) })).sort((p, q) => p.depth - q.depth);
}
/** Which axis dot is under (px, py) (relative to the widget centre)? */
export function pickAxisDot(dots: AxisDot[], px: number, py: number, hit = 10): AxisDot | null {
  let best: AxisDot | null = null;
  for (const d of dots) if (Math.hypot(d.x - px, d.y - py) <= hit && (!best || d.depth > best.depth)) best = d;
  return best;
}
