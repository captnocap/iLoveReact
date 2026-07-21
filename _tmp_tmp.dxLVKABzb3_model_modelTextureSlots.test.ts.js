(() => {
  // cart/editor/model/modelTextureSlots.ts
  var NO_FACE_MATERIAL = 4294967295;
  function compileTextureSlotMesh(vertices2, faceMaterials, slots) {
    const triangleCount = Math.floor(vertices2.length / 24);
    if (vertices2.length !== triangleCount * 24) throw new Error("texture-slot mesh is not triangle-aligned stride-8 geometry");
    if (slots.length === 0) return { vertices: vertices2, slots: [] };
    if (!faceMaterials) {
      const end = triangleCount * 3;
      return { vertices: vertices2, slots: slots.map(() => ({ start: end, count: 0 })) };
    }
    if (faceMaterials.length !== triangleCount) {
      throw new Error(`texture-slot mesh has ${triangleCount} triangles but ${faceMaterials?.length ?? 0} face-role rows`);
    }
    const buckets = Array.from({ length: slots.length + 1 }, () => []);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const material = faceMaterials[triangle];
      const bucket = material !== NO_FACE_MATERIAL && material < slots.length ? material + 1 : 0;
      buckets[bucket].push(triangle);
    }
    const out = new Float32Array(vertices2.length);
    let outFloat = 0;
    const appendBucket = (triangles) => {
      for (const triangle of triangles) {
        const source = triangle * 24;
        out.set(vertices2.subarray(source, source + 24), outFloat);
        outFloat += 24;
      }
    };
    appendBucket(buckets[0]);
    let vertexStart = buckets[0].length * 3;
    const ranges = slots.map((_, index) => {
      const triangles = buckets[index + 1];
      const range = { start: vertexStart, count: triangles.length * 3 };
      appendBucket(triangles);
      vertexStart += range.count;
      return range;
    });
    return { vertices: out, slots: ranges };
  }

  // cart/editor/model/modelTextureSlots.test.ts
  function assert(ok, message) {
    if (!ok) throw new Error(message);
  }
  var vertices = new Float32Array(4 * 24);
  for (let triangle = 0; triangle < 4; triangle += 1) {
    vertices[triangle * 24] = triangle + 1;
  }
  var compiled = compileTextureSlotMesh(
    vertices,
    new Uint32Array([1, NO_FACE_MATERIAL, 0, 1]),
    [{ id: "cloth", label: "Cloth" }, { id: "trim", label: "Trim" }]
  );
  assert(compiled.vertices[0] === 2, "unslotted painted face must stay in the base prefix");
  assert(compiled.vertices[24] === 3, "slot 0 face did not follow the base prefix");
  assert(compiled.vertices[48] === 1 && compiled.vertices[72] === 4, "slot 1 faces were not contiguous");
  assert(compiled.slots[0].start === 3 && compiled.slots[0].count === 3, "slot 0 range is wrong");
  assert(compiled.slots[1].start === 6 && compiled.slots[1].count === 6, "slot 1 range is wrong");
  var empty = compileTextureSlotMesh(
    vertices.subarray(0, 48),
    new Uint32Array([NO_FACE_MATERIAL, 1]),
    [{ id: "unused", label: "Unused" }, { id: "used", label: "Used" }]
  );
  assert(empty.slots[0].start === 3 && empty.slots[0].count === 0, "empty roles must retain their stable slot index");
  assert(empty.slots[1].start === 3 && empty.slots[1].count === 3, "later role shifted across an empty role");
  var allPaintedVertices = vertices.subarray(0, 48);
  var unassigned = compileTextureSlotMesh(
    allPaintedVertices,
    null,
    [{ id: "future", label: "Future role" }]
  );
  assert(unassigned.vertices === allPaintedVertices, "an all-painted mesh was copied or repartitioned");
  assert(unassigned.vertices[0] === vertices[0] && unassigned.vertices[24] === vertices[24], "an all-painted mesh was reordered");
  assert(unassigned.slots[0].start === 6 && unassigned.slots[0].count === 0, "unassigned named role lost its stable empty range");
})();
