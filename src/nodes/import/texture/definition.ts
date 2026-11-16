import { PendingAssetError, assets } from '../../../engine/io/assets';
import { detectGrid, rowsToHalf, type DecodedImage, type GridGuess } from '../../../engine/io/decode';
import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { dataValue } from '../../../engine/resources/values';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import type { TexturePin } from '../../../engine/types';
import shaderSrc from './convert.wgsl?raw';

/**
 * import.texture — PNG / JPG / WEBP / TGA / EXR / HDR. The file lives in the asset store (IndexedDB + embedded in
 * saved projects). Outputs: Color, Gray (luma or one channel), Alpha, Normal, UV and a Flipbook (manual or detected grid).
 * Memory safety: decoded on import with an optional DOWNSCALE (`max_size`), cached with a byte cap, uploaded in 256-row chunks.
 */
export const SHADER = defineShader('import_texture_convert.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'mode', type: 'f32' },
  { name: 'chan', type: 'f32' },
  { name: 'flip_green', type: 'f32' },
  { name: 'uv_biased', type: 'f32' },
  { name: 'uv_range', type: 'f32' },
]);

const gridCache = new WeakMap<DecodedImage, GridGuess>();
export const gridOf = (img: DecodedImage): GridGuess => {
  let g = gridCache.get(img);
  if (!g) gridCache.set(img, (g = detectGrid(img)));
  return g;
};

const CHAN = ['luma', 'r', 'g', 'b', 'a'];
export default defineNode({
  id: 'import.texture',
  version: 1,
  category: 'import',
  title: 'Texture (Import)',
  description:
    'Imports an image file (PNG, JPG, WEBP, TGA, EXR, HDR). Drop a file onto the graph to create this node. Outputs the colour, a gray channel, alpha, a decoded normal map, a UV field and a flipbook (grid detection or manual grid). Huge files can be downscaled on import.',
  keywords: ['import', 'texture', 'image', 'png', 'jpg', 'jpeg', 'webp', 'tga', 'exr', 'hdr', 'file', 'flipbook', 'sprite sheet', 'normal map'],
  icon: 'cat-import',
  inputs: [],
  outputs: [
    { id: 'output', name: 'Output', type: 'color' },
    { id: 'gray', name: 'Gray', type: 'gray' },
    { id: 'alpha', name: 'Alpha', type: 'gray' },
    { id: 'normal', name: 'Normal', type: 'normal' },
    { id: 'uv', name: 'UV', type: 'uv' },
    { id: 'flipbook', name: 'Flipbook', type: 'flipbook' },
  ],
  common: { texture: true },
  params: [
    P.asset('asset', 'image', { group: 'Source', label: 'Image', tooltip: 'Click to import a file or pick one already in the project.' }),
    P.enum('color_space', 'srgb', [{ value: 'srgb', label: 'sRGB (colour)' }, { value: 'linear', label: 'Linear (data)' }], { group: 'Source', label: 'Color space', tooltip: '8-bit files: sRGB converts to linear for colour textures; choose Linear for normal maps, masks and packed data. EXR / HDR are always linear.' }),
    P.enum('max_size', '4096', [{ value: '0', label: 'Original' }, { value: '8192', label: '8192' }, { value: '4096', label: '4096' }, { value: '2048', label: '2048' }, { value: '1024', label: '1024' }, { value: '512', label: '512' }], { group: 'Source', label: 'Downscale on import', tooltip: 'Larger images are reduced (box filter) while decoding to protect GPU memory.' }),
    P.enum('size_mode', 'native', [{ value: 'native', label: 'Native' }, { value: 'graph', label: 'Fit graph size' }], { group: 'Source', label: 'Output size', tooltip: 'Native keeps the image resolution; Fit graph size resamples to the Texture tab size (wrap-aware).' }),
    P.enum('gray_channel', 'luma', CHAN.map((c) => ({ value: c, label: c === 'luma' ? 'Luminance' : c.toUpperCase() })), { group: 'Gray output', label: 'Gray source' }),
    P.bool('flip_green', false, { group: 'Normal output', label: 'Flip green (DirectX → OpenGL)', tooltip: 'Inverts the green channel of the decoded normal map.' }),
    P.enum('uv_decode', 'absolute', [{ value: 'absolute', label: 'Absolute (RG = lookup)' }, { value: 'biased', label: 'Biased flowmap (0.5 = neutral)' }], { group: 'UV output', label: 'UV decode' }),
    P.float('uv_range', 0.1, { group: 'UV output', label: 'Flow range', min: 0, max: 4, softMax: 0.5, step: 0.005, visibleIf: (v) => v.uv_decode === 'biased' }),
    P.enum('grid_mode', 'none', [{ value: 'none', label: 'Not a flipbook' }, { value: 'manual', label: 'Manual grid' }, { value: 'auto', label: 'Detect grid' }], { group: 'Flipbook', label: 'Grid' }),
    P.int('cols', 4, { group: 'Flipbook', min: 1, max: 256, visibleIf: (v) => v.grid_mode === 'manual' }),
    P.int('rows', 4, { group: 'Flipbook', min: 1, max: 256, visibleIf: (v) => v.grid_mode === 'manual' }),
    P.int('frames', 16, { group: 'Flipbook', min: 1, max: 65536, label: 'Frame count', visibleIf: (v) => v.grid_mode === 'manual' }),
    P.float('fps', 30, { group: 'Flipbook', min: 1, max: 240, softMax: 60, label: 'Playback fps', visibleIf: (v) => v.grid_mode !== 'none' }),
  ],
  cost: { gpu: 'low', tiling: 'global' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const p = ctx.params;
    const ref = p.asset('asset');
    if (!ref) throw new Error('No image yet: click "Image" in Properties, or drop a file onto the graph.');
    const max = parseInt(p.str('max_size'), 10) || 0;
    const img = assets.image(ref.assetId, max);
    if (!img) {
      const err = assets.error(ref.assetId, max);
      if (err) throw new Error(err);
      // still decoding: the engine re-evaluates when `assets.onReady` fires (see Engine)
      throw new PendingAssetError('Decoding image…');
    }
    const maxDim = ctx.gpu.caps.limits.maxTextureDimension2D ?? 8192;
    if (img.width > maxDim || img.height > maxDim) throw new Error(`Image ${img.width}x${img.height} exceeds the GPU limit (${maxDim}). Lower "Downscale on import".`);

    // 1) upload the source in 256-row chunks (bounded temporary memory)
    const src = ctx.tex('color', img.width, img.height);
    const srgb = p.str('color_space') === 'srgb';
    const rows = 256;
    const buf = new Uint16Array(img.width * Math.min(rows, img.height) * 4);
    for (let y = 0; y < img.height; y += rows) {
      const n = Math.min(rows, img.height - y);
      rowsToHalf(img, y, y + n, srgb, buf);
      ctx.gpu.device.queue.writeTexture({ texture: src.texture, origin: { x: 0, y } }, buf.buffer as ArrayBuffer, { offset: 0, bytesPerRow: img.width * 8, rowsPerImage: n }, { width: img.width, height: n });
    }
    const native = p.str('size_mode') === 'native';
    const ow = native ? img.width : ctx.frame.width;
    const oh = native ? img.height : ctx.frame.height;
    const run = (mode: number, pin: TexturePin) => {
      const t = ctx.tex(pin, ow, oh);
      ctx.pass({
        label: `import ${pin}`,
        target: t,
        shader: SHADER,
        uniforms: { layout: LAYOUT, values: { mode, chan: Math.max(0, CHAN.indexOf(p.str('gray_channel'))), flip_green: p.bool('flip_green') ? 1 : 0, uv_biased: p.str('uv_decode') === 'biased' ? 1 : 0, uv_range: p.num('uv_range') } },
        textures: [src],
        ss: 1,
      });
      return t;
    };
    const color = run(0, 'color');
    const gm = p.str('grid_mode');
    const g = gm === 'auto' ? gridOf(img) : gm === 'manual' ? { cols: p.int('cols'), rows: p.int('rows'), frames: p.int('frames') } : { cols: 1, rows: 1, frames: 1 };
    const cols = Math.max(1, g.cols);
    const rows2 = Math.max(1, g.rows);
    const meta = { tex: color, cols, rows: rows2, frames: Math.max(1, Math.min(g.frames, cols * rows2)), fps: p.num('fps'), cellW: Math.floor(ow / cols), cellH: Math.floor(oh / rows2), padding: 0, rowOrder: 'top_down', loop: true, ready: true };
    return {
      output: ctx.result(color, 'color'),
      gray: ctx.result(run(1, 'gray'), 'gray'),
      alpha: ctx.result(run(2, 'gray'), 'gray'),
      normal: ctx.result(run(3, 'normal'), 'normal'),
      uv: ctx.result(run(4, 'uv'), 'uv'),
      flipbook: dataValue('flipbook', meta, [color]),
    };
  },
});
