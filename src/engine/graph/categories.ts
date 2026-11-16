import type { NodeCategory } from '../types';

export interface CategoryInfo {
  id: NodeCategory;
  label: string;
  color: string;
  order: number;
}

/** Category colors for node headers, library and minimap. One accent hue per category, dark-UI friendly. */
export const CATEGORIES: Record<NodeCategory, CategoryInfo> = {
  grayscale: { id: 'grayscale', label: 'Grayscale', color: '#8a94a6', order: 0 },
  color: { id: 'color', label: 'Color', color: '#e0a23c', order: 1 },
  normal: { id: 'normal', label: 'Normal', color: '#6c7bff', order: 2 },
  uv: { id: 'uv', label: 'UV', color: '#35c2a1', order: 3 },
  utils: { id: 'utils', label: 'Utils', color: '#5aa7e0', order: 4 },
  islands: { id: 'islands', label: 'Islands', color: '#b5cf4a', order: 5 },
  vector: { id: 'vector', label: 'Vector', color: '#3fc7d8', order: 5.7 },
  simulation: { id: 'simulation', label: 'Simulation', color: '#f0883e', order: 5.8 },
  particle: { id: 'particle', label: 'Particle', color: '#d46fd0', order: 6 },
  geometry: { id: 'geometry', label: 'Geometry', color: '#e0627f', order: 7 },
  camera: { id: 'camera', label: 'Camera', color: '#9b8cf0', order: 8 },
  subgraph: { id: 'subgraph', label: 'Subgraphs', color: '#7fd1c8', order: 5.5 },
  import: { id: 'import', label: 'Import', color: '#e07a3c', order: 9 },
  export: { id: 'export', label: 'Export', color: '#d94f4f', order: 10 },
};
