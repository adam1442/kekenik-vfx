import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { bakePivots, bakeTexture, freezeStep, getRecorder } from '../../../engine/mesh/history';
import { cpuTexOf } from '../../_shared/meshnodes';

const MODES = [
  { value: 'freeze', label: 'Freeze at time' },
  { value: 'texture', label: 'Texture -> vertex data' },
  { value: 'pivots', label: 'Pivots per island' },
  { value: 'animation', label: 'Record animation (frame buffers)' },
];
const is = (m: string) => (v: Record<string, unknown>): boolean => v.mode === m;

/** geometry.bake — freeze, bake a texture into mesh data, bake pivots, record mesh animation for flipbook / VAT. */
export default defineNode({
  id: 'geometry.bake',
  version: 1,
  category: 'geometry',
  title: 'Bake',
  description:
    'Freeze: holds the mesh the first time the playhead reaches `Freeze at` (change `Re-bake` to capture again). Texture: samples a texture at the UVs into a named vertex / point attribute. Pivots: one pivot per island written to `pivot`, `pivot_offset`, `id` (and optionally UV sets) for pivot-baked meshes. Record animation: stores the mesh of every frame slot (constant point count, memory capped and accounted in the shared budget) for the mesh flipbook / VAT exporter; the node passes the mesh through.',
  keywords: ['bake', 'freeze', 'pivot', 'vat', 'vertex animation', 'flipbook', 'attribute', 'texture', 'record', 'cache'],
  icon: 'cat-geometry',
  inputs: [{ id: 'input', name: 'Mesh', type: 'mesh' }, { id: 'texture', name: 'Texture', type: 'color', optional: true, tooltip: 'Texture to bake (Texture mode).' }],
  outputs: [{ id: 'output', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  cpuTextureInputs: ['texture'],
  timeDependent: (v) => v.mode === 'freeze' || v.mode === 'animation',
  params: [
    P.enum('mode', 'freeze', MODES, { tab: 'Bake' }),
    P.float('freeze_at', 0, { tab: 'Bake', label: 'Freeze at (s)', min: 0, max: 100000, softMax: 10, step: 0.01, visibleIf: is('freeze') }),
    P.int('rebake', 0, { tab: 'Bake', label: 'Re-bake (change to capture again)', min: 0, max: 1000000, visibleIf: (v) => v.mode === 'freeze' }),
    P.string('attribute', 'baked', { tab: 'Bake', label: 'Attribute name', visibleIf: is('texture') }),
    P.enum('channels', 'luma', [...['r', 'g', 'b', 'a', 'luma', 'rgb', 'rgba'].map((v) => ({ value: v, label: v.toUpperCase() }))], { tab: 'Bake', label: 'Channels', visibleIf: is('texture') }),
    P.enum('element', 'vertex', [{ value: 'vertex', label: 'Vertex' }, { value: 'point', label: 'Point' }], { tab: 'Bake', label: 'Write to', visibleIf: is('texture') }),
    P.int('uv_set', 0, { tab: 'Bake', label: 'UV set', min: 0, max: 7, visibleIf: is('texture') }),
    P.float('scale', 1, { tab: 'Bake', min: -1000, max: 1000, softMin: -4, softMax: 4, step: 0.01, visibleIf: is('texture') }),
    P.float('bias', 0, { tab: 'Bake', min: -1000, max: 1000, softMin: -1, softMax: 1, step: 0.01, visibleIf: is('texture') }),
    P.enum('pivot', 'bounds', [{ value: 'centroid', label: 'Centroid' }, { value: 'bounds', label: 'Bounds center' }, { value: 'base', label: 'Bounds base (min Z)' }, { value: 'top', label: 'Bounds top (max Z)' }], { tab: 'Bake', label: 'Pivot position', visibleIf: is('pivots') }),
    P.int('pivot_uv_set', -1, { tab: 'Bake', label: 'Pivot to UV set (-1 off)', min: -1, max: 6, visibleIf: is('pivots'), tooltip: 'Writes pivot x,y (normalised to the bounds) to uv<n> and pivot z + island id to uv<n+1>.' }),
    P.int('fps', 30, { tab: 'Bake', label: 'Frames per second', min: 1, max: 240, visibleIf: is('animation') }),
    P.float('max_memory_mb', 256, { tab: 'Bake', label: 'Max memory (MB)', min: 1, max: 4096, softMax: 1024, step: 1, visibleIf: is('animation'), tooltip: 'Recording stops (logged) beyond this cap.' }),
    P.bool('normals', true, { tab: 'Bake', label: 'Record normals', visibleIf: is('animation') }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Bake needs a mesh');
    const p = ctx.params;
    switch (p.str('mode')) {
      case 'freeze': {
        const r = freezeStep(ctx.node.id, `${p.int('rebake')}|${p.num('freeze_at')}`, ctx.frame.time, p.num('freeze_at'), src);
        return { output: meshValue(r.mesh.clone(), 'mesh') };
      }
      case 'texture':
        return { output: meshValue(bakeTexture(src, { texture: cpuTexOf(ctx, 'texture'), uvSet: p.int('uv_set'), attribute: p.str('attribute') || 'baked', channels: p.str('channels') as 'r', element: p.str('element') as 'vertex', scale: p.num('scale'), bias: p.num('bias') }), 'mesh') };
      case 'pivots':
        return { output: meshValue(bakePivots(src, { pivot: p.str('pivot') as 'bounds', toUvSet: p.int('pivot_uv_set') }), 'mesh') };
      default: {
        const rec = getRecorder(ctx.node.id, p.int('fps'), p.num('max_memory_mb') * 1024 * 1024, p.bool('normals'));
        const st = rec.record(Math.round(ctx.frame.time * p.int('fps')), src);
        const out = src.clone();
        out.setAttr({ name: 'bake_frames', element: 'detail', size: 1, kind: 'i32', data: Int32Array.of(rec.frameCount) });
        if (st === 'full') throw new Error(`Bake: memory cap reached after ${rec.frameCount} frames — raise “Max memory”.`);
        if (st === 'topology') throw new Error('Bake: the point count changed (VAT needs constant topology); the recorder was reset.');
        return { output: meshValue(out, 'mesh') };
      }
    }
  },
});
