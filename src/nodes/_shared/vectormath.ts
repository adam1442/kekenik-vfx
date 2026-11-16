/** CPU mirrors of the Vector utility shaders. Vectors are tile fractions / second, +x right, +y DOWN. */
export const vecMagnitude = (x: number, y: number): number => Math.hypot(x, y);
/** Angle in turns, 0..1 (0 = +x, increasing clockwise on screen). */
export const vecAngle01 = (x: number, y: number, offsetTurns = 0): number => {
  let a = Math.atan2(y, x) / (2 * Math.PI) + offsetTurns;
  a -= Math.floor(a);
  return a;
};
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}
/** Colour wheel: angle = hue, magnitude / scale = value. */
export const wheelColor = (x: number, y: number, scale: number): [number, number, number] => {
  const m = Math.hypot(x, y);
  return hsvToRgb(vecAngle01(x, y), m > 1e-9 ? 1 : 0, Math.min(1, m / Math.max(scale, 1e-6)));
};
/** Vector -> UV lookup delta (content moves along the vector): delta = -v * amount. */
export const vectorToUvDelta = (x: number, y: number, amount: number): [number, number] => [-x * amount, -y * amount];
export const uvDeltaToVector = (dx: number, dy: number, amount: number): [number, number] => [-dx / amount, -dy / amount];
/** Central-difference divergence / curl of a field sampled with spacing 1/n, 1/m (per second). */
export const divergenceCentral = (vxR: number, vxL: number, vyU: number, vyD: number, n: number, m: number): number => (vxR - vxL) * 0.5 * n + (vyU - vyD) * 0.5 * m;
export const curlCentral = (vyR: number, vyL: number, vxU: number, vxD: number, n: number, m: number): number => (vyR - vyL) * 0.5 * n - (vxU - vxD) * 0.5 * m;
