(() => {
  // cart/editor/data/modelOutliner.ts
  var DEFAULT_GROUP_STEM = "Group";
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

  // cart/editor/model/outlinerCommand.ts
  var MODEL_PART_NAME_MAX_CHARS = 80;
  var MODEL_PART_RENAME_COMMAND_ID = "model.part.rename";
  var MODEL_PARTS_GROUP_COMMAND_ID = "model.parts.group";
  var MODEL_PARTS_UNGROUP_COMMAND_ID = "model.parts.ungroup";
  var MODEL_GROUP_RENAME_COMMAND_ID = "model.group.rename";
  var MODEL_GROUP_DISSOLVE_COMMAND_ID = "model.group.dissolve";
  var MODEL_OUTLINER_MOVE_COMMAND_ID = "model.outliner.move";
  var ModelOutlinerRejected = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
      this.name = "ModelOutlinerRejected";
    }
    code;
  };
  function cleanRecords(parts) {
    return parts.map(({ mesh: _mesh, ...record }) => ({ ...record }));
  }
  function modelPartRecords(parts) {
    return cleanRecords(parts);
  }
  function modelOutlinerNote(modelId, parts) {
    return JSON.stringify({ modelId, parts });
  }
  function assertSnapshot(snapshot2, modelId) {
    if (!modelId || snapshot2.modelId !== modelId) {
      throw new ModelOutlinerRejected("WRONG_MODEL", "the requested model is not the active model document");
    }
    if (!Number.isInteger(snapshot2.nextSequence) || snapshot2.nextSequence < 0) {
      throw new ModelOutlinerRejected("INVALID_SEQUENCE", "the model identity sequence is invalid");
    }
    const parts = cleanRecords(snapshot2.parts);
    const ids = /* @__PURE__ */ new Set();
    for (const part2 of parts) {
      if (!part2.id || ids.has(part2.id)) throw new ModelOutlinerRejected("INVALID_PARTS", "model part ids must be unique");
      ids.add(part2.id);
    }
    return parts;
  }
  function trimmedName(raw, kind) {
    if (typeof raw !== "string") throw new ModelOutlinerRejected("INVALID_NAME", `${kind} name must be text`);
    const name = raw.trim().slice(0, MODEL_PART_NAME_MAX_CHARS);
    if (!name) throw new ModelOutlinerRejected("INVALID_NAME", `${kind} names cannot be blank`);
    return name;
  }
  function exactPartIds(parts, rawIds) {
    if (!Array.isArray(rawIds)) throw new ModelOutlinerRejected("INVALID_SELECTION", "part ids must be an array");
    const ids = [...new Set(rawIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (ids.length !== rawIds.length || ids.some((id) => !parts.some((part2) => part2.id === id))) {
      throw new ModelOutlinerRejected("INVALID_SELECTION", "the part selection contains a missing or duplicate row");
    }
    return ids;
  }
  function plan(snapshot2, commandId, action, label, status, partIds, after, nextSequence = snapshot2.nextSequence, groupId) {
    const before = cleanRecords(snapshot2.parts);
    return {
      label,
      status,
      next: { modelId: snapshot2.modelId, parts: cleanRecords(after), nextSequence },
      transaction: {
        action,
        commandId,
        modelId: snapshot2.modelId,
        partIds: [...partIds],
        ...groupId ? { groupId } : {},
        before,
        after: cleanRecords(after)
      }
    };
  }
  function planPartRename(snapshot2, args) {
    const parts = assertSnapshot(snapshot2, args.modelId);
    const part2 = parts.find((candidate) => candidate.id === args.partId);
    if (!part2) throw new ModelOutlinerRejected("PART_NOT_FOUND", "part not found");
    const name = trimmedName(args.name, "part");
    if (part2.name === name) throw new ModelOutlinerRejected("NO_CHANGE", "part already has that name");
    const after = parts.map((candidate) => candidate.id === part2.id ? { ...candidate, name } : candidate);
    return plan(
      snapshot2,
      MODEL_PART_RENAME_COMMAND_ID,
      "part.rename",
      `rename part ${part2.name} \u2192 ${name}`,
      `renamed Outliner part "${part2.name}" \u2192 "${name}"`,
      [part2.id],
      after
    );
  }
  function planPartsGroup(snapshot2, args) {
    const parts = assertSnapshot(snapshot2, args.modelId);
    const ids = exactPartIds(parts, args.partIds);
    if (ids.length < 2) throw new ModelOutlinerRejected("TOO_FEW_PARTS", "group parts: select at least two outliner rows");
    const selected = ids.map((id) => parts.find((part2) => part2.id === id));
    const existingGroupIds = [...new Set(selected.map((part2) => part2.groupId).filter((id) => Boolean(id)))];
    const addToExisting = existingGroupIds.length === 1 && selected.some((part2) => part2.groupId !== existingGroupIds[0]);
    if (existingGroupIds.length === 1 && !addToExisting && selected.every((part2) => part2.groupId === existingGroupIds[0])) {
      throw new ModelOutlinerRejected("NO_CHANGE", `${selected.length} selected parts are already in ${selected[0].groupName ?? "group"}`);
    }
    const groupId = addToExisting ? existingGroupIds[0] : `part-group:${snapshot2.nextSequence}`;
    const groupName = addToExisting ? parts.find((part2) => part2.groupId === groupId)?.groupName ?? nextModelGroupName(parts) : nextModelGroupName(parts);
    const after = assignPartsToGroup(parts, ids, groupId, groupName);
    return plan(
      snapshot2,
      MODEL_PARTS_GROUP_COMMAND_ID,
      "parts.group",
      addToExisting ? `add ${ids.length} parts to ${groupName}` : `group ${ids.length} parts as ${groupName}`,
      addToExisting ? `added selected parts to ${groupName}` : `grouped ${ids.length} parts as ${groupName}`,
      ids,
      after,
      addToExisting ? snapshot2.nextSequence : snapshot2.nextSequence + 1,
      groupId
    );
  }
  function planPartsUngroup(snapshot2, args) {
    const parts = assertSnapshot(snapshot2, args.modelId);
    const ids = exactPartIds(parts, args.partIds);
    const count = parts.filter((part2) => ids.includes(part2.id) && part2.groupId).length;
    if (count === 0) throw new ModelOutlinerRejected("NO_CHANGE", "ungroup parts: the selected parts are already at the root");
    const after = ungroupParts(parts, ids);
    return plan(
      snapshot2,
      MODEL_PARTS_UNGROUP_COMMAND_ID,
      "parts.ungroup",
      `ungroup ${count} part${count === 1 ? "" : "s"}`,
      `moved ${count} selected part${count === 1 ? "" : "s"} to the outliner root \u2014 geometry kept`,
      ids,
      after
    );
  }
  function planGroupRename(snapshot2, args) {
    const parts = assertSnapshot(snapshot2, args.modelId);
    const members = partsInGroup(parts, args.groupId);
    if (!args.groupId || members.length === 0) throw new ModelOutlinerRejected("GROUP_NOT_FOUND", "part group not found");
    const name = trimmedName(args.name, "group");
    const previousName = partGroupPath(members[0]).find((group) => group.id === args.groupId)?.name ?? "Group";
    if (previousName === name) throw new ModelOutlinerRejected("NO_CHANGE", "group already has that name");
    if (parts.some((part2) => partGroupPath(part2).some((group) => group.id !== args.groupId && group.name.toLowerCase() === name.toLowerCase()))) {
      throw new ModelOutlinerRejected("DUPLICATE_NAME", `group name already in use: ${name}`);
    }
    const after = parts.map((part2) => withPartGroupPath(part2, partGroupPath(part2).map((group) => group.id === args.groupId ? { ...group, name } : group)));
    return plan(
      snapshot2,
      MODEL_GROUP_RENAME_COMMAND_ID,
      "group.rename",
      `rename group ${previousName} \u2192 ${name}`,
      `renamed group "${previousName}" \u2192 "${name}"`,
      members.map((part2) => part2.id),
      after,
      snapshot2.nextSequence,
      args.groupId
    );
  }
  function planGroupDissolve(snapshot2, args) {
    const parts = assertSnapshot(snapshot2, args.modelId);
    const members = partsInGroup(parts, args.groupId);
    if (!args.groupId || members.length === 0) throw new ModelOutlinerRejected("GROUP_NOT_FOUND", "part group not found");
    const name = partGroupPath(members[0]).find((group) => group.id === args.groupId)?.name ?? "Group";
    const ids = members.map((part2) => part2.id);
    const after = parts.map((part2) => withPartGroupPath(part2, partGroupPath(part2).filter((group) => group.id !== args.groupId)));
    return plan(
      snapshot2,
      MODEL_GROUP_DISSOLVE_COMMAND_ID,
      "group.dissolve",
      `dissolve ${name}`,
      `dissolved ${name} \u2014 kept ${members.length} independent part${members.length === 1 ? "" : "s"}`,
      ids,
      after,
      snapshot2.nextSequence,
      args.groupId
    );
  }
  function planOutlinerMove(snapshot2, args) {
    const parts = assertSnapshot(snapshot2, args.modelId);
    if (!args.item || args.item.kind !== "part" && args.item.kind !== "group" || typeof args.item.id !== "string") {
      throw new ModelOutlinerRejected("INVALID_DRAG", "outliner drag source is invalid");
    }
    if (!args.target || !["root", "part", "group"].includes(args.target.kind)) {
      throw new ModelOutlinerRejected("INVALID_DROP", "outliner drop target is invalid");
    }
    const drop = args.target;
    if (drop.kind !== "root" && (typeof drop.id !== "string" || !["before", "after", "inside"].includes(drop.position) || drop.kind === "part" && drop.position === "inside" || !parts.some((part2) => drop.kind === "part" ? part2.id === drop.id : partGroupPath(part2).some((group) => group.id === drop.id)))) {
      throw new ModelOutlinerRejected("INVALID_DROP", "outliner drop destination does not exist");
    }
    const after = moveOutlinerItem(parts, args.item, args.target);
    if (after.map((part2) => `${part2.id}:${JSON.stringify(partGroupPath(part2))}`).join("|") === parts.map((part2) => `${part2.id}:${JSON.stringify(partGroupPath(part2))}`).join("|")) {
      throw new ModelOutlinerRejected("NO_CHANGE", "outliner item is already there");
    }
    const moved = args.item.kind === "part" ? after.filter((part2) => part2.id === args.item.id) : partsInGroup(after, args.item.id);
    return plan(
      snapshot2,
      MODEL_OUTLINER_MOVE_COMMAND_ID,
      "outliner.move",
      `move ${args.item.kind} ${args.item.id}`,
      `moved ${args.item.kind} in Outliner`,
      moved.map((part2) => part2.id),
      after
    );
  }

  // cart/editor/model/outlinerCommand.test.ts
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
    color: "#999999",
    lo: Number(id.length),
    hi: Number(id.length) + 2
  });
  var snapshot = (parts, nextSequence = 8) => ({ modelId: "model-a", parts: modelPartRecords(parts), nextSequence });
  test("rename records an exact before/after metadata transaction", () => {
    const before = [part("a", "Door"), part("bb", "Frame")];
    const result = planPartRename(snapshot(before), { modelId: "model-a", partId: "a", name: "  Front Door  " });
    assert(result.next.parts[0]?.name === "Front Door", "trimmed name not applied");
    assert(result.transaction.before[0]?.name === "Door", "before snapshot was mutated");
    assert(result.transaction.after[0]?.lo === before[0]?.lo, "host range metadata was lost");
  });
  test("group, partial ungroup, rename, and dissolve preserve part identity", () => {
    const base = snapshot([part("a", "Deck"), part("b", "Rail"), part("c", "Lamp")], 12);
    const grouped = planPartsGroup(base, { modelId: "model-a", partIds: ["a", "b"] });
    assert(grouped.transaction.groupId === "part-group:12" && grouped.next.nextSequence === 13, "fresh group identity was not deterministic");
    assert(grouped.next.parts[2]?.groupId === void 0, "unselected part was regrouped");
    const renamed = planGroupRename(grouped.next, { modelId: "model-a", groupId: "part-group:12", name: "Bridge" });
    assert(renamed.next.parts.slice(0, 2).every((row) => row.groupName === "Bridge"), "group label did not update every member");
    const ungrouped = planPartsUngroup(renamed.next, { modelId: "model-a", partIds: ["a"] });
    assert(!ungrouped.next.parts[0]?.groupId && ungrouped.next.parts[1]?.groupId === "part-group:12", "partial ungroup changed the wrong rows");
    const dissolved = planGroupDissolve(ungrouped.next, { modelId: "model-a", groupId: "part-group:12" });
    assert(dissolved.next.parts.every((row) => !row.groupId), "dissolve left group metadata behind");
    assert(dissolved.next.parts.map((row) => row.id).join(",") === "a,b,c", "organizational commands reordered parts");
  });
  test("adding loose parts to one selected group reuses that group identity", () => {
    const base = snapshot([part("a", "Deck", "g", "Bridge"), part("b", "Rail"), part("c", "Lamp")], 20);
    const result = planPartsGroup(base, { modelId: "model-a", partIds: ["a", "b"] });
    assert(result.transaction.groupId === "g" && result.next.nextSequence === 20, "existing group was replaced instead of extended");
    assert(result.next.parts[1]?.groupName === "Bridge", "loose row did not join the group");
  });
  test("outliner move is one exact journal transaction and nested dissolve keeps children", () => {
    const base = snapshot([
      part("a", "Loose"),
      { ...part("b", "Door", "body", "Body"), groupPath: [{ id: "body", name: "Body" }] },
      { ...part("c", "Lamp", "lights", "Lights"), groupPath: [{ id: "lights", name: "Lights" }] }
    ]);
    const moved = planOutlinerMove(base, {
      modelId: "model-a",
      item: { kind: "group", id: "lights" },
      target: { kind: "group", id: "body", position: "inside" }
    });
    assert(moved.transaction.action === "outliner.move" && moved.transaction.before[2]?.groupId === "lights", "move did not retain an exact inverse");
    assert(moved.next.parts.find((row) => row.id === "c")?.groupPath?.map((g) => g.id).join("/") === "body/lights", "move plan flattened nested folder");
    const dissolved = planGroupDissolve(moved.next, { modelId: "model-a", groupId: "body" });
    assert(dissolved.next.parts.find((row) => row.id === "c")?.groupPath?.map((g) => g.id).join("/") === "lights", "dissolving parent destroyed child folder");
  });
  test("invalid and inert requests reject before a mutation plan exists", () => {
    const base = snapshot([part("a", "Deck", "g", "Bridge"), part("b", "Rail", "g", "Bridge")]);
    const rejects = [
      () => planPartRename(base, { modelId: "model-a", partId: "a", name: "Deck" }),
      () => planPartsGroup(base, { modelId: "model-a", partIds: ["a", "b"] }),
      () => planPartsUngroup(base, { modelId: "model-a", partIds: [] }),
      () => planGroupRename(base, { modelId: "model-a", groupId: "g", name: " " }),
      () => planGroupDissolve(base, { modelId: "other", groupId: "g" })
    ];
    for (const reject of rejects) {
      let threw = false;
      try {
        reject();
      } catch (error) {
        threw = error instanceof ModelOutlinerRejected;
      }
      assert(threw, "invalid request was not rejected by the domain boundary");
    }
  });
  test("journal notes exclude mesh blobs while retaining exact durable metadata", () => {
    const withMesh = { ...part("a", "Deck"), mesh: { vertices: [], faces: [] } };
    const note = modelOutlinerNote("model-a", modelPartRecords([withMesh]));
    assert(!note.includes('"mesh"'), "mesh geometry leaked into the journal note");
    assert(note.includes('"modelId":"model-a"') && note.includes('"name":"Deck"'), "journal note lost identity metadata");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
