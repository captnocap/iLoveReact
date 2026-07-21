(() => {
  // cart/editor/data/modelOutliner.ts
  var NUMBERED_SUFFIX = /\s+\((\d+)\)$/;
  var LEGACY_COPY_SUFFIX = /\s+copy$/i;
  function duplicateNameStem(rawName) {
    let name = rawName.trim() || "Part";
    while (true) {
      const withoutCopy = name.replace(LEGACY_COPY_SUFFIX, "").trim();
      if (withoutCopy !== name) {
        name = withoutCopy;
        continue;
      }
      const withoutNumber = name.replace(NUMBERED_SUFFIX, "").trim();
      if (withoutNumber !== name) {
        name = withoutNumber;
        continue;
      }
      return name || "Part";
    }
  }

  // cart/editor/model/meshCollision.ts
  var MESH_COLLISION_TUNING = {
    // world_loader's per-mesh island budget. Reduction happens here so the tail
    // of a long bridge is merged locally instead of being truncated.
    hostBoxBudget: 24,
    // Planes still need a physical skin. Horizontal faces extend downward so the
    // visible top remains the exact walkable height; vertical axes expand evenly.
    minimumThicknessMeters: 0.04
  };
  function volume(box) {
    return Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY) * Math.max(0, box.maxZ - box.minZ);
  }
  function union(a, b) {
    return {
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      minZ: Math.min(a.minZ, b.minZ),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
      maxZ: Math.max(a.maxZ, b.maxZ)
    };
  }
  function centerDistanceSquared(a, b) {
    const ax = (a.minX + a.maxX) * 0.5, ay = (a.minY + a.maxY) * 0.5, az = (a.minZ + a.maxZ) * 0.5;
    const bx = (b.minX + b.maxX) * 0.5, by = (b.minY + b.maxY) * 0.5, bz = (b.minZ + b.maxZ) * 0.5;
    return (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2;
  }
  function thicken(box) {
    const out = { ...box };
    const minimum = MESH_COLLISION_TUNING.minimumThicknessMeters;
    const x = out.maxX - out.minX;
    if (x < minimum) {
      const grow = (minimum - x) * 0.5;
      out.minX -= grow;
      out.maxX += grow;
    }
    const z = out.maxZ - out.minZ;
    if (z < minimum) {
      const grow = (minimum - z) * 0.5;
      out.minZ -= grow;
      out.maxZ += grow;
    }
    const y = out.maxY - out.minY;
    if (y < minimum) out.minY = out.maxY - minimum;
    return out;
  }
  function candidateFamily(meta, index) {
    if (!meta) return `range:${index}`;
    const stem = duplicateNameStem(meta.name);
    return `${meta.groupId ?? "root"}:${stem}`;
  }
  function rangeBounds(vertices, faceGroups, lo, hi) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const triangles = Math.floor(vertices.length / 24);
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      const group = faceGroups ? faceGroups[triangle] : triangle;
      if (group < lo || group >= hi) continue;
      for (let corner = 0; corner < 3; corner += 1) {
        const at = (triangle * 3 + corner) * 8;
        const x = vertices[at], y = vertices[at + 1], z = vertices[at + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    return Number.isFinite(minX) ? thicken({ minX, minY, minZ, maxX, maxY, maxZ }) : null;
  }
  function reduceToHostBudget(input) {
    const candidates = input.slice();
    let mergeSerial = 0;
    while (candidates.length > MESH_COLLISION_TUNING.hostBoxBudget) {
      const counts = /* @__PURE__ */ new Map();
      for (const candidate of candidates) counts.set(candidate.family, (counts.get(candidate.family) ?? 0) + 1);
      const hasRepeat = [...counts.values()].some((count) => count > 1);
      let bestA = -1, bestB = -1, bestCost = Infinity;
      for (let a2 = 0; a2 < candidates.length; a2 += 1) {
        for (let b2 = a2 + 1; b2 < candidates.length; b2 += 1) {
          const ca = candidates[a2], cb = candidates[b2];
          const sameFamily = ca.family === cb.family;
          if (hasRepeat && !sameFamily) continue;
          const joined = union(ca.box, cb.box);
          const inflation = Math.max(0, volume(joined) - volume(ca.box) - volume(cb.box));
          const orderGap = Math.abs(ca.order - cb.order);
          const cost = inflation + centerDistanceSquared(ca.box, cb.box) + orderGap * 1e-3;
          if (cost < bestCost) {
            bestCost = cost;
            bestA = a2;
            bestB = b2;
          }
        }
      }
      if (bestA < 0 || bestB < 0) break;
      const a = candidates[bestA], b = candidates[bestB];
      const merged = {
        box: union(a.box, b.box),
        family: a.family === b.family ? a.family : `merged:${mergeSerial++}`,
        order: Math.min(a.order, b.order)
      };
      candidates.splice(bestB, 1);
      candidates.splice(bestA, 1, merged);
    }
    return candidates.sort((a, b) => a.order - b.order);
  }
  function compileOutlinerCollisionBoxes(vertices, doc, parts) {
    if (!doc || doc.ranges.length < 2 || vertices.length === 0 || vertices.length % 24 !== 0) return [];
    const triangles = vertices.length / 24;
    if (doc.faceGroups && doc.faceGroups.length !== triangles) return [];
    const candidates = [];
    for (let index = 0; index < doc.ranges.length; index += 1) {
      const range = doc.ranges[index];
      const meta = parts?.[index];
      if (meta?.visible === false || range.hi <= range.lo) continue;
      const box = rangeBounds(vertices, doc.faceGroups, range.lo, range.hi);
      if (box) candidates.push({ box, family: candidateFamily(meta, index), order: index });
    }
    if (candidates.length < 2) return [];
    return reduceToHostBudget(candidates).map((candidate) => candidate.box);
  }

  // cart/editor/model/meshCollision.test.ts
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
  function triangleAt(x, y) {
    return [
      x,
      y,
      0,
      0,
      1,
      0,
      0,
      0,
      x + 1,
      y,
      0,
      0,
      1,
      0,
      1,
      0,
      x,
      y,
      1,
      0,
      1,
      0,
      0,
      1
    ];
  }
  function fixture(count, rise = 0.25) {
    const values = [];
    for (let i = 0; i < count; i += 1) values.push(...triangleAt(i * 1.25, i * rise));
    const groups = new Uint32Array(count);
    const ranges = [];
    const parts = [];
    for (let i = 0; i < count; i += 1) {
      groups[i] = i;
      ranges.push({ lo: i, hi: i + 1 });
      parts.push({ name: `Deck (${i + 1})`, color: "#888888", visible: true, groupId: "bridge", groupName: "Bridge" });
    }
    const vertices = new Float32Array(values);
    return { vertices, doc: { vertices, faceGroups: groups, ranges }, parts };
  }
  test("rising Outliner members keep separate local height bands", () => {
    const f = fixture(3, 2);
    const boxes = compileOutlinerCollisionBoxes(f.vertices, f.doc, f.parts);
    assert(boxes.length === 3, `expected three part bands, got ${boxes.length}`);
    assert(boxes[0].maxY === 0 && boxes[1].maxY === 2 && boxes[2].maxY === 4, "walkable tops no longer follow the visible rise");
    assert(boxes.every((box) => Math.abs(box.maxY - box.minY - MESH_COLLISION_TUNING.minimumThicknessMeters) < 1e-9), "flat decks did not receive a downward-only skin");
  });
  test("long paths reduce locally to the host budget without losing either endpoint", () => {
    const f = fixture(33, 0.5);
    const boxes = compileOutlinerCollisionBoxes(f.vertices, f.doc, f.parts);
    assert(boxes.length === MESH_COLLISION_TUNING.hostBoxBudget, `expected ${MESH_COLLISION_TUNING.hostBoxBudget} boxes, got ${boxes.length}`);
    assert(Math.min(...boxes.map((box) => box.minX)) <= 0, "first bridge bay disappeared");
    assert(Math.max(...boxes.map((box) => box.maxX)) >= 41, "last bridge bay disappeared");
    assert(boxes.every((box) => box.maxY - box.minY < 3), "a local merge recreated the whole-height wall");
  });
  test("hidden Outliner members do not produce invisible collision", () => {
    const f = fixture(3);
    f.parts[1] = { ...f.parts[1], visible: false };
    const boxes = compileOutlinerCollisionBoxes(f.vertices, f.doc, f.parts);
    assert(boxes.length === 2, "hidden member still blocks the player");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
