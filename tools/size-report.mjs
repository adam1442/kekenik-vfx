// Bundle size report: raw / gzip / brotli per file, sorted, with totals. Usage: node tools/size-report.mjs [dir=dist]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
const dir = process.argv[2] ?? 'dist';
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(dir);
const kb = (n) => (n / 1024).toFixed(1).padStart(9) + ' kB';
const rows = files.map((f) => {
  const b = readFileSync(f);
  return { f: relative(dir, f), raw: b.length, gz: gzipSync(b).length, br: /\.(js|css|html|json|svg|wgsl|webmanifest)$/.test(f) ? brotliCompressSync(b).length : b.length };
}).sort((a, b) => b.raw - a.raw);
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const lines = [`Bundle report for ${dir}`, '', 'file'.padEnd(46) + '      raw        gzip      brotli'];
for (const r of rows) lines.push(r.f.padEnd(46).slice(0, 46) + kb(r.raw) + kb(r.gz) + kb(r.br));
lines.push('-'.repeat(46 + 33), 'TOTAL'.padEnd(46) + kb(sum('raw')) + kb(sum('gz')) + kb(sum('br')));
const js = rows.filter((r) => r.f.endsWith('.js'));
lines.push('', `JS chunks: ${js.length}, largest: ${js[0]?.f ?? '-'} (${js[0] ? (js[0].raw / 1024).toFixed(0) : 0} kB raw)`);
console.log(lines.join('\n'));
if (process.argv.includes('--write')) writeFileSync(join(dir, 'size-report.txt'), lines.join('\n') + '\n');
