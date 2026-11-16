import { BUILD_INFO } from './build-info';

/** Product version (semantic). Bumped by hand for releases (keep in sync with package.json). The build stamp is injected at build time. */
export const APP_VERSION = '1.0.0';
export const APP_NAME = 'Kekenik VFX';

/** "1.0.0 · 2026-01-31 · abc1234" (what the status bar / About dialog show). */
export function versionLabel(): string {
  const day = BUILD_INFO.built.slice(0, 10);
  return `${APP_VERSION} · ${day}${BUILD_INFO.commit ? ` · ${BUILD_INFO.commit}` : ''}`;
}
