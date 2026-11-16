/**
 * SAFE MODE (`?safe` in the URL): for GPU / driver trouble. The app starts with GPU-heavy panels replaced by a placeholder
 * (3D viewport, node gallery, flipbook editor), graph thumbnails off, no pipeline warm-up, no adaptive extras, no autosave recovery
 * prompt side effects. A panel can be enabled individually from its placeholder. Nothing is persisted: reload without `?safe` to leave.
 */
export const HEAVY_PANELS: ReadonlySet<string> = new Set(['viewport-3d', 'node-gallery', 'flipbook-editor']);

export function isSafeMode(search: string = typeof location !== 'undefined' ? location.search : ''): boolean {
  return /[?&]safe(=1|=true)?(&|$)/.test(search);
}

const allowed = new Set<string>();
/** Is this panel blocked right now? (safe mode and not individually enabled) */
export const isPanelBlocked = (panelId: string, safe: boolean = isSafeMode()): boolean => safe && HEAVY_PANELS.has(panelId) && !allowed.has(panelId);
export const allowPanel = (panelId: string): void => void allowed.add(panelId);
