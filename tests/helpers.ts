import type { GpuContext } from '../src/engine/gpu/device';
import { discoverNodes } from '../src/engine/graph/discover';
import { NodeRegistry } from '../src/engine/graph/registry';
import { MemoryManager } from '../src/engine/resources/memory';

export function makeRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  const { failed } = discoverNodes(r);
  if (failed.length) throw new Error(`node discovery failed: ${failed.join(', ')}`);
  return r;
}

/** Minimal fake GpuContext: enough for MemoryManager / pools (no real GPU). */
export function mockGpu(): { gpu: GpuContext; stats: { destroyedTextures: number; createdTextures: number } } {
  const stats = { destroyedTextures: 0, createdTextures: 0 };
  const device = {
    pushErrorScope() {},
    popErrorScope: async () => null,
    createTexture() {
      stats.createdTextures++;
      return {
        destroy() {
          stats.destroyedTextures++;
        },
        createView: () => ({}),
      };
    },
    createBuffer: () => ({ destroy() {} }),
  };
  const gpu = {
    device,
    generation: 1,
    caps: {
      limits: { maxTextureDimension2D: 4096, maxBufferSize: 2 ** 30 },
      has: { textureFormatsTier1: false, bgra8Storage: false },
      defaultBudgetBytes: 2 ** 28,
    },
  } as unknown as GpuContext;
  return { gpu, stats };
}

export function mockMemory(budget = 8 * 1024 * 1024) {
  const { gpu, stats } = mockGpu();
  return { mm: new MemoryManager(gpu, budget), stats };
}
