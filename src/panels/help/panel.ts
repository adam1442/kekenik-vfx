import { registerLazyPanel } from '../../ui/dock/panel-lazy';

import { t } from '../../shared/i18n';
/** Lazy panel: metadata only; the UI lives in view.ts and is code-split (see ui/dock/panel-lazy.ts). */
registerLazyPanel(
  {
    id: 'help',
    title: 'Help',
    icon: 'info',
    defaultDock: { zone: 'right', size: 0.3 },
    description: t('help.nodeReferenceKeyboardShortcu'),
  },
  () => import('./view'),
);
