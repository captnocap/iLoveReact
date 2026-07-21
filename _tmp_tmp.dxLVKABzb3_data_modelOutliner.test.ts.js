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
  function withPartGroupPath(part2, path) {
    const clean = path.filter((entry) => Boolean(entry.id && entry.name.trim())).map((entry) => ({ id: entry.id, name: entry.name.trim() }));
    if (clean.length === 0) return withoutPartGroup(part2);
    const leaf = clean[clean.length - 1];
    return { ...part2, groupPath: clean, groupId: leaf.id, groupName: leaf.name };
  }
  function partInGroup(part2, groupId) {
    return partGroupPath(part2).some((entry) => entry.id === groupId);
  }
  function partsInGroup(parts, groupId) {
    return parts.filter((part2) => partInGroup(part2, groupId));
  }
  function groupPathById(parts, groupId) {
    for (const part2 of parts) {
      const path = partGroupPath(part2);
      const index = path.findIndex((entry) => entry.id === groupId);
      if (index >= 0) return path.slice(0, index + 1);
    }
    return null;
  }
  function modelOutlinerRoots(parts) {
    const roots = [];
    const groups = /* @__PURE__ */ new Map();
    for (const part2 of parts) {
      const path = partGroupPath(part2);
      if (path.length === 0) {
        roots.push({ kind: "part", part: part2 });
        continue;
      }
      let siblings = roots;
      for (let depth = 0; depth < path.length; depth += 1) {
        const ref = path[depth];
        let group = groups.get(ref.id);
        if (!group) {
          group = { id: ref.id, name: ref.name, path: path.slice(0, depth + 1), parts: [], children: [] };
          groups.set(ref.id, group);
          siblings.push({ kind: "group", group });
        }
        if (!group.parts.some((member) => member.id === part2.id)) group.parts.push(part2);
        siblings = group.children;
      }
      siblings.push({ kind: "part", part: part2 });
    }
    return roots;
  }
  function nextModelGroupName(parts) {
    const used = new Set(parts.flatMap(partGroupPath).map((group) => group.name));
    let index = 1;
    while (used.has(`${DEFAULT_GROUP_STEM} ${index}`)) index += 1;
    return `${DEFAULT_GROUP_STEM} ${index}`;
  }
  function assignPartsToGroup(parts, partIds, groupId, groupName) {
    const ids = new Set(partIds);
    const name = groupName.trim();
    if (!groupId || !name || ids.size === 0) return parts.slice();
    return parts.map((part2) => ids.has(part2.id) ? withPartGroupPath(part2, [{ id: groupId, name }]) : part2);
  }
  function ungroupParts(parts, partIds) {
    const ids = new Set(partIds);
    return parts.map((part2) => ids.has(part2.id) ? withoutPartGroup(part2) : part2);
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
  function withoutPartGroup(part2) {
    const { groupId: _groupId, groupName: _groupName, groupPath: _groupPath, ...rest } = part2;
    return rest;
  }
  function rewriteGroupPrefix(part2, groupId, destinationParent) {
    const path = partGroupPath(part2);
    const at = path.findIndex((entry) => entry.id === groupId);
    if (at < 0) return part2;
    return withPartGroupPath(part2, [...destinationParent, ...path.slice(at)]);
  }
  function moveOutlinerItem(parts, item, target) {
    const source = item.kind === "part" ? parts.filter((part2) => part2.id === item.id) : partsInGroup(parts, item.id);
    if (source.length === 0) return parts.slice();
    const sourceIds = new Set(source.map((part2) => part2.id));
    const targetPath = target.kind === "root" ? [] : target.kind === "part" ? partGroupPath(parts.find((part2) => part2.id === target.id) ?? source[0]) : groupPathById(parts, target.id) ?? [];
    if (item.kind === "group" && targetPath.some((entry) => entry.id === item.id)) return parts.slice();
    const rewritten = source.map((part2) => {
      if (item.kind === "part") {
        const destination = target.kind === "group" && target.position === "inside" ? targetPath : target.kind === "root" ? [] : targetPath.slice(0, target.kind === "group" ? -1 : void 0);
        return withPartGroupPath(part2, destination);
      }
      const destinationParent = target.kind === "group" && target.position === "inside" ? targetPath : target.kind === "root" ? [] : targetPath.slice(0, target.kind === "group" ? -1 : void 0);
      return rewriteGroupPrefix(part2, item.id, destinationParent);
    });
    const remaining = parts.filter((part2) => !sourceIds.has(part2.id));
    let insertion = remaining.length;
    if (target.kind !== "root") {
      const targetMembers = target.kind === "part" ? remaining.filter((part2) => part2.id === target.id) : partsInGroup(remaining, target.id);
      if (targetMembers.length) {
        const indexes = targetMembers.map((member) => remaining.findIndex((part2) => part2.id === member.id));
        insertion = target.position === "before" ? Math.min(...indexes) : Math.max(...indexes) + 1;
      }
    }
    const next = [...remaining.slice(0, insertion), ...rewritten, ...remaining.slice(insertion)];
    return next.map((part2, outlinerOrder) => ({ ...part2, outlinerOrder }));
  }

  // cart/editor/data/modelOutliner.test.ts
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
  function part(id, name, groupId, groupName) {
    return { id, name, visible: true, color: "#999999", groupId, groupName };
  }
  test("outliner folders gather non-contiguous parts without changing source rows", () => {
    const parts = [part("a", "deck", "g1", "Bridge deck"), part("b", "loose"), part("c", "divider", "g1", "Bridge deck")];
    const roots = modelOutlinerRoots(parts);
    assert(roots.length === 2, "one folder plus one loose root");
    assert(roots[0]?.kind === "group" && roots[0].group.parts.map((p) => p.id).join(",") === "a,c", "folder membership follows ids");
    assert(roots[1]?.kind === "part" && roots[1].part.id === "b", "loose part remains a root");
    assert(parts.map((p) => p.id).join(",") === "a,b,c", "source order is never rewritten");
  });
  test("nested paths derive recursive groups without changing geometry identity", () => {
    const parts = [
      { ...part("a", "hood"), groupPath: [{ id: "body", name: "Body" }, { id: "front", name: "Front" }], lo: 2, hi: 8 },
      { ...part("b", "door"), groupPath: [{ id: "body", name: "Body" }], lo: 8, hi: 12 }
    ];
    const roots = modelOutlinerRoots(parts);
    assert(roots[0]?.kind === "group" && roots[0].group.children[0]?.kind === "group", "nested folder was flattened");
    assert(roots[0]?.kind === "group" && roots[0].group.parts.length === 2, "parent group did not include descendants");
    assert(parts[0]?.lo === 2 && parts[0]?.hi === 8, "tree derivation touched geometry range");
  });
  test("dragging parts and folders reparents paths and persists display order", () => {
    const base = [
      part("a", "loose"),
      { ...part("b", "door", "body", "Body"), groupPath: [{ id: "body", name: "Body" }] },
      { ...part("c", "lamp", "lights", "Lights"), groupPath: [{ id: "lights", name: "Lights" }] }
    ];
    const nestedPart = moveOutlinerItem(base, { kind: "part", id: "a" }, { kind: "group", id: "body", position: "inside" });
    assert(partGroupPath(nestedPart.find((row) => row.id === "a")).map((g) => g.id).join("/") === "body", "part did not enter target group");
    const nestedGroup = moveOutlinerItem(nestedPart, { kind: "group", id: "lights" }, { kind: "group", id: "body", position: "inside" });
    assert(partGroupPath(nestedGroup.find((row) => row.id === "c")).map((g) => g.id).join("/") === "body/lights", "folder did not nest under target");
    assert(nestedGroup.every((row, index) => row.outlinerOrder === index), "display order was not stamped");
    const refusedCycle = moveOutlinerItem(nestedGroup, { kind: "group", id: "body" }, { kind: "group", id: "lights", position: "inside" });
    assert(refusedCycle.map((row) => row.id).join(",") === nestedGroup.map((row) => row.id).join(","), "group cycle was allowed");
  });
  test("duplicate names replace legacy copy chains with one numbered family", () => {
    const names = ["Cube", "Cube copy", "Cube copy copy", "Cube (2)", "Cube (20)"];
    assert(duplicateNameStem("Cube copy copy copy") === "Cube", "legacy copy suffixes collapse");
    assert(duplicateNameStem("Cube (20)") === "Cube", "number suffix collapses to its family");
    assert(nextDuplicatePartName("Cube copy copy", names) === "Cube (21)", "next number follows the family maximum");
    assert(nextDuplicatePartName("Cube", names, "mirror X") === "Cube mirror X", "first mirror has a clean qualifier");
  });
  test("duplicated folders receive their own collision-free numbered family", () => {
    const grouped = [part("a", "deck", "g1", "Bridge"), part("b", "rail", "g2", "Bridge (2)")];
    assert(nextDuplicateGroupName("Bridge", grouped) === "Bridge (3)", "folder copy follows the existing folder family");
    assert(nextDuplicateGroupName("Bridge copy copy", grouped) === "Bridge (3)", "legacy folder copy chains normalize too");
  });
  test("group labels and dissolve semantics are collision-free and non-destructive", () => {
    const grouped = [part("a", "one", "g1", "Group 1"), part("b", "two", "g2", "Group 3")];
    assert(nextModelGroupName(grouped) === "Group 2", "fills the first available label");
    const dissolved = withoutPartGroup({ ...grouped[0], lo: 4, hi: 9 });
    assert(!dissolved.groupId && !dissolved.groupName, "membership is removed");
    assert(dissolved.id === "a" && dissolved.lo === 4 && dissolved.hi === 9, "geometry identity/range survives");
    const loose = [part("a", "one"), { ...part("b", "two"), lo: 10, hi: 12 }, part("c", "three")];
    const assigned = assignPartsToGroup(loose, ["a", "b"], "bridge", "Bridge pieces");
    assert(assigned[0]?.groupId === "bridge" && assigned[1]?.groupId === "bridge" && !assigned[2]?.groupId, "assignment touches only explicit ids");
    const ungrouped = ungroupParts(assigned, ["b"]);
    assert(ungrouped[0]?.groupId === "bridge" && !ungrouped[1]?.groupId, "partial ungroup keeps other members");
    assert(ungrouped[1]?.lo === 10 && ungrouped[1]?.hi === 12, "partial ungroup retains geometry range");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
