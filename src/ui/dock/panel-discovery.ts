/**
 * Panel auto-discovery. Kept OUT of panel-registry.ts on purpose: panels import the registry, so the eager glob living in
 * the registry module would create an import cycle (panel bodies running before the registry Map exists).
 */
const modules = import.meta.glob('../../panels/*/panel.ts', { eager: true });

/** Import every `src/panels/<name>/panel.ts` (each registers itself). Idempotent. */
export function discoverPanels(): number {
  return Object.keys(modules).length;
}
