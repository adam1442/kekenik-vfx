import { GraphEditor } from '../../engine/commands/graph-commands';
import { Engine } from '../../engine/engine';
import type { GpuContext } from '../../engine/gpu/device';
import { discoverNodes } from '../../engine/graph/discover';
import { Graph } from '../../engine/graph/graph';
import { NodeRegistry, nodeRegistry } from '../../engine/graph/registry';
import { ActiveTargetService, SelectionService } from '../../app/services';
import { Emitter } from '../../shared/emitter';
import { download, h } from '../../ui/core/dom';
import { initTooltips } from '../../ui/core/overlay';
import '../../ui/styles';
import { buildDag } from './selftest-checks';
import { GraphView, type GraphHost } from './view';

/**
 * Graph editor STRESS PAGE (dist/graph-stress.html -> index.html#graph-stress).
 * Generates a 500-node / ~1000-link graph and runs scripted camera scenarios (pan sweep, zoom in/out, far-out LOD view),
 * reporting real frame intervals (rAF) and CPU draw time per frame. Works without WebGPU (no thumbnails then).
 */
function pct(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export async function mountGraphStress(root: HTMLElement, gpu: GpuContext | null): Promise<void> {
  initTooltips();
  let engine: Engine | null = null;
  let registry: NodeRegistry = nodeRegistry;
  if (gpu) {
    try {
      engine = await Engine.create({ gpu });
      registry = engine.registry;
    } catch {
      engine = null;
    }
  }
  if (!engine) discoverNodes(registry);

  let editor = new GraphEditor(buildDag(registry, 25, 20));
  const selection = new SelectionService();
  selection.bind(editor.graph);
  const active = new ActiveTargetService(selection);
  const projectChange = new Emitter<void>();
  const host: GraphHost = { registry, engine, editor: () => editor, selection, active, onProjectChange: projectChange };
  if (engine) {
    engine.scheduler.attach(editor.graph);
    engine.scheduler.start();
  }

  const stage = h('div', { style: { flex: '1', position: 'relative', minHeight: '0' } });
  const out = h('pre', { style: { margin: '0', padding: '0.667rem 1rem', background: '#0d0e11', color: '#c9ccd2', fontSize: '0.917rem', maxHeight: '38vh', overflow: 'auto', whiteSpace: 'pre-wrap' } }, 'Press “Run benchmark”. Frame intervals are measured with requestAnimationFrame (capped by your display refresh rate).');
  const hud = h('span', { style: { marginLeft: 'auto', color: '#8c939e', fontSize: '1rem' } });
  const btn = (label: string, fn: () => void): HTMLButtonElement => h('button', { class: 'primary', style: { padding: '0.333rem 1rem' }, onclick: fn }, label);
  const bar = h('div', { style: { display: 'flex', gap: '0.667rem', padding: '0.5rem 0.833rem', alignItems: 'center', background: '#17191d', borderBottom: '1px solid #2b2f36' } }, h('b', {}, 'Graph stress test'), hud);
  root.replaceChildren(h('div', { class: 'k-app', style: { display: 'flex', flexDirection: 'column', height: '100vh' } }, bar, stage, out));

  const view = new GraphView(host, stage);
  const ro = new ResizeObserver(() => view.resize(stage.clientWidth, stage.clientHeight));
  ro.observe(stage);
  (window as unknown as { graphStress: unknown }).graphStress = { view, host };

  const regen = (cols: number, rows: number): void => {
    editor = new GraphEditor(buildDag(registry, cols, rows));
    selection.bind(editor.graph);
    engine?.scheduler.attach(editor.graph);
    projectChange.emit();
    out.textContent = `Generated ${editor.graph.nodes.size} nodes / ${editor.graph.links.size} links.`;
  };

  let running = false;
  const runScenario = async (name: string, frames: number, cam: (i: number, n: number) => { x: number; y: number; zoom: number }): Promise<string> => {
    const draws: number[] = [];
    const dts: number[] = [];
    view.capture = draws;
    let last = performance.now();
    for (let i = 0; i < frames; i++) {
      view.setView(cam(i, frames));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const t = performance.now();
      dts.push(t - last);
      last = t;
    }
    view.capture = null;
    dts.shift();
    const avg = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
    const f = view.lastFrame;
    return `${name.padEnd(26)} fps ${(1000 / avg).toFixed(0).padStart(4)} | frame ms avg ${avg.toFixed(2)} p95 ${pct(dts, 95).toFixed(2)} max ${Math.max(...dts).toFixed(1)} | CPU draw ms avg ${(draws.reduce((a, b) => a + b, 0) / Math.max(1, draws.length)).toFixed(2)} p95 ${pct(draws, 95).toFixed(2)} max ${Math.max(0, ...draws).toFixed(2)} | drawn ${f.nodes} nodes / ${f.links} links`;
  };
  const bench = async (): Promise<void> => {
    if (running) return;
    running = true;
    const g = editor.graph;
    const W = stage.clientWidth,
      H = stage.clientHeight;
    const lines = [`Graph: ${g.nodes.size} nodes, ${g.links.size} links · viewport ${W}×${H} @ DPR ${window.devicePixelRatio} · thumbnails ${view.thumbs ? 'ON (WebGPU atlas)' : 'off'} · UA ${navigator.userAgent}`, ''];
    view.setPref('flow', false);
    lines.push(await runScenario('pan sweep (zoom 1.0)', 180, (i, n) => ({ x: -i * (5600 / n), y: -i * (3000 / n) * 0.5, zoom: 1 })));
    lines.push(await runScenario('zoom in/out at centre', 180, (i, n) => {
      const z = Math.exp(Math.sin((i / n) * Math.PI * 2) * 1.1 - 0.9);
      const wx = 2800,
        wy = 2500;
      return { zoom: z, x: W / 2 - wx * z, y: H / 2 - wy * z };
    }));
    lines.push(await runScenario('all nodes visible (LOD)', 120, (i, n) => {
      const z = 0.12 + 0.02 * Math.sin((i / n) * 6.28);
      return { zoom: z, x: 20 - i * 0.2, y: 20 };
    }));
    lines.push(await runScenario('medium zoom 0.45 pan', 150, (i, n) => ({ zoom: 0.45, x: -i * (2400 / n), y: -400 })));
    view.setPref('flow', true);
    view.selectAll();
    lines.push(await runScenario('flow animation + all sel', 120, (i, n) => ({ zoom: 0.7, x: -i * (1500 / n), y: -300 })));
    view.setPref('flow', false);
    view.deselect();
    view.fitAll(false);
    lines.push('', 'Target: 60 fps (16.7 ms) with 500 nodes / 1000 links. CPU draw ms is the Canvas2D cost of one frame; thumbnails add one GPU draw call.');
    out.textContent = lines.join('\n');
    running = false;
  };
  bar.insertBefore(btn('Run benchmark', () => void bench()), hud);
  bar.insertBefore(btn('500 nodes', () => regen(25, 20)), hud);
  bar.insertBefore(btn('1500 nodes', () => regen(50, 30)), hud);
  bar.insertBefore(h('button', { style: { padding: '0.333rem 1rem' }, onclick: () => download('graph-stress-report.txt', out.textContent ?? '', 'text/plain') }, 'Save report'), hud);
  // live HUD
  let lastT = performance.now();
  let acc = 0;
  let n = 0;
  const hudLoop = (): void => {
    const t = performance.now();
    acc += t - lastT;
    lastT = t;
    if (++n >= 30) {
      hud.textContent = `${(1000 / (acc / n)).toFixed(0)} fps · last draw ${view.stats.lastDrawMs.toFixed(2)} ms · max ${view.stats.maxDrawMs.toFixed(1)} ms`;
      acc = 0;
      n = 0;
    }
    requestAnimationFrame(hudLoop);
  };
  hudLoop();
  view.fitAll(false);
  void Graph;
}
