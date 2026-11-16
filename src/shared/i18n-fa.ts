import fa from '../i18n/fa.json';
import type { EN } from './i18n';

/**
 * Persian (fa) translation. English is the source of truth; every key of `EN` has a Persian value (tests/i18n.test.ts reports gaps).
 * Terminology: docs/I18N_GLOSSARY.md. Kept in Latin script on purpose: Flipbook, Mask, UV, Normal, HDR, Gamma, Luma, Alpha channel names.
 */
export const FA: Record<keyof typeof EN, string> = fa;
