#!/usr/bin/env node
/**
 * i18n audit (no dependencies). Statically finds string literals handed to UI-producing calls in src/** and reports file:line:
 *   textContent / innerText / placeholder / title / aria-label / tip assignments or object keys, setAttribute('title'|'placeholder'|'aria-label'),
 *   toast(...), confirm / alert / prompt, command + menu `title:` / `label:` literals, and h('tag', {...}, 'Literal text') children.
 * A line that already calls t( / tr( / trNode*( is fine. Technical text goes into tools/i18n-allowlist.json:
 *   { "ignoreFiles": [regex...], "ignoreLines": [regex...], "baseline": { "<file>": <count of legacy literals> } }
 * Exit code 1 when a file has MORE un-externalised literals than its baseline (new hard-coded UI text), 0 otherwise.
 * `--update-baseline` rewrites the baseline from the current counts (use only after migrating strings DOWN). `--list` prints every finding.
 * (Named .mjs: this repo targets Node 20, which cannot run .ts files without an extra dependency.)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const allowPath = join(root, 'tools/i18n-allowlist.json');
const allow = JSON.parse(readFileSync(allowPath, 'utf8'));
const ignoreFiles = allow.ignoreFiles.map((r) => new RegExp(r));
const ignoreLines = allow.ignoreLines.map((r) => new RegExp(r));

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk(join(root, 'src')).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));

const LIT = String.raw`(['"\`])((?:\\.|(?!\1).)*)\1`;
const patterns = [
  new RegExp(String.raw`\.(?:textContent|innerText)\s*=\s*${LIT}`),
  new RegExp(String.raw`\b(?:placeholder|title|tip|ariaLabel|'aria-label')\s*[:=]\s*${LIT}`),
  new RegExp(String.raw`setAttribute\(\s*['"](?:title|placeholder|aria-label)['"]\s*,\s*${LIT}`),
  new RegExp(String.raw`\b(?:toast|confirm|alert|prompt)\(\s*${LIT}`),
  new RegExp(String.raw`\b(?:label|description)\s*:\s*${LIT}`),
  new RegExp(String.raw`\bh\(\s*'[a-z0-9]+'\s*,\s*(?:\{[^}]*\}|null|undefined)\s*,\s*${LIT}`),
];
// A literal is "UI text" when it contains a word of >= 3 letters and either a space or starts with a capital (skips ids, units, extensions, css).
const isText = (s) => /[A-Za-z\u0600-\u06FF]{3,}/.test(s) && (/\s/.test(s) || /^[A-Z][a-z]{2,}/.test(s)) && !/^[\w.#:/\\-]+$/.test(s) && !/^(https?:|data:)/.test(s);

const found = new Map();
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (ignoreFiles.some((r) => r.test(rel))) continue;
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\b(?:t|tr|trNodeLabel|trNodeParam|trNodeOption)\(/.test(line) || ignoreLines.some((r) => r.test(line))) return;
      for (const p of patterns) {
        const m = p.exec(line);
        const lit = m && (m[2] ?? '');
        if (m && isText(lit)) {
          if (!found.has(rel)) found.set(rel, []);
          found.get(rel).push({ line: i + 1, text: lit.slice(0, 70) });
          break;
        }
      }
    });
}

if (process.argv.includes('--update-baseline')) {
  allow.baseline = Object.fromEntries([...found].map(([f, a]) => [f, a.length]).sort());
  writeFileSync(allowPath, JSON.stringify(allow, null, 2) + '\n');
  console.log(`i18n baseline written: ${[...found.values()].reduce((n, a) => n + a.length, 0)} legacy literals in ${found.size} files`);
  process.exit(0);
}
let bad = 0;
let total = 0;
for (const [f, list] of found) {
  total += list.length;
  const base = allow.baseline[f] ?? 0;
  if (process.argv.includes('--list')) list.forEach((x) => console.log(`${f}:${x.line}  ${x.text}`));
  if (list.length > base) {
    bad += list.length - base;
    console.error(`NEW un-externalised UI strings in ${f} (${list.length} > baseline ${base}):`);
    list.slice(base).forEach((x) => console.error(`  ${f}:${x.line}  "${x.text}"`));
  }
}
console.log(`i18n audit: ${total} legacy literal(s) in baseline files, ${bad} new violation(s).`);
process.exit(bad ? 1 : 0);
