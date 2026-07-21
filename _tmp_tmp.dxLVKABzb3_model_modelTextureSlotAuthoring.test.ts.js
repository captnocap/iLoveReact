(() => {
  // cart/editor/model/modelTextureSlotAuthoring.ts
  function createTextureSlotFromSelection(slots, assignSelectedFaces) {
    let number = slots.length + 1;
    const ids = new Set(slots.map((slot2) => slot2.id));
    while (ids.has(`surface_${number}`)) number += 1;
    const assignedFaces = Math.max(0, Number(assignSelectedFaces(slots.length)) || 0);
    if (assignedFaces === 0) return { slots, slot: null, assignedFaces: 0 };
    const slot = { id: `surface_${number}`, label: `Surface ${number}` };
    return { slots: [...slots, slot], slot, assignedFaces };
  }

  // cart/editor/model/modelTextureSlotAuthoring.test.ts
  function assert(ok, message) {
    if (!ok) throw new Error(message);
  }
  var existing = [{ id: "surface_1", label: "Skin" }];
  var assignedIndex = -1;
  var rejected = createTextureSlotFromSelection(existing, (index) => {
    assignedIndex = index;
    return 0;
  });
  assert(assignedIndex === 1, "new role must target the next stable material index");
  assert(rejected.slot === null, "empty selection must not mint a role");
  assert(rejected.slots === existing, "rejected creation must preserve the exact role table");
  var created = createTextureSlotFromSelection(existing, (index) => {
    assignedIndex = index;
    return 3;
  });
  assert(assignedIndex === 1, "selected faces were assigned to the wrong role index");
  assert(created.assignedFaces === 3, "assigned authored-face count was lost");
  assert(created.slots.length === 2, "selected faces did not mint exactly one role");
  assert(created.slot?.id === "surface_2" && created.slot.label === "Surface 2", "new role identity is wrong");
  var sparse = createTextureSlotFromSelection(
    [{ id: "surface_2", label: "Existing" }],
    () => 1
  );
  assert(sparse.slot?.id === "surface_3", "generated role id collided with an existing stable id");
})();
