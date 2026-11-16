import { EN, getLocale, setLocale, t } from '../shared/i18n';
import { FA } from '../shared/i18n-fa';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/** group "i18n ·": both languages load, nothing is empty or key-looking, switching sets lang / dir and is reversible. */
export function i18nTests(_h: Helpers): TestDef[] {
  void _h;
  return [
    {
      name: 'i18n · en + fa tables are complete, no empty or key-looking strings, live switch sets lang / dir',
      async run() {
        const before = getLocale();
        try {
          const bad: string[] = [];
          for (const [name, tab] of [['en', EN], ['fa', FA]] as const) {
            for (const [k, v] of Object.entries(tab)) if (!v.trim() || /^[a-z]+(\.[a-zA-Z]+)+$/.test(v)) bad.push(`${name}:${k}`);
          }
          if (bad.length) throw new Error(`bad strings: ${bad.slice(0, 5).join(', ')}`);
          setLocale('fa', false);
          if (document.documentElement.dir !== 'rtl' || document.documentElement.lang !== 'fa') throw new Error('dir/lang not applied for fa');
          const sample = ['settings.title', 'perf.title', 'help.title', 'hist.noinput', 'perf.fusion.title'] as const;
          for (const k of sample) if (!t(k) || t(k) === k) throw new Error(`raw key shown for ${k}`);
          setLocale('en', false);
          if ((document.documentElement.dir as string) !== 'ltr') throw new Error('dir not restored');
          return `${Object.keys(EN).length} keys in en and fa`;
        } finally {
          setLocale(before, false);
        }
      },
    },
  ];
}
