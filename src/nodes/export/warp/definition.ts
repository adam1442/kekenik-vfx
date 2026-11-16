import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { ENGINE_PRESETS, type EngineId } from '../../../export/engines';
import { uvInParam, uvModeIndex } from '../../_shared/uvparams';
import { imageExportParams } from '../../_shared/exportparams';
import { CODEC_OPTIONS, FLOW_SIGN_OPTIONS } from '../../utils/color_to_uv/definition';
import { LAYOUT, SHADER } from '../../utils/uv_to_color/definition';

/**
 * export.warp — UV distortion / flowmap export. Uses the SAME encoder as `utils.uv_to_color` (CONTRACTS §9: absolute / offset /
 * 0.5-biased / direction + speed, `flow_sign`, `range`). "Engine" decides the vertical flip (Unity = flipped). The range
 * (tile-space offset of a saturated channel) and the codec are written into the flipbook / sidecar metadata JSON.
 */
export default defineNode({
  id: 'export.warp',
  version: 1,
  category: 'export',
  title: 'Export Warp',
  description: 'Writes a UV warp / flowmap using the documented UV codecs: absolute lookup, signed offset (EXR / float), 0.5-neutral biased (8 / 16-bit flowmaps, Unreal / Unity / Godot) or direction + speed. A JSON file next to the image records the encoding and the range scale so engines can decode it exactly.',
  keywords: ['export', 'warp', 'flowmap', 'uv', 'distortion', 'flow', 'vector field', 'png', 'exr'],
  icon: 'cat-export',
  inputs: [{ id: 'input', name: 'UV', type: 'uv' }],
  outputs: [{ id: 'output', name: 'Export', type: 'color' }],
  params: [
    uvInParam(),
    P.enum('codec', 'biased', CODEC_OPTIONS, { tab: 'Export', group: 'Warp', label: 'Encoding' }),
    P.float('range', 0.1, { tab: 'Export', group: 'Warp', label: 'Range scale', min: 0.0001, max: 8, softMax: 1, step: 0.001, display: 'percent', visibleIf: (v) => v.codec === 'biased' || v.codec === 'direction', tooltip: 'Tile-space offset that maps to a fully saturated channel (neutral = 0.5). Written to the JSON.' }),
    P.enum('flow_sign', 'flow', FLOW_SIGN_OPTIONS, { tab: 'Export', group: 'Warp', label: 'Vector means', visibleIf: (v) => v.codec === 'biased' || v.codec === 'direction' }),
    P.enum('flip_y', 'engine', [{ value: 'engine', label: 'From engine preset' }, { value: 'off', label: 'Off' }, { value: 'on', label: 'Flip Y (bottom-up engines)' }], { tab: 'Export', group: 'Warp', label: 'Vertical flip' }),
    P.bool('write_json', true, { tab: 'Export', group: 'Warp', label: 'Write encoding JSON' }),
    ...imageExportParams('warp', { format: 'png', depth: '16', colorSpace: 'linear' }),
  ],
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Export Warp needs a UV input');
    const p = ctx.params;
    const fy = p.str('flip_y');
    const flip = fy === 'on' || (fy === 'engine' && ENGINE_PRESETS[p.str('engine') as EngineId].warpFlipY);
    const out = ctx.tex('color');
    ctx.pass({
      label: 'export warp',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { codec: p.enumIndex('codec'), range: p.num('range'), flip_y: flip, flow: p.str('flow_sign') === 'flow', uv_in: uvModeIndex(p.str('uv_in')) } },
      textures: [src.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});
