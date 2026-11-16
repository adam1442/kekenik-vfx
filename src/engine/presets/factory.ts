import type { NodePreset } from './presets';

/** Built-in factory presets: noises, masks, gradients, ramps. Every entry must spawn on the real registry (tests/presets.test.ts). */
type F = Omit<NodePreset, 'created' | 'builtin' | 'id'>;
const f = (folder: string, name: string, nodeType: string, params: Record<string, unknown>, tags: string[] = []): F => ({ folder, name, nodeType, typeVersion: 1, params: params as F['params'], tags });
const ramp = (stops: [number, number[]][], interp = 'oklab'): { gradient: unknown } => ({ gradient: { interp, stops: stops.map(([pos, color]) => ({ pos, color })) } });

export const FACTORY_PRESETS: F[] = [
  /* ---- Noises ---- */
  f('Noises', 'Soft Clouds', 'grayscale.noise', { noise_type: 'perlin', scale: [3, 3], octaves: 5, roughness: 0.55 }, ['cloud', 'smoke', 'tiling']),
  f('Noises', 'Billowy Puffs', 'grayscale.noise', { noise_type: 'billow', scale: [4, 4], octaves: 4 }, ['cloud', 'puff']),
  f('Noises', 'Ridged Mountains', 'grayscale.noise', { noise_type: 'ridged', scale: [4, 4], octaves: 6, roughness: 0.5 }, ['terrain', 'lightning', 'energy']),
  f('Noises', 'Fine Grain', 'grayscale.noise', { noise_type: 'value', scale: [64, 64], octaves: 1 }, ['grain', 'dust']),
  f('Noises', 'Cellular Cells', 'grayscale.noise', { noise_type: 'worley_f1', scale: [6, 6] }, ['cells', 'voronoi', 'water']),
  f('Noises', 'Cracks', 'grayscale.noise', { noise_type: 'cracks', scale: [5, 5], edge_width: 0.06 }, ['cracks', 'lava', 'ground']),
  f('Noises', 'Voronoi Tiles', 'grayscale.noise', { noise_type: 'voronoi', scale: [5, 5] }, ['tiles', 'cells']),
  f('Noises', 'Stretched Streaks', 'grayscale.noise', { noise_type: 'perlin', scale: [1, 12], octaves: 4 }, ['streak', 'beam', 'swipe', 'wind']),
  f('Noises', 'Gabor Fibers', 'grayscale.noise', { noise_type: 'gabor', scale: [8, 8] }, ['fibers', 'wood']),
  /* ---- Masks ---- */
  f('Masks', 'Soft Glow Circle', 'grayscale.shape', { shape: 'circle', size: [0.8, 0.8], softness: 1 }, ['glow', 'orb', 'sprite']),
  f('Masks', 'Hard Circle', 'grayscale.shape', { shape: 'circle', size: [0.7, 0.7], softness: 0.02 }, ['disc', 'dot']),
  f('Masks', 'Ring', 'grayscale.shape', { shape: 'ring', size: [0.85, 0.85], thickness: 0.15, softness: 0.12 }, ['shockwave', 'ring']),
  f('Masks', 'Four-point Star', 'grayscale.shape', { shape: 'star', sides: 4, pinch: 0.12, size: [0.9, 0.9], softness: 0.25 }, ['flare', 'sparkle']),
  f('Masks', 'Five-point Star', 'grayscale.shape', { shape: 'star', sides: 5, size: [0.8, 0.8] }, ['star']),
  f('Masks', 'Heart', 'grayscale.shape', { shape: 'heart', size: [0.7, 0.7], softness: 0.05 }, ['heart']),
  f('Masks', 'Lightning Bolt', 'grayscale.shape', { shape: 'bolt', size: [0.6, 0.8] }, ['bolt', 'electric']),
  f('Masks', 'Hexagon Grid', 'utils.grid', { pattern: 'hex', cells: [6, 6], line_width: 0.06 }, ['hex', 'shield', 'honeycomb']),
  f('Masks', 'Brick Grid', 'utils.grid', { pattern: 'bricks', cells: [6, 12], line_width: 0.08 }, ['bricks', 'wall']),
  f('Masks', 'Ring of Dots', 'grayscale.polar_scatter', { ring_count: 2, count: 16, shape: 'circle', size: 0.04 }, ['circle', 'magic', 'radial']),
  f('Masks', 'Ring of Stars', 'grayscale.polar_scatter', { ring_count: 1, count: 12, shape: 'star', size: 0.07, radius_min: 0.35, radius_max: 0.35 }, ['magic', 'rune']),
  /* ---- Gradients ---- */
  f('Gradients', 'Linear Horizontal', 'grayscale.gradient', { gtype: 'linear', start: [0, 0.5], end: [1, 0.5] }, ['linear']),
  f('Gradients', 'Linear Vertical', 'grayscale.gradient', { gtype: 'linear', start: [0.5, 0], end: [0.5, 1] }, ['linear', 'fade']),
  f('Gradients', 'Radial Falloff', 'grayscale.gradient', { gtype: 'radial', center: [0.5, 0.5], radius: 0.5 }, ['radial', 'sphere']),
  f('Gradients', 'Angular Sweep', 'grayscale.gradient', { gtype: 'angular' }, ['angular', 'sweep']),
  f('Gradients', 'Diamond', 'grayscale.gradient', { gtype: 'diamond' }, ['diamond']),
  f('Gradients', 'Spiral', 'grayscale.gradient', { gtype: 'spiral', turns: 3 }, ['spiral', 'vortex']),
  /* ---- Ramps ---- */
  f('Ramps', 'Fire', 'color.ramp', ramp([[0, [0, 0, 0, 1]], [0.25, [0.12, 0.005, 0, 1]], [0.55, [1, 0.16, 0.004, 1]], [0.8, [1, 0.65, 0.05, 1]], [1, [1, 0.95, 0.6, 1]]]), ['fire', 'flame', 'explosion']),
  f('Ramps', 'Ice', 'color.ramp', ramp([[0, [0.01, 0.03, 0.09, 1]], [0.4, [0.08, 0.35, 0.8, 1]], [0.75, [0.5, 0.9, 1, 1]], [1, [1, 1, 1, 1]]]), ['ice', 'frost', 'cold']),
  f('Ramps', 'Toxic Green', 'color.ramp', ramp([[0, [0, 0.02, 0, 1]], [0.5, [0.1, 0.7, 0.05, 1]], [1, [0.85, 1, 0.3, 1]]]), ['toxic', 'poison', 'acid']),
  f('Ramps', 'Plasma Purple', 'color.ramp', ramp([[0, [0.02, 0, 0.06, 1]], [0.45, [0.5, 0.05, 0.9, 1]], [0.8, [1, 0.35, 0.95, 1]], [1, [1, 0.9, 1, 1]]]), ['magic', 'plasma', 'arcane']),
  f('Ramps', 'Electric Blue', 'color.ramp', ramp([[0, [0, 0, 0, 1]], [0.3, [0.05, 0.1, 0.6, 1]], [0.65, [0.3, 0.6, 1, 1]], [1, [0.95, 0.98, 1, 1]]]), ['lightning', 'energy', 'electric']),
  f('Ramps', 'Smoke (alpha)', 'color.ramp', ramp([[0, [0.1, 0.1, 0.12, 0]], [0.4, [0.25, 0.25, 0.28, 0.6]], [1, [0.85, 0.85, 0.88, 1]]]), ['smoke', 'alpha', 'steam']),
  f('Ramps', 'Gold', 'color.ramp', ramp([[0, [0.1, 0.04, 0, 1]], [0.5, [0.9, 0.55, 0.05, 1]], [1, [1, 0.95, 0.6, 1]]]), ['gold', 'treasure']),
];
