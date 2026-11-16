/** Build stamp injected by `vite.app.config.ts` (`define`). Falls back to empty values in tests and tooling. */
declare const __KK_BUILD__: { built: string; commit: string } | undefined;

export const BUILD_INFO: { built: string; commit: string } =
  typeof __KK_BUILD__ !== 'undefined' ? __KK_BUILD__ : { built: '', commit: '' };
