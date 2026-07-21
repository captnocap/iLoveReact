(() => {
  // cart/editor/model/doorModel.ts
  var DOOR_LEAF_PART_NAME = "Door Leaf";
  function isDoorLeafPartName(name) {
    return /door.*leaf/i.test(name.trim());
  }
  function resolveDoorLeafPart(parts2) {
    const matches = parts2.map((part, index) => ({ part, index })).filter(({ part }) => part.visible && isDoorLeafPartName(part.name));
    if (matches.length === 0) {
      return { ok: false, error: `Door Wall export needs one visible Outliner part named "${DOOR_LEAF_PART_NAME}".` };
    }
    if (matches.length > 1) {
      return { ok: false, error: `Door Wall export found ${matches.length} visible door-leaf parts; keep exactly one named "${DOOR_LEAF_PART_NAME}".` };
    }
    return { ok: true, index: matches[0].index };
  }
  function vertexBounds(vertices2, start, count) {
    if (count <= 0 || start < 0 || start + count > vertices2.length / 8) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let vertex = start; vertex < start + count; vertex += 1) {
      const at = vertex * 8;
      const x = vertices2[at], y = vertices2[at + 1], z = vertices2[at + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return Number.isFinite(minX) ? { minX, minY, minZ, maxX, maxY, maxZ } : null;
  }
  function doorFrameCollisionBoxes(vertices2, bodyCount, leafStart, leafCount) {
    const body = vertexBounds(vertices2, 0, bodyCount);
    const leaf = vertexBounds(vertices2, leafStart, leafCount);
    if (!body || !leaf) return null;
    const depth = body.maxZ - body.minZ;
    const leafWidth = leaf.maxX - leaf.minX;
    const leafDepth = leaf.maxZ - leaf.minZ;
    if (depth <= 1e-3 || leafWidth <= 1e-3 || leafWidth < leafDepth) return null;
    const apertureMinX = Math.max(body.minX, leaf.minX);
    const apertureMaxX = Math.min(body.maxX, leaf.maxX);
    const apertureTop = Math.min(body.maxY, leaf.maxY);
    if (apertureMaxX - apertureMinX <= 1e-3 || apertureTop - body.minY <= 1e-3) return null;
    const boxes = [];
    const add = (minX, minY, maxX, maxY) => {
      if (maxX - minX <= 1e-3 || maxY - minY <= 1e-3) return;
      boxes.push({ minX, minY, minZ: body.minZ, maxX, maxY, maxZ: body.maxZ });
    };
    add(body.minX, body.minY, apertureMinX, apertureTop);
    add(apertureMaxX, body.minY, body.maxX, apertureTop);
    add(body.minX, apertureTop, body.maxX, body.maxY);
    return boxes.length > 0 ? boxes : null;
  }
  function compileDoorMesh(vertices2, doc2, parts2) {
    const resolved = resolveDoorLeafPart(parts2);
    if (!resolved.ok) return resolved;
    if (parts2.length !== doc2.ranges.length) {
      return { ok: false, error: `Door Wall export cannot pair ${parts2.length} Outliner parts with ${doc2.ranges.length} saved mesh ranges; save the model and retry.` };
    }
    if (vertices2.length === 0 || vertices2.length % 24 !== 0) {
      return { ok: false, error: "Door Wall export needs a non-empty triangle mesh." };
    }
    const triangleCount = vertices2.length / 24;
    if (doc2.faceGroups && doc2.faceGroups.length !== triangleCount) {
      return { ok: false, error: `Door Wall export face-group count (${doc2.faceGroups.length}) does not match its ${triangleCount} triangles.` };
    }
    const vertexCount = vertices2.length / 8;
    const glassFirstVertex = doc2.glassFirstVertex ?? vertexCount;
    if (glassFirstVertex < 0 || glassFirstVertex > vertexCount || glassFirstVertex % 3 !== 0) {
      return { ok: false, error: "Door Wall export has an invalid saved glass-face boundary; save the model again and retry." };
    }
    const glassFirstTriangle = glassFirstVertex / 3;
    const leafRange = doc2.ranges[resolved.index];
    if (!leafRange || leafRange.hi <= leafRange.lo) {
      return { ok: false, error: `The "${parts2[resolved.index]?.name ?? DOOR_LEAF_PART_NAME}" Outliner part has no saved face range.` };
    }
    let leafTriangles = 0;
    let leafGlassTriangles = 0;
    for (let triangle2 = 0; triangle2 < triangleCount; triangle2 += 1) {
      const group = doc2.faceGroups ? doc2.faceGroups[triangle2] : triangle2;
      if (group >= leafRange.lo && group < leafRange.hi) {
        leafTriangles += 1;
        if (triangle2 >= glassFirstTriangle) leafGlassTriangles += 1;
      }
    }
    if (leafTriangles === 0) {
      return { ok: false, error: `The "${parts2[resolved.index]?.name ?? DOOR_LEAF_PART_NAME}" Outliner part is empty; give the door panel geometry before export.` };
    }
    if (leafTriangles === triangleCount) {
      return { ok: false, error: "Door Wall export needs static frame geometry in addition to the Door Leaf." };
    }
    const leafOpaqueTriangles = leafTriangles - leafGlassTriangles;
    if (leafOpaqueTriangles === 0) {
      return { ok: false, error: "Door Wall export needs opaque Door Leaf geometry around any glass window faces." };
    }
    const bodyTriangles = triangleCount - leafTriangles;
    const bodyFloats = bodyTriangles * 24;
    const leafOpaqueFloats = leafOpaqueTriangles * 24;
    const out = new Float32Array(vertices2.length);
    let bodyAt = 0;
    let leafAt = bodyFloats;
    let leafGlassAt = bodyFloats + leafOpaqueFloats;
    for (let triangle2 = 0; triangle2 < triangleCount; triangle2 += 1) {
      const group = doc2.faceGroups ? doc2.faceGroups[triangle2] : triangle2;
      const sourceAt = triangle2 * 24;
      const source = vertices2.subarray(sourceAt, sourceAt + 24);
      if (group >= leafRange.lo && group < leafRange.hi) {
        if (triangle2 >= glassFirstTriangle) {
          out.set(source, leafGlassAt);
          leafGlassAt += 24;
        } else {
          out.set(source, leafAt);
          leafAt += 24;
        }
      } else {
        out.set(source, bodyAt);
        bodyAt += 24;
      }
    }
    const leaf = { start: bodyFloats / 8, count: leafTriangles * 24 / 8 };
    const leafGlass = leafGlassTriangles > 0 ? { start: (bodyFloats + leafOpaqueFloats) / 8, count: leafGlassTriangles * 24 / 8 } : void 0;
    const collisionBoxes = doorFrameCollisionBoxes(out, leaf.start, leaf.start, leaf.count);
    if (!collisionBoxes) {
      return { ok: false, error: "Door Wall export could not derive an open frame around the Door Leaf; keep the leaf inside a wall frame and aligned across local X." };
    }
    return {
      ok: true,
      mesh: {
        vertices: out,
        // MESH_PROPS ranges are in VERTICES, not floats.
        leaf,
        ...leafGlass ? { leafGlass } : {},
        collisionBoxes
      }
    };
  }

  // cart/editor/model/doorModel.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(`${s}
`));
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      log(`FAIL  ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function triangle(a, b, c) {
    const vertex = ([x, y, z]) => [x, y, z, 0, 1, 0, 0, 0];
    return [...vertex(a), ...vertex(b), ...vertex(c)];
  }
  var vertices = new Float32Array([
    ...triangle([-2, 0, -0.2], [-1, 0, 0.2], [-1, 3, 0.2]),
    // left frame group 0
    ...triangle([-1, 0, -0.05], [1, 0, 0.05], [1, 2.2, 0.05]),
    // leaf group 2, deliberately interleaved
    ...triangle([1, 0, -0.2], [2, 0, 0.2], [2, 3, 0.2])
    // right frame group 1
  ]);
  var doc = {
    vertices,
    faceGroups: new Uint32Array([0, 2, 1]),
    ranges: [{ lo: 0, hi: 2 }, { lo: 2, hi: 3 }]
  };
  var parts = [
    { name: "Door Frame", color: "#aaa", visible: true },
    { name: "front DOOR carved LEAF", color: "#222", visible: true }
  ];
  test("the leaf name contract is explicit, visible, and unique", () => {
    assert(resolveDoorLeafPart(parts).ok, "valid Door Leaf was rejected");
    assert(!resolveDoorLeafPart([{ name: "Door Frame", visible: true }]).ok, "missing leaf passed");
    assert(!resolveDoorLeafPart([{ name: "Door Leaf", visible: false }]).ok, "hidden leaf passed");
    assert(!resolveDoorLeafPart([
      { name: "Door Leaf", visible: true },
      { name: "Door Glass Leaf", visible: true }
    ]).ok, "two semantic leaves passed");
  });
  test("compiler moves interleaved leaf triangles into one trailing vertex slot", () => {
    const result = compileDoorMesh(vertices, doc, parts);
    assert(result.ok, result.ok ? "" : result.error);
    if (!result.ok) return;
    assert(result.mesh.leaf.start === 6, `leaf starts at vertex ${result.mesh.leaf.start}, expected 6`);
    assert(result.mesh.leaf.count === 3, `leaf count ${result.mesh.leaf.count}, expected 3`);
    assert(result.mesh.vertices[0] === -2, "first frame triangle moved incorrectly");
    assert(result.mesh.vertices[24] === 1, "second frame triangle did not compact before leaf");
    assert(result.mesh.vertices[48] === -1, "leaf triangle is not trailing");
    assert(result.mesh.collisionBoxes.length === 3, `door frame should compile as two jambs + lintel, got ${result.mesh.collisionBoxes.length}`);
    const groundBands = result.mesh.collisionBoxes.filter((box) => box.minY === 0 && box.maxY > 2);
    assert(groundBands.length === 2, "door aperture was sealed instead of leaving two ground-level jambs");
  });
  test("compiler keeps Studio glass as a separate trailing leaf slot", () => {
    const glassVertices = new Float32Array([
      ...triangle([-2, 0, -0.2], [-1, 0, 0.2], [-1, 3, 0.2]),
      ...triangle([1, 0, -0.2], [2, 0, 0.2], [2, 3, 0.2]),
      ...triangle([-1, 0, -0.05], [1, 0, 0.05], [1, 2.2, 0.05]),
      // opaque leaf
      ...triangle([-0.5, 1, -0.051], [0.5, 1, -0.051], [0.5, 1.7, -0.051])
      // glass window
    ]);
    const glassDoc = {
      vertices: glassVertices,
      faceGroups: new Uint32Array([0, 1, 2, 2]),
      ranges: [{ lo: 0, hi: 2 }, { lo: 2, hi: 3 }],
      glassFirstVertex: 9
    };
    const result = compileDoorMesh(glassVertices, glassDoc, parts);
    assert(result.ok, result.ok ? "" : result.error);
    if (!result.ok) return;
    assert(result.mesh.leaf.start === 6 && result.mesh.leaf.count === 6, "combined leaf range changed");
    assert(result.mesh.leafGlass?.start === 9 && result.mesh.leafGlass.count === 3, "glass window did not become the final leaf slot");
  });
  test("compiler rejects an all-leaf model because a door also needs a static frame", () => {
    const onlyLeaf = {
      vertices: new Float32Array(triangle([-1, 0, -0.05], [1, 0, 0.05], [1, 2, 0.05])),
      faceGroups: new Uint32Array([0]),
      ranges: [{ lo: 0, hi: 1 }]
    };
    const result = compileDoorMesh(onlyLeaf.vertices, onlyLeaf, [{ name: "Door Leaf", color: "#222", visible: true }]);
    assert(!result.ok, "all-leaf model compiled without a frame");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
