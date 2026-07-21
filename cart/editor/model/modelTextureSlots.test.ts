import { compileTextureSlotMesh, NO_FACE_MATERIAL } from './modelTextureSlots';

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const vertices = new Float32Array(4 * 24);
for (let triangle = 0; triangle < 4; triangle += 1) {
  vertices[triangle * 24] = triangle + 1;
}
const compiled = compileTextureSlotMesh(
  vertices,
  new Uint32Array([1, NO_FACE_MATERIAL, 0, 1]),
  new Uint32Array([0, 1, 2, 3]),
  [{ id: 'cloth', label: 'Cloth' }, { id: 'trim', label: 'Trim' }],
);
assert(compiled.vertices[0] === 2, 'unslotted painted face must stay in the base prefix');
assert(compiled.vertices[24] === 3, 'slot 0 face did not follow the base prefix');
assert(compiled.vertices[48] === 1 && compiled.vertices[72] === 4, 'slot 1 faces were not contiguous');
assert(compiled.slots[0]!.start === 3 && compiled.slots[0]!.count === 3, 'slot 0 range is wrong');
assert(compiled.slots[1]!.start === 6 && compiled.slots[1]!.count === 6, 'slot 1 range is wrong');

const empty = compileTextureSlotMesh(
  vertices.subarray(0, 48),
  new Uint32Array([NO_FACE_MATERIAL, 1]),
  new Uint32Array([0, 1]),
  [{ id: 'unused', label: 'Unused' }, { id: 'used', label: 'Used' }],
);
assert(empty.slots[0]!.start === 3 && empty.slots[0]!.count === 0, 'empty roles must retain their stable slot index');
assert(empty.slots[1]!.start === 3 && empty.slots[1]!.count === 3, 'later role shifted across an empty role');

const allPaintedVertices = vertices.subarray(0, 48);
const unassigned = compileTextureSlotMesh(
  allPaintedVertices,
  null,
  null,
  [{ id: 'future', label: 'Future role' }],
);
assert(unassigned.vertices === allPaintedVertices, 'an all-painted mesh was copied or repartitioned');
assert(unassigned.vertices[0] === vertices[0] && unassigned.vertices[24] === vertices[24], 'an all-painted mesh was reordered');
assert(unassigned.slots[0]!.start === 6 && unassigned.slots[0]!.count === 0, 'unassigned named role lost its stable empty range');

// A quad whose paint atlas maps every corner to one texel must still give a
// face material a full coherent square. Both hidden triangles share face group
// 7, so their diagonal cannot become a texture seam.
const quad = new Float32Array([
  0, 0, 0, 0, 0, 1, 0.25, 0.75,
  1, 0, 0, 0, 0, 1, 0.25, 0.75,
  1, 1, 0, 0, 0, 1, 0.25, 0.75,
  0, 0, 0, 0, 0, 1, 0.25, 0.75,
  1, 1, 0, 0, 0, 1, 0.25, 0.75,
  0, 1, 0, 0, 0, 1, 0.25, 0.75,
]);
const texturedQuad = compileTextureSlotMesh(
  quad,
  new Uint32Array([0, 0]),
  new Uint32Array([7, 7]),
  [{ id: 'surface', label: 'Surface' }],
);
assert(texturedQuad.vertices.every((value, i) => i % 8 !== 6 && i % 8 !== 7 ? true : value === (i % 8 === 6 ? 0.25 : 0.75)), 'paint UVs were overwritten by the face material');
assert(!!texturedQuad.materialUvs, 'assigned face did not receive material UVs');
const us = Array.from(texturedQuad.materialUvs!).filter((_, i) => i % 2 === 0);
const vs = Array.from(texturedQuad.materialUvs!).filter((_, i) => i % 2 === 1);
assert(Math.min(...us) === 0 && Math.max(...us) === 1, 'material did not span the full face width');
assert(Math.min(...vs) === 0 && Math.max(...vs) === 1, 'material did not span the full face height');
assert(texturedQuad.materialUvs![0] === texturedQuad.materialUvs![6] && texturedQuad.materialUvs![1] === texturedQuad.materialUvs![7], 'shared quad corner split across the hidden diagonal');
