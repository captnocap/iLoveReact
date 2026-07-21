(() => {
  // cart/editor/data/modelIdentity.ts
  function allocatePrimitiveModelId(kind, docs, catalog, durableIdExists) {
    const taken = (n2) => {
      const id = `primitive:${kind}:${n2}`;
      return durableIdExists(id) || catalog.some((model) => model.id === id || model.name === `Model ${n2}`) || docs.some((doc) => doc.kind === "model" && doc.sourceId?.startsWith("primitive:") && doc.sourceId.endsWith(`:${n2}`));
    };
    let n = 1;
    while (taken(n)) n += 1;
    return `primitive:${kind}:${n}`;
  }
  var PLAYER_MODEL_ID_PREFIX = "character:player:";
  var BUILD_STARTER_MODEL_ID_PREFIX = "starter:build:";
  function allocateBuildStarterModelId(starterId, docs, catalog, durableIdExists) {
    const prefix = `${BUILD_STARTER_MODEL_ID_PREFIX}${starterId}:`;
    const taken = (n2) => {
      const id = `${prefix}${n2}`;
      return durableIdExists(id) || catalog.some((model) => model.id === id) || docs.some((doc) => doc.kind === "model" && doc.sourceId === id);
    };
    let n = 1;
    while (taken(n)) n += 1;
    return `${prefix}${n}`;
  }
  function allocatePlayerModelId(docs, catalog, durableIdExists) {
    const taken = (n2) => {
      const id = `${PLAYER_MODEL_ID_PREFIX}${n2}`;
      return durableIdExists(id) || catalog.some((model) => model.id === id || model.name === `Player Model ${n2}`) || docs.some((doc) => doc.kind === "model" && doc.sourceId === id);
    };
    let n = 1;
    while (taken(n)) n += 1;
    return `${PLAYER_MODEL_ID_PREFIX}${n}`;
  }

  // cart/editor/data/modelIdentity.test.ts
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
  test("disk truth reserves a primitive id even when the browser catalog omitted it", () => {
    const next = allocatePrimitiveModelId("cylinder", [], [], (id) => id === "primitive:cylinder:1");
    assert(next === "primitive:cylinder:2", `reused stored cylinder id: ${next}`);
  });
  test("disk truth also reserves player starter identities", () => {
    const docs = [];
    const next = allocatePlayerModelId(docs, [], (id) => id === "character:player:1");
    assert(next === "character:player:2", `reused stored player id: ${next}`);
  });
  test("build starters reserve identities per semantic kind", () => {
    const docs = [{ id: "model:starter:build:wall:1", kind: "model", title: "Wall Piece 1", sourceId: "starter:build:wall:1" }];
    const wall = allocateBuildStarterModelId("wall", docs, [], () => false);
    const floor = allocateBuildStarterModelId("floor", docs, [], (id) => id === "starter:build:floor:1");
    assert(wall === "starter:build:wall:2", `reused open wall starter id: ${wall}`);
    assert(floor === "starter:build:floor:2", `reused stored floor starter id: ${floor}`);
    const door = allocateBuildStarterModelId("door-wall", docs, [], (id) => id === "starter:build:door-wall:1");
    assert(door === "starter:build:door-wall:2", `door variant collided with the base wall identity: ${door}`);
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
