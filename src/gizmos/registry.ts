import type { GizmoDecl } from '../engine/graph/gizmo-decl';
import type { ParamValues } from '../engine/params/schema';
import { buildAngle, buildBrush, buildCircle, buildFalloff, buildGrid, buildLine, buildPoint, buildRange } from './models-basic';
import { buildRect, buildTransform } from './models-shape';
import { buildPath } from './models-spline';
import type { GizmoEnv, GizmoModel } from './types';
import type { SnapSettings } from './snap';
import type { V2 } from './geom';

/** Builds one model from a declaration (null: hidden / not for this viewport / 3D-only). Never throws. */
export function buildGizmoModel(decl: GizmoDecl, env: GizmoEnv, viewport: '2d' | '3d' = '2d'): GizmoModel | null {
  if (decl.viewport !== 'both' && decl.viewport !== viewport) return null;
  if (decl.visibleIf) {
    try {
      if (!decl.visibleIf(env.values)) return null;
    } catch {
      return null;
    }
  }
  try {
    switch (decl.type) {
      case 'point':
        return buildPoint(decl, env);
      case 'circle':
        return buildCircle(decl, env);
      case 'rect':
        return buildRect(decl, env);
      case 'line':
        return buildLine(decl, env);
      case 'angle':
        return buildAngle(decl, env);
      case 'transform':
        return buildTransform(decl, env);
      case 'path':
        return buildPath(decl, env);
      case 'range':
        return buildRange(decl, env);
      case 'falloff':
        return buildFalloff(decl, env);
      case 'grid':
        return buildGrid(decl, env);
      case 'brush':
        return buildBrush(decl, env);
      default:
        return null; // 3D gizmos (box3d, point3d, radius3d, ...): built by src/gizmos3d for the 3D viewport
    }
  } catch (e) {
    console.error(`[gizmo] ${decl.id} (${decl.type}) failed to build:`, e);
    return null;
  }
}

export interface NodeGizmoInput {
  nodeId: string;
  decls: readonly GizmoDecl[];
  values: ParamValues;
}
export interface SharedEnv {
  size: V2;
  tile: [boolean, boolean];
  snap: SnapSettings;
  zoom: number;
}

/** UI-only per-gizmo state (selected spline point...) kept across rebuilds; owned by the viewport. */
export class GizmoStateStore {
  private m = new Map<string, Record<string, unknown>>();
  get(key: string): Record<string, unknown> {
    let s = this.m.get(key);
    if (!s) this.m.set(key, (s = {}));
    return s;
  }
  clear(): void {
    this.m.clear();
  }
}

export function buildNodeGizmos(nodes: NodeGizmoInput[], shared: SharedEnv, states: GizmoStateStore, viewport: '2d' | '3d' = '2d'): GizmoModel[] {
  const out: GizmoModel[] = [];
  for (const n of nodes) {
    for (const d of n.decls) {
      const env: GizmoEnv = { nodeId: n.nodeId, values: n.values, ...shared, state: states.get(`${n.nodeId}/${d.id}`) };
      const m = buildGizmoModel(d, env, viewport);
      if (m) out.push(m);
    }
  }
  return out;
}
