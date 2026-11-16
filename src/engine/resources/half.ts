/** IEEE-754 binary16 <-> binary32 helpers (readback decode, test uploads). Pure, unit-tested. */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const m = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (m / 1024);
  if (e === 0x1f) return m ? NaN : s ? -Infinity : Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + m / 1024);
}

export function floatToHalf(val: number): number {
  f32[0] = val;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / nan
  if (exp >= 0x1f) return sign | 0x7c00; // overflow -> inf
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow -> 0
    mant = (mant | 0x800000) >> (1 - exp);
    if (mant & 0x1000) mant += 0x2000; // round to nearest
    return sign | (mant >> 13);
  }
  if (mant & 0x1000) {
    mant += 0x2000; // round to nearest (ties up; good enough for tests/uploads)
    if (mant & 0x800000) {
      mant = 0;
      exp++;
      if (exp >= 0x1f) return sign | 0x7c00;
    }
  }
  return sign | (exp << 10) | (mant >> 13);
}

export function decodeHalfArray(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = halfToFloat(src[i]);
  return out;
}
