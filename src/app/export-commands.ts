/**
 * App-level export glue: commands (palette) + the acceptance sample recipes (textures: looping flipbook as PNG 16 /
 * EXR, channel pack, normal DirectX / OpenGL, UV warp; meshes: GLB beam, VAT, turntable).
 */
import { setTrackExtrapolation, setTrackKey } from '../engine/anim/tracks';
import { loopMatch } from '../engine/anim/keyframes';
import type { ParamValue } from '../engine/params/schema';
import { toast } from '../ui/core/overlay';
import { animOf } from './anim';
import type { AppServices } from './app';

import { t } from '../shared/i18n';
function keyEvolution(app: AppServices, noise: string): void {
  const g = app.project.graph;
  const L = g.settings.loopLength;
  const def = g.expandedOf(noise)!.params.find((p) => p.id === 'evolution')!;
  let tr = setTrackKey(undefined, def, 0, 0);
  tr = setTrackKey(tr, def, L, 1);
  if (tr.kind === 'num') {
    const ch = tr.ch.map((c) => ({ ...loopMatch({ ...c, keys: c.keys.map((k) => ({ ...k, interp: 'linear' as const })) }, undefined, true) }));
    tr = setTrackExtrapolation({ kind: 'num', ch }, 'cycle_offset');
  }
  animOf(app).updateTrack(noise, 'evolution', tr, 'Key Evolution');
}

export function buildExportTextureSample(app: AppServices): void {
  const ed = app.project.editor;
  ed.stack.transaction('Sample: export textures', () => {
    const noise = ed.addNode('grayscale.noise', { x: 40, y: 40, params: { noise_type: 'perlin', scale: [4, 4], octaves: 3, z_cells: 2 } });
    keyEvolution(app, noise);
    const png16 = ed.addNode('export.color', { x: 420, y: 0, name: 'Flipbook PNG16', params: { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4, size_mode: 'absolute', size_abs: [2048, 2048], format: 'png', depth: '16', engine: 'unreal' } });
    const exr = ed.addNode('export.color', { x: 420, y: 150, name: 'Flipbook EXR', params: { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4, size_mode: 'absolute', size_abs: [2048, 2048], format: 'exr', depth: 'half' } });
    ed.connect({ node: noise, pin: 'output' }, { node: png16, pin: 'input' });
    ed.connect({ node: noise, pin: 'output' }, { node: exr, pin: 'input' });
    const nB = ed.addNode('grayscale.noise', { x: 40, y: 330, params: { noise_type: 'perlin', scale: [8, 8], octaves: 2, seed: 7 } });
    const grad = ed.addNode('grayscale.gradient', { x: 40, y: 480 });
    const pack = ed.addNode('export.multimask', { x: 420, y: 330, name: 'Packed RGB mask', params: { engine: 'unreal', format: 'png', depth: '8', slots: 'rgb' } });
    ed.connect({ node: nB, pin: 'output' }, { node: pack, pin: 'r' });
    ed.connect({ node: grad, pin: 'output' }, { node: pack, pin: 'g' });
    ed.connect({ node: nB, pin: 'output' }, { node: pack, pin: 'b' });
    const nrmSrc = ed.addNode('grayscale.noise', { x: 40, y: 640, params: { noise_type: 'perlin', scale: [6, 6], octaves: 4 } });
    const nrm = ed.addNode('normal.create', { x: 260, y: 640 });
    const dx = ed.addNode('export.normal', { x: 560, y: 600, name: 'Normal DirectX', params: { convention: 'directx', format: 'png', depth: '16' } });
    const gl = ed.addNode('export.normal', { x: 560, y: 760, name: 'Normal OpenGL', params: { convention: 'opengl', format: 'png', depth: '16' } });
    ed.connect({ node: nrmSrc, pin: 'output' }, { node: nrm, pin: 'input' });
    ed.connect({ node: nrm, pin: 'output' }, { node: dx, pin: 'input' });
    ed.connect({ node: nrm, pin: 'output' }, { node: gl, pin: 'input' });
    const uvn = ed.addNode('uv.noise', { x: 40, y: 920 });
    const warp = ed.addNode('export.warp', { x: 420, y: 920, name: 'Flowmap', params: { codec: 'biased', format: 'png', depth: '16' } });
    ed.connect({ node: uvn, pin: 'output' }, { node: warp, pin: 'input' });
    app.selection.set([png16]);
  });
  void app.dock.openPanel('export');
  toast(t('exportCommands.created6ExportNodes'), { type: 'ok', timeout: 7000 });
}

export function buildExportMeshSample(app: AppServices): void {
  const ed = app.project.editor;
  const reg = app.engine.registry;
  const beam = (reg.expanded('geometry.sweep')?.def.gallery ?? []).find((v) => /beam/i.test(v.name))?.params ?? {};
  ed.stack.transaction('Sample: export meshes', () => {
    const sweep = ed.addNode('geometry.sweep', { x: 40, y: 40, params: beam as Record<string, ParamValue> });
    const glb = ed.addNode('export.mesh', { x: 600, y: 0, name: 'Beam GLB', params: { mode: 'mesh', mesh_format: 'glb', engine: 'unreal' } });
    ed.connect({ node: sweep, pin: 'output' }, { node: glb, pin: 'input' });
    const noise = ed.addNode('geometry.noise', { x: 330, y: 200, params: { animate: true, loop: true, amplitude: 0.25 } });
    ed.connect({ node: sweep, pin: 'output' }, { node: noise, pin: 'input' });
    const vat = ed.addNode('export.mesh', { x: 600, y: 200, name: 'Beam VAT', params: { mode: 'vat_soft', mesh_format: 'glb', vat_format: 'exr_half', frame_count: 32 } });
    ed.connect({ node: noise, pin: 'output' }, { node: vat, pin: 'input' });
    const cam = ed.addNode('camera.camera', { x: 330, y: 420 });
    const tt = ed.addNode('export.viewport', { x: 600, y: 420, name: 'Turntable', params: { source: '3d', frame_mode: 'turntable', frame_count: 48, size: [1280, 720], ss: '2', display: 'matcap' } });
    ed.connect({ node: noise, pin: 'output' }, { node: tt, pin: 'mesh' });
    ed.connect({ node: cam, pin: 'camera' }, { node: tt, pin: 'camera' });
    app.selection.set([glb]);
  });
  void app.dock.openPanel('export');
  toast(t('exportCommands.createdBeamGlbBeam'), { type: 'ok', timeout: 7000 });
}

export function registerExportCommands(app: AppServices): void {
  const reg = app.commands.register.bind(app.commands);
  reg({ id: 'export.panel', title: t('exportCommands.openExportPanel'), category: 'Export', icon: 'panel-export', run: () => void app.dock.openPanel('export') });
  reg({ id: 'export.sampleTextures', title: t('exportCommands.sampleExportTexturesFlipbook'), category: 'Export', run: () => buildExportTextureSample(app) });
  reg({ id: 'export.sampleMeshes', title: t('exportCommands.sampleExportMeshesGlb'), category: 'Export', run: () => buildExportMeshSample(app) });
}
