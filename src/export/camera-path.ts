import type { CameraData } from '../engine/mesh/camera';
import { defaultCamera } from '../engine/mesh/camera';

/** Camera paths for viewport export. Pure; Z up, right handed (CONTRACTS §13). */
const RAD = Math.PI / 180;

/** Default camera framing a bounding sphere (3/4 view from the usual front-right-above direction). */
export function frameSphere(center: [number, number, number], radius: number, fovY = 40): CameraData {
  const dir = [0.5, -0.78, 0.38];
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const dist = (Math.max(radius, 1e-3) / Math.sin((fovY * RAD) / 2)) * 1.15;
  return { ...defaultCamera(), fovY, position: [center[0] + (dir[0] / l) * dist, center[1] + (dir[1] / l) * dist, center[2] + (dir[2] / l) * dist], target: center, near: Math.max(0.01, dist * 0.01), far: dist * 20 + radius * 4 };
}

/** Orbit the camera around its target about the world Z axis (azimuth) and tilt it (elevation delta), keeping the distance. */
export function orbitCamera(base: CameraData, azimuthDeg: number, elevationDeltaDeg = 0): CameraData {
  const rx = base.position[0] - base.target[0];
  const ry = base.position[1] - base.target[1];
  const rz = base.position[2] - base.target[2];
  const r = Math.hypot(rx, ry, rz) || 1;
  const az = Math.atan2(ry, rx) + azimuthDeg * RAD;
  const el = Math.max(-89 * RAD, Math.min(89 * RAD, Math.asin(Math.max(-1, Math.min(1, rz / r))) + elevationDeltaDeg * RAD));
  return { ...base, position: [base.target[0] + r * Math.cos(el) * Math.cos(az), base.target[1] + r * Math.cos(el) * Math.sin(az), base.target[2] + r * Math.sin(el)] };
}

/** Azimuth of every turntable frame: `count` frames over `degrees` WITHOUT repeating the end (frame 0 == frame count at 360). */
export const turntableAngles = (count: number, degrees: number): number[] => Array.from({ length: count }, (_, i) => (degrees * i) / Math.max(1, count));
