import type { MemoryManager, PooledBuffer, RefCounted } from '../resources/memory';
import { dataValue, type DataValue, type PinValue } from '../resources/values';
import { MeshData, STD } from './mesh';

/**
 * Mesh <-> memory budget bridge.
 *  - `MeshResource` wraps a FROZEN MeshData as a ref-counted value (`DataValue.resources`), so the evaluator's output cache,
 *    LRU eviction and "release after last consumer" apply to meshes exactly like textures.
 *  - CPU bytes are accounted ONCE per distinct typed array (copy-on-write sharing between cached meshes does not
 *    double-count) through `MemoryManager.addExternal('mesh', bytes)` -> they count against the same budget and show in the
 *    GPU memory meter. `ensureRoom` runs first, so a mesh that does not fit throws OutOfBudgetError (error badge).
 *  - The optional GPU mirror allocates from the BufferPool (accounted there).
 */
export class MeshAccounting {
  private refs = new Map<ArrayBufferView, number>();
  constructor(readonly mm: MemoryManager) {}

  /** Bytes that would be newly added if `mesh` were registered now. */
  newBytes(mesh: MeshData): number {
    let n = 0;
    for (const a of mesh.arrays()) if (!this.refs.has(a)) n += a.byteLength;
    return n;
  }
  acquire(mesh: MeshData): ArrayBufferView[] {
    const need = this.newBytes(mesh);
    if (need > 0) this.mm.ensureRoom(need, `mesh (${mesh.pointCount} points)`);
    const arrays = mesh.arrays();
    let added = 0;
    for (const a of arrays) {
      const c = this.refs.get(a) ?? 0;
      if (c === 0) added += a.byteLength;
      this.refs.set(a, c + 1);
    }
    this.mm.addExternal('mesh', added);
    return arrays;
  }
  release(arrays: ArrayBufferView[]): void {
    let freed = 0;
    for (const a of arrays) {
      const c = (this.refs.get(a) ?? 0) - 1;
      if (c <= 0) {
        this.refs.delete(a);
        freed += a.byteLength;
      } else this.refs.set(a, c);
    }
    this.mm.removeExternal('mesh', freed);
  }
  get liveArrays(): number {
    return this.refs.size;
  }
}

let current: MeshAccounting | null = null;
/** Called by Engine. The latest bound manager is used by new resources (tests create several engines). */
export function bindMeshAccounting(mm: MemoryManager): MeshAccounting {
  current = new MeshAccounting(mm);
  return current;
}
export const meshAccounting = (): MeshAccounting | null => current;

export class MeshResource implements RefCounted {
  /** Starts at 0 ("floating"): a node returns the value and the evaluator retains it (like pooled textures that are not yet owned). */
  private refs = 0;
  private arrays: ArrayBufferView[];
  private mirror: MeshGpuMirror | null = null;
  private disposed = false;
  readonly mesh: MeshData;
  constructor(
    mesh: MeshData,
    private acct: MeshAccounting | null,
  ) {
    this.mesh = mesh.freeze();
    this.arrays = acct ? acct.acquire(mesh) : mesh.arrays();
  }
  get bytes(): number {
    return this.mesh.bytes + (this.mirror?.bytes ?? 0);
  }
  get refCount(): number {
    return this.refs;
  }
  retain(): this {
    if (this.disposed) throw new Error('MeshResource: use after free');
    this.refs++;
    return this;
  }
  release(): void {
    if (this.disposed) return;
    if (--this.refs > 0) return;
    this.disposed = true;
    this.mirror?.dispose();
    this.mirror = null;
    this.acct?.release(this.arrays);
  }
  /** Lazily created GPU buffers (storage + vertex + index usage). Requires a bound accounting (i.e. an Engine). */
  gpu(): MeshGpuMirror {
    if (this.disposed) throw new Error('MeshResource: use after free');
    if (!this.acct) throw new Error('MeshResource.gpu(): no MemoryManager bound');
    if (!this.mirror) this.mirror = new MeshGpuMirror(this.mesh, this.acct.mm);
    return this.mirror;
  }
}

/**
 * GPU mirror: the buffers a compute/render consumer needs, uploaded on first use and cached for the life of the resource.
 *   positions : array<vec4f> per POINT (xyz, 1) — 16-byte stride for storage-buffer alignment
 *   vertPoint : array<u32> per vertex
 *   triangles : array<u32> vertex indices, 3 per triangle (INDEX usage too)
 *   attribute(name): array<f32> packed `size` floats per element (point/vertex/primitive/detail)
 */
export class MeshGpuMirror {
  private bufs = new Map<string, PooledBuffer>();
  bytes = 0;
  constructor(
    private mesh: MeshData,
    private mm: MemoryManager,
  ) {}
  private make(name: string, data: ArrayBufferView, copyBytes?: number): PooledBuffer {
    const hit = this.bufs.get(name);
    if (hit) return hit;
    const usage = 0x80 /*STORAGE*/ | 0x20 /*VERTEX*/ | 0x10 /*INDEX*/ | 0x08 /*COPY_DST*/ | 0x04 /*COPY_SRC*/;
    const size = Math.max(16, Math.ceil((copyBytes ?? data.byteLength) / 4) * 4);
    const b = this.mm.buffers.acquire({ size, usage, label: `mesh:${name}` });
    this.mm.gpu.device.queue.writeBuffer(b.buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    this.bufs.set(name, b);
    this.bytes += b.size;
    return b;
  }
  positions(): PooledBuffer {
    const hit = this.bufs.get('P');
    if (hit) return hit;
    const P = this.mesh.positions;
    const n = this.mesh.pointCount;
    const v4 = new Float32Array(Math.max(4, n * 4));
    for (let i = 0; i < n; i++) {
      v4[i * 4] = P[i * 3];
      v4[i * 4 + 1] = P[i * 3 + 1];
      v4[i * 4 + 2] = P[i * 3 + 2];
      v4[i * 4 + 3] = 1;
    }
    return this.make('P', v4);
  }
  vertPoint(): PooledBuffer {
    return this.make('vp', this.mesh.topology.vertPoint.length ? this.mesh.topology.vertPoint : new Uint32Array(1));
  }
  triangles(): PooledBuffer {
    const t = this.mesh.topology.triangles().verts;
    return this.make('tri', t.length ? t : new Uint32Array(3));
  }
  attribute(name: string, el: 'point' | 'vertex' | 'primitive' | 'detail' = 'point'): PooledBuffer | null {
    const a = this.mesh.attr(el, name);
    if (!a) return null;
    return this.make(`${el}/${name}`, a.data.length ? (a.data instanceof Float32Array ? a.data : Float32Array.from(a.data)) : new Float32Array(1));
  }
  dispose(): void {
    for (const b of this.bufs.values()) b.release();
    this.bufs.clear();
    this.bytes = 0;
  }
}

/** Wrap a mesh as a pin value (freezes it, accounts it, ref-counts it). Use in node `evaluate`: `{ mesh: meshValue(m, 'mesh') }`. */
export function meshValue(mesh: MeshData, pin: 'mesh' | 'points' = 'mesh'): DataValue {
  const res = new MeshResource(mesh, current);
  // the node's creation reference is transferred to the value (the evaluator retains/releases around it)
  return dataValue(pin, res.mesh, [res]);
}
export function asMesh(v: PinValue | undefined): MeshData | undefined {
  return v && v.kind === 'data' && (v.pin === 'mesh' || v.pin === 'points') && v.data instanceof MeshData ? v.data : undefined;
}
export const hasStd = (m: MeshData): boolean => m.has('point', STD.P);
