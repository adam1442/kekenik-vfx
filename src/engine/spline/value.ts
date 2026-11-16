import type { PinValue } from '../resources/values';
import { dataValue } from '../resources/values';
import { cloneSet, type SplineSet } from './ops';

/** Pin value of type `spline` (CPU data, no GPU resources). The set is frozen by convention: nodes must clone before editing. */
export const splineValue = (set: SplineSet): PinValue => dataValue('spline', set);

export function asSplineSet(v: PinValue | undefined): SplineSet | undefined {
  if (!v || v.kind !== 'data' || v.pin !== 'spline') return undefined;
  const d = v.data as SplineSet | undefined;
  return d && Array.isArray(d.splines) ? d : undefined;
}

/** Editable copy of an input set. */
export const editableSet = (v: PinValue | undefined): SplineSet | undefined => {
  const s = asSplineSet(v);
  return s ? cloneSet(s) : undefined;
};
