import { consoleBus } from '../../shared/log';
import type { NodeDefinition } from './node';
import { nodeRegistry, type NodeRegistry } from './registry';

/**
 * Auto-discovery: every `src/nodes/<category>/<node>/definition.ts` that default-exports a NodeDefinition is
 * registered. Nothing in shared files ever lists nodes by hand.
 */
const modules = import.meta.glob('../../nodes/**/definition.ts', { eager: true }) as Record<string, { default?: NodeDefinition | NodeDefinition[] }>;

export function discoverNodes(registry: NodeRegistry = nodeRegistry): { loaded: number; failed: string[] } {
  const failed: string[] = [];
  let loaded = 0;
  for (const [path, mod] of Object.entries(modules)) {
    try {
      if (!mod.default) throw new Error('no default export');
      // a definition.ts may default-export an ARRAY (e.g. Gray + Color variants).
      for (const def of Array.isArray(mod.default) ? mod.default : [mod.default]) {
        if (registry.has(def.id)) continue;
        registry.register(def);
        loaded++;
      }
    } catch (e) {
      failed.push(path);
      consoleBus.error(`Node definition ${path} rejected: ${(e as Error).message}`, { source: 'app' });
    }
  }
  return { loaded, failed };
}

export const discoveredNodePaths = (): string[] => Object.keys(modules);
