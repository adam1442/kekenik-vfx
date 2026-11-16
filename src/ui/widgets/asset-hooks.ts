import type { AssetRef } from '../../engine/params/schema';

/** Hooks the app installs so the generic Properties widget can import / pick assets. */
export interface AssetUiHooks {
  pick(kind: 'image' | 'model' | 'any', anchor: HTMLElement): void | Promise<void>;
}
export const assetUi: { hooks: AssetUiHooks | null; onPicked: ((ref: AssetRef) => void) | null } = { hooks: null, onPicked: null };
