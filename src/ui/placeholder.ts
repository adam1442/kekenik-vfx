import { h } from './core/dom';
import { registerPanel, type PanelDefinition } from './dock/panel-registry';
import { icon } from './icons';

import { t } from '../shared/i18n';
/** Registers a clearly-labelled placeholder panel (used for panels that are not available). */
export function placeholderPanel(def: Pick<PanelDefinition, 'id' | 'title' | 'icon' | 'singleton' | 'multiple' | 'defaultDock'> & { owner: string; blurb: string; bullets: string[] }): void {
  registerPanel({
    id: def.id,
    title: def.title,
    icon: def.icon,
    singleton: def.singleton,
    multiple: def.multiple,
    defaultDock: def.defaultDock,
    create(host) {
      host.append(h('div', { class: 'k-placeholder' }, h('div', { style: { color: 'var(--accent2)', marginBottom: '0.5rem' } }, icon(def.icon, 28)), h('h3', {}, def.title, ' ', h('span', { class: 'k-badge' }, t('placeholder.placeholder', { owner: def.owner }))), h('div', {}, def.blurb), h('ul', {}, ...def.bullets.map((b) => h('li', {}, b)))));
      return { dispose() {} };
    },
  });
}
