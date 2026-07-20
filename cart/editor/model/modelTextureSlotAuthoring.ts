import type { ModelFacePurpose, ModelTextureSlot } from '../data/types';

export type CreateTextureSlotResult = {
  slots: readonly ModelTextureSlot[];
  slot: ModelTextureSlot | null;
  assignedFaces: number;
};

/** Runtime boundary for hand-edited/older manifests. Unknown role purposes are
 * ordinary material faces; consumers must never index a purpose table with an
 * unchecked manifest string. */
export function normalizeModelFacePurpose(value: unknown): ModelFacePurpose {
  return value === 'screen' || value === 'flora' ? value : 'material';
}

/** Preserve role-table cardinality because faceMaterials stores slot indexes.
 * Invalid rows receive deterministic identity instead of being filtered and
 * shifting every later face assignment. */
export function normalizeModelTextureSlots(value: unknown): ModelTextureSlot[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const fallbackId = `surface_${index + 1}`;
    const id = typeof row.id === 'string' && row.id.trim() ? row.id : fallbackId;
    const label = typeof row.label === 'string' && row.label.trim() ? row.label : id;
    const purpose = normalizeModelFacePurpose(row.purpose);
    return { id, label, ...(purpose === 'material' ? {} : { purpose }) };
  });
}

/** Create a named role only when the host can immediately attach selected
 * authored faces to it. Empty role metadata is not a valid authoring state. */
export function createTextureSlotFromSelection(
  slots: readonly ModelTextureSlot[],
  assignSelectedFaces: (slotIndex: number) => number,
  options: { purpose?: ModelFacePurpose; label?: string } = {},
): CreateTextureSlotResult {
  const purpose = options.purpose ?? 'material';
  const prefix = purpose === 'material' ? 'surface' : purpose;
  let number = 1;
  const ids = new Set(slots.map((slot) => slot.id));
  while (ids.has(`${prefix}_${number}`)) number += 1;

  const assignedFaces = Math.max(0, Number(assignSelectedFaces(slots.length)) || 0);
  if (assignedFaces === 0) return { slots, slot: null, assignedFaces: 0 };

  const defaultLabel = purpose === 'screen' ? `Screen ${number}` : purpose === 'flora' ? `Flora Surface ${number}` : `Surface ${number}`;
  const slot: ModelTextureSlot = {
    id: `${prefix}_${number}`,
    label: options.label?.trim() || defaultLabel,
    ...(purpose !== 'material' ? { purpose } : {}),
  };
  return { slots: [...slots, slot], slot, assignedFaces };
}
