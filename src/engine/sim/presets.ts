import type { ParamValues } from '../params/schema';

/** Node preset of a simulation node: stable id, English + Persian name / description, parameter overrides. */
export interface SimPreset {
  id: string;
  name: { en: string; fa: string };
  description: { en: string; fa: string };
  params: ParamValues;
}
const registry = new Map<string, SimPreset[]>();
/** Each simulation node registers its presets at import time (nodes are discovered eagerly). */
export const registerSimPresets = (nodeId: string, list: SimPreset[]): SimPreset[] => {
  registry.set(nodeId, list);
  return list;
};
export const simPresetsFor = (nodeId: string): SimPreset[] | undefined => registry.get(nodeId);
