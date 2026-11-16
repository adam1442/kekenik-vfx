import type { TexturePin } from '../types';

const BPP: Record<string, number> = {
  r8unorm: 1,
  r8snorm: 1,
  r8uint: 1,
  rg8unorm: 2,
  r16float: 2,
  r16uint: 2,
  rg16float: 4,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  r32float: 4,
  r32uint: 4,
  rg32float: 8,
  rgba16float: 8,
  rgba16uint: 8,
  rgba32float: 16,
  rgba32uint: 16,
};

export const bytesPerPixel = (format: string): number => {
  const b = BPP[format];
  if (b === undefined) throw new Error(`bytesPerPixel: unknown format ${format}`);
  return b;
};

export const channelCount = (format: string): number =>
  format.startsWith('rgba') || format.startsWith('bgra') ? 4 : format.startsWith('rg') ? 2 : 1;

export const textureBytes = (w: number, h: number, format: string): number => w * h * bytesPerPixel(format);

/**
 * Intermediate formats. Gray r16float, UV rg16float, Color/Normal rgba16float.
 * HQ mode switches everything to 32-bit float. 8-bit exists only at export.
 */
export function formatForPin(pin: TexturePin, hq: boolean): GPUTextureFormat {
  switch (pin) {
    case 'gray':
      return hq ? 'r32float' : 'r16float';
    case 'uv':
    case 'vector':
      return hq ? 'rg32float' : 'rg16float';
    default:
      return hq ? 'rgba32float' : 'rgba16float';
  }
}

export const isFloat32Format = (f: string): boolean => f.endsWith('32float');
export const isFloat16Format = (f: string): boolean => f.endsWith('16float');
