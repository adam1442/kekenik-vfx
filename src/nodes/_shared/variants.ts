import type { NodeDefinition } from '../../engine/graph/node';
import type { TexturePin } from '../../engine/types';

/**
 * Gray / Color variants. Pin types are static in this engine, so every filter that "works on Gray and Color"
 * ships as TWO registered definitions produced from ONE factory (`definition.ts` default-exports the array; see
 * discover.ts). The shader is shared: gray textures simply sample as (v, 0, 0, 1) and the shader works on all 4
 * channels (luma-driven weights use `COLOR` define: gray -> `.r`, color -> Rec.709 luminance).
 * Gray -> Color connections are implicit, so the Color variant also accepts Gray wires.
 */
export type Kind = 'gray' | 'color';
export const KINDS: Kind[] = ['gray', 'color'];
export const pinOf = (k: Kind): TexturePin => k;
export const idOf = (id: string, k: Kind): string => (k === 'color' ? `${id}_color` : id);
export const titleOf = (title: string, k: Kind): string => (k === 'color' ? `${title} (Color)` : title);
/** Shader define set for a kind. */
export const kindDefines = (k: Kind): { COLOR: number } => ({ COLOR: k === 'color' ? 1 : 0 });
/** Build both variants. */
export const variants = (make: (k: Kind) => NodeDefinition): NodeDefinition[] => KINDS.map(make);
/** Common optional tooltip texts. */
export const RADIUS_TIP = 'Fraction of the smaller image side (resolution independent).';
