(() => {
  // cart/editor/world/floraKinds.ts
  var FLORA_SPEC = {
    grass: 0,
    bush: 1,
    flowers: 2,
    palm: 3,
    pine: 4,
    maple: 5,
    oak: 6,
    cedar: 7,
    spruce: 8,
    tallGrass: 9,
    reeds: 10,
    lowBush: 11,
    denseBush: 12,
    hydrangeaMophead: 13,
    hydrangeaPanicle: 14,
    leafyThicket: 15,
    wildWeedBush: 16
  };
  var FLORA_KIND_DEFINITIONS = [
    { kind: "grassSparse", label: "Grass (Sparse)", color: "#6f9a52", lane: "grass", population: { spec: FLORA_SPEC.grass, count: 3, chance: 1 } },
    { kind: "grassMed", label: "Grass", color: "#4f8a34", lane: "grass", population: { spec: FLORA_SPEC.grass, count: 7, chance: 1 } },
    { kind: "grassLush", label: "Grass (Lush)", color: "#2f6b28", lane: "grass", population: { spec: FLORA_SPEC.grass, count: 16, chance: 1 } },
    { kind: "grassDry", label: "Dry Grass", color: "#9a8f4a", lane: "grass", population: { spec: FLORA_SPEC.grass, count: 7, chance: 1 } },
    { kind: "palmSparse", label: "Palm Tree (Sparse)", color: "#3f7a4a", lane: "tree", population: { spec: FLORA_SPEC.palm, count: 0, chance: 0.08 } },
    { kind: "palmMed", label: "Palm Trees", color: "#2f6b3a", lane: "tree", population: { spec: FLORA_SPEC.palm, count: 0, chance: 0.22 } },
    { kind: "palmDense", label: "Palm Tree (Dense)", color: "#1f5230", lane: "tree", population: { spec: FLORA_SPEC.palm, count: 0, chance: 0.7 } },
    { kind: "bush", label: "Bush", color: "#356326", lane: "bush", population: { spec: FLORA_SPEC.bush, count: 14, chance: 1 } },
    { kind: "grassFlowers", label: "Flower Grass", color: "#d77ab6", lane: "grass", population: { spec: FLORA_SPEC.flowers, count: 6, chance: 1 } },
    { kind: "pine", label: "NW Pine", color: "#245d35", lane: "tree", population: { spec: FLORA_SPEC.pine, count: 0, chance: 0.22 } },
    { kind: "maple", label: "Maple Tree", color: "#4f7f32", lane: "tree", population: { spec: FLORA_SPEC.maple, count: 0, chance: 0.18 } },
    { kind: "oak", label: "Oak Tree", color: "#3f6c2b", lane: "tree", population: { spec: FLORA_SPEC.oak, count: 0, chance: 0.14 } },
    { kind: "cedar", label: "Western Red Cedar", color: "#1f5b4a", lane: "tree", population: { spec: FLORA_SPEC.cedar, count: 0, chance: 0.2 } },
    { kind: "spruce", label: "Spruce Tree", color: "#1c5144", lane: "tree", population: { spec: FLORA_SPEC.spruce, count: 0, chance: 0.22 } },
    { kind: "grassTall", label: "Tall Grass", color: "#5c8738", lane: "grass", population: { spec: FLORA_SPEC.tallGrass, count: 8, chance: 1 } },
    { kind: "grassReeds", label: "Reeds", color: "#8b8a42", lane: "grass", population: { spec: FLORA_SPEC.reeds, count: 6, chance: 1 } },
    { kind: "bushLow", label: "Low Bush", color: "#2f5e2a", lane: "bush", population: { spec: FLORA_SPEC.lowBush, count: 10, chance: 1 } },
    { kind: "bushDense", label: "Dense Bush", color: "#214b23", lane: "bush", population: { spec: FLORA_SPEC.denseBush, count: 22, chance: 1 } },
    { kind: "hydrangeaMophead", label: "Hydrangea (Mophead)", color: "#b94fa9", lane: "bush", population: { spec: FLORA_SPEC.hydrangeaMophead, count: 0, chance: 1 } },
    { kind: "hydrangeaPanicle", label: "Hydrangea (Panicle)", color: "#e8b5b1", lane: "bush", population: { spec: FLORA_SPEC.hydrangeaPanicle, count: 0, chance: 1 } },
    { kind: "leafyThicket", label: "Leafy Thicket", color: "#245b2e", lane: "bush", population: { spec: FLORA_SPEC.leafyThicket, count: 0, chance: 1 } },
    { kind: "wildWeedBush", label: "Wild Weed Bush", color: "#39723b", lane: "bush", population: { spec: FLORA_SPEC.wildWeedBush, count: 0, chance: 1 } }
  ];
  var FLORA_SPECS = new Float32Array(
    FLORA_KIND_DEFINITIONS.flatMap(({ population }) => [population.spec, population.count, population.chance])
  );

  // cart/editor/world/floraKinds.test.ts
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
  test("original painter legend indices never move", () => {
    const original = ["grassSparse", "grassMed", "grassLush", "grassDry", "palmSparse", "palmMed", "palmDense", "bush", "grassFlowers"];
    assert(
      FLORA_KIND_DEFINITIONS.slice(0, original.length).map((d) => d.kind).join(",") === original.join(","),
      "the persisted first-nine flora legend changed"
    );
  });
  test("one catalog definition owns exactly one host triple", () => {
    assert(FLORA_SPECS.length === FLORA_KIND_DEFINITIONS.length * 3, "spec payload and legend length drifted");
    FLORA_KIND_DEFINITIONS.forEach((def, index) => {
      const at = index * 3;
      assert(FLORA_SPECS[at] === def.population.spec, `${def.kind} spec drifted`);
      assert(FLORA_SPECS[at + 1] === def.population.count, `${def.kind} count drifted`);
      assert(Math.abs(FLORA_SPECS[at + 2] - def.population.chance) < 1e-6, `${def.kind} chance drifted`);
    });
  });
  test("new tree species append to the tree lane with distinct recipes", () => {
    const trees = FLORA_KIND_DEFINITIONS.filter((d) => ["pine", "maple", "oak", "cedar", "spruce"].includes(d.kind));
    assert(trees.length === 5, `expected five new species, got ${trees.length}`);
    assert(trees.every((d) => d.lane === "tree" && d.population.count === 0 && d.population.chance > 0), "tree recipe shape is wrong");
    assert(new Set(trees.map((d) => d.population.spec)).size === trees.length, "tree species share a recipe id");
    assert(trees.map((d) => d.population.spec).join(",") === [FLORA_SPEC.pine, FLORA_SPEC.maple, FLORA_SPEC.oak, FLORA_SPEC.cedar, FLORA_SPEC.spruce].join(","), "tree recipe order drifted");
  });
  test("grass and bush shape variants stay in their structural lanes", () => {
    for (const kind of ["grassTall", "grassReeds"]) {
      assert(FLORA_KIND_DEFINITIONS.find((d) => d.kind === kind)?.lane === "grass", `${kind} left grass lane`);
    }
    for (const kind of ["bushLow", "bushDense"]) {
      assert(FLORA_KIND_DEFINITIONS.find((d) => d.kind === kind)?.lane === "bush", `${kind} left bush lane`);
    }
  });
  test("wrapped shrub recipes append as one whole 24-byte instance per painted cell", () => {
    const expected = [
      ["hydrangeaMophead", FLORA_SPEC.hydrangeaMophead],
      ["hydrangeaPanicle", FLORA_SPEC.hydrangeaPanicle],
      ["leafyThicket", FLORA_SPEC.leafyThicket],
      ["wildWeedBush", FLORA_SPEC.wildWeedBush]
    ];
    const appended = FLORA_KIND_DEFINITIONS.slice(-expected.length);
    assert(appended.map((d) => d.kind).join(",") === expected.map(([kind]) => kind).join(","), "wrapped shrubs are not append-only");
    appended.forEach((def, index) => {
      assert(def.lane === "bush", `${def.kind} left the bush lane`);
      assert(def.population.spec === expected[index][1], `${def.kind} recipe id drifted`);
      assert(def.population.count === 0 && def.population.chance === 1, `${def.kind} must emit one shared-mesh row`);
    });
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
