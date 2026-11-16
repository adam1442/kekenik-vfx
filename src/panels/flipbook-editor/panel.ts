import { registerLazyPanel } from '../../ui/dock/panel-lazy';

import { t } from '../../shared/i18n';
/** Lazy panel: metadata only; the UI lives in view.ts and is code-split (see ui/dock/panel-lazy.ts). */
registerLazyPanel(
  {
    id: 'flipbook-editor',
    title: t('flipbookEditor.flipbookEditor'),
    icon: 'pin-flipbook',
    defaultDock: { zone: 'right', size: 0.3 },
    description: t('flipbookEditor.importAFlipbookSheet'),
  },
  () => import('./view'),
);
