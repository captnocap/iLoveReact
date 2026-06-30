// tunables/events.ts — the authoring events the defaults/tunables surface emits.
//
// Edits NEVER mutate editor state directly: the inspector picks a preset or marks
// an override, and that travels through the authoring eventbus as a registered
// event. This file owns workstream G's event types (tunable.override.set and the
// Color Studio's material.slot.* / material.seed.* family) and the thin dispatch
// helpers that stamp the current selection AND log the edit in one call.
//
// Event types register ONCE at module load via defineEventType (the anti-collision
// seam). Targets carry refs (kind `tunable` / `material`) so the hot index + chunk
// cache can dirty the right region from the edit alone (EDITOR_FOUNDATION seam 1).

import { defineEventType, type TargetRef } from '../editorbus/event';
import { dispatch } from '../editorbus/bus';
import { type Seq } from '../editorbus/event';
import {
  type Selection, setSelection, clearSelection, overrideKey,
} from './tunable';

// ── Event-type registry (one factory per authoring action) ───────────────────

/** Choose a preset or set a custom override for a tunable. */
export const tunableOverrideSet = defineEventType<{ id: string; selection: Selection }>({
  type: 'tunable.override.set',
  undoable: true,
  describe: (p) =>
    typeof p.selection === 'string'
      ? `set ${p.id} → ${p.selection}`
      : `override ${p.id} = ${p.selection.custom}`,
  validate: (p) => { if (!p.id) throw new Error('tunable.override.set: missing id'); },
});

/** Revert a tunable to its `default` preset. */
export const tunableOverrideClear = defineEventType<{ id: string }>({
  type: 'tunable.override.clear',
  undoable: true,
  describe: (p) => `reset ${p.id} to default`,
});

/** Fill a shader-slot color override for `(material, variant, slot)`. */
export const materialSlotFill = defineEventType<{
  material: string; variant: string; slot: string; value: string;
}>({
  type: 'material.slot.fill',
  undoable: true,
  describe: (p) => `fill ${p.material}/${p.variant} slot ${p.slot} = ${p.value}`,
  validate: (p) => { if (!p.material || !p.slot) throw new Error('material.slot.fill: missing material/slot'); },
});

/** Reset a shader slot back to its baked value. */
export const materialSlotReset = defineEventType<{
  material: string; variant: string; slot: string;
}>({
  type: 'material.slot.reset',
  undoable: true,
  describe: (p) => `reset ${p.material}/${p.variant} slot ${p.slot} to baked`,
});

/** Roll a new procedural seed for a material. */
export const materialSeedRoll = defineEventType<{ material: string; seed: number }>({
  type: 'material.seed.roll',
  undoable: true,
  describe: (p) => `roll ${p.material} seed → ${p.seed}`,
});

/** Select the active variant of a material. */
export const materialVariantSelect = defineEventType<{ material: string; variant: string }>({
  type: 'material.variant.select',
  undoable: false,
  describe: (p) => `select ${p.material} variant ${p.variant}`,
});

// ── Dispatch helpers (set local state + log the edit on the bus) ─────────────

const tunableRef = (id: string): TargetRef[] => [{ kind: 'tunable', id }];
const materialRef = (key: string): TargetRef[] => [{ kind: 'material', id: key }];

/** Choose a preset or set a custom override, and log it on the bus. Updates the
 *  active selection so resolveCurrent()/the host door reflect the edit at once. */
export function setTunableOverride(id: string, selection: Selection): Seq {
  setSelection(id, selection);
  return dispatch(tunableOverrideSet({ id, selection }, tunableRef(id)));
}

/** Revert a tunable to its default preset, logged on the bus. */
export function clearTunableOverride(id: string): Seq {
  clearSelection(id);
  return dispatch(tunableOverrideClear({ id }, tunableRef(id)));
}

/** Fill a shader slot (keyed by material+variant+slot) and log it on the bus. */
export function fillMaterialSlot(material: string, variant: string, slot: string, value: string): Seq {
  const key = overrideKey(material, variant, slot);
  return dispatch(materialSlotFill({ material, variant, slot, value }, materialRef(key)));
}

/** Reset a shader slot to its baked value, logged on the bus. */
export function resetMaterialSlot(material: string, variant: string, slot: string): Seq {
  const key = overrideKey(material, variant, slot);
  return dispatch(materialSlotReset({ material, variant, slot }, materialRef(key)));
}

/** Roll a material's procedural seed, logged on the bus. */
export function rollMaterialSeed(material: string, seed: number): Seq {
  return dispatch(materialSeedRoll({ material, seed }, materialRef(material)));
}

/** Select a material's active variant, logged on the bus. */
export function selectMaterialVariant(material: string, variant: string): Seq {
  return dispatch(materialVariantSelect({ material, variant }, materialRef(material)));
}
