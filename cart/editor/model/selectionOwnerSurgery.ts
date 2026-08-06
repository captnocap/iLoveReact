import type { ModelPart } from '../data/types';
import type { ModelSelectionMode, ModelSelectionSnapshot } from './modelSelectionFocus';

export type SelectionOwnerGroup = {
  partIndex: number;
  partId: string;
  partName: string;
  visible: boolean;
  elementIds: number[];
};

export type SelectionOwnerPlan = {
  mode: Exclude<ModelSelectionMode, 0>;
  count: number;
  groups: SelectionOwnerGroup[];
};

export type SelectionOwnerPlanResult =
  | { ok: true; plan: SelectionOwnerPlan }
  | { ok: false; reason: string };

type OwnedElement = { id: number; part: number | null };

function stampedPartsByRange(parts: readonly ModelPart[]): ModelPart[] {
  return parts
    .filter((part) => Number.isSafeInteger(part.lo) && Number.isSafeInteger(part.hi) && part.hi! > part.lo!)
    .slice()
    .sort((a, b) => a.lo! - b.lo!);
}

/**
 * Resolve the host's numeric part owners back to durable Outliner rows. The plan is
 * intentionally read-only: AppFrame owns the scope switch and restores the selected
 * element ids only after the target row has become the active edit boundary.
 */
export function planSelectionOwnerSurgery(
  selection: ModelSelectionSnapshot | null,
  parts: readonly ModelPart[],
): SelectionOwnerPlanResult {
  if (!selection || selection.mode === 0 || selection.count === 0) {
    return { ok: false, reason: 'select vertices, edges, or faces in the model first' };
  }
  if (selection.truncated) {
    return { ok: false, reason: 'the selection is too large to preserve exactly; select a smaller repair set' };
  }

  let elements: OwnedElement[];
  let expected: number;
  if (selection.mode === 1) {
    elements = selection.vertices;
    expected = selection.count;
  } else if (selection.mode === 2) {
    elements = selection.edges;
    expected = selection.count;
  } else {
    elements = selection.triangles;
    expected = selection.selectedTriangles;
  }
  if (elements.length !== expected || elements.length === 0) {
    return { ok: false, reason: 'the live selection changed before its ownership could be read; select it again' };
  }
  if (elements.some((element) => element.part === null)) {
    return { ok: false, reason: 'part of this selection has no Outliner owner; save a copy before repairing ownership' };
  }

  const rankedParts = stampedPartsByRange(parts);
  if (rankedParts.length !== parts.length) {
    return { ok: false, reason: 'the Outliner has an unstamped part; save and reopen before selection surgery' };
  }

  const idsByOwner = new Map<number, number[]>();
  for (const element of elements) {
    const partIndex = element.part!;
    if (!rankedParts[partIndex]) {
      return { ok: false, reason: `the selection names missing Outliner owner ${partIndex}` };
    }
    const ids = idsByOwner.get(partIndex) ?? [];
    ids.push(element.id);
    idsByOwner.set(partIndex, ids);
  }

  const groups = [...idsByOwner.entries()]
    .sort(([a], [b]) => a - b)
    .map(([partIndex, elementIds]) => {
      const part = rankedParts[partIndex]!;
      return {
        partIndex,
        partId: part.id,
        partName: part.name,
        visible: part.visible,
        elementIds,
      };
    });

  return {
    ok: true,
    plan: {
      mode: selection.mode,
      count: selection.count,
      groups,
    },
  };
}

export function selectionOwnerElementLabel(mode: Exclude<ModelSelectionMode, 0>, count: number): string {
  const noun = mode === 1 ? 'vertex' : mode === 2 ? 'edge' : 'face';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
