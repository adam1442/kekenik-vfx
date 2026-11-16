import type { GradientValue, ParamValue, SplineValue } from '../../engine/params/schema';

/* ------------------------------------------------------------------------------------------------
 * MESH RECIPES: complete node graphs built ONLY from nodes. Each recipe talks to a tiny sink interface so
 * the same code builds into a `Graph` (tests, Gallery thumbnails) and into the undoable `GraphEditor` (Gallery double-click).
 * ---------------------------------------------------------------------------------------------- */

export interface RecipeSink {
  add(type: string, x: number, y: number, params?: Record<string, ParamValue>): string;
  connect(fromNode: string, fromPin: string, toNode: string, toPin: string): void;
}
export interface RecipeResult {
  /** Node whose `output` is the finished mesh (select it: the 3D viewport shows it). */
  target: string;
  /** Texture node for the viewport material (scrolling noise / mask texture), when the recipe has one. */
  texture?: string;
}
export interface MeshRecipe {
  id: string;
  title: string;
  description: string;
  build(s: RecipeSink, x: number, y: number): RecipeResult;
}

const pt = (x: number, y: number, z: number, scale = 1, twist = 0) => ({ x, y, attrs: { z, scale, twist } });
const grad = (stops: [number, [number, number, number, number]][]): GradientValue => ({ stops: stops.map(([pos, color]) => ({ pos, color })) });

/** Energy beam: Sweep (ribbon) + Noise (looping, masked by the taper) + vertex colours (gradient + noise texture alpha). */
export const energyBeam: MeshRecipe = {
  id: 'recipe.energy_beam',
  title: 'Energy beam',
  description: 'Sweep ribbon -> looping vector Noise (masked by the end taper) -> Combine Color gradient along the length -> Combine Color (Gray noise texture via UV into alpha). The Noise texture node is the scrolling material texture.',
  build(s, x, y) {
    const spline: SplineValue = { closed: false, points: [pt(-1.6, 0, 0.1), pt(-0.6, 0.18, 0.25), pt(0.6, -0.18, 0.25), pt(1.6, 0, 0.1)] };
    const sweep = s.add('geometry.sweep', x, y, {
      spline: spline as unknown as ParamValue, profile: 'ribbon', width: 0.45, segments: 96, v_tiling: 3, up: [0, 0, 1], use_gradient: false,
      scale_curve: { keys: [{ x: 0, y: 0.05 }, { x: 0.12, y: 1 }, { x: 0.88, y: 1 }, { x: 1, y: 0.05 }] },
    });
    const noise = s.add('geometry.noise', x + 260, y, { mode: 'vector', amplitude: 0.07, frequency: 3, animate: true, loop: true, loop_cycles: 2, mask: 'attribute', mask_attr: 'pscale', seed: 5 });
    const grd = s.add('geometry.combine_color', x + 520, y, { source: 'gradient_length', length_attr: 'age', write_a: false, gradient: grad([[0, [0.1, 0.5, 1, 1]], [0.5, [0.85, 1, 1, 1]], [1, [0.1, 0.5, 1, 1]]]) });
    const tint = s.add('geometry.combine_color', x + 780, y, { source: 'texture', write_r: false, write_g: false, write_b: false, write_a: true, blend: 'multiply', gray_to_alpha: true });
    const tex = s.add('grayscale.noise', x + 520, y + 200, { seed: 7, scale: [2, 10] });
    s.connect(sweep, 'output', noise, 'input');
    s.connect(noise, 'output', grd, 'input');
    s.connect(grd, 'output', tint, 'input');
    s.connect(tex, 'output', tint, 'texture');
    return { target: tint, texture: tex };
  },
};

/** Shockwave ring: Shapes ring with polar (radial gradient) UVs -> radial vertex-colour gradient -> ripple warp -> Noise wobble. */
export const shockwaveRing: MeshRecipe = {
  id: 'recipe.shockwave_ring',
  title: 'Shockwave ring',
  description: 'Shapes ring (polar UVs: u around, v radial) -> Combine Color radial gradient (fading alpha) -> Space Warp ripple -> looping Noise wobble.',
  build(s, x, y) {
    const ring = s.add('geometry.shapes', x, y, { shape: 'ring', radius: 1.2, inner_radius: 0.8, segments: 96, rings: 8, uv_mode: 'polar' });
    const col = s.add('geometry.combine_color', x + 260, y, { source: 'gradient_radial', gradient: grad([[0, [1, 0.3, 0.05, 0]], [0.66, [1, 0.5, 0.1, 0.25]], [0.88, [1, 0.85, 0.5, 1]], [1, [1, 1, 1, 0]]]) });
    const warp = s.add('geometry.space_warp', x + 520, y, { mode: 'ripple', axis: 'z', amount: 0.06, frequency: 5, decay: 0.2 });
    const noise = s.add('geometry.noise', x + 780, y, { mode: 'axis', axis: [0, 0, 1], amplitude: 0.03, frequency: 4, animate: true, loop: true, seed: 3 });
    s.connect(ring, 'mesh', col, 'input');
    s.connect(col, 'output', warp, 'input');
    s.connect(warp, 'output', noise, 'input');
    return { target: noise };
  },
};

/** Sword swipe: Sweep ribbon along an arc, fading alpha along the length, streak mask texture written into the vertex alpha. */
export const swordSwipe: MeshRecipe = {
  id: 'recipe.sword_swipe',
  title: 'Sword swipe',
  description: 'Sweep ribbon along a 160° arc (width grows then thins) -> Combine Color: Gray streak mask via UV multiplied into the alpha. The mask texture node is the viewport material texture.',
  build(s, x, y) {
    const points = Array.from({ length: 6 }, (_, i) => {
      const a = (-60 + (i / 5) * 160) * (Math.PI / 180);
      return pt(Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0);
    });
    const sweep = s.add('geometry.sweep', x, y, {
      spline: { closed: false, points } as unknown as ParamValue, profile: 'ribbon', width: 0.9, segments: 80, up: [0, 0, 1], v_tiling: 1,
      scale_curve: { keys: [{ x: 0, y: 0 }, { x: 0.65, y: 1 }, { x: 1, y: 0.2 }] }, use_gradient: true, color_gradient: grad([[0, [1, 1, 1, 0]], [0.6, [1, 1, 1, 0.9]], [1, [1, 1, 1, 1]]]),
    });
    const mask = s.add('grayscale.noise', x, y + 200, { seed: 4, scale: [1, 12] });
    const cc = s.add('geometry.combine_color', x + 260, y, { source: 'texture', write_r: false, write_g: false, write_b: false, write_a: true, blend: 'multiply', gray_to_alpha: true });
    s.connect(sweep, 'output', cc, 'input');
    s.connect(mask, 'output', cc, 'texture');
    return { target: cc, texture: mask };
  },
};

export const MESH_RECIPES: MeshRecipe[] = [energyBeam, shockwaveRing, swordSwipe];
