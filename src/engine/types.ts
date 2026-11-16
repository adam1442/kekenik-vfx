/** Foundation types shared by the whole engine. Keep this file dependency-free. */

/** Pin / data types. Gray->Color is the only implicit conversion. */
export type PinType =
  | 'gray'
  | 'color'
  | 'normal'
  | 'uv'
  | 'mesh'
  | 'points'
  | 'spline'
  | 'scalar'
  | 'vector'
  | 'curve'
  | 'gradient'
  | 'flipbook'
  | 'camera';

/** Pin types that are backed by a GPU texture. */
/** `vector` = signed 2-channel float field (tile fractions / second), NOT a UV warp: see CONTRACTS section 15. */
export type TexturePin = 'gray' | 'color' | 'normal' | 'uv' | 'vector';
export const isTexturePin = (t: PinType): t is TexturePin => t === 'gray' || t === 'color' || t === 'normal' || t === 'uv' || t === 'vector';

export type NodeCategory =
  | 'grayscale'
  | 'color'
  | 'normal'
  | 'uv'
  | 'utils'
  | 'islands'
  | 'subgraph'
  | 'simulation'
  | 'vector'
  | 'particle'
  | 'geometry'
  | 'camera'
  | 'import'
  | 'export';

export type TilingMode = 'none' | 'both' | 'x' | 'y';
export type FilterMode = 'point' | 'linear' | 'cubic';

export const FILTER_INDEX: Record<FilterMode, number> = { point: 0, linear: 1, cubic: 2 };
export const tilingFlags = (t: TilingMode): [boolean, boolean] => [t === 'both' || t === 'x', t === 'both' || t === 'y'];

export interface PinRef {
  node: string;
  pin: string;
}
