(() => {
  // cart/editor/model/nativeMeshEvents.ts
  var NATIVE_MESH_ACTIONS = [
    { kind: "extrude-face", label: "extrude face", commandId: "model.mesh.extrude-face" },
    { kind: "extrude-edge", label: "extrude edge", commandId: "model.mesh.extrude-edge" },
    { kind: "create-face", label: "create face", commandId: "model.mesh.create-face" },
    { kind: "loop-cut", label: "loop cut", commandId: "model.mesh.loop-cut" },
    { kind: "symmetrize", label: "symmetrize", commandId: "model.mesh.symmetrize" },
    { kind: "delete-selection", label: "delete selection", commandId: "model.mesh.delete-selection" },
    { kind: "delete-part", label: "delete part", commandId: "model.mesh.delete-part" },
    { kind: "add-part", label: "add part", commandId: "model.mesh.add-part" },
    { kind: "hide-part", label: "hide part", commandId: "model.mesh.hide-part" },
    { kind: "show-part", label: "show part", commandId: "model.mesh.show-part" },
    { kind: "duplicate-part", label: "duplicate part", commandId: "model.mesh.duplicate-part" },
    { kind: "mirror-part", label: "mirror part", commandId: "model.mesh.mirror-part" },
    { kind: "path-array", label: "path array", commandId: "model.mesh.path-array" },
    { kind: "detach-faces", label: "detach faces", commandId: "model.mesh.detach-faces" },
    { kind: "merge-parts", label: "merge parts", commandId: "model.mesh.merge-parts" },
    { kind: "flip-faces", label: "flip faces", commandId: "model.mesh.flip-faces" },
    { kind: "merge-faces", label: "merge faces", commandId: "model.mesh.merge-faces" },
    { kind: "glass-faces", label: "glass faces", commandId: "model.mesh.glass-faces" },
    { kind: "solidify-faces", label: "solidify faces", commandId: "model.mesh.solidify-faces" },
    { kind: "split-quads", label: "split quads", commandId: "model.mesh.split-quads" },
    { kind: "transform", label: "transform", commandId: "model.mesh.transform" },
    { kind: "nudge", label: "nudge", commandId: "model.mesh.nudge" },
    { kind: "scale-by-value", label: "scale by value", commandId: "model.mesh.scale-by" }
  ];
  var NATIVE_MESH_PHASES = ["applied", "undone", "redone"];
  var NATIVE_MESH_SOURCES = [
    "native",
    "menu",
    "hotkey",
    "toolbar",
    "dock",
    "context-menu",
    "palette",
    "viewport",
    "remote",
    "automation"
  ];
  var NATIVE_MESH_EVENT_WORDS = 10;
  function intValue(raw) {
    return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  }
  function modelDocumentToken(modelId) {
    let hash = 2166136261;
    for (let i = 0; i < modelId.length; i += 1) {
      hash = Math.imul(hash ^ modelId.charCodeAt(i), 16777619) >>> 0;
    }
    return hash & 2147483647 || 1;
  }
  function nativeMeshActionSourceOrdinal(source) {
    const normalized = source === "action bar" ? "toolbar" : source === "context" ? "context-menu" : source === "stage" ? "viewport" : source === "focus-panel" ? "dock" : source === "device" ? "native" : source;
    const index = NATIVE_MESH_SOURCES.indexOf(normalized);
    return index < 0 ? NATIVE_MESH_SOURCES.indexOf("automation") : index;
  }
  function withNativeMeshActionSource(source, mutate) {
    const setSource = globalThis.__mesh_action_source;
    setSource?.(nativeMeshActionSourceOrdinal(source));
    try {
      return mutate();
    } finally {
      setSource?.(0);
    }
  }
  function decodeNativeMeshActions(buffer) {
    if (!buffer) return [];
    const values = new Uint32Array(buffer);
    const available = Math.floor(Math.max(0, values.length - 1) / NATIVE_MESH_EVENT_WORDS);
    const count = Math.min(intValue(values[0]), available);
    const reports = [];
    for (let i = 0; i < count; i += 1) {
      const base = 1 + i * NATIVE_MESH_EVENT_WORDS;
      const action = NATIVE_MESH_ACTIONS[intValue(values[base + 2])];
      if (!action) continue;
      const phase = NATIVE_MESH_PHASES[intValue(values[base + 3])] ?? "applied";
      const source = NATIVE_MESH_SOURCES[intValue(values[base + 4])] ?? "native";
      reports.push({
        id: intValue(values[base]),
        documentToken: intValue(values[base + 1]),
        kind: action.kind,
        label: action.label,
        commandId: action.commandId,
        phase,
        source,
        beforeVertices: intValue(values[base + 5]),
        afterVertices: intValue(values[base + 6]),
        beforeParts: intValue(values[base + 7]),
        afterParts: intValue(values[base + 8]),
        droppedBefore: intValue(values[base + 9])
      });
    }
    return reports;
  }

  // cart/editor/model/nativeMeshEvents.test.ts
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
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  test("semantic ordinals preserve the native journal contract", () => {
    assert(NATIVE_MESH_ACTIONS.length === 23, `expected all 23 native actions, got ${NATIVE_MESH_ACTIONS.length}`);
    assert(NATIVE_MESH_ACTIONS[0]?.commandId === "model.mesh.extrude-face", "first ordinal drifted");
    assert(NATIVE_MESH_ACTIONS[14]?.commandId === "model.mesh.merge-parts", "merge ordinal drifted");
    assert(NATIVE_MESH_ACTIONS[20]?.commandId === "model.mesh.transform", "transform ordinal drifted");
    assert(NATIVE_MESH_ACTIONS[22]?.commandId === "model.mesh.scale-by", "last ordinal drifted");
  });
  test("document tokens are stable, distinct, nonzero, and bridge-exact", () => {
    const bridge = modelDocumentToken("models/bridge");
    assert(bridge === modelDocumentToken("models/bridge"), "same document changed tokens");
    assert(bridge !== modelDocumentToken("models/other"), "ordinary model ids collided");
    assert(bridge > 0 && bridge <= 2147483647, `token escaped positive bridge range: ${bridge}`);
    assert(new Uint32Array([bridge])[0] === bridge, "token did not survive Uint32 exactly");
  });
  test("one fixed native row decodes identity, phase, source, and counts", () => {
    const row = new Uint32Array(11);
    row.set([1, 41, 99, 20, 1, 7, 24, 24, 2, 2, 3]);
    const report = decodeNativeMeshActions(row.buffer)[0];
    assert(report.id === 41 && report.documentToken === 99, "action/document identity drifted");
    assert(report.kind === "transform" && report.commandId === "model.mesh.transform", "semantic action drifted");
    assert(report.phase === "undone" && report.source === "viewport", "phase/source drifted");
    assert(report.beforeVertices === 24 && report.afterVertices === 24, "vertex counts drifted");
    assert(report.beforeParts === 2 && report.afterParts === 2 && report.droppedBefore === 3, "part/overflow counts drifted");
  });
  test("source scope always resets to native, including after a throw", () => {
    const writes = [];
    const prior = globalThis.__mesh_action_source;
    globalThis.__mesh_action_source = (ordinal) => writes.push(ordinal);
    assert(nativeMeshActionSourceOrdinal("focus-panel") === 4, "focus panel did not normalize to dock");
    withNativeMeshActionSource("action bar", () => 1);
    try {
      withNativeMeshActionSource("hotkey", () => {
        throw new Error("expected");
      });
    } catch {
    }
    globalThis.__mesh_action_source = prior;
    assert(writes.join(",") === "3,0,2,0", `source scope leaked: ${writes.join(",")}`);
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) globalThis.__exit?.(1);
})();
