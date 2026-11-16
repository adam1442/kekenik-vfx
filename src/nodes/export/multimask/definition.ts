import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { PACK_SOURCES, packSourceIndex } from '../../../export/pixels';
import { imageExportParams } from '../../_shared/exportparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('export_multimask.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'defv', type: 'vec4f' }, { name: 'black', type: 'vec4f' }, { name: 'white', type: 'vec4f' }, { name: 'gamma', type: 'vec4f' },
  { name: 'src0', type: 'u32' }, { name: 'src1', type: 'u32' }, { name: 'src2', type: 'u32' }, { name: 'src3', type: 'u32' },
  { name: 'inv0', type: 'u32' }, { name: 'inv1', type: 'u32' }, { name: 'inv2', type: 'u32' }, { name: 'inv3', type: 'u32' },
  { name: 'mask', type: 'u32' },
]);

const SRC_LABEL: Record<string, string> = { r: 'R', g: 'G', b: 'B', a: 'A', luma: 'Luminance', zero: 'Zero', one: 'One' };
const SRC_OPTIONS = PACK_SOURCES.map((s) => ({ value: s, label: SRC_LABEL[s] }));
const SLOTS = ['r', 'g', 'b', 'a'] as const;

/** export.multimask — channel-packed texture: any Gray / Color channel into R, G, B, A with per-channel levels and invert. */
export default defineNode({
  id: 'export.multimask',
  version: 1,
  category: 'export',
  title: 'Export Multimask',
  description: 'Packs up to four sources into the R, G, B and A channels of ONE file. Per channel: source channel (R/G/B/A/luminance/0/1), levels (black / white / gamma) and invert. Use it for ORM / RMA / mask packs; the output is the packed texture.',
  keywords: ['export', 'pack', 'channel', 'orm', 'rma', 'multimask', 'mask pack', 'rgba'],
  icon: 'cat-export',
  inputs: SLOTS.map((c) => ({ id: c, name: `${c.toUpperCase()} source`, type: 'color' as const, optional: true })),
  outputs: [{ id: 'output', name: 'Packed', type: 'color' }],
  params: [
    ...SLOTS.flatMap((c) => [
      P.enum(`${c}_source`, 'r', SRC_OPTIONS, { tab: 'Channels', group: `${c.toUpperCase()} channel`, label: 'Take channel' }),
      P.float(`${c}_default`, c === 'a' ? 1 : 0, { tab: 'Channels', group: `${c.toUpperCase()} channel`, label: 'Value when unconnected', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.01 }),
      P.float(`${c}_black`, 0, { tab: 'Channels', group: `${c.toUpperCase()} channel`, label: 'Levels black', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005 }),
      P.float(`${c}_white`, 1, { tab: 'Channels', group: `${c.toUpperCase()} channel`, label: 'Levels white', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005 }),
      P.float(`${c}_gamma`, 1, { tab: 'Channels', group: `${c.toUpperCase()} channel`, label: 'Levels gamma', min: 0.05, max: 8, softMax: 3, step: 0.01 }),
      P.bool(`${c}_invert`, false, { tab: 'Channels', group: `${c.toUpperCase()} channel`, label: 'Invert' }),
    ]),
    P.enum('slots', 'rgba', [{ value: 'rgba', label: 'RGBA (4 channels)' }, { value: 'rgb', label: 'RGB (3 channels)' }], { tab: 'Export', group: 'Output', label: 'Written channels' }),
    ...imageExportParams('multimask', { format: 'png', depth: '8', colorSpace: 'linear' }).filter((p) => p.id !== 'color_space'),
    P.enum('color_space', 'linear', [{ value: 'linear', label: 'Linear (masks)' }, { value: 'srgb', label: 'sRGB' }], { tab: 'Export', group: 'Output', label: 'Color space' }),
    P.bool('premultiply', false, { tab: 'Export', group: 'Output', label: 'Premultiplied alpha' }),
  ],
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 4 }],
  evaluate(ctx) {
    const t = SLOTS.map((c) => ctx.texInput(c));
    const p = ctx.params;
    let mask = 0;
    t.forEach((x, i) => {
      if (x) mask |= 1 << i;
    });
    const out = ctx.tex('color');
    const v4 = (f: (c: string) => number): number[] => SLOTS.map(f);
    ctx.pass({
      label: 'export multimask',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          defv: v4((c) => p.num(`${c}_default`)), black: v4((c) => p.num(`${c}_black`)), white: v4((c) => p.num(`${c}_white`)), gamma: v4((c) => p.num(`${c}_gamma`)),
          src0: packSourceIndex(p.str('r_source') as 'r'), src1: packSourceIndex(p.str('g_source') as 'r'), src2: packSourceIndex(p.str('b_source') as 'r'), src3: packSourceIndex(p.str('a_source') as 'r'),
          inv0: p.bool('r_invert'), inv1: p.bool('g_invert'), inv2: p.bool('b_invert'), inv3: p.bool('a_invert'),
          mask,
        },
      },
      textures: t.map((x) => x?.tex ?? null),
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});
