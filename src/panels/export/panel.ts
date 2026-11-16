import { registerLazyPanel } from '../../ui/dock/panel-lazy';

/** Lazy panel: metadata only; the UI lives in view.ts and is code-split (see ui/dock/panel-lazy.ts). */
registerLazyPanel(
  {
    id: 'export',
    title: 'Export',
    icon: 'panel-export',
    defaultDock: { zone: 'right', size: 0.3 },
    description:
      'Export jobs: textures (PNG / TGA / EXR / HDR / DDS), flipbooks, channel packs, meshes, VAT and viewport sequences.',
  },
  () => import('./view'),
);
