import type { PinType, TexturePin } from '../types';
import type { GpuTexture, RefCounted } from './memory';

/**
 * What flows along links. Textures are ref-counted GPU textures; everything else (mesh, points, scalar,
 * curve, flipbook...) is an opaque `data` payload that may own ref-counted resources.
 */
export interface TextureValue {
  kind: 'texture';
  pin: TexturePin;
  tex: GpuTexture;
  width: number;
  height: number;
  /** Vector pins only - metadata `scale` (1 = tile fractions per second; motion vectors use 1 / fps = per frame). */
  vecScale?: number;
}
export interface DataValue {
  kind: 'data';
  pin: PinType;
  data: unknown;
  /** Resources owned by this value; retained/released together with it. */
  resources?: RefCounted[];
}
export type PinValue = TextureValue | DataValue;

export const resourcesOf = (v: PinValue): RefCounted[] => (v.kind === 'texture' ? [v.tex] : (v.resources ?? []));
export const retainValue = (v: PinValue): void => {
  for (const r of resourcesOf(v)) r.retain();
};
export const releaseValue = (v: PinValue): void => {
  for (const r of resourcesOf(v)) r.release();
};
export const valueBytes = (v: PinValue): number => resourcesOf(v).reduce((a, r) => a + r.bytes, 0);
/** Bytes that would actually be freed if every holder except the caller dropped the value. */
export const exclusiveBytes = (v: PinValue): number => resourcesOf(v).reduce((a, r) => a + (r.refCount <= 1 ? r.bytes : 0), 0);

export const textureValue = (tex: GpuTexture, pin: TexturePin): TextureValue => ({ kind: 'texture', pin, tex, width: tex.width, height: tex.height });
export const dataValue = (pin: PinType, data: unknown, resources?: RefCounted[]): DataValue => ({ kind: 'data', pin, data, resources });
