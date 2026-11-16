import { formatCapabilityReport } from '../engine/gpu/caps';
import type { GpuContext } from '../engine/gpu/device';
import { discoverNodes } from '../engine/graph/discover';
import { nodeRegistry } from '../engine/graph/registry';
import { consoleBus } from '../shared/log';
import { el } from '../ui/styles';
import { SAMPLE_TEST_PREFIX, sampleResults } from './samples';
import { Skip, tests } from './tests';
import { renderVisuals } from './visuals';

interface Result {
  name: string;
  status: 'pending' | 'run' | 'pass' | 'fail' | 'skip';
  ms: number;
  detail: string;
}

/** Development-only GPU harness (`/#selftest` on the dev server): runs every GPU known-answer test sequentially. */
export async function mountSelfTest(root: HTMLElement, gpu: GpuContext): Promise<void> {
  discoverNodes(nodeRegistry);
  const capsText = formatCapabilityReport(gpu.caps);
  const results: Result[] = tests.map((t) => ({ name: t.name, status: 'pending', ms: 0, detail: '' }));
  const list = el('div');
  const visualHost = el('div');
  const summary = el('div', { class: 'dim' });
  const run = el('button', { class: 'primary' }, 'Run all');
  const copy = el('button', {}, 'Copy report');
  const evalSamples = el('button', {}, 'Evaluate all samples');
  const sampleTable = el('div');
  const back = el('button', {}, 'Back to app');
  back.onclick = () => {
    location.hash = '';
    location.reload();
  };
  root.replaceChildren(
    el('div', { class: 'page' }, el('h1', {}, 'KEKENIK VFX — ENGINE SELF-TEST'), el('p', { class: 'dim' }, 'GPU known-answer tests. Copy the report and paste it back to the developers.'), el('div', { class: 'top', style: 'margin:10px 0;border:1px solid var(--line)' }, run, evalSamples, copy, back, summary), sampleTable, list, visualHost),
  );

  const icon = { pending: '·', run: '…', pass: '✔', fail: '✘', skip: '⚠' } as const;
  function render(): void {
    list.replaceChildren(
      ...results.map((r) => {
        const row = el('div', { class: `t ${r.status}` }, el('span', { class: 's' }, icon[r.status]), el('span', {}, r.name), el('span', { class: 'dim' }, r.status === 'pending' ? '' : `${r.ms.toFixed(0)} ms`));
        if (r.detail) row.append(el('pre', {}, r.detail));
        return row;
      }),
    );
    const c = (s: Result['status']) => results.filter((r) => r.status === s).length;
    renderVisuals(visualHost);
    summary.textContent = `${c('pass')} passed · ${c('fail')} failed · ${c('skip')} skipped · ${c('pending') + c('run')} pending`;
  }

  function report(): string {
    const lines = [
      `Kekenik VFX self-test — ${new Date().toISOString()}`,
      `UA: ${navigator.userAgent}`,
      '',
      capsText,
      '',
      ...results.map((r) => `[${r.status.toUpperCase()}] ${r.name} (${r.ms.toFixed(0)} ms)${r.detail ? `\n    ${r.detail.replace(/\n/g, '\n    ')}` : ''}`),
      '',
      'Console (errors/warnings):',
      ...consoleBus.entries.filter((e) => e.level !== 'info').slice(-40).map((e) => `  ${consoleBus.format(e).replace(/\n/g, '\n    ')}`),
    ];
    return lines.join('\n');
  }
  copy.onclick = async () => {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied ✔';
    } catch {
      const ta = el('textarea', { style: 'position:fixed;inset:10%;width:80%;height:80%;z-index:9;background:#000;color:#fff' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      copy.textContent = 'Select all + copy (shown)';
    }
    setTimeout(() => (copy.textContent = 'Copy report'), 2500);
  };

  let running = false;
  async function runAll(only?: (name: string) => boolean): Promise<void> {
    if (running) return;
    running = true;
    run.setAttribute('disabled', '');
    evalSamples.setAttribute('disabled', '');
    for (let i = 0; i < tests.length; i++) {
      if (only && !only(tests[i].name)) continue;
      const r = results[i];
      r.status = 'run';
      r.detail = '';
      render();
      await new Promise((res) => setTimeout(res, 0));
      const t0 = performance.now();
      try {
        const d = await tests[i].run({ gpu, registry: nodeRegistry });
        r.status = 'pass';
        r.detail = d ?? '';
      } catch (e) {
        if (e instanceof Skip) {
          r.status = 'skip';
          r.detail = e.message;
        } else {
          r.status = 'fail';
          r.detail = (e as Error).message;
        }
      }
      r.ms = performance.now() - t0;
      render();
    }
    running = false;
    run.removeAttribute('disabled');
    evalSamples.removeAttribute('disabled');
    renderSampleTable();
  }
  /** Results table of the sample evaluation (sequential, small resolution): time + peak memory per sample, copyable as TSV. */
  const sampleRows = (): string[][] =>
    tests.map((tt, i) => [tt, results[i]] as const).filter(([tt]) => tt.name.startsWith(SAMPLE_TEST_PREFIX)).map(([tt, r]) => {
      const id = /"([^"]+)"/.exec(tt.name)?.[1] ?? tt.name;
      const n = sampleResults.get(id);
      return [id, r.status.toUpperCase(), n ? n.ms.toFixed(0) : '', n ? n.peakMB.toFixed(1) : '', r.status === 'fail' ? r.detail : ''];
    });
  function renderSampleTable(): void {
    const rows = sampleRows();
    if (!rows.some((r) => r[1] !== 'PENDING')) return;
    const head = ['sample', 'status', 'time ms', 'peak MB', 'errors'];
    const copyTable = el('button', {}, 'Copy table');
    copyTable.onclick = () => void navigator.clipboard?.writeText([head, ...rows].map((r) => r.join('\t')).join('\n'));
    sampleTable.replaceChildren(
      el('h3', {}, 'Samples'),
      el('table', { style: 'border-collapse:collapse;font-size:12px' }, el('tr', {}, ...head.map((x) => el('th', { style: 'text-align:left;padding:2px 10px' }, x))), ...rows.map((r) => el('tr', { class: r[1] === 'FAIL' ? 'fail' : '' }, ...r.map((x) => el('td', { style: 'padding:2px 10px' }, x))))),
      copyTable,
    );
  }
  run.onclick = () => void runAll();
  evalSamples.onclick = () => void runAll((name) => name.startsWith(SAMPLE_TEST_PREFIX));
  render();
  await runAll();
}
