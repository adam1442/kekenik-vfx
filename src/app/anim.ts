/**
 * App-level animation glue: AnimationEditor per project editor, auto-key state, transport commands, the
 * "looping Noise -> Sheet Encode" sample and the loop-seam verifier command.
 */
import { AnimationEditor } from '../engine/anim/anim-editor';
import { verifyLoopSeam } from '../engine/anim/seam-gpu';
import { animatedParams } from '../engine/anim/animator';
import { channelCountOf, setTrackExtrapolation, setTrackKey } from '../engine/anim/tracks';
import { loopMatch } from '../engine/anim/keyframes';
import type { GraphEditor } from '../engine/commands/graph-commands';
import { Store } from '../shared/emitter';
import { consoleBus } from '../shared/log';
import { toast } from '../ui/core/overlay';
import type { AppServices } from './app';

import { t } from '../shared/i18n';
const editors = new WeakMap<GraphEditor, AnimationEditor>();
/** The AnimationEditor of the current project (undo-aware). */
export function animOf(app: AppServices): AnimationEditor {
  const e = app.project.editor;
  let a = editors.get(e);
  if (!a) {
    a = new AnimationEditor(e);
    editors.set(e, a);
  }
  return a;
}

/** Auto-key: edits of animatable params create keys at the playhead (session setting). */
export const autoKey = new Store(false);

let lastSeam: { text: string; verdict: string } | null = null;
export const lastSeamReport = (): typeof lastSeam => lastSeam;
export const onSeamReport = new Store<string>('');

/** Run the seam verifier on the active viewport target (or the selected node). Toasts and logs the result. */
export async function runSeamVerifier(app: AppServices, nodeId?: string): Promise<void> {
  const id = nodeId ?? app.selection.primary ?? app.active.get()?.nodeId;
  const g = app.project.graph;
  if (!id || !g.nodes.has(id)) {
    toast(t('anim.selectANodeWhose'), { type: 'warn' });
    return;
  }
  const ex = g.expandedOf(id);
  const out = ex?.outputs.find((o) => ['gray', 'color', 'normal', 'uv'].includes(o.type));
  if (!out) {
    toast(t('anim.theSelectedNodeHas'), { type: 'warn' });
    return;
  }
  const end = app.tasks.begin('Verifying loop seam');
  try {
    const r = await verifyLoopSeam(app.engine, g, { nodeId: id, pinId: out.id }, {});
    lastSeam = { text: r.message, verdict: r.verdict };
    onSeamReport.set(`${r.verdict}|${r.message}`);
    const msg = `Loop seam: ${r.message}`;
    if (r.verdict === 'clean' || r.verdict === 'static') consoleBus.info(msg, { source: 'app', nodeId: id });
    else consoleBus.warn(msg, { source: 'app', nodeId: id });
    toast(r.message, { type: r.verdict === 'clean' ? 'ok' : r.verdict === 'static' ? 'info' : 'warn', title: t('anim.loopSeam', { verdict: r.verdict }) });
  } catch (e) {
    if ((e as Error).message !== 'cancelled') toast((e as Error).message, { type: 'error', title: t('anim.seamVerifierFailed') });
  } finally {
    end();
  }
}

/** Build the acceptance recipe: Noise (evolution keyed 0 -> 1, cycling) -> Sheet Encode (16 frames). One undo step. */
export function buildLoopingNoiseSample(app: AppServices): void {
  const ed = app.project.editor;
  const anim = animOf(app);
  const g = app.project.graph;
  const L = g.settings.loopLength;
  ed.stack.transaction('Sample: looping noise flipbook', () => {
    const noise = ed.addNode('grayscale.noise', { x: 80, y: 80, params: { noise_type: 'perlin', scale: [4, 4], octaves: 3, z_cells: 2 } });
    const sheet = ed.addNode('utils.sheet_encode', { x: 420, y: 80, params: { frames: 16 } });
    ed.connect({ node: noise, pin: 'output' }, { node: sheet, pin: 'input' });
    const def = g.expandedOf(noise)!.params.find((p) => p.id === 'evolution')!;
    let tr = setTrackKey(undefined, def, 0, 0);
    tr = setTrackKey(tr, def, L, 1);
    if (tr.kind === 'num') {
      // linear ramp, then loop-match + cycle with offset: the value keeps climbing, the periodic noise lattice makes it seamless
      const ch = tr.ch.map((c) => ({ ...loopMatch({ ...c, keys: c.keys.map((k) => ({ ...k, interp: 'linear' as const })) }, undefined, true) }));
      tr = setTrackExtrapolation({ kind: 'num', ch }, 'cycle_offset');
    }
    anim.updateTrack(noise, 'evolution', tr, 'Key Evolution');
    app.selection.set([sheet]);
  });
  void channelCountOf;
  app.engine.playback.setFrame(0);
  toast(t('anim.createdNoiseEvolutionKeyed'), { type: 'ok', timeout: 6000 });
}

export function registerAnimationCommands(app: AppServices): void {
  const C = app.commands;
  const pb = (): typeof app.engine.playback => app.engine.playback;
  const reg = C.register.bind(C);
  reg({ id: 'anim.playPause', title: t('anim.playPause'), category: 'Animation', icon: 'play', keys: ['Space'], run: () => pb().toggle() });
  reg({ id: 'anim.stop', title: t('anim.stopRewind'), category: 'Animation', icon: 'pause', run: () => pb().stop() });
  reg({ id: 'anim.stepBack', title: t('anim.stepBackOneFrame'), category: 'Animation', icon: 'step-back', keys: ['Alt+ArrowLeft'], run: () => pb().step(-1) });
  reg({ id: 'anim.stepForward', title: t('anim.stepForwardOneFrame'), category: 'Animation', icon: 'step-fwd', keys: ['Alt+ArrowRight'], run: () => pb().step(1) });
  reg({ id: 'anim.goStart', title: t('anim.goToStart'), category: 'Animation', keys: ['Shift+Home'], run: () => pb().goStart() });
  reg({ id: 'anim.goEnd', title: t('anim.goToEnd'), category: 'Animation', keys: ['Shift+End'], run: () => pb().goEnd() });
  reg({
    id: 'anim.prevKey',
    title: t('anim.previousKeyframe'),
    category: 'Animation',
    keys: ['Alt+Shift+ArrowLeft'],
    run: () => void pb().jumpToKey(pb().keyFramesOf(app.selection.get() as string[]), -1),
  });
  reg({
    id: 'anim.nextKey',
    title: t('anim.nextKeyframe'),
    category: 'Animation',
    keys: ['Alt+Shift+ArrowRight'],
    run: () => void pb().jumpToKey(pb().keyFramesOf(app.selection.get() as string[]), 1),
  });
  reg({
    id: 'anim.loopMode',
    title: t('anim.cycleLoopModeOnce'),
    category: 'Animation',
    icon: 'loop',
    run: () => {
      const order = ['once', 'loop', 'pingpong'] as const;
      const cur = app.project.graph.timeline.loop;
      animOf(app).setTimeline({ loop: order[(order.indexOf(cur) + 1) % 3] }, 'Loop mode');
      pb().reanchor();
    },
  });
  reg({ id: 'anim.autoKey', title: t('anim.toggleAutoKey'), category: 'Animation', icon: 'key', keys: ['Shift+K'], run: () => autoKey.set(!autoKey.get()) });
  reg({
    id: 'anim.keySelected',
    title: t('anim.keyAnimatedParametersOf'),
    category: 'Animation',
    keys: ['K'],
    run: () => {
      const g = app.project.graph;
      const f = Math.round(pb().frame);
      const a = animOf(app);
      app.project.editor.stack.transaction('Key selected', () => {
        for (const id of app.selection.get()) for (const { def } of animatedParams(g, id)) a.setKey(id, def.id, f);
      });
    },
  });
  reg({ id: 'anim.verifyLoop', title: t('anim.verifyLoopSeamOf'), category: 'Animation', icon: 'loop', run: () => void runSeamVerifier(app) });
  reg({ id: 'anim.sampleLoopingNoise', title: t('anim.sampleLoopingNoise'), category: 'Animation', run: () => buildLoopingNoiseSample(app) });
}
