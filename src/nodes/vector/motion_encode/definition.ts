import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** Engine conventions (see docs/EXPORT_GUIDE.md): the starting values; verify them in your engine. */
export const MOTION_CONVENTIONS = { unreal: { flipY: true }, unity: { flipY: false }, godot: { flipY: false }, custom: { flipY: false } } as const;

/** vector.motion_encode: pack vectors into an engine-friendly RG texture (0.5 neutral or signed float) and back. */
export default shaderNode({
  id: 'vector.motion_encode',
  title: 'Motion Vector Encode / Decode',
  description: 'Packs a Vector (sheet) into an RG Color texture for engines: 0.5-neutral or signed encoding, scale, Y convention (Unreal / Unity / Godot / custom), 8 / 16-bit quantisation. The same flipbook layout as the colour flipbook. Decode reverses it.',
  keywords: ['motion', 'vector', 'encode', 'decode', 'unreal', 'unity', 'godot', 'flipbook', 'pack', 'rg', 'engine'],
  inputs: [{ id: 'vector', name: 'Vector', type: 'vector' }, { id: 'encoded', name: 'Encoded', type: 'color' }],
  outputs: [{ id: 'output', name: 'Encoded', type: 'color' }, { id: 'decoded', name: 'Decoded', type: 'vector' }],
  vecScale: 1,
  params: [
    P.float('scale', 0.1, { group: 'Encoding', label: 'Scale', min: 0.0001, max: 100, softMax: 1, step: 0.001, precision: 4, tooltip: 'Vector length (tile fractions per frame) that maps to the full range. Motion Vector Generate: max displacement / cell size.' }),
    P.enum('convention', 'unreal', [{ value: 'unreal', label: 'Unreal' }, { value: 'unity', label: 'Unity' }, { value: 'godot', label: 'Godot' }, { value: 'custom', label: 'Custom' }], { group: 'Encoding', label: 'Engine convention' }),
    P.bool('flip_y', false, { group: 'Encoding', label: 'Flip Y (custom)', visibleIf: (v) => v.convention === 'custom', tooltip: 'Negate the Y component (positive Y up instead of down).' }),
    P.bool('signed_out', false, { group: 'Encoding', label: 'Signed float (no 0.5 bias)', tooltip: 'Store v / scale directly (EXR / float textures).' }),
    P.enum('depth', 'bits16', [{ value: 'bits8', label: '8-bit' }, { value: 'bits16', label: '16-bit' }, { value: 'float', label: 'Float' }], { group: 'Encoding', label: 'Precision' }),
  ],
  extraFields: [{ name: 'flip', type: 'u32' }],
  extra: (ctx) => {
    const conv = ctx.params.str('convention') as keyof typeof MOTION_CONVENTIONS;
    return { flip: (conv === 'custom' ? ctx.params.bool('flip_y') : MOTION_CONVENTIONS[conv]?.flipY) ? 1 : 0 };
  },
  gallery: [{ name: 'Unreal 16-bit', params: { convention: 'unreal', depth: 'bits16' } }, { name: 'Unity 8-bit', params: { convention: 'unity', depth: 'bits8' } }],
  shader: src,
});
