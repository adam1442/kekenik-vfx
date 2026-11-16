import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.multi_switch — select among up to 8 inputs by an ANIMATABLE index. `Wrap` makes the index loop around the first
 * `Inputs` entries (index = count behaves like 0), so a keyframed ramp 0 -> count loops seamlessly. Modes: Step (floor),
 * Nearest (round), Crossfade (linear mix between floor and ceil, wrapped when looping). Unconnected selections give black.
 */
export const MAX_INPUTS = 8;
export const SHADER = defineShader('utils_multi_switch.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'a', type: 'i32' },
  { name: 'b', type: 'i32' },
  { name: 'mix_t', type: 'f32' },
  { name: 'connected', type: 'u32' },
]);

/** Index math (pure, tested): returns the two input indices and the mix amount. */
export function switchIndices(index: number, count: number, mode: 'step' | 'nearest' | 'crossfade', wrap: boolean): { a: number; b: number; t: number } {
  const n = Math.max(1, Math.min(MAX_INPUTS, Math.round(count)));
  const fix = (i: number): number => (wrap ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1));
  if (mode === 'crossfade') {
    const fl = Math.floor(index);
    const t = index - fl;
    return { a: fix(fl), b: fix(fl + 1), t };
  }
  const i = mode === 'nearest' ? Math.round(index) : Math.floor(index);
  return { a: fix(i), b: fix(i), t: 0 };
}

export default variants((k) =>
  defineNode({
    id: idOf('utils.multi_switch', k),
    version: 1,
    category: 'utils',
    title: titleOf('Multi Switch', k),
    description: 'Selects one of up to 8 inputs by an animatable index (step, nearest or crossfade; loop friendly).',
    keywords: ['switch', 'select', 'choose', 'sequence', 'flipbook', 'animate inputs', 'multiplexer'],
    icon: 'switch',
    inputs: Array.from({ length: MAX_INPUTS }, (_, i) => ({ id: `input_${i + 1}`, name: `Input ${i + 1}`, type: pinOf(k), optional: true })),
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('index', 0, { group: 'Switch', min: -1024, max: 1024, softMin: 0, softMax: 8, step: 0.01, animatable: true, tooltip: '0 selects Input 1. Fractions matter in Crossfade mode.' }),
      P.int('count', 2, { group: 'Switch', label: 'Inputs', min: 1, max: MAX_INPUTS, tooltip: 'How many inputs take part (also the loop length when Wrap is on).' }),
      P.enum('mode', 'step', [{ value: 'step', label: 'Step' }, { value: 'nearest', label: 'Nearest' }, { value: 'crossfade', label: 'Crossfade' }], { group: 'Switch' }),
      P.bool('wrap', true, { group: 'Switch', label: 'Wrap (loop)', tooltip: 'Index wraps around the active inputs; otherwise it is clamped.' }),
    ],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: MAX_INPUTS }],
    gallery: [{ name: 'Crossfade', params: { mode: 'crossfade', index: 0.5 } }],
    evaluate(ctx) {
      const p = ctx.params;
      const texs = Array.from({ length: MAX_INPUTS }, (_, i) => ctx.texInput(`input_${i + 1}`));
      let connected = 0;
      texs.forEach((t, i) => {
        if (t) connected |= 1 << i;
      });
      if (!connected) throw new Error('Multi Switch needs at least one connected input');
      const { a, b, t } = switchIndices(p.num('index'), p.int('count'), p.str('mode') as 'step', p.bool('wrap'));
      const out = ctx.tex(pinOf(k));
      ctx.pass({ label: 'multi switch', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { a, b, mix_t: t, connected } }, textures: texs.map((x) => x?.tex ?? null), ss: 1 });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);
