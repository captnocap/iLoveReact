import { createTextureSlotFromSelection, normalizeModelTextureSlots } from './modelTextureSlotAuthoring';

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const existing = [{ id: 'surface_1', label: 'Skin' }];
let assignedIndex = -1;
const rejected = createTextureSlotFromSelection(existing, (index) => {
  assignedIndex = index;
  return 0;
});
assert(assignedIndex === 1, 'new role must target the next stable material index');
assert(rejected.slot === null, 'empty selection must not mint a role');
assert(rejected.slots === existing, 'rejected creation must preserve the exact role table');

const created = createTextureSlotFromSelection(existing, (index) => {
  assignedIndex = index;
  return 3;
});
assert(assignedIndex === 1, 'selected faces were assigned to the wrong role index');
assert(created.assignedFaces === 3, 'assigned authored-face count was lost');
assert(created.slots.length === 2, 'selected faces did not mint exactly one role');
assert(created.slot?.id === 'surface_2' && created.slot.label === 'Surface 2', 'new role identity is wrong');

const sparse = createTextureSlotFromSelection(
  [{ id: 'surface_2', label: 'Existing' }],
  () => 1,
);
assert(sparse.slot?.id === 'surface_1', 'generated role id did not take the first open stable id');

const flora = createTextureSlotFromSelection(existing, () => 2, { purpose: 'flora' });
assert(flora.slot?.id === 'flora_1' && flora.slot.purpose === 'flora', 'flora face role lost its semantic purpose');
const screen = createTextureSlotFromSelection(flora.slots, () => 1, { purpose: 'screen' });
assert(screen.slot?.label === 'Screen 1' && screen.slot.purpose === 'screen', 'screen face role was not minted distinctly');

const repaired = normalizeModelTextureSlots([
  { id: 'legacy', label: 'Legacy', purpose: 'billboard' },
  null,
]);
assert(repaired?.length === 2, 'manifest repair shifted the indexed role table');
assert(repaired?.[0]?.purpose === undefined, 'unknown face purpose did not fall back to material');
assert(repaired?.[1]?.id === 'surface_2', 'invalid indexed role did not receive deterministic identity');
