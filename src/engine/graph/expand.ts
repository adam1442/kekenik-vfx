import { gizmoParamRefs } from './gizmo-decl';
import { P, type ParamDef } from '../params/schema';
import { isTexturePin, type TexturePin } from '../types';
import { BLENDING_TAB, COMMON_PARAM_IDS, commonBlendingParams, commonTextureParams } from './common-params';
import type { NodeDefinition } from './node';
import type { PinDef } from './pins';

/**
 * The runtime view of a definition: declared pins/params PLUS everything the engine adds automatically:
 *   - Background input pin (when `common.blending`),
 *   - `<param>_mod` Gray input pins + `<param>_mod_k` intensity params (for `modulatable` float params),
 *   - Texture and Blending tab params.
 * UI, graph validation, evaluation and serialization all use the expanded form.
 */
export interface ExpandedNode {
  def: NodeDefinition;
  inputs: PinDef[];
  outputs: PinDef[];
  params: ParamDef[];
  tabs: string[];
  hasTextureTab: boolean;
  hasBlending: boolean;
  /** Type of the first texture output (the one the Background blend applies to). */
  primaryTexture?: { pinId: string; type: TexturePin };
}

export function expandDefinition(def: NodeDefinition): ExpandedNode {
  const primary = def.outputs.find((o) => isTexturePin(o.type));
  const hasTextureTab = def.common?.texture ?? !!primary;
  const hasBlending = !!def.common?.blending && !!primary;

  const inputs: PinDef[] = [...def.inputs];
  const params: ParamDef[] = [];
  for (const p of def.params) {
    const base = { ...p, tab: p.tab ?? 'Main' } as ParamDef;
    params.push(base);
    if (p.type === 'float' && p.modulatable) {
      inputs.push({ id: `${p.id}_mod`, name: `${p.label} mod`, type: 'gray', optional: true, role: 'modulation', tooltip: `Modulates "${p.label}" per pixel.` });
      params.push(
        P.float(`${p.id}_mod_k`, 1, {
          label: `${p.label} modulation`,
          display: 'percent',
          min: -1,
          max: 1,
          step: 0.01,
          tab: base.tab,
          group: p.group,
          showWhenConnected: `${p.id}_mod`,
          tooltip: '0% = ignore the input, 100% = fully multiply, negative = inverted input.',
        }),
      );
    }
  }
  if (hasBlending && primary) {
    inputs.push({ id: 'background', name: 'Background', type: primary.type, optional: true, role: 'background', tooltip: 'Optional: blended with the result (Blending tab).' });
  }
  if (hasTextureTab) params.push(...commonTextureParams());
  if (hasBlending) params.push(...commonBlendingParams());

  const tabs: string[] = [];
  for (const p of params) if (!tabs.includes(p.tab ?? 'Main')) tabs.push(p.tab ?? 'Main');
  // Keep Main first, Blending/Texture last.
  tabs.sort((a, b) => rank(a) - rank(b));
  return { def, inputs, outputs: def.outputs, params, tabs, hasTextureTab, hasBlending, primaryTexture: primary ? { pinId: primary.id, type: primary.type as TexturePin } : undefined };
}

const rank = (t: string): number => (t === 'Main' ? 0 : t === 'Texture' ? 98 : t === BLENDING_TAB ? 99 : 1);

/** Returns a list of problems with a definition (empty = valid). Registry.register throws when non-empty. */
export function validateDefinition(def: NodeDefinition): string[] {
  const errs: string[] = [];
  if (!/^[a-z]+\.[a-z0-9_]+$/.test(def.id)) errs.push(`id "${def.id}" must look like "<category>.<name>" (lowercase)`);
  else if (def.id.split('.')[0] !== def.category) errs.push(`id prefix must equal category "${def.category}"`);
  if (!Number.isInteger(def.version) || def.version < 1) errs.push('version must be an integer >= 1');
  if (!def.title) errs.push('title missing');
  const seenIn = new Set<string>();
  for (const p of def.inputs) {
    if (seenIn.has(p.id)) errs.push(`duplicate input pin "${p.id}"`);
    seenIn.add(p.id);
    if ((p.id === 'background' && def.common?.blending) || p.id.endsWith('_mod')) errs.push(`input pin id "${p.id}" is reserved`);
  }
  const seenOut = new Set<string>();
  for (const p of def.outputs) {
    if (seenOut.has(p.id)) errs.push(`duplicate output pin "${p.id}"`);
    seenOut.add(p.id);
  }
  const ids = new Set<string>();
  for (const p of def.params) {
    if (ids.has(p.id)) errs.push(`duplicate param "${p.id}"`);
    ids.add(p.id);
    if (COMMON_PARAM_IDS.has(p.id) || p.id.endsWith('_mod_k')) errs.push(`param id "${p.id}" is reserved`);
    if (p.type === 'enum' && !p.options.some((o) => o.value === p.default)) errs.push(`enum "${p.id}" default is not an option`);
    if (p.type === 'float' && p.min !== undefined && p.max !== undefined && p.min > p.max) errs.push(`param "${p.id}" min > max`);
    if (p.type === 'float' && p.modulatable && (p.min === undefined || p.max === undefined)) {
      /* allowed, but modulation is most predictable with a hard range */
    }
  }
  for (const g of def.gizmos ?? []) {
    const refs = gizmoParamRefs(g);
    for (const r of refs) if (!ids.has(r)) errs.push(`gizmo "${g.id}" references unknown param "${r}"`);
  }
  if (!def.outputs.length && def.category !== 'export') errs.push('node has no outputs');
  return errs;
}
