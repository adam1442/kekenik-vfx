import { registerLazyPanel } from '../../ui/dock/panel-lazy';

import { t } from '../../shared/i18n';
/** Lazy panel: metadata only; the UI lives in view.ts and is code-split (see ui/dock/panel-lazy.ts). */
registerLazyPanel(
  {
    id: 'anim-curves',
    title: t('animCurves.animationCurves'),
    icon: 'panel-curve',
    defaultDock: { zone: 'bottom', size: 0.3 },
    description:
      'Curve editor for animated parameters: tangents, loop matching, extrapolation, normalize view.',
  },
  () => import('./view'),
);
