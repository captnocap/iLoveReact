(() => {
  // cart/editor/data/modelPackage.ts
  var MODEL_MANIFEST_VERSION = 1;
  function modelSlug(id) {
    return id.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
  function modelFolderIdFor(id) {
    return `model-${modelSlug(id)}`;
  }
  function packageToManifest(pkg) {
    return {
      version: MODEL_MANIFEST_VERSION,
      id: pkg.id,
      name: pkg.name,
      kind: pkg.kind,
      stage: pkg.stage,
      favorite: pkg.favorite,
      hidden: pkg.hidden,
      folderId: pkg.folderId,
      semanticKind: pkg.semanticKind,
      sourceKind: pkg.sourceKind,
      color: pkg.color,
      rig: pkg.rig,
      data: pkg.data,
      triangles: pkg.triangles,
      lods: pkg.lods,
      mesh: { viewerPath: pkg.viewerPath, viewerMeshRef: pkg.viewerMeshRef },
      decompositions: pkg.decompositions,
      atlases: pkg.atlases,
      paints: pkg.paints,
      placeable: pkg.placeable,
      skeleton: pkg.skeleton,
      textureSlots: pkg.textureSlots
    };
  }
  function manifestToPackage(manifest, dir) {
    return {
      id: manifest.id,
      // Derived from the id (not the stored folderId) so every model has its own
      // home node even if an older manifest wrote a shared per-kind folderId.
      folderId: modelFolderIdFor(manifest.id),
      name: manifest.name,
      path: `/${dir}`,
      kind: manifest.kind,
      stage: manifest.stage,
      favorite: manifest.favorite,
      hidden: manifest.hidden,
      color: manifest.color,
      source: `${dir}/manifest.json`,
      viewerPath: manifest.mesh.viewerPath,
      viewerMeshRef: manifest.mesh.viewerMeshRef,
      rig: manifest.rig,
      data: manifest.data,
      triangles: manifest.triangles,
      lods: manifest.lods,
      decompositions: manifest.decompositions,
      atlases: manifest.atlases,
      paints: manifest.paints,
      sourceKind: manifest.sourceKind,
      semanticKind: manifest.semanticKind,
      placeable: manifest.placeable,
      skeleton: manifest.skeleton,
      textureSlots: manifest.textureSlots,
      // A saved primitive package re-arms its generator on load (semanticKind IS the
      // seed kind), so reopening it from disk still builds viewable geometry — the
      // manifest carries identity; mesh-blob readback is a later slice.
      primitive: manifest.sourceKind === "primitive" ? manifest.semanticKind : void 0
    };
  }

  // cart/editor/data/modelPackage.test.ts
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
  test("face texture roles retain stable ids and labels through manifest persistence", () => {
    const pkg = {
      id: "prop:textured-chair",
      folderId: "model-prop_textured-chair",
      name: "Textured Chair",
      path: "/tmp/textured-chair",
      kind: "prop",
      stage: "wip",
      color: "#778899",
      source: "/tmp/textured-chair/manifest.json",
      rig: "plain",
      data: "studio",
      triangles: 12,
      lods: 1,
      decompositions: [],
      atlases: [],
      paints: [],
      textureSlots: [{ id: "seat_cloth", label: "Seat Cloth" }, { id: "frame", label: "Frame" }]
    };
    const restored = manifestToPackage(packageToManifest(pkg), "cart/editor/data/models/props/textured-chair");
    assert(restored.textureSlots?.length === 2, "texture roles were dropped");
    assert(restored.textureSlots?.[0]?.id === "seat_cloth", "stable role id changed");
    assert(restored.textureSlots?.[1]?.label === "Frame", "role label changed");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
