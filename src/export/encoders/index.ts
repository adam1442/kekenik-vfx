import { ddsFormat } from './dds';
import { exrFormat } from './exr';
import { hdrFormat } from './hdr';
import { pngFormat } from './png';
import { tgaFormat } from './tga';
import type { ImageFormat, ImageFormatId } from './types';

export const IMAGE_FORMATS: Record<ImageFormatId, ImageFormat> = { png: pngFormat, tga: tgaFormat, exr: exrFormat, hdr: hdrFormat, dds: ddsFormat };
export const imageFormat = (id: string): ImageFormat => {
  const f = IMAGE_FORMATS[id as ImageFormatId];
  if (!f) throw new Error(`Unknown image format "${id}"`);
  return f;
};
export type { ImageFormat, ImageFormatId, ImageSpec, RowEncoder, SampleDepth, ColorSpaceFlag, EncoderOptions } from './types';
