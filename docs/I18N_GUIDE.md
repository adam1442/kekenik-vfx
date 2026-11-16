# Internationalisation guide

Kekenik VFX ships with **English** (source language) and **Persian (فارسی, right-to-left)**. This guide explains how the strings
are organised, how to improve Persian, and how to add another language.

## 1. How strings are organised

| What | Where |
|---|---|
| UI strings (menus, dialogs, panels) | `src/i18n/en.json` (source of truth) and `src/i18n/fa.json` |
| Runtime: `t()`, `tr()`, locale registry, RTL, digits | `src/shared/i18n.ts` |
| Persian node titles, parameters, options, pins | `src/shared/i18n-fa-terms.ts` (term table, shared across nodes) |
| Persian node descriptions | `src/shared/i18n-fa-9b.ts`, `src/shared/i18n-fa-sim.ts` and `src/shared/i18n-fa.ts` |

Rules for code:

- New UI text must use a key: `t('panel.title')`, with `{name}` placeholders for variables (`t('perf.fps', { n: 60 })`).
- Never concatenate translated fragments; translators need whole sentences.
- Missing keys fall back to English; unknown keys render as the key itself so they are easy to spot.
- `npm run i18n:audit` fails when a file gains new hard-coded UI literals compared with `tools/i18n-allowlist.json`.
- `tests/i18n*.test.ts` check that every English key has a Persian value, that placeholders match, and the RTL rules below.

## 2. Persian and RTL rules

- The interface switches to right-to-left (`dir="rtl"`); the **graph canvas, timeline, curve editor, histogram, numeric fields and
  viewports always stay left-to-right**.
- Numbers stay left-to-right inside RTL text. The *Digits* setting can display Persian digits (۰–۹) for labels; stored values are
  never changed.
- Keyboard keys (Ctrl, F3, ...) and file formats (PNG, EXR, glTF) are never translated.
- Some technical words are intentionally kept in Latin script for consistency: **Flipbook, Mask, UV, Normal, HDR, Gamma, Luma, Alpha,
  R/G/B/A**.
- Fonts: the interface uses a system font stack and Persian falls back to the platform font. To use Vazirmatn, see
  `public/fonts/README.md` (SIL OFL 1.1; keep its license file with the font).

### Preferred terms

| English | فارسی | English | فارسی |
|---|---|---|---|
| Settings | تنظیمات | Node | نود |
| Parameter | پارامتر | Pin | پین |
| Viewport | ویوپورت | Pipeline | پایپلاین |
| Cache | کش | Profiler | پروفایلر |
| Histogram | هیستوگرام | Black point / White point | نقطهٔ سیاه / سفید |
| Preview | پیش‌نمایش | Autosave | ذخیرهٔ خودکار |
| Safe mode | حالت امن | Shader | شیدر |
| Texture | بافت | Memory budget | بودجهٔ حافظه |

## 3. Improving a translation

1. Edit `src/i18n/fa.json` (or the term tables above for node text).
2. Switch the interface to Persian in Settings and walk through the panels; look for clipped, untranslated or wrongly ordered text.
3. Run `npm run test` and `npm run i18n:audit`.

## 4. Adding a language

1. Copy `src/i18n/en.json` to `src/i18n/<code>.json` (for example `de.json`) and translate the values; keep keys and `{placeholders}`.
2. Create a small module that registers it, modelled on `src/shared/i18n-fa.ts`:
   `registerLocale('<code>', json)`, and import it from `src/shared/i18n.ts` next to the Persian import.
3. Add the display name (in the language itself) to `LANG_NAMES` in `src/shared/i18n.ts`.
4. For right-to-left languages add the code to the `RTL` set in the same file.
5. Node titles, parameters and descriptions are looked up through `trNode*` helpers; add a term table with `registerTerms('<code>', {...})`
   and, for descriptions, a map keyed by node id. Missing entries fall back to English.
6. Add tests next to `tests/i18n.test.ts` (key coverage, placeholders) and update this guide and the README.

Write translations in your own words; do not copy text from other software.
