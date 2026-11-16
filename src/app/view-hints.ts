import { Emitter } from '../shared/emitter';

/**
 * VIEW HINTS: a sample / template can tell the 3D viewports which mesh node to show, which texture node to use as
 * the VFX material and how the material should be displayed (blend, UV scroll, tiling...). Viewports listen to this emitter and
 * adopt the hint (it is just a convenience that pre-fills what the user would pick in the Material box). Node ids refer to
 * the project that was loaded right before the hint is emitted.
 */
export interface ViewHints {
  /** Mesh node id to preview ('' = follow the active node). */
  mesh?: string;
  /** Texture node id used as the material ('' = follow the active node, 'none' = plain shading). */
  material?: string;
  /** Partial material preview settings (see MaterialPreview in panels/viewport-3d/scene.ts). */
  mat?: { blend?: string; doubleSided?: boolean; depthWrite?: boolean; softFade?: number; scroll?: [number, number]; tile?: [number, number]; opacity?: number };
  /** 3D display mode id ('matcap' | 'pbr' | 'unlit' | 'vertex_color' | 'normals' | 'wireframe'). */
  display?: string;
}

export const viewHints = new Emitter<ViewHints>();
