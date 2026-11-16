import type { Gizmo3DModel } from './core';

/** What the renderer needs from a controller (keeps draw.ts independent of the controller class). */
export interface Controller3DLike {
  getModels(): readonly Gizmo3DModel[];
  hover: { key: string; id: string } | null;
  readonly active: { key: string; id: string } | null;
}
