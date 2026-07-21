(() => {
  // cart/editor/data/modelOutliner.ts
  var DEFAULT_GROUP_STEM = "Group";
  var NUMBERED_SUFFIX = /\s+\((\d+)\)$/;
  var LEGACY_COPY_SUFFIX = /\s+copy$/i;
  function partGroupPath(part2) {
    const path = part2.groupPath?.filter((entry) => Boolean(
      entry && typeof entry.id === "string" && entry.id && typeof entry.name === "string" && entry.name.trim()
    )).map((entry) => ({ id: entry.id, name: entry.name.trim() }));
    if (path?.length) return path;
    return part2.groupId ? [{ id: part2.groupId, name: part2.groupName?.trim() || DEFAULT_GROUP_STEM }] : [];
  }
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
  function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function nextDuplicatePartName(sourceName, existingNames, qualifier) {
    const stem = duplicateNameStem(sourceName);
    const family = qualifier ? `${stem} ${qualifier}` : stem;
    const numbered = new RegExp(`^${escapeRegex(family)} \\((\\d+)\\)$`, "i");
    let max = 0;
    for (const raw of existingNames) {
      const name = raw.trim();
      if (name.toLowerCase() === family.toLowerCase()) {
        max = Math.max(max, 1);
        continue;
      }
      const match = name.match(numbered);
      if (match) {
        max = Math.max(max, Number(match[1]));
        continue;
      }
      if (!qualifier && duplicateNameStem(name).toLowerCase() === stem.toLowerCase() && LEGACY_COPY_SUFFIX.test(name)) {
        max = Math.max(max, 1);
      }
    }
    return max === 0 ? family : `${family} (${max + 1})`;
  }
  function nextDuplicateGroupName(sourceName, parts) {
    const groupNames = [...new Set(parts.flatMap(partGroupPath).map((group) => group.name))];
    return nextDuplicatePartName(sourceName, groupNames);
  }

  // cart/editor/data/pathArray.ts
  var PATH_ARRAY_TUNING = {
    minBays: 2,
    maxBays: 64,
    defaultBays: 8,
    defaultTurnDegrees: 45,
    defaultRiseU: 1,
    maxAbsTurnDegrees: 360,
    maxAbsRiseU: 4096,
    turnStepDegrees: 5,
    riseStepU: 1,
    maxAbsPointU: 16384
  };
  function defaultPathArrayParams() {
    return {
      axis: 0,
      bays: PATH_ARRAY_TUNING.defaultBays,
      turnDegrees: PATH_ARRAY_TUNING.defaultTurnDegrees,
      riseU: PATH_ARRAY_TUNING.defaultRiseU,
      profile: "eased"
    };
  }
  function sanitizePathArrayParams(raw) {
    const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
    const points = raw.points && raw.points.length >= PATH_ARRAY_TUNING.minBays ? raw.points.slice(0, PATH_ARRAY_TUNING.maxBays).map((point, index) => ({
      xU: index === 0 ? 0 : Math.max(-PATH_ARRAY_TUNING.maxAbsPointU, Math.min(PATH_ARRAY_TUNING.maxAbsPointU, finite(point.xU, 0))),
      yU: index === 0 ? 0 : Math.max(-PATH_ARRAY_TUNING.maxAbsPointU, Math.min(PATH_ARRAY_TUNING.maxAbsPointU, finite(point.yU, 0))),
      zU: index === 0 ? 0 : Math.max(-PATH_ARRAY_TUNING.maxAbsPointU, Math.min(PATH_ARRAY_TUNING.maxAbsPointU, finite(point.zU, 0)))
    })) : void 0;
    return {
      axis: [0, 1, 2, 3].includes(raw.axis) ? raw.axis : 0,
      bays: points?.length ?? Math.max(PATH_ARRAY_TUNING.minBays, Math.min(PATH_ARRAY_TUNING.maxBays, Math.round(finite(raw.bays, PATH_ARRAY_TUNING.defaultBays)))),
      turnDegrees: Math.max(-PATH_ARRAY_TUNING.maxAbsTurnDegrees, Math.min(PATH_ARRAY_TUNING.maxAbsTurnDegrees, finite(raw.turnDegrees, 0))),
      riseU: Math.max(-PATH_ARRAY_TUNING.maxAbsRiseU, Math.min(PATH_ARRAY_TUNING.maxAbsRiseU, finite(raw.riseU, 0))),
      profile: raw.profile === "linear" ? "linear" : "eased",
      ...points ? { points } : {}
    };
  }
  var AXIS_BASIS = {
    0: { fx: 1, fz: 0, rx: 0, rz: -1 },
    1: { fx: -1, fz: 0, rx: 0, rz: 1 },
    2: { fx: 0, fz: 1, rx: 1, rz: 0 },
    3: { fx: 0, fz: -1, rx: -1, rz: 0 }
  };
  function arcPathArrayPoints(params, sourceLengthU) {
    const clean = sanitizePathArrayParams({ ...params, points: void 0 });
    const basis = AXIS_BASIS[clean.axis];
    const generated = clean.bays - 1;
    const totalDistance = Math.max(1e-4, Math.abs(sourceLengthU)) * generated;
    const turn = clean.turnDegrees * Math.PI / 180;
    return Array.from({ length: clean.bays }, (_, index) => {
      const t = index / generated;
      const angle = turn * t;
      const distance = totalDistance * t;
      const forwardDistance = Math.abs(turn) < 1e-5 ? distance : Math.sin(angle) * (totalDistance / turn);
      const rightDistance = Math.abs(turn) < 1e-5 ? 0 : (1 - Math.cos(angle)) * (totalDistance / turn);
      const grade = clean.profile === "linear" ? t : t * t * (3 - 2 * t);
      return {
        xU: basis.fx * forwardDistance + basis.rx * rightDistance,
        yU: clean.riseU * grade,
        zU: basis.fz * forwardDistance + basis.rz * rightDistance
      };
    });
  }
  function appendPathArrayPoint(points, axis, sourceLengthU) {
    if (points.length >= PATH_ARRAY_TUNING.maxBays) return points.slice();
    const last = points[points.length - 1] ?? { xU: 0, yU: 0, zU: 0 };
    const previous = points[points.length - 2];
    const basis = AXIS_BASIS[axis];
    const step = Math.max(1e-4, Math.abs(sourceLengthU));
    const delta = previous ? { xU: last.xU - previous.xU, yU: last.yU - previous.yU, zU: last.zU - previous.zU } : { xU: basis.fx * step, yU: 0, zU: basis.fz * step };
    return [...points, { xU: last.xU + delta.xU, yU: last.yU + delta.yU, zU: last.zU + delta.zU }];
  }
  function materializePathArrayRows(parts, sourceIds, freshRanges, seq) {
    const sourceSet = new Set(sourceIds);
    const sources = sourceIds.map((id) => parts.find((part2) => part2.id === id)).filter((part2) => Boolean(part2));
    if (sources.length === 0 || sources.length !== sourceSet.size || freshRanges.length === 0 || freshRanges.length % sources.length !== 0) return null;
    if (freshRanges.some((range) => range.hi <= range.lo)) return null;
    const commonGroupId = sources[0].groupId && sources.every((part2) => part2.groupId === sources[0].groupId) ? sources[0].groupId : null;
    let cursor = seq;
    const groupId = commonGroupId ?? `part-group:path:${cursor++}`;
    const groupName = commonGroupId ? sources[0].groupName?.trim() || "Path Array" : nextDuplicateGroupName(sources.length === 1 ? `${duplicateNameStem(sources[0].name)} Path` : "Path Array", parts);
    const groupedSources = commonGroupId ? parts.slice() : parts.map((part2) => sourceSet.has(part2.id) ? { ...part2, groupId, groupName } : part2);
    const usedNames = parts.map((part2) => part2.name);
    const created = freshRanges.map((range, index) => {
      const source = sources[index % sources.length];
      const name = nextDuplicatePartName(source.name, usedNames);
      usedNames.push(name);
      const { id: _id, name: _name, mesh: _mesh, sourcePath: _sourcePath, lo: _lo, hi: _hi, groupId: _groupId, groupName: _groupName, ...copyable } = source;
      return {
        ...copyable,
        id: `part:path:${cursor++}`,
        name,
        visible: true,
        groupId,
        groupName,
        lo: range.lo,
        hi: range.hi
      };
    });
    return { parts: [...groupedSources, ...created], created, nextSeq: cursor, groupId, groupName };
  }

  // cart/editor/data/pathArray.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((text) => globalThis.__writeStdout?.(`${text}
`));
  function test(name, run) {
    try {
      run();
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
  var part = (id, name, groupId, groupName) => ({
    id,
    name,
    groupId,
    groupName,
    visible: true,
    color: "#8899aa",
    lo: Number(id.slice(1)) * 10,
    hi: Number(id.slice(1)) * 10 + 2
  });
  test("a loose source and every generated bay land in one collapsible group", () => {
    const source = { ...part("p1", "Deck"), sourcePath: "/tmp/source.glb" };
    const result = materializePathArrayRows([source], [source.id], [{ lo: 20, hi: 22 }, { lo: 22, hi: 24 }], 7);
    assert(Boolean(result), "valid host ranges were rejected");
    assert(result.parts.every((row) => row.groupId === result.groupId && row.groupName === "Deck Path"), "array rows did not share one folder");
    assert(result.created.map((row) => row.name).join("|") === "Deck (2)|Deck (3)", "duplicate family drifted");
    assert(result.created.map((row) => `${row.lo}-${row.hi}`).join("|") === "20-22|22-24", "host range order was lost");
    assert(result.created.every((row) => !row.sourcePath && !row.mesh), "generated host geometry retained stale seed/file sources");
  });
  test("a multi-part grouped bay preserves member order and folder identity", () => {
    const parts = [part("p1", "Deck", "bridge", "Bridge"), part("p2", "Rail", "bridge", "Bridge"), part("p3", "Loose")];
    const ranges = [{ lo: 40, hi: 42 }, { lo: 42, hi: 44 }, { lo: 44, hi: 46 }, { lo: 46, hi: 48 }];
    const result = materializePathArrayRows(parts, ["p1", "p2"], ranges, 20);
    assert(Boolean(result), "group template was rejected");
    assert(result.groupId === "bridge" && result.groupName === "Bridge", "existing folder identity was replaced");
    assert(result.created.map((row) => row.name).join("|") === "Deck (2)|Rail (2)|Deck (3)|Rail (3)", "bay-major/member-minor order drifted");
    assert(result.parts.find((row) => row.id === "p3")?.groupId === void 0, "unselected loose row was regrouped");
  });
  test("range cardinality and numeric parameters are bounded at the cart boundary", () => {
    const source = part("p1", "Deck");
    assert(materializePathArrayRows([source], ["p1"], [], 1) === null, "empty host result was accepted");
    assert(materializePathArrayRows([source, part("p2", "Rail")], ["p1", "p2"], [{ lo: 9, hi: 10 }], 1) === null, "partial generated bay was accepted");
    const clean = sanitizePathArrayParams({ ...defaultPathArrayParams(), axis: 9, bays: 999, turnDegrees: Number.NaN, riseU: Number.POSITIVE_INFINITY, profile: "wat" });
    assert(clean.axis === 0 && clean.bays === 64 && clean.turnDegrees === 0 && clean.riseU === 0 && clean.profile === "eased", "boundary sanitization drifted");
  });
  test("arc parameters seed editable authoring-space XYZ boundary points", () => {
    const points = arcPathArrayPoints({ ...defaultPathArrayParams(), axis: 0, bays: 3, turnDegrees: 0, riseU: 2, profile: "linear" }, 1);
    assert(points.length === 3, "point count must equal total bays");
    assert(points.map((point) => `${point.xU},${point.yU},${point.zU}`).join("|") === "0,0,0|1,1,0|2,2,0", "straight XYZ seed drifted");
    const extended = appendPathArrayPoint(points, 0, 1);
    assert(extended[3]?.xU === 3 && extended[3]?.yU === 3, "new run did not continue the last vector");
    const clean = sanitizePathArrayParams({ ...defaultPathArrayParams(), points: [{ xU: 99, yU: 99, zU: 99 }, { xU: 2, yU: 1, zU: 0 }] });
    assert(clean.bays === 2 && clean.points?.[0]?.xU === 0 && clean.points?.[0]?.yU === 0, "point zero must stay pinned to the source end");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
