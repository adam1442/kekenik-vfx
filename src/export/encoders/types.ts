import type { ByteSink } from '../bytes';

/**
 * Image encoder contract.
 *
 * Encoders are STREAMING: they receive rows of Float32 samples (interleaved channels, top row first, values already in
 * the final transfer domain: display-referred 0..1 for 8/16-bit integer outputs, linear scene values for half / float) and
 * write to a `ByteSink` as they go, so peak memory is one strip + the compressor window, never the whole image.
 */
export type SampleDepth = 8 | 16 | 'half' | 'float';
export type ColorSpaceFlag = 'srgb' | 'linear';

export interface ImageSpec {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  depth: SampleDepth;
  /** Metadata only (PNG sRGB / gAMA chunks, DDS sRGB format): the samples are already encoded by the caller. */
  colorSpace: ColorSpaceFlag;
  software?: string;
  /** Free-form comment (PNG tEXt / EXR comments). */
  comment?: string;
}

export interface EncoderOptions {
  /** PNG row filter strategy. */
  pngFilter?: 'none' | 'sub' | 'up' | 'adaptive';
  /** EXR compression. */
  exrCompression?: 'zip' | 'none';
  /** EXR channel names (default derived from channel count). */
  exrChannels?: string[];
  /** Cap for encoders that must buffer (EXR into a non-seekable sink). */
  maxBufferBytes?: number;
}

export interface RowEncoder {
  /** `rows` holds `count` rows of `width * channels` floats. Must be called top to bottom, exactly `height` rows in total. */
  writeRows(rows: Float32Array, count: number): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}

export type ImageFormatId = 'png' | 'tga' | 'exr' | 'hdr' | 'dds';

export interface ImageFormat {
  id: ImageFormatId;
  label: string;
  ext: string;
  mime: string;
  depths: SampleDepth[];
  /** Linear-only formats (EXR / HDR): the color space flag is ignored and the exporter says so. */
  linearOnly: boolean;
  /** Maximum number of channels the container stores natively. */
  maxChannels: 1 | 2 | 3 | 4;
  create(spec: ImageSpec, sink: ByteSink, opts?: EncoderOptions): Promise<RowEncoder>;
}

/* ------------------------------------------------------------------------------------------------ quantisation */

/** Round-to-nearest 8-bit quantisation of a 0..1 value (NaN -> 0). */
export const q8 = (v: number): number => (v > 0 ? (v >= 1 ? 255 : Math.round(v * 255)) : 0);
/** Round-to-nearest 16-bit quantisation of a 0..1 value (NaN -> 0). */
export const q16 = (v: number): number => (v > 0 ? (v >= 1 ? 65535 : Math.round(v * 65535)) : 0);

export function assertSpec(spec: ImageSpec, fmt: { depths: SampleDepth[]; maxChannels: number; id: string }): void {
  if (!(spec.width >= 1 && spec.height >= 1) || !Number.isInteger(spec.width) || !Number.isInteger(spec.height)) throw new Error(`${fmt.id}: invalid size ${spec.width}x${spec.height}`);
  if (!fmt.depths.includes(spec.depth)) throw new Error(`${fmt.id}: bit depth "${spec.depth}" is not supported (supported: ${fmt.depths.join(', ')})`);
  if (spec.channels > fmt.maxChannels) throw new Error(`${fmt.id}: ${spec.channels} channels are not supported (max ${fmt.maxChannels})`);
}

/** Tracks how many rows were written; shared by the encoders. */
export class RowCounter {
  written = 0;
  constructor(readonly height: number, readonly name: string) {}
  add(n: number): void {
    this.written += n;
    if (this.written > this.height) throw new Error(`${this.name}: more rows written than the image height (${this.height})`);
  }
  assertComplete(): void {
    if (this.written !== this.height) throw new Error(`${this.name}: finished after ${this.written} of ${this.height} rows`);
  }
}
