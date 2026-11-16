/**
 * Autosave / project integrity envelope.
 *
 *   KKI1 <fnv1a-32 hex> <utf16 length>\n<json>
 *
 * Detects truncated or bit-rotted autosaves (browser killed mid-write, quota problems). Plain JSON (old files / hand-edited
 * files) is accepted as "unwrapped, unchecked". The hash is not cryptographic: it only has to catch accidents.
 */
export const INTEGRITY_MAGIC = 'KKI1';

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function wrapIntegrity(json: string): string {
  return `${INTEGRITY_MAGIC} ${fnv1a(json)} ${json.length}\n${json}`;
}

export interface Unwrapped {
  ok: boolean;
  /** The payload (also returned for failed checks, so a salvage attempt can still try it). */
  json: string;
  /** false = legacy plain JSON without envelope. */
  wrapped: boolean;
  reason?: string;
}

export function unwrapIntegrity(text: string): Unwrapped {
  if (!text.startsWith(INTEGRITY_MAGIC + ' ')) return { ok: true, json: text, wrapped: false };
  const nl = text.indexOf('\n');
  if (nl < 0) return { ok: false, json: '', wrapped: true, reason: 'envelope header is truncated' };
  const [, hash, len] = text.slice(0, nl).split(' ');
  const json = text.slice(nl + 1);
  if (Number(len) !== json.length) return { ok: false, json, wrapped: true, reason: `length mismatch (${json.length} of ${len})` };
  if (fnv1a(json) !== hash) return { ok: false, json, wrapped: true, reason: 'checksum mismatch' };
  return { ok: true, json, wrapped: true };
}
