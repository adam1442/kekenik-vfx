import { defineNode } from '../../../engine/graph/node';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { P } from '../../../engine/params/schema';
import { AXIS_LABELS, ENGINE_OPTIONS, type MeshAxis } from '../../../export/engines';
import { DEFAULT_TEMPLATE } from '../../../export/naming';

const AXES = [{ value: 'engine', label: 'From engine preset' }, ...(Object.keys(AXIS_LABELS) as MeshAxis[]).map((k) => ({ value: k, label: AXIS_LABELS[k] }))];
const is = (k: string, ...vals: unknown[]) => (v: Record<string, unknown>): boolean => vals.includes(v[k]);
const T = 'Export';

/** export.mesh — GLB / glTF / OBJ / PLY, mesh flipbooks, VAT (soft / rigid), pivot-baked meshes. Run it from the Export panel. */
export default defineNode({
  id: 'export.mesh',
  version: 1,
  category: 'export',
  title: 'Export Mesh',
  description: 'Exports a mesh as GLB / glTF (positions, normals, several UV sets, vertex colours, custom attributes), OBJ or PLY with axis / handedness / unit conversion. Modes: single mesh, MESH FLIPBOOK (all frames in one mesh with frame attributes), VAT soft body (position + normal textures + JSON), VAT rigid body (pivot displacement + rotation), PIVOT-baked mesh (pivot in UV sets / vertex colour / attributes).',
  keywords: ['export', 'mesh', 'glb', 'gltf', 'obj', 'ply', 'vat', 'vertex animation texture', 'pivot', 'flipbook', 'model'],
  icon: 'cat-export',
  inputs: [{ id: 'input', name: 'Mesh', type: 'mesh' }],
  outputs: [{ id: 'output', name: 'Mesh', type: 'mesh' }],
  params: [
    P.bool('enabled', true, { tab: T, group: 'Output', label: 'Include in "Export all"' }),
    P.string('file_name', DEFAULT_TEMPLATE, { tab: T, group: 'Output', label: 'File name', tooltip: 'Tokens: {graph} {node} {frame} {date} {time} {engine} {format}. VAT adds _pos / _nrm / _rot suffixes.' }),
    P.enum('mode', 'mesh', [{ value: 'mesh', label: 'Mesh (single frame)' }, { value: 'flipbook', label: 'Mesh flipbook (all frames in one mesh)' }, { value: 'vat_soft', label: 'VAT soft body' }, { value: 'vat_rigid', label: 'VAT rigid body (pieces)' }, { value: 'pivot', label: 'Pivot-baked mesh' }], { tab: T, group: 'Output' }),
    P.enum('mesh_format', 'glb', [{ value: 'glb', label: 'GLB (binary glTF)' }, { value: 'gltf', label: 'glTF + .bin' }, { value: 'obj', label: 'OBJ' }, { value: 'ply', label: 'PLY (binary)' }], { tab: T, group: 'Output', label: 'Format' }),
    P.enum('engine', 'none', ENGINE_OPTIONS, { tab: T, group: 'Output', label: 'Engine preset' }),
    P.enum('axis', 'engine', AXES, { tab: T, group: 'Coordinates', label: 'Axes / handedness', tooltip: 'Authoring space is Z up, +Y forward, right handed. Mirrored targets (Unity, Unreal) get reversed triangle winding.' }),
    P.float('unit_scale', 0, { tab: T, group: 'Coordinates', label: 'Unit scale (0 = engine default)', min: 0, max: 100000, softMax: 100, step: 0.01, tooltip: '1 authoring unit = 1 metre. Unreal default 100 (centimetres).' }),
    P.bool('normals', true, { tab: T, group: 'Attributes', label: 'Normals' }),
    P.bool('custom_attrs', true, { tab: T, group: 'Attributes', label: 'Custom attributes (pscale, age, id ...)', tooltip: 'GLB / glTF: application-specific _NAME attributes + described in extras. PLY: float properties. OBJ: not stored.' }),
    P.int('frame_start', 0, { tab: T, group: 'Frames', label: 'Frame (first frame)', min: -100000, max: 100000, visibleIf: is('mode', 'mesh', 'pivot', 'flipbook', 'vat_soft', 'vat_rigid') }),
    P.int('frame_count', 0, { tab: T, group: 'Frames', label: 'Frame count (0 = graph loop)', min: 0, max: 4096, visibleIf: is('mode', 'flipbook', 'vat_soft', 'vat_rigid') }),
    P.enum('vat_format', 'exr_half', [{ value: 'exr_half', label: 'EXR half float (raw)' }, { value: 'exr_float', label: 'EXR float (raw)' }, { value: 'png16', label: 'PNG 16-bit (normalised)' }, { value: 'png8', label: 'PNG 8-bit (normalised, coarse)' }], { tab: T, group: 'VAT', label: 'Texture format', visibleIf: is('mode', 'vat_soft', 'vat_rigid'), tooltip: 'EXR stores raw positions; PNG stores positions normalised by the bounds in the JSON.' }),
    P.bool('vat_offset', false, { tab: T, group: 'VAT', label: 'Store offset from frame 0', visibleIf: is('mode', 'vat_soft') }),
    P.bool('vat_normals', true, { tab: T, group: 'VAT', label: 'Write normal texture', visibleIf: is('mode', 'vat_soft') }),
    P.bool('vat_loop', true, { tab: T, group: 'VAT', label: 'Loops (metadata)', visibleIf: is('mode', 'vat_soft', 'vat_rigid') }),
    P.enum('pivot_mode', 'bounds', [{ value: 'centroid', label: 'Centroid' }, { value: 'bounds', label: 'Bounds centre' }, { value: 'base', label: 'Bounds base (min Z)' }, { value: 'top', label: 'Bounds top (max Z)' }], { tab: T, group: 'Pivot', label: 'Pivot position', visibleIf: is('mode', 'pivot', 'vat_rigid'), tooltip: 'Used when the mesh has no `pivot` attribute yet (otherwise the Bake node data is used).' }),
    P.enum('pivot_encoding', 'uv', [{ value: 'attributes', label: 'Attributes only' }, { value: 'uv', label: 'UV sets (xy, z + random id)' }, { value: 'vertex_color', label: 'Vertex colour (xyz + random id in A)' }], { tab: T, group: 'Pivot', label: 'Pivot encoding', visibleIf: is('mode', 'pivot') }),
  ],
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Export Mesh needs a Mesh input');
    return { output: meshValue(src.clone(), 'mesh') };
  },
});
