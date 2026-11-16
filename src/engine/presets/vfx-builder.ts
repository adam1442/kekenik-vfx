import { Graph, type GraphData } from '../graph/graph';
import type { NodeRegistry } from '../graph/registry';
import type { ParamValue } from '../params/schema';
import type { ExposedParam, SubgraphDefData } from '../subgraph/def';
import { defTypeId } from '../subgraph/def';
import type { NodePreset } from './presets';

/**
 * VFX shared subgraph PRESETS. Built DETERMINISTICALLY through the same Graph API the editor uses (addNode / connect, fixed ids,
 * fixed timestamps) so `tests/build-presets.test.ts` can regenerate `vfx-presets.generated.json` (GEN_PRESETS=1) and verify the committed
 * file is byte-identical otherwise. Every preset embeds its subgraph definition, exposes >= 4 controls (label / group / min / max / tooltip)
 * and is spawned from the Presets panel (folder "VFX") or the node search. Samples use these by name.
 */
type Params = Record<string, ParamValue>;
interface InSpec { id: string; name: string; type: 'gray' | 'color' | 'uv' }
interface OutSpec { id: string; name: string; type: 'gray' | 'color'; from: string }
interface NodeSpec { id: string; type: string; name: string; col: number; row: number; params?: Params }
interface ExpSpec { node: string; param: string; label: string; group: string; min?: number; max?: number; tooltip?: string }
interface Spec {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputs: InSpec[];
  outputs: OutSpec[];
  nodes: NodeSpec[];
  links: [string, string][];
  exposed: ExpSpec[];
}

const STAMP = '2026-01-01T00:00:00.000Z';
const ramp = (stops: [number, number[]][], interp = 'oklab'): ParamValue => ({ interp, stops: stops.map(([pos, color]) => ({ pos, color })) }) as unknown as ParamValue;

/** Gradient defaults of the three slash colour variants + the neutral rig. */
const SLASH = {
  fire: { body: ramp([[0, [0.02, 0, 0, 0]], [0.35, [0.6, 0.06, 0.005, 0.6]], [0.7, [1, 0.4, 0.04, 1]], [1, [1, 0.8, 0.3, 1]]]), edge: ramp([[0, [0, 0, 0, 0]], [0.5, [1, 0.6, 0.1, 0.8]], [1, [1, 0.95, 0.7, 1]]]) },
  ice: { body: ramp([[0, [0, 0.03, 0.1, 0]], [0.35, [0.05, 0.3, 0.8, 0.6]], [0.7, [0.3, 0.75, 1, 1]], [1, [0.8, 0.97, 1, 1]]]), edge: ramp([[0, [0, 0, 0, 0]], [0.5, [0.5, 0.9, 1, 0.8]], [1, [1, 1, 1, 1]]]) },
  arcane: { body: ramp([[0, [0.04, 0, 0.1, 0]], [0.35, [0.35, 0.05, 0.8, 0.6]], [0.7, [0.75, 0.2, 1, 1]], [1, [1, 0.7, 1, 1]]]), edge: ramp([[0, [0, 0, 0, 0]], [0.5, [0.9, 0.4, 1, 0.8]], [1, [1, 0.95, 1, 1]]]) },
};

function slashSpec(id: string, name: string, v: keyof typeof SLASH, description: string): Spec {
  return {
    id, name, description, tags: ['slash', 'sword', 'melee', 'variant', v, 'color'],
    inputs: [{ id: 'in_mask', name: 'Mask', type: 'gray' }, { id: 'in_edge', name: 'Edge', type: 'gray' }],
    outputs: [{ id: 'out_color', name: 'Color', type: 'color', from: 'add.output' }],
    nodes: [
      { id: 'body', type: 'color.ramp', name: 'Body colour', col: 1, row: 0, params: { gradient: SLASH[v].body, intensity: 2 } },
      { id: 'edge', type: 'color.ramp', name: 'Edge colour', col: 1, row: 1, params: { gradient: SLASH[v].edge, intensity: 4 } },
      { id: 'add', type: 'utils.blend_color', name: 'Add edge', col: 2, row: 0, params: { blend_type: 'add', cross_mix: 1, opacity: 1 } },
    ],
    links: [['in_mask.output', 'body.input'], ['in_edge.output', 'edge.input'], ['edge.output', 'add.foreground'], ['body.output', 'add.background']],
    exposed: [
      { node: 'body', param: 'gradient', label: 'Body gradient', group: 'Colour', tooltip: 'Colour of the slash body over the mask (HDR stops allowed).' },
      { node: 'edge', param: 'gradient', label: 'Edge gradient', group: 'Colour', tooltip: 'Colour of the burn edge.' },
      { node: 'body', param: 'intensity', label: 'Body intensity', group: 'Colour', min: 0, max: 32, tooltip: 'HDR multiplier of the body.' },
      { node: 'edge', param: 'intensity', label: 'Edge intensity', group: 'Colour', min: 0, max: 64, tooltip: 'HDR multiplier of the edge glow.' },
    ],
  };
}

const SPECS: Spec[] = [
  {
    id: 'sg_vfx_flow_advect_loop', name: 'Flow Advect Loop',
    description: 'Advects any gray pattern along a curl-noise flow field with two-phase loop-safe blending (uv.flow). Cycles are whole numbers, so the result loops seamlessly. Use for fire, smoke and magic motion.',
    tags: ['flow', 'advect', 'loop', 'curl', 'fire', 'smoke', 'motion'],
    inputs: [{ id: 'in_pattern', name: 'Pattern', type: 'gray' }],
    outputs: [{ id: 'out_advected', name: 'Advected', type: 'gray', from: 'split.r' }],
    nodes: [
      { id: 'curl', type: 'uv.noise', name: 'Curl field', col: 1, row: 0, params: { mode: 'curl', scale: [3, 3], strength: 0.12, octaves: 2 } },
      { id: 'adv', type: 'uv.flow', name: 'Two-phase advect', col: 2, row: 0, params: { strength: 0.1, use_loop: true, cycles: 1 } },
      { id: 'split', type: 'utils.rgba_split', name: 'To gray', col: 3, row: 0 },
    ],
    links: [['curl.output', 'adv.flow'], ['in_pattern.output', 'adv.source'], ['adv.result', 'split.input']],
    exposed: [
      { node: 'adv', param: 'strength', label: 'Flow strength', group: 'Flow', min: 0, max: 0.5, tooltip: 'Distance a pixel travels per cycle.' },
      { node: 'adv', param: 'cycles', label: 'Loop cycles', group: 'Flow', min: 1, max: 8, tooltip: 'Whole advection cycles per loop (integer = seamless).' },
      { node: 'curl', param: 'scale', label: 'Curl scale', group: 'Field', min: 1, max: 32, tooltip: 'Size of the swirls.' },
      { node: 'curl', param: 'strength', label: 'Curl strength', group: 'Field', min: 0, max: 0.5, tooltip: 'Amplitude of the flow field.' },
      { node: 'curl', param: 'evolution', label: 'Field evolution', group: 'Field', min: 0, max: 8, tooltip: 'Animate 0 -> 1 per loop for a field that morphs and loops.' },
      { node: 'adv', param: 'phase_noise', label: 'Phase noise', group: 'Flow', min: 0, max: 1, tooltip: 'Per-pixel phase offset hides the cross-fade pulse.' },
      { node: 'curl', param: 'seed', label: 'Seed', group: 'Field' },
    ],
  },
  {
    id: 'sg_vfx_domain_warp', name: 'Domain Warp',
    description: 'Warps any gray pattern through a multi-octave noise vector field (domain warping): cauliflower edges, rolled smoke, organic flames. Animate Evolution 0 -> 1 for a looping warp.',
    tags: ['warp', 'domain', 'distort', 'smoke', 'fire', 'organic'],
    inputs: [{ id: 'in_pattern', name: 'Pattern', type: 'gray' }],
    outputs: [{ id: 'out_warped', name: 'Warped', type: 'gray', from: 'tr.output' }],
    nodes: [
      { id: 'warp', type: 'uv.noise', name: 'Warp field', col: 1, row: 0, params: { mode: 'vector', scale: [3, 3], strength: 0.08, octaves: 3 } },
      { id: 'tr', type: 'utils.transform', name: 'Apply warp', col: 2, row: 0, params: { edge: 'tiling' } },
    ],
    links: [['in_pattern.output', 'tr.input'], ['warp.output', 'tr.uv']],
    exposed: [
      { node: 'warp', param: 'strength', label: 'Warp strength', group: 'Warp', min: 0, max: 0.4, tooltip: 'Displacement amount (UV).' },
      { node: 'warp', param: 'scale', label: 'Warp scale', group: 'Warp', min: 1, max: 32, tooltip: 'Size of the warp features.' },
      { node: 'warp', param: 'octaves', label: 'Detail', group: 'Warp', min: 1, max: 6, tooltip: 'Warp octaves (fine wobble).' },
      { node: 'warp', param: 'evolution', label: 'Evolution', group: 'Animation', min: 0, max: 8, tooltip: 'Animate 0 -> 1 per loop for a seamless loop.' },
      { node: 'warp', param: 'seed', label: 'Seed', group: 'Animation' },
    ],
  },
  {
    id: 'sg_vfx_dissolve_over_time', name: 'Dissolve Over Time',
    description: 'Dissolve / erode with burn edge: Shape + Noise in, Mask, Edge and a coloured Burn ramp out. Animate Progress 0 -> 100% (or Reverse to grow). Per-pixel, tiling-safe.',
    tags: ['dissolve', 'erode', 'burn', 'edge', 'teleport', 'fade', 'threshold'],
    inputs: [{ id: 'in_shape', name: 'Shape', type: 'gray' }, { id: 'in_noise', name: 'Noise', type: 'gray' }],
    outputs: [{ id: 'out_mask', name: 'Mask', type: 'gray', from: 'dis.mask' }, { id: 'out_edge', name: 'Edge', type: 'gray', from: 'dis.edge' }, { id: 'out_burn', name: 'Burn', type: 'color', from: 'burn.output' }],
    nodes: [
      { id: 'dis', type: 'utils.dissolve', name: 'Dissolve', col: 1, row: 0, params: { progress: 0, softness: 0.08, edge_width: 0.12, noise_amount: 0.5 } },
      { id: 'burn', type: 'color.ramp', name: 'Burn colour', col: 2, row: 1, params: { gradient: ramp([[0, [0, 0, 0, 0]], [0.4, [1, 0.25, 0.02, 0.8]], [0.75, [1, 0.7, 0.15, 1]], [1, [1, 0.95, 0.7, 1]]]), intensity: 3 } },
    ],
    links: [['in_shape.output', 'dis.input'], ['in_noise.output', 'dis.noise'], ['dis.heat', 'burn.input']],
    exposed: [
      { node: 'dis', param: 'progress', label: 'Progress', group: 'Dissolve', min: 0, max: 1, tooltip: 'Animate 0 -> 100% to dissolve.' },
      { node: 'dis', param: 'softness', label: 'Softness', group: 'Dissolve', min: 0.001, max: 1, tooltip: 'Soft front width.' },
      { node: 'dis', param: 'edge_width', label: 'Edge width', group: 'Edge', min: 0, max: 1, tooltip: 'Burn band width.' },
      { node: 'dis', param: 'noise_amount', label: 'Noise amount', group: 'Dissolve', min: 0, max: 1, tooltip: 'How much the noise breaks the front.' },
      { node: 'dis', param: 'reverse', label: 'Reverse (grow)', group: 'Dissolve' },
      { node: 'burn', param: 'gradient', label: 'Burn gradient', group: 'Edge', tooltip: 'Colour over the heat (front = 100%).' },
      { node: 'burn', param: 'intensity', label: 'Burn intensity', group: 'Edge', min: 0, max: 32, tooltip: 'HDR multiplier of the burn colour.' },
    ],
  },
  {
    id: 'sg_vfx_fire_temperature_ramp', name: 'Fire Temperature Ramp',
    description: 'Gray temperature map -> HDR blackbody fire colour (core above 1, cool tips fade). A shape-curve control reshapes the input before the Kelvin mapping.',
    tags: ['fire', 'temperature', 'blackbody', 'hdr', 'ramp', 'flame', 'ember', 'explosion'],
    inputs: [{ id: 'in_temperature', name: 'Temperature', type: 'gray' }],
    outputs: [{ id: 'out_color', name: 'Color', type: 'color', from: 'bb.output' }],
    nodes: [
      { id: 'shape', type: 'utils.math', name: 'Shape curve', col: 1, row: 0, params: { op: 'pow', value: 1 } },
      { id: 'bb', type: 'color.blackbody', name: 'Blackbody', col: 2, row: 0, params: { kelvin_min: 1000, kelvin_max: 4200, emission_curve: 1.6, intensity: 3 } },
    ],
    links: [['in_temperature.output', 'shape.a'], ['shape.output', 'bb.input']],
    exposed: [
      { node: 'bb', param: 'kelvin_max', label: 'Hot temperature (K)', group: 'Temperature', min: 1000, max: 12000, tooltip: 'Kelvin at 100% (4200 yellow-white, 9000 blue-white).' },
      { node: 'bb', param: 'kelvin_min', label: 'Cool temperature (K)', group: 'Temperature', min: 1000, max: 6000, tooltip: 'Kelvin at 0% (1000 = deep red).' },
      { node: 'shape', param: 'value', label: 'Shape curve', group: 'Temperature', min: 0.2, max: 4, tooltip: 'Power on the input: > 1 pushes the body towards red.' },
      { node: 'bb', param: 'emission_curve', label: 'Emission curve', group: 'Emission', min: 0, max: 6, tooltip: 'Brightness = intensity * value^curve.' },
      { node: 'bb', param: 'intensity', label: 'Intensity (HDR)', group: 'Emission', min: 0, max: 32, tooltip: 'HDR multiplier; the core exceeds 1.' },
      { node: 'bb', param: 'tint', label: 'Tint', group: 'Emission', tooltip: 'Colour multiplier (green / blue fire).' },
      { node: 'bb', param: 'tonemap', label: 'Tonemap preview', group: 'Emission' },
    ],
  },
  {
    id: 'sg_vfx_soft_particle_mask', name: 'Soft Particle Mask',
    description: 'Round soft-edged sprite mask (glow dot) with an adjustable falloff curve: the base sprite of embers, motes, glows and soft particles.',
    tags: ['particle', 'sprite', 'glow', 'soft', 'dot', 'mask', 'ember'],
    inputs: [],
    outputs: [{ id: 'out_mask', name: 'Mask', type: 'gray', from: 'curve.output' }],
    nodes: [
      { id: 'disc', type: 'grayscale.shape', name: 'Disc', col: 0, row: 0, params: { shape: 'circle', size: [0.9, 0.9], softness: 1 } },
      { id: 'curve', type: 'utils.math', name: 'Falloff', col: 1, row: 0, params: { op: 'pow', value: 1.5 } },
    ],
    links: [['disc.output', 'curve.a']],
    exposed: [
      { node: 'disc', param: 'size', label: 'Size', group: 'Sprite', min: 0.05, max: 1.5, tooltip: 'Disc size relative to the image.' },
      { node: 'disc', param: 'softness', label: 'Softness', group: 'Sprite', min: 0, max: 1, tooltip: '100% = glow, 0% = hard disc.' },
      { node: 'curve', param: 'value', label: 'Falloff power', group: 'Sprite', min: 0.2, max: 6, tooltip: 'Higher = tighter core.' },
      { node: 'disc', param: 'intensity', label: 'Intensity', group: 'Sprite', min: 0, max: 4 },
    ],
  },
  {
    id: 'sg_vfx_lightning_bolt_core', name: 'Lightning Bolt Core',
    description: 'Lightning bolt with branches, strike reveal and a bloom pass. Animate Evolution for a morphing bolt, Seed (stepped) for flicker, Reveal for the strike.',
    tags: ['lightning', 'bolt', 'arc', 'electric', 'flicker', 'strike'],
    inputs: [],
    outputs: [{ id: 'out_bolt', name: 'Bolt', type: 'gray', from: 'glow.output' }],
    nodes: [
      { id: 'bolt', type: 'grayscale.lightning', name: 'Bolt', col: 0, row: 0, params: { branches: 3, jag: 0.09, glow: 0.35 } },
      { id: 'glow', type: 'utils.glow', name: 'Bloom', col: 1, row: 0, params: { threshold: 0.4, intensity: 0.6, radius: 0.05 } },
    ],
    links: [['bolt.output', 'glow.input']],
    exposed: [
      { node: 'bolt', param: 'jag', label: 'Jaggedness', group: 'Bolt', min: 0, max: 0.4, tooltip: 'Zig-zag amount.' },
      { node: 'bolt', param: 'width', label: 'Core width', group: 'Bolt', min: 0.001, max: 0.08 },
      { node: 'bolt', param: 'branches', label: 'Branches', group: 'Bolt', min: 0, max: 6 },
      { node: 'bolt', param: 'reveal', label: 'Strike reveal', group: 'Animation', min: 0, max: 1, tooltip: 'Animate 0 -> 100% for the strike.' },
      { node: 'bolt', param: 'evolution', label: 'Evolution', group: 'Animation', min: 0, max: 16, tooltip: 'Integer values return to a fresh shape.' },
      { node: 'bolt', param: 'seed', label: 'Seed', group: 'Animation', tooltip: 'Animate stepped for flicker.' },
      { node: 'glow', param: 'intensity', label: 'Bloom', group: 'Glow', min: 0, max: 4 },
    ],
  },
  {
    id: 'sg_vfx_rune_ring', name: 'Rune Ring',
    description: 'Procedural rune ring with border circles and bloom, ready for magic circles. Animate Rotation (360 per loop) and Reveal (build-up).',
    tags: ['rune', 'magic circle', 'glyph', 'ring', 'spell', 'sigil', 'build-up'],
    inputs: [],
    outputs: [{ id: 'out_runes', name: 'Runes', type: 'gray', from: 'glow.output' }],
    nodes: [
      { id: 'runes', type: 'grayscale.rune_ring', name: 'Runes', col: 0, row: 0, params: { count: 24 } },
      { id: 'glow', type: 'utils.glow', name: 'Bloom', col: 1, row: 0, params: { threshold: 0.3, intensity: 0.5, radius: 0.04 } },
    ],
    links: [['runes.output', 'glow.input']],
    exposed: [
      { node: 'runes', param: 'count', label: 'Rune count', group: 'Ring', min: 3, max: 96 },
      { node: 'runes', param: 'radius', label: 'Ring radius', group: 'Ring', min: 0.05, max: 0.6 },
      { node: 'runes', param: 'glyph_height', label: 'Glyph size', group: 'Ring', min: 0.02, max: 0.3 },
      { node: 'runes', param: 'rotation', label: 'Rotation', group: 'Animation', tooltip: 'Animate 0 -> 360 per loop.' },
      { node: 'runes', param: 'reveal', label: 'Reveal', group: 'Animation', min: 0, max: 1, tooltip: 'Build-up: animate 0 -> 100%.' },
      { node: 'runes', param: 'stroke', label: 'Stroke', group: 'Look', min: 0.001, max: 0.05 },
      { node: 'runes', param: 'seed', label: 'Seed', group: 'Look' },
      { node: 'glow', param: 'intensity', label: 'Bloom', group: 'Look', min: 0, max: 4 },
    ],
  },
  {
    id: 'sg_vfx_smoke_puff_body', name: 'Smoke Puff Body',
    description: 'Billowy smoke / fireball body: warped billow noise multiplied by a soft round envelope and soft-thresholded into rolled edges. Animate Evolution for the roll, Size for the expansion.',
    tags: ['smoke', 'puff', 'billow', 'cloud', 'explosion', 'fireball', 'dust'],
    inputs: [],
    outputs: [{ id: 'out_body', name: 'Body', type: 'gray', from: 'soft.output' }],
    nodes: [
      { id: 'warp', type: 'uv.noise', name: 'Warp', col: 0, row: 1, params: { mode: 'curl', scale: [3, 3], strength: 0.07, octaves: 2 } },
      { id: 'noise', type: 'grayscale.noise', name: 'Billow', col: 1, row: 1, params: { noise_type: 'billow', scale: [4, 4], octaves: 5, roughness: 0.55 } },
      { id: 'env', type: 'grayscale.shape', name: 'Envelope', col: 1, row: 0, params: { shape: 'circle', size: [0.7, 0.7], softness: 0.8 } },
      { id: 'mul', type: 'utils.blend', name: 'Envelope x noise', col: 2, row: 0, params: { blend_type: 'multiply', cross_mix: 1, opacity: 1 } },
      { id: 'soft', type: 'utils.math', name: 'Soft threshold', col: 3, row: 0, params: { op: 'smoothstep', value: 0.18, value2: 0.35, clamp_out: true } },
    ],
    links: [['warp.output', 'noise.uv'], ['noise.output', 'mul.foreground'], ['env.output', 'mul.background'], ['mul.output', 'soft.a']],
    exposed: [
      { node: 'env', param: 'size', label: 'Puff size', group: 'Shape', min: 0.05, max: 1.4, tooltip: 'Animate for the expansion (scale over life).' },
      { node: 'env', param: 'softness', label: 'Envelope softness', group: 'Shape', min: 0, max: 1 },
      { node: 'noise', param: 'scale', label: 'Billow scale', group: 'Detail', min: 1, max: 16 },
      { node: 'noise', param: 'evolution', label: 'Evolution', group: 'Animation', min: 0, max: 8, tooltip: 'Animate 0 -> 1 per loop (seamless).' },
      { node: 'warp', param: 'strength', label: 'Warp strength', group: 'Detail', min: 0, max: 0.3 },
      { node: 'soft', param: 'value', label: 'Threshold', group: 'Edge', min: 0, max: 1, tooltip: 'Where the puff edge starts.' },
      { node: 'soft', param: 'value2', label: 'Edge softness', group: 'Edge', min: 0.01, max: 1 },
      { node: 'noise', param: 'seed', label: 'Seed', group: 'Detail' },
    ],
  },
  slashSpec('sg_vfx_slash_color_rig', 'Slash Color Rig', 'fire', 'Colour rig for slashes and swipes: Mask + Edge in, HDR colour out through two editable gradients. The three variants below are this rig with Fire / Ice / Arcane gradients.'),
  slashSpec('sg_vfx_slash_fire', 'Slash Color - Fire', 'fire', 'Fire variant of the Slash Color Rig (orange body, white-yellow edge).'),
  slashSpec('sg_vfx_slash_ice', 'Slash Color - Ice', 'ice', 'Ice variant of the Slash Color Rig (blue body, white edge).'),
  slashSpec('sg_vfx_slash_arcane', 'Slash Color - Arcane', 'arcane', 'Arcane variant of the Slash Color Rig (violet body, pink-white edge).'),
];

type PresetOut = Omit<NodePreset, 'created' | 'builtin' | 'id'>;

/** Builds every VFX preset through the Graph API. Pure + deterministic (no random ids, no clock). */
export function buildVfxPresets(registry: NodeRegistry): PresetOut[] {
  return SPECS.map((s) => {
    const g = new Graph(registry);
    s.inputs.forEach((i, k) => g.addNode(`subgraph.in_${i.type}`, { id: i.id, x: 0, y: k * 190, name: i.name, params: { name: i.name, order: k } }));
    s.nodes.forEach((n) => g.addNode(n.type, { id: n.id, x: 320 + n.col * 280, y: n.row * 190, name: n.name, params: (n.params ?? {}) as never }));
    s.outputs.forEach((o, k) => g.addNode(`subgraph.out_${o.type}`, { id: o.id, x: 320 + 4 * 280, y: k * 190, name: o.name, params: { name: o.name, order: k } }));
    const ref = (r: string): { node: string; pin: string } => {
      const [node, pin = 'output'] = r.split('.');
      return { node, pin };
    };
    let ln = 0; // deterministic link ids (the editor would use random ones)
    for (const [a, b] of s.links) g.connect(ref(a), ref(b), `l${++ln}`);
    for (const o of s.outputs) g.connect(ref(o.from), { node: o.id, pin: 'input' }, `l${++ln}`);
    const graph: GraphData = g.toData();
    const exposed: ExposedParam[] = s.exposed.map((e, k) => {
      const node = graph.nodes.find((n) => n.id === e.node);
      if (!node) throw new Error(`${s.id}: exposed node ${e.node} missing`);
      const pd = registry.expanded(node.type)?.params.find((p) => p.id === e.param);
      if (!pd) throw new Error(`${s.id}: ${node.type} has no param ${e.param}`);
      const x: ExposedParam = { id: `p${k + 1}`, node: e.node, param: e.param, label: e.label, group: e.group, default: (node.params[e.param] ?? (pd as { default?: ParamValue }).default) as ParamValue };
      if (e.min !== undefined) x.min = e.min;
      if (e.max !== undefined) x.max = e.max;
      if (e.tooltip) x.tooltip = e.tooltip;
      return x;
    });
    const def: SubgraphDefData = { format: 'kekenik-subgraph', id: s.id, name: s.name, description: s.description, tags: s.tags, folder: 'VFX', version: 1, created: STAMP, modified: STAMP, graph, exposed };
    return { name: s.name, folder: 'VFX', tags: ['vfx', 'subgraph', ...s.tags], nodeType: defTypeId(s.id), typeVersion: 1, params: {}, subgraph: def };
  });
}
