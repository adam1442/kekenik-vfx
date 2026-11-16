import type { ParamDef } from '../../engine/params/schema';
import { P } from '../../engine/params/schema';
import type { EvalContext } from '../../engine/graph/node';
import type { GpuTexture } from '../../engine/resources/memory';

/**
 * UV pin convention helpers. See docs/CONTRACTS.md "UV pin convention".
 *  - stored UV values are ABSOLUTE lookup coordinates (identity = own uv) or OFFSETS (delta = lookup - own uv),
 *    chosen per node with the `uv_out` / `uv_in*` enum params below; units are tile space, v points DOWN.
 *  - the shader side lives in `engine/shaders/wgsl/uvfield.wgsl` (`uvf_pack`, `uvf_delta`, `uvf_sample`).
 */
export type UvMode = 'absolute' | 'offset';
export const UV_MODE_OPTIONS = [
  { value: 'absolute', label: 'Absolute (lookup)', tooltip: 'The pixel holds the coordinate to read from. Identity = own UV. Graph default.' },
  { value: 'offset', label: 'Offset (warp)', tooltip: 'The pixel holds (lookup - own UV). Neutral = 0. Use for export / engine flowmaps.' },
];
/** Index (0 absolute, 1 offset) for a mode param. */
export const uvModeIndex = (v: string): number => (v === 'offset' ? 1 : 0);

/** Output mode param (every UV producer). */
export const uvOutParam = (): ParamDef =>
  P.enum('uv_out', 'absolute', UV_MODE_OPTIONS, { group: 'Output', label: 'UV output', tooltip: 'How the field is stored: absolute lookup coordinates (default, what Transform / Directional Blur / Noise UV expect) or offsets from the pixel position.' });
/** Input mode param for a UV input pin (every UV consumer). */
export const uvInParam = (id = 'uv_in', label = 'UV input'): ParamDef =>
  P.enum(id, 'absolute', UV_MODE_OPTIONS, { group: 'Input', label, tooltip: 'How the connected UV field is stored.' });

/** Bound texture list helper: modulation textures may be missing. */
export const texOrNull = (t: { tex: GpuTexture } | undefined): GpuTexture | null => t?.tex ?? null;

/** Value of a modulation input for ctx.mod(id) in the shape the uniform blocks use. */
export function modOf(ctx: EvalContext, id: string): { tex: GpuTexture | null; k: number } {
  const m = ctx.mod(id);
  return { tex: m.tex?.tex ?? null, k: m.k };
}

/* ------------------------------------------------------------------------------------------------ CPU references */

/** Absolute <-> offset conversion at pixel position uv (pure, tested). */
export const uvToDelta = (raw: [number, number], uv: [number, number], mode: UvMode): [number, number] => (mode === 'offset' ? raw : [raw[0] - uv[0], raw[1] - uv[1]]);
export const deltaToUv = (delta: [number, number], uv: [number, number], mode: UvMode): [number, number] => (mode === 'offset' ? delta : [uv[0] + delta[0], uv[1] + delta[1]]);

/**
 * Engine encodings for export / import (used by UV to Color, Color to UV, documented in CONTRACTS.md):
 *  - 'absolute'   rg = lookup coordinate, b = 0                       (UV distortion lookup tables, float formats)
 *  - 'offset'     rg = delta (signed), b = 0                          (EXR / float flowmaps)
 *  - 'biased'     rg = delta / range * 0.5 + 0.5 (8/16-bit friendly)  (Unreal flowmaps, Unity / Godot flowmaps)
 *  - 'direction'  rg = unit direction * 0.5 + 0.5, b = |delta| / range (flow direction + speed)
 */
export type UvCodec = 'absolute' | 'offset' | 'biased' | 'direction';
export function encodeUvCodec(delta: [number, number], uv: [number, number], codec: UvCodec, range: number, flipY: boolean, contentMotion = false): [number, number, number] {
  const sg = contentMotion && (codec === 'biased' || codec === 'direction') ? -1 : 1;
  const dy = (flipY ? -delta[1] : delta[1]) * sg;
  const dx = delta[0] * sg;
  switch (codec) {
    case 'absolute':
      return [uv[0] + delta[0], flipY ? 1 - (uv[1] + delta[1]) : uv[1] + delta[1], 0];
    case 'offset':
      return [delta[0], dy, 0];
    case 'biased':
      return [(dx / range) * 0.5 + 0.5, (dy / range) * 0.5 + 0.5, 0];
    case 'direction': {
      const len = Math.hypot(dx, dy);
      const inv = len > 1e-9 ? 1 / len : 0;
      return [dx * inv * 0.5 + 0.5, dy * inv * 0.5 + 0.5, Math.min(len / range, 1)];
    }
  }
}
export function decodeUvCodec(c: [number, number, number], uv: [number, number], codec: UvCodec, range: number, flipY: boolean, contentMotion = false): [number, number] {
  const sg = contentMotion && (codec === 'biased' || codec === 'direction') ? -1 : 1;
  switch (codec) {
    case 'absolute': {
      const y = flipY ? 1 - c[1] : c[1];
      return [c[0] - uv[0], y - uv[1]];
    }
    case 'offset':
      return [c[0], flipY ? -c[1] : c[1]];
    case 'biased': {
      const dx = (c[0] * 2 - 1) * range;
      const dy = (c[1] * 2 - 1) * range;
      return [dx * sg, (flipY ? -dy : dy) * sg];
    }
    case 'direction': {
      const dx = c[0] * 2 - 1;
      const dy = c[1] * 2 - 1;
      const l = Math.hypot(dx, dy);
      const inv = l > 1e-9 ? (c[2] * range) / l : 0;
      return [dx * inv * sg, (flipY ? -dy : dy) * inv * sg];
    }
  }
}
