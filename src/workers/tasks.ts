import { objParseCore, type ObjCoreResult } from '../engine/io/model';
import { noiseDisplace, type NoiseDisplaceParams } from '../engine/mesh/deform';
import { MeshData, Topology, type Attribute } from '../engine/mesh/mesh';
import { jsonParseTask } from '../shared/worker-pool';

/**
 * WORKER-SAFE task registry: pure functions `(params, inputs) -> outputs` over plain, structured-clone friendly data (typed
 * arrays + JSON). No DOM, no GPU, no main-thread-only imports. The SAME function runs on a worker and (for small inputs / as the crash
 * fallback) on the main thread, so results are identical byte for byte (tests/workers.test.ts, selftest group "Workers").
 */
export interface WireMesh {
  pointCount: number;
  vertPoint: Uint32Array;
  primStart: Uint32Array;
  attrs: Attribute[];
}
export const encodeMesh = (m: MeshData): WireMesh => ({ pointCount: m.pointCount, vertPoint: m.topology.vertPoint, primStart: m.topology.primStart, attrs: m.list() });
export function decodeMesh(w: WireMesh): MeshData {
  const m = new MeshData(w.pointCount, new Topology(w.vertPoint, w.primStart));
  for (const a of w.attrs) m.setAttr({ ...a });
  return m;
}

export interface TaskMap {
  'mesh.noise': { params: NoiseDisplaceParams; inputs: [WireMesh]; out: { mesh: WireMesh } };
  'obj.parse': { params: { text: string; maxTriangles: number }; inputs: []; out: ObjCoreResult };
  'json.parse': { params: string; inputs: []; out: ReturnType<typeof jsonParseTask> };
}
export type TaskName = keyof TaskMap;

export function runTask<K extends TaskName>(task: K, params: TaskMap[K]['params'], inputs: TaskMap[K]['inputs']): TaskMap[K]['out'];
export function runTask(task: string, params: unknown, inputs: unknown[]): unknown {
  switch (task as TaskName) {
    case 'mesh.noise':
      return { mesh: encodeMesh(noiseDisplace(decodeMesh(inputs[0] as WireMesh), params as NoiseDisplaceParams)) };
    case 'obj.parse':
      return objParseCore(params as TaskMap['obj.parse']['params']);
    case 'json.parse':
      return jsonParseTask(params as string);
    default:
      throw new Error(`Unknown worker task "${task}"`);
  }
}

/** Every distinct ArrayBuffer inside a result (for the transfer list of the response; duplicates would make postMessage throw). */
export function collectTransfers(out: unknown, seen = new Set<ArrayBuffer>(), depth = 0): Transferable[] {
  if (depth > 6 || out === null || typeof out !== 'object') return [];
  if (ArrayBuffer.isView(out)) {
    if (out.buffer instanceof ArrayBuffer) seen.add(out.buffer);
    return [...seen];
  }
  for (const v of Array.isArray(out) ? out : Object.values(out as Record<string, unknown>)) collectTransfers(v, seen, depth + 1);
  return [...seen];
}
