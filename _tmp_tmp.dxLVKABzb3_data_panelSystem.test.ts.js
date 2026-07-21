(() => {
  // cart/editor/data/panelSystem.ts
  var ASSETS = { id: "assets", label: "All assets", icon: "FolderTree", renderer: "library", folder: "game" };
  var BUILD = { id: "build", label: "Build assets", icon: "Blocks", renderer: "library", folder: "architecture" };
  var MODELS = { id: "models", label: "Models", icon: "Box", renderer: "library", folder: "models" };
  var MATERIALS = { id: "materials", label: "Materials", icon: "Palette", renderer: "library", folder: "materials" };
  var CHARACTERS = { id: "characters", label: "Characters", icon: "UserRound", renderer: "library", folder: "characters" };
  var MISSIONS = { id: "missions", label: "Mission assets", icon: "Map", renderer: "library", folder: "missions" };
  var PAINT = { id: "paint", label: "Paint", icon: "Paintbrush", renderer: "paint" };
  var WORLD_BIBLE = { id: "world-bible", label: "World Bible index", icon: "BookOpen", renderer: "world-bible" };
  var WORLD_LEFT = [ASSETS, BUILD, MODELS, MATERIALS, CHARACTERS, MISSIONS];
  var MODEL_LEFT = [MODELS, MATERIALS];
  var MATERIAL_LEFT = [MATERIALS, MODELS];
  var ANIMATION_LEFT = [CHARACTERS, MODELS];
  var FACADE_LEFT = [MATERIALS, MODELS];
  var MODEL_PAINT_LEFT = [PAINT, MODELS, MATERIALS];
  var FACADE_PAINT_LEFT = [PAINT, MATERIALS, MODELS];
  var KNOWLEDGE_LEFT = [WORLD_BIBLE];
  var INSPECTOR = { id: "inspector", label: "Focus", icon: "SlidersHorizontal" };
  var MODEL_RIGHT = [
    { id: "inspector", label: "Model", icon: "SlidersHorizontal" },
    { id: "paint", label: "Atlas", icon: "Image" },
    { id: "rig", label: "Rig", icon: "Bone" }
  ];
  var FOCUS_RIGHT = [INSPECTOR];
  function leftPanelsFor(kind, paintActive = false) {
    if (kind === "knowledge") return KNOWLEDGE_LEFT;
    if (paintActive && kind === "model") return MODEL_PAINT_LEFT;
    if (paintActive && kind === "facade") return FACADE_PAINT_LEFT;
    if (kind === "model") return MODEL_LEFT;
    if (kind === "material") return MATERIAL_LEFT;
    if (kind === "animation") return ANIMATION_LEFT;
    if (kind === "facade") return FACADE_LEFT;
    return WORLD_LEFT;
  }
  function rightPanelsFor(kind) {
    if (kind === "knowledge") return [];
    return kind === "model" ? MODEL_RIGHT : FOCUS_RIGHT;
  }
  function resolvedPanelId(buttons, requested) {
    return buttons.find((button) => button.id === requested)?.id ?? buttons[0].id;
  }
  function resolvedPanelIdOrNull(buttons, requested) {
    return buttons.find((button) => button.id === requested)?.id ?? buttons[0]?.id ?? null;
  }
  function pressPanelButton(active, pressed, collapsed) {
    if (active === pressed) return { active, collapsed: !collapsed };
    return { active: pressed, collapsed: false };
  }
  function leftPanelForFolder(kind, folder, fallback) {
    let candidate = "assets";
    if (folder === "architecture" || folder === "build-pieces" || folder === "prefabs") candidate = "build";
    else if (folder === "models" || folder.startsWith("models-") || folder.startsWith("model-")) candidate = "models";
    else if (folder === "materials" || folder.startsWith("materials-")) candidate = "materials";
    else if (folder === "characters") candidate = "characters";
    else if (folder === "missions" || folder === "bankheist" || folder === "mission-assets" || folder === "scripts" || folder === "ui") candidate = "missions";
    const buttons = leftPanelsFor(kind);
    if (buttons.some((button) => button.id === candidate)) return candidate;
    if (buttons.some((button) => button.id === fallback)) return fallback;
    return buttons[0].id;
  }
  function normalizeLeftPanelId(value) {
    if (value === "grid") return "materials";
    if (value === "pieces") return "build";
    if (value === "actors") return "characters";
    if (value === "data") return "missions";
    if (value === "world" || value === "pipeline") return "assets";
    if (value === "tool-options" || value === "ink") return "paint";
    return ["assets", "build", "models", "materials", "characters", "missions", "paint", "world-bible"].includes(value) ? value : "assets";
  }
  function normalizeRightPanelId(value) {
    return value === "paint" || value === "rig" ? value : "inspector";
  }

  // cart/editor/data/panelSystem.test.ts
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
  test("model browse context exposes source libraries and focus tools", () => {
    assert(leftPanelsFor("model").map((button) => button.id).join(",") === "models,materials", "model left rail drifted");
    assert(rightPanelsFor("model").map((button) => button.id).join(",") === "inspector,paint,rig", "model right rail drifted");
  });
  test("paint is one peer pane and source libraries remain reachable", () => {
    const modelPaint = leftPanelsFor("model", true);
    const facadePaint = leftPanelsFor("facade", true);
    assert(modelPaint.map((button) => button.id).join(",") === "paint,models,materials", "model paint panes drifted");
    assert(facadePaint.map((button) => button.id).join(",") === "paint,materials,models", "facade paint panes drifted");
    assert(modelPaint.map((button) => button.renderer).join(",") === "paint,library,library", "paint pane renderers are not explicit");
    assert(leftPanelsFor("world", true)[0].id === "assets", "unsupported world paint context replaced its library");
  });
  test("non-model documents never advertise unimplemented right panes", () => {
    for (const kind of ["world", "material", "playtest", "animation", "facade"]) {
      assert(rightPanelsFor(kind).map((button) => button.id).join(",") === "inspector", `${kind} advertised a dead focus pane`);
    }
  });
  test("World Bible owns one explicit index pane and no generic world inspector", () => {
    const left = leftPanelsFor("knowledge");
    assert(left.length === 1 && left[0].id === "world-bible" && left[0].renderer === "world-bible", "knowledge fell into the world asset browser");
    assert(rightPanelsFor("knowledge").length === 0, "knowledge advertised the world-object inspector");
  });
  test("pressing the active rail button toggles collapse", () => {
    const closed = pressPanelButton("models", "models", false);
    assert(closed.active === "models" && closed.collapsed, "active press did not collapse");
    const opened = pressPanelButton(closed.active, "models", closed.collapsed);
    assert(opened.active === "models" && !opened.collapsed, "second active press did not reopen");
  });
  test("pressing a different button selects it and opens its panel", () => {
    const result = pressPanelButton("models", "materials", true);
    assert(result.active === "materials" && !result.collapsed, "different pane stayed collapsed or unselected");
  });
  test("invalid pane state resolves to the context default without inventing a renderer", () => {
    assert(resolvedPanelId(leftPanelsFor("model"), "missions") === "models", "model left default was not contextual");
    assert(resolvedPanelId(rightPanelsFor("world"), "rig") === "inspector", "world right default was not contextual");
    assert(resolvedPanelIdOrNull(rightPanelsFor("knowledge"), "inspector") === null, "empty World Bible focus rail did not resolve safely");
  });
  test("tree navigation updates the matching contextual rail family", () => {
    assert(leftPanelForFolder("world", "model-prop-chair/paints", "assets") === "models", "model subfolder did not select Models");
    assert(leftPanelForFolder("world", "materials-generated", "assets") === "materials", "material subfolder did not select Materials");
    assert(leftPanelForFolder("world", "build-pieces", "assets") === "build", "build folder did not select Build");
    assert(leftPanelForFolder("model", "missions", "materials") === "materials", "unavailable model pane discarded the valid fallback");
  });
  test("mock-era hot state migrates into the live pane vocabulary", () => {
    assert(normalizeLeftPanelId("grid") === "materials", "legacy grid did not migrate");
    assert(normalizeLeftPanelId("actors") === "characters", "legacy actors did not migrate");
    assert(normalizeLeftPanelId("tool-options") === "paint", "split tool-options state did not migrate to Paint");
    assert(normalizeLeftPanelId("ink") === "paint", "split Ink state did not migrate to Paint");
    assert(normalizeLeftPanelId("paint") === "paint", "live Paint pane did not survive hot reload");
    assert(normalizeRightPanelId("layers") === "inspector", "inert legacy right pane became live content unexpectedly");
    assert(normalizeRightPanelId("rig") === "rig", "live rig pane did not survive hot reload");
  });
  log(`
panel system: ${passed} passed, ${failed} failed`);
  if (failed) throw new Error(`${failed} panel-system test(s) failed`);
})();
