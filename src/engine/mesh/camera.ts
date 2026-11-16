import { dataValue, type DataValue, type PinValue } from '../resources/values';
import { v3, type V3 } from './math3';

/**
 * Camera value flowing on `camera` pins (CAMERA / LOOK AT nodes). World is Z-up, right handed.
 * The 3D viewport can adopt it ("Camera: <node>") and viewport export / turntables (6B) consume it.
 */
export interface CameraData {
  position: V3;
  target: V3;
  /** Up hint (not necessarily orthogonal to the view direction). */
  up: V3;
  /** Vertical field of view in degrees (perspective). */
  fovY: number;
  ortho: boolean;
  /** Visible world height for orthographic cameras. */
  orthoSize: number;
  near: number;
  far: number;
  /** Roll around the view axis, degrees. */
  roll: number;
}

export const defaultCamera = (): CameraData => ({ position: [4, -6, 3.2], target: [0, 0, 0.6], up: [0, 0, 1], fovY: 40, ortho: false, orthoSize: 4, near: 0.05, far: 500, roll: 0 });

export function cameraValue(c: CameraData): DataValue {
  return dataValue('camera', Object.freeze({ ...c }));
}
export function asCamera(v: PinValue | undefined): CameraData | undefined {
  if (!v || v.kind !== 'data' || v.pin !== 'camera') return undefined;
  const d = v.data as Partial<CameraData> | null;
  return d && Array.isArray(d.position) && Array.isArray(d.target) ? (d as CameraData) : undefined;
}
/** Orthonormal camera basis (right, up, forward) from position/target/up/roll. */
export function cameraBasis(c: CameraData): { right: V3; up: V3; forward: V3 } {
  const forward = v3.norm(v3.sub(c.target, c.position));
  let right = v3.cross(forward, c.up);
  if (v3.len(right) < 1e-6) right = v3.cross(forward, [0, 1, 0]);
  right = v3.norm(right);
  let up = v3.norm(v3.cross(right, forward));
  if (c.roll) {
    const a = (c.roll * Math.PI) / 180;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const r2 = v3.add(v3.scale(right, cs), v3.scale(up, sn));
    up = v3.add(v3.scale(up, cs), v3.scale(right, -sn));
    right = r2;
  }
  return { right, up, forward };
}
