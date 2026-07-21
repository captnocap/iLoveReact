(() => {
  // cart/editor/data/paintVariants.ts
  var PAINT_MESH_VERTEX_FLOATS = 8;
  var PAINT_MESH_VERTEX_BYTES = PAINT_MESH_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  var PAINT_MESH_U_OFFSET = 6;
  var PAINT_MESH_V_OFFSET = 7;
  function paintSkinFitsCurrentMesh(currentMeshBytes, skinMeshBytes) {
    const validSkin = skinMeshBytes >= PAINT_MESH_VERTEX_BYTES * 3 && skinMeshBytes % PAINT_MESH_VERTEX_BYTES === 0;
    return validSkin && (currentMeshBytes === null || currentMeshBytes === skinMeshBytes);
  }
  function bindPaintSkinToCurrentMesh(current, skin) {
    if (current.length !== skin.length || current.length < PAINT_MESH_VERTEX_FLOATS * 3) return null;
    if (current.length % PAINT_MESH_VERTEX_FLOATS !== 0) return null;
    const bound = new Float32Array(current);
    for (let i = 0; i < bound.length; i += PAINT_MESH_VERTEX_FLOATS) {
      bound[i + PAINT_MESH_U_OFFSET] = skin[i + PAINT_MESH_U_OFFSET];
      bound[i + PAINT_MESH_V_OFFSET] = skin[i + PAINT_MESH_V_OFFSET];
    }
    return bound;
  }

  // cart/editor/data/paintVariants.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(s + "\n"));
  function test(name, fn) {
    try {
      fn();
      passed++;
      log(`  ok  ${name}`);
    } catch (e) {
      failed++;
      log(`FAIL  ${name}: ${e.message}`);
    }
  }
  function assert(c, m) {
    if (!c) throw new Error(m);
  }
  var vertex = (x, nx, u, v) => [x, x + 1, x + 2, nx, nx + 1, nx + 2, u, v];
  test("a saved skin contributes UVs but never its stale positions or normals", () => {
    const current = new Float32Array([
      ...vertex(10, 20, 0.1, 0.2),
      ...vertex(30, 40, 0.3, 0.4),
      ...vertex(50, 60, 0.5, 0.6)
    ]);
    const savedSkin = new Float32Array([
      ...vertex(-10, -20, 0.7, 0.8),
      ...vertex(-30, -40, 0.9, 1),
      ...vertex(-50, -60, 0.11, 0.12)
    ]);
    const bound = bindPaintSkinToCurrentMesh(current, savedSkin);
    assert(bound !== null, "same-cardinality skin should bind");
    for (let i = 0; i < current.length; i += 8) {
      for (let field = 0; field < 6; field += 1) {
        assert(bound[i + field] === current[i + field], `geometry field ${field} came from stale skin`);
      }
      assert(bound[i + 6] === savedSkin[i + 6], "u did not come from saved skin");
      assert(bound[i + 7] === savedSkin[i + 7], "v did not come from saved skin");
    }
  });
  test("a topology-changing skin cannot bind to the current model", () => {
    const current = new Float32Array(3 * 8);
    const stale = new Float32Array(6 * 8);
    assert(bindPaintSkinToCurrentMesh(current, stale) === null, "different vertex counts must refuse");
    assert(!paintSkinFitsCurrentMesh(current.byteLength, stale.byteLength), "stale skin must leave the palette");
  });
  test("a well-formed legacy skin remains usable until a base mesh exists", () => {
    const triangleBytes = 3 * PAINT_MESH_VERTEX_BYTES;
    assert(paintSkinFitsCurrentMesh(null, triangleBytes), "legacy skin should remain reachable");
    assert(!paintSkinFitsCurrentMesh(null, triangleBytes - 1), "partial vertex data must refuse");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
