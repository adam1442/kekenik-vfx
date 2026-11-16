import { PendingAssetError, assets } from '../../../engine/io/assets';
import { modelToMesh, type ModelOptions } from '../../../engine/io/model';
import { defineNode } from '../../../engine/graph/node';
import { meshValue } from '../../../engine/mesh/accounting';
import { P } from '../../../engine/params/schema';

/**
 * import.model — GLB / glTF (embedded buffers) / OBJ → Mesh (positions, normals, UV0, vertex colour `Cd`).
 * Geometry only: no materials, skinning or animation. Axis / scale / pivot options; hard caps on file size, triangles
 * and vertices (see engine/io/model.ts, MESH_LIMITS). The parsed model is cached by the asset manager (LRU).
 */
export default defineNode({
  id: 'import.model',
  version: 1,
  category: 'import',
  title: 'Model (Import)',
  description: 'Imports a GLB, glTF or OBJ file as a Mesh. Drop the file onto the graph to create this node. Geometry only (positions, normals, UVs, vertex colours).',
  keywords: ['import', 'model', 'mesh', 'glb', 'gltf', 'obj', 'geometry', 'file'],
  icon: 'cat-import',
  inputs: [],
  outputs: [{ id: 'mesh', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  params: [
    P.asset('asset', 'model', { group: 'Source', label: 'Model', tooltip: 'Click to import a file or pick one already in the project.' }),
    P.float('scale', 1, { group: 'Transform', min: 0.0001, max: 10000, softMin: 0.01, softMax: 100, step: 0.01, tooltip: 'Uniform scale applied at import.' }),
    P.enum('axis', 'y_up_to_z_up', [{ value: 'none', label: 'As authored' }, { value: 'y_up_to_z_up', label: 'Y-up → Z-up' }, { value: 'z_up_to_y_up', label: 'Z-up → Y-up' }], { group: 'Transform', label: 'Up axis', tooltip: 'The 3D viewport and the mesh nodes are Z-up; glTF / OBJ files are usually Y-up.' }),
    P.enum('pivot', 'none', [{ value: 'none', label: 'Keep' }, { value: 'center', label: 'Bounds centre' }, { value: 'base', label: 'Base centre' }], { group: 'Transform', label: 'Pivot' }),
    P.enum('uv_flip', 'auto', [{ value: 'auto', label: 'Auto (glTF flips V)' }, { value: 'on', label: 'Flip V' }, { value: 'off', label: 'Keep V' }], { group: 'UV', label: 'UV V' }),
  ],
  cost: { gpu: 'trivial', tiling: 'global' },
  evaluate(ctx) {
    const p = ctx.params;
    const ref = p.asset('asset');
    if (!ref) throw new Error('No model yet: click "Model" in Properties, or drop a GLB / glTF / OBJ file onto the graph.');
    const m = assets.model(ref.assetId);
    if (!m) {
      const err = assets.error(ref.assetId);
      if (err) throw new Error(err);
      throw new PendingAssetError('Parsing model…');
    }
    const o: ModelOptions = { scale: p.num('scale'), axis: p.str('axis') as ModelOptions['axis'], pivot: p.str('pivot') as ModelOptions['pivot'], uvFlip: p.str('uv_flip') as ModelOptions['uvFlip'] };
    return { mesh: meshValue(modelToMesh(m, o), 'mesh') };
  },
});
