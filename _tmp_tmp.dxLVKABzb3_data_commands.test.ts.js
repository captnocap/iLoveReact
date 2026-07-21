(() => {
  // cart/editor/data/surfaces.ts
  function activeDoc(state) {
    return state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId);
  }
  function activeSurface(state) {
    const doc = activeDoc(state);
    if (doc?.kind === "model") return "model";
    if (doc?.kind === "material" || state.materialFocused) return "material";
    if (doc?.kind === "playtest") return "playtest";
    if (doc?.kind === "animation") return "animation";
    if (doc?.kind === "knowledge") return "knowledge";
    return "world";
  }
  function hasSelection(state, surface) {
    if (surface === "model") return state.modelTool.sel > 0;
    if (surface === "world") return !!state.selectedPieceId || !!state.selectedObjectId;
    return true;
  }

  // cart/editor/world/buildCatalog.ts
  var EDIT_BY_ID = {
    "wall.concrete.doorway": "door",
    "wall.concrete.openDoorway": "arch",
    "wall.metal.garageDoor": "garageDoor",
    "wall.stucco.window": "window",
    "wall.stucco.doubleWindow": "doubleWindow",
    "wall.plywood.brokenWindow": "brokenWindow"
  };
  var MATERIAL_LOOK = {
    concrete: { hex: "#9aa3ad" },
    brick: { hex: "#8a4a3a" },
    stucco: { hex: "#d8cdb8" },
    wood: { hex: "#8a6a45" },
    metal: { hex: "#7d858d" },
    glass: { hex: "#cfe6f2", opacity: 0.3 },
    chainlink: { hex: "#b9c2c9", opacity: 0.45 }
  };
  function rgbOf(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  var W = [3, 3, 5e-3];
  var P = [3, 0.2, 3];
  var F = [3, 0.05, 3];
  var V = [3, 3, 3];
  var RAW = [
    ["wall.concrete.common", "Concrete Wall", "concrete", "common", ...W],
    ["wall.brick.downtown", "Brick Wall", "brick", "downtown", ...W],
    ["wall.stucco.suburb", "Stucco Wall", "stucco", "suburb", ...W],
    ["wall.stucco.motel", "Motel Wall", "stucco", "motel", ...W],
    ["wall.metal.industrial", "Sheet-Metal Wall", "metal", "industrial", ...W],
    ["wall.plywood.trap_lot", "Plywood Wall", "wood", "trap_lot", ...W],
    ["wall.storefront.downtown", "Storefront Glass", "glass", "downtown", ...W],
    ["wall.concrete.doorway", "Doorway Wall", "concrete", "common", ...W],
    ["wall.concrete.openDoorway", "Open Doorway Wall", "concrete", "common", ...W],
    ["wall.metal.garageDoor", "Garage Door Wall", "metal", "industrial", ...W],
    ["wall.stucco.window", "Window Wall", "stucco", "suburb", ...W],
    ["wall.stucco.doubleWindow", "Double Window Wall", "stucco", "suburb", ...W],
    ["wall.plywood.brokenWindow", "Broken Window Wall", "wood", "trap_lot", ...W],
    ["floor.concrete.common", "Concrete Floor", "concrete", "common", ...F],
    ["floor.wood.suburb", "Wood Floor", "wood", "suburb", ...F],
    ["roof.flat.common", "Flat Roof", "concrete", "common", ...P],
    ["roof.gable.suburb", "Gable Roof", "wood", "suburb", ...P],
    ["roof.gableSteep.suburb", "Gable Roof (Steep)", "wood", "suburb", ...P],
    ["roof.shed.common", "Shed Roof", "metal", "common", ...P],
    ["roof.shedSteep.common", "Shed Roof (Steep)", "metal", "common", ...P],
    ["roof.shingle.suburb", "Shingle Roof", "wood", "suburb", ...P],
    ["ramp.concrete.common", "Concrete Ramp", "concrete", "common", ...V],
    ["stairs.wood.common", "Wood Stairs", "wood", "common", ...V],
    ["stairs.concrete.common", "Concrete Stairs", "concrete", "common", ...V],
    ["stairs.metal.industrial", "Metal Utility Stairs", "metal", "industrial", ...V],
    ["stairs.wood.narrow", "Narrow Wood Stairs", "wood", "common", 1.2, 3, 3],
    ["elevator.metal.common", "Elevator", "metal", "common", ...V],
    ["pillar.concrete.common", "Concrete Pillar", "concrete", "common", 0.6, 3, 0.6],
    ["corner.concrete.common", "Concrete Corner", "concrete", "common", ...V],
    ["arch.concrete.downtown", "Concrete Arch", "concrete", "downtown", ...W],
    ["fence.chainlink.trap_lot", "Chainlink Fence", "chainlink", "trap_lot", 3, 2, 0.05],
    ["fence.wood.suburb", "Wood Fence", "wood", "suburb", 3, 1.8, 0.08],
    ["railing.metal.motel", "Walkway Railing", "metal", "motel", 3, 1, 0.08],
    ["trim.cornice.downtown", "Cornice Trim", "concrete", "downtown", 3, 0.3, 0.3],
    ["sign.shop.downtown", "Shop Sign", "metal", "downtown", 2.4, 0.8, 0.2],
    ["sign.pole.common", "Pole Sign", "metal", "common", 0.24, 3.3, 0.24]
  ];
  function rowFromRaw([id, label, material, theme, w, h, d]) {
    const look = MATERIAL_LOOK[material];
    return { id, label, kind: id.split(".")[0], material, theme, w, h, d, rgb: rgbOf(look.hex), opacity: look.opacity, edit: EDIT_BY_ID[id] };
  }
  var FALLBACK_CATALOG = RAW.map(rowFromRaw);
  var ROW_BY_ID = new Map(FALLBACK_CATALOG.map((r) => [r.id, r]));
  var KIND_ORDER = ["wall", "floor", "roof", "ramp", "stairs", "elevator", "pillar", "corner", "arch", "fence", "railing", "trim", "sign"];
  var KIND_LABEL = {
    wall: "Wall",
    floor: "Floor",
    roof: "Roof",
    ramp: "Ramp",
    stairs: "Stairs",
    elevator: "Elevator",
    pillar: "Pillar",
    corner: "Corner",
    arch: "Arch",
    fence: "Fence",
    railing: "Railing",
    trim: "Trim",
    sign: "Sign"
  };

  // cart/editor/data/buildStarters.ts
  var STARTER_CATALOG_ROW = {
    wall: "wall.concrete.common",
    floor: "floor.concrete.common",
    roof: "roof.flat.common",
    ramp: "ramp.concrete.common",
    stairs: "stairs.concrete.common",
    elevator: "elevator.metal.common",
    pillar: "pillar.concrete.common",
    corner: "corner.concrete.common",
    arch: "arch.concrete.downtown",
    fence: "fence.wood.suburb",
    railing: "railing.metal.motel",
    trim: "trim.cornice.downtown",
    sign: "sign.shop.downtown"
  };
  var STARTER_ICON = {
    wall: "BrickWall",
    floor: "Layers",
    roof: "House",
    ramp: "MoveUpRight",
    stairs: "ChartNoAxesColumnIncreasing",
    elevator: "BetweenHorizontalStart",
    pillar: "Columns",
    corner: "PanelsTopLeft",
    arch: "DoorOpen",
    fence: "Fence",
    railing: "GalleryHorizontalEnd",
    trim: "RectangleHorizontal",
    sign: "Signpost"
  };
  var STARTER_NAME = {
    stairs: "Stair Piece"
  };
  var BASE_STARTERS = KIND_ORDER.map((kind) => ({
    id: kind,
    kind,
    name: STARTER_NAME[kind] ?? `${KIND_LABEL[kind]} Piece`,
    icon: STARTER_ICON[kind],
    catalogPieceId: STARTER_CATALOG_ROW[kind]
  }));
  var WALL_EDIT_STARTERS = [
    {
      id: "door-wall",
      kind: "wall",
      edit: "door",
      name: "Door Wall",
      icon: "DoorOpen",
      catalogPieceId: "wall.concrete.doorway"
    },
    {
      id: "garage-door-wall",
      kind: "wall",
      edit: "garageDoor",
      name: "Garage Door Wall",
      icon: "Warehouse",
      catalogPieceId: "wall.metal.garageDoor"
    }
  ];
  var BUILD_PIECE_STARTERS = BASE_STARTERS.flatMap((starter) => starter.kind === "wall" ? [starter, ...WALL_EDIT_STARTERS] : [starter]);
  var STARTER_BY_ID = new Map(BUILD_PIECE_STARTERS.map((starter) => [starter.id, starter]));

  // cart/editor/data/buildExports.ts
  var BASE_TARGETS = KIND_ORDER.map((kind) => ({
    id: kind,
    label: KIND_LABEL[kind],
    kind
  }));
  var WALL_EDIT_TARGETS = [
    { id: "door-wall", label: "Door Wall", kind: "wall", edit: "door" },
    { id: "garage-door-wall", label: "Garage Door Wall", kind: "wall", edit: "garageDoor" }
  ];
  var BUILD_PIECE_EXPORT_TARGETS = BASE_TARGETS.flatMap((target) => target.kind === "wall" ? [target, ...WALL_EDIT_TARGETS] : [target]);
  var TARGET_BY_ID = new Map(BUILD_PIECE_EXPORT_TARGETS.map((target) => [target.id, target]));

  // cart/editor/data/propExports.ts
  var PROP_EXPORT_TARGETS = [
    { id: "scenery", label: "Scenery Prop", role: "scenery", icon: "Armchair" },
    { id: "stop-sign", label: "Stop Sign", role: "stopSign", icon: "CircleStop" },
    { id: "traffic-light", label: "Traffic Light", role: "trafficLight", icon: "TrafficCone" },
    { id: "street-sign", label: "Street Sign", role: "streetSign", icon: "Signpost" },
    { id: "bus-stop", label: "Bus Stop", role: "busStop", icon: "BusFront" },
    { id: "train-stop", label: "Train Stop", role: "trainStop", icon: "TrainFront" }
  ];
  function propExportCommandId(target) {
    return target.role === "scenery" ? "export-prop" : `export-prop-${target.id}`;
  }

  // cart/editor/world/pieceCommandIds.ts
  var WORLD_PIECE_ROTATE_COMMAND_ID = "world.piece.rotate";
  var WORLD_PIECE_SPIN_COMMAND_ID = "world.piece.spin";
  var WORLD_PIECE_DELETE_COMMAND_ID = "world.piece.delete";

  // cart/editor/data/commands.ts
  var MENUS = ["File", "Edit", "View", "Map", "Build", "Globals", "Window"];
  var PRIMITIVE_MESHES = [
    { kind: "cube", name: "Cube", icon: "Box" },
    { kind: "cylinder", name: "Cylinder", icon: "Cylinder" },
    { kind: "cone", name: "Cone", icon: "Cone" },
    { kind: "pyramid", name: "Pyramid", icon: "Pyramid" },
    { kind: "plane", name: "Plane", icon: "Square" },
    { kind: "sphere", name: "Sphere", icon: "Globe" },
    { kind: "icosphere", name: "Icosphere", icon: "Hexagon" }
  ];
  var NEW_MESH_COMMANDS = PRIMITIVE_MESHES.map((p) => ({
    id: `new-mesh-${p.kind}`,
    menu: "File",
    submenu: "New Mesh",
    name: p.name,
    icon: p.icon,
    key: "",
    context: false,
    native: true,
    undoable: false,
    scope: "global"
  }));
  var ADD_MESH_COMMANDS = PRIMITIVE_MESHES.map((p) => ({
    id: `add-mesh-${p.kind}`,
    menu: "Edit",
    submenu: "Add Primitive",
    name: p.name,
    icon: p.icon,
    key: "",
    context: true,
    native: true,
    undoable: true,
    tool: false,
    scope: "model"
  }));
  var NEW_PLAYER_MODEL_COMMAND = {
    id: "new-model-player",
    menu: "File",
    submenu: "New Mesh",
    name: "Player / NPC Model",
    icon: "PersonStanding",
    key: "",
    context: false,
    native: true,
    undoable: false,
    scope: "global"
  };
  var NEW_BUILD_STARTER_COMMANDS = BUILD_PIECE_STARTERS.map((starter) => ({
    id: `new-build-starter-${starter.id}`,
    menu: "File",
    submenu: "Build Pieces",
    name: starter.name,
    icon: starter.icon,
    key: "",
    context: false,
    native: true,
    undoable: false,
    scope: "global"
  }));
  var PAINT_RESOLUTIONS = [16, 32, 64, 128, 256, 512];
  var PAINT_RES_COMMANDS = PAINT_RESOLUTIONS.map((px) => ({
    id: `mesh-paint-res-${px}`,
    menu: "Edit",
    submenu: "Paint Resolution",
    name: `${px}\xD7${px} texels / triangle`,
    icon: "Grid3x3",
    key: "",
    context: false,
    native: true,
    undoable: false,
    scope: "model"
  }));
  var EXPORT_BUILD_COMMANDS = BUILD_PIECE_EXPORT_TARGETS.map((target) => ({
    id: `export-build-piece-${target.id}`,
    menu: "File",
    submenu: "Export Build Piece",
    name: target.label,
    icon: "PackagePlus",
    key: "",
    context: false,
    native: true,
    undoable: false,
    scope: "model"
  }));
  var EXPORT_PROP_COMMANDS = PROP_EXPORT_TARGETS.map((target) => ({
    id: propExportCommandId(target),
    menu: "File",
    submenu: "Export Prop",
    name: target.label,
    icon: target.icon,
    key: "",
    context: false,
    native: true,
    undoable: false,
    scope: "model"
  }));
  var EXPORT_CHARACTER_COMMAND = {
    id: "export-character",
    menu: "File",
    submenu: "Export",
    name: "Player / NPC Model...",
    icon: "PersonStanding",
    key: "",
    context: false,
    native: true,
    undoable: false,
    scope: "model"
  };
  var COMMANDS = [
    // ── File ──────────────────────────────────────────────────────────────────────────────────
    { id: "new-map", menu: "File", name: "New Map Workspace", icon: "FilePlus2", key: "Ctrl+N", context: false, native: true, undoable: false, scope: "global" },
    ...NEW_MESH_COMMANDS,
    ...NEW_BUILD_STARTER_COMMANDS,
    NEW_PLAYER_MODEL_COMMAND,
    { id: "open-map", menu: "File", name: "Open Workspace", icon: "FolderOpen", key: "Ctrl+O", context: false, native: true, undoable: false, scope: "global" },
    { id: "open-file-explorer", menu: "File", name: "Open Project Asset Explorer", icon: "FolderSearch", key: "Ctrl+P", context: false, native: true, undoable: false, scope: "global" },
    { id: "find-import-source", menu: "File", name: "Find Import Source", icon: "SearchCode", key: "Ctrl+Shift+P", context: false, native: true, undoable: false, scope: "global" },
    // Import a .glb/.obj from anywhere on disk via the OS picker — the same native mesh importer
    // (__mesh_load_file) the explorer's in-project model rows open through.
    { id: "import-model-file", menu: "File", name: "Import Model (.glb / .obj)...", icon: "FolderInput", key: "Ctrl+I", context: false, native: true, undoable: false, scope: "global" },
    // Every document has one explicit Save entrance. The active surface decides
    // which durable document is committed; autosave never replaces this command.
    { id: "save-snapshot", menu: "File", name: "Save", icon: "Save", key: "Ctrl+S", context: false, native: true, undoable: false, scope: "global" },
    ...EXPORT_BUILD_COMMANDS,
    ...EXPORT_PROP_COMMANDS,
    EXPORT_CHARACTER_COMMAND,
    // ── Edit ──────────────────────────────────────────────────────────────────────────────────
    // Undo/redo route per surface in runCommand (model → host mesh journal; world → local history).
    { id: "undo-local", menu: "Edit", name: "Undo", icon: "Undo2", key: "Ctrl+Z", context: false, native: true, undoable: false, scope: "global" },
    { id: "redo-local", menu: "Edit", name: "Redo", icon: "Redo2", key: "Ctrl+Shift+Z", context: false, native: true, undoable: false, scope: "global" },
    { id: "open-preferences", menu: "Edit", name: "Preferences...", icon: "Settings", key: "Ctrl+,", context: false, native: true, undoable: false, scope: "global" },
    { id: "duplicate-selection", menu: "Edit", name: "Duplicate Selection", icon: "Copy", key: "D", context: true, native: true, undoable: true, scope: "world", needsSelection: true },
    // Delete acts on whatever's selected on the active surface (world object or mesh element).
    { id: "delete-selection", menu: "Edit", name: "Delete Selection", icon: "Trash2", key: "Del", context: true, native: true, undoable: true, tool: true, scope: "global", needsSelection: true },
    ...ADD_MESH_COMMANDS,
    ...PAINT_RES_COMMANDS,
    // ── View ──────────────────────────────────────────────────────────────────────────────────
    { id: "toggle-minimap", menu: "View", name: "Toggle Linked 2D Map", icon: "Map", key: "M", context: false, native: true, undoable: false, scope: "world" },
    // Focus is an armable viewport MODE (req_2550): arm it, then click a piece to frame it. As a
    // mode it isn't selection-gated (the click provides the target), so no needsSelection.
    { id: "focus-selection", menu: "View", name: "Focus Selection", icon: "ScanSearch", key: "F", context: true, native: true, undoable: false, tool: true, scope: "world" },
    // Reference images (req_2758 — the old studio's tracing backdrops, req_1280): drop a
    // blueprint/photo on one of the six cardinal planes behind the model and build over it.
    { id: "model-ref-images", menu: "View", scope: "model", name: "Reference Images...", icon: "Image", key: "", context: true, native: false, undoable: false },
    // ── Map (world) ───────────────────────────────────────────────────────────────────────────
    // Grow the world by 120 m chunks from a 2D topology view (req_2703): the dialog
    // shows the map's chunk occupancy with a "+" on every open edge slot.
    { id: "add-chunk", menu: "Map", name: "Add Chunk...", icon: "Grid2x2Plus", key: "", context: false, native: true, undoable: false, scope: "world" },
    // FLOORCTL req_2485: steps the REAL active storey (0 = Ground) up, wrapping past the cap.
    { id: "world.floor.step", menu: "Map", name: "Step Active Floor", icon: "Layers", key: "]", context: false, native: true, undoable: false, scope: "world" },
    // ── Build (world) ─────────────────────────────────────────────────────────────────────────
    // Select is the neutral default (req_2550): a viewport click picks the piece under it and places
    // nothing. It's the tool the editor boots into; Esc returns to it. Arming any other tool takes
    // the click away from placement — that's the modality the world was missing.
    { id: "select-tool", menu: "Build", name: "Select", icon: "MousePointer2", key: "Esc", context: false, native: true, undoable: false, tool: true, scope: "world" },
    { id: "place-piece", menu: "Build", name: "Place Piece", icon: "Pencil", key: "B", context: true, native: true, undoable: false, tool: true, scope: "world" },
    // Move is an armable mode: click a piece to grab it. Not selection-gated — the click selects.
    { id: "move-selection", menu: "Build", name: "Move Selection", icon: "Move", key: "V", context: true, native: true, undoable: false, tool: true, scope: "world" },
    // R is mode-sensitive (req_0598): it spins the selected placed piece when one
    // exists, otherwise the armed placement ghost. The enablement gate below keeps
    // both routes discoverable on the world surface.
    { id: WORLD_PIECE_ROTATE_COMMAND_ID, menu: "Build", name: "Rotate Piece", icon: "RotateCw", key: "R", context: true, native: true, undoable: true, scope: "world", needsSelection: true },
    // Spin (SPINPROP req_3128): toggles a continuous visual spin on the selected AUTHORED
    // prop — the rotating business-sign. Visual only; the collider keeps the placed yaw.
    { id: WORLD_PIECE_SPIN_COMMAND_ID, menu: "Build", name: "Spin Piece", icon: "Orbit", key: "", context: true, native: true, undoable: true, scope: "world", needsSelection: true },
    { id: WORLD_PIECE_DELETE_COMMAND_ID, menu: "Edit", name: "Delete World Piece", icon: "Trash2", key: "Del", context: true, native: true, undoable: true, scope: "world", needsSelection: true },
    // Paint Faces (req_2879): an armable brush MODE — touch a placed piece's face and the
    // browser's active material lands in THAT face's slot (front vs back stay separate, so the
    // exterior and interior of one wall paint independently). A drag sweeps across faces. Not
    // selection-gated — the touch provides the target, like Focus/Move.
    { id: "paint-faces", menu: "Build", name: "Paint Faces", icon: "Paintbrush", key: "N", context: true, native: true, undoable: false, tool: true, scope: "world" },
    // Place Sticker (req_3025): an armable stamp MODE — the click's face hit takes the armed
    // sticker at its true meter size (4x6 label default). Not selection-gated; the touch is
    // the target, like Paint Faces. The armed sticker/rot/scale live in state.stickerArm.
    { id: "place-sticker", menu: "Build", name: "Place Sticker", icon: "Sticker", key: "K", context: true, native: true, undoable: false, tool: true, scope: "world" },
    // Paint Facade (req_3057): from the piece quick menu — gathers the coplanar wall run
    // around the clicked piece and opens it as ONE meter-true paint canvas (256 px/m).
    { id: "paint-facade", menu: "Build", name: "Paint Facade", icon: "SprayCan", key: "", context: true, native: true, undoable: false, scope: "world", needsSelection: true },
    { id: "open-color-studio", menu: "Build", name: "Open Color Studio", icon: "Palette", key: "C", context: true, native: true, undoable: false, scope: "world", needsSelection: true },
    // ── Globals (GLOBALS req_2770) — the game's world-level tunables ──────────────────────────
    // Each leaf opens the PLAYTEST tab (the editor world with the embodied player) and puts
    // that domain's settings in the focus panel: tune a value, feel it the same second, and
    // the micro-save locks it in. Physics is the first domain; the menu grows by addition.
    { id: "globals-physics", menu: "Globals", name: "Physics", icon: "Gauge", key: "", context: false, native: true, undoable: false, scope: "global" },
    // Globals → Animation (req_2786): the CAPTURE surface — webcam feed beside the
    // exported player model, live pose sync driving the body; the record verb grows here.
    { id: "globals-animation", menu: "Globals", name: "Animation", icon: "PersonStanding", key: "", context: false, native: true, undoable: false, scope: "global" },
    // ── Window (real popover toggles — flip the existing dock popover state) ─────────────────────
    { id: "toggle-eventbus", menu: "Window", name: "Event Bus", icon: "Workflow", key: "Ctrl+H", context: false, native: true, undoable: false, scope: "global" },
    { id: "toggle-performance", menu: "Window", name: "Performance", icon: "Gauge", key: "", context: false, native: true, undoable: false, scope: "global" },
    { id: "toggle-memory", menu: "Window", name: "Memory", icon: "MemoryStick", key: "", context: false, native: true, undoable: false, scope: "global" },
    { id: "toggle-build-journal", menu: "Window", name: "Build Journal", icon: "BookOpen", key: "", context: false, native: true, undoable: false, scope: "global" },
    // ── Model-surface mesh tools (Edit → Mesh; the host-native mesh editor) ──────────────────────
    // scope 'model' → only enabled when a model document is the active surface. Keys resolve per
    // surface through the keymap; ModelView owns their live dispatch.
    { id: "mesh-vertex", menu: "Edit", scope: "model", name: "Vertex Select", icon: "Grip", key: "1", context: true, native: true, undoable: false, tool: true },
    { id: "mesh-edge", menu: "Edit", scope: "model", name: "Edge Select", icon: "Spline", key: "2", context: true, native: true, undoable: false, tool: true },
    { id: "mesh-face", menu: "Edit", scope: "model", name: "Face Select", icon: "Triangle", key: "3", context: true, native: true, undoable: false, tool: true },
    { id: "mesh-move", menu: "Edit", scope: "model", name: "Move Gizmo", icon: "Move", key: "G", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-scale", menu: "Edit", scope: "model", name: "Scale Gizmo", icon: "Scale3d", key: "S", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-scale-by", menu: "Edit", scope: "model", name: "Scale By\u2026", icon: "Scale3d", key: "", context: true, native: true, undoable: true },
    { id: "mesh-rotate", menu: "Edit", scope: "model", name: "Rotate Gizmo", icon: "Rotate3d", key: "R", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-paint", menu: "Edit", scope: "model", name: "Paint Faces", icon: "Brush", key: "P", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-path-plane", menu: "Edit", scope: "model", name: "Pen Plane", icon: "PenTool", key: "", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-focus", menu: "Edit", scope: "model", name: "Focus Pivot", icon: "Focus", key: "F", context: true, native: true, undoable: false, tool: true },
    { id: "mesh-wire", menu: "Edit", scope: "model", name: "Wireframe", icon: "Grid3x3", key: "W", context: false, native: true, undoable: false, tool: true },
    // Camera lock (req_2893): freeze the orbit view where the user set it — every camera
    // motion (drag/zoom/pan/double-click focus/compass snap) no-ops host-side while on.
    { id: "mesh-cam-lock", menu: "Edit", scope: "model", name: "Lock Camera", icon: "Lock", key: "K", context: false, native: true, undoable: false, tool: true },
    // Saved view (req_3067): pin the current orbit pose, then jump back to it after any
    // amount of orbiting — a double-click focus otherwise loses the working angle for good.
    { id: "mesh-cam-store", menu: "Edit", scope: "model", name: "Store View", icon: "BookmarkPlus", key: "", context: false, native: true, undoable: false, tool: true },
    { id: "mesh-cam-recall", menu: "Edit", scope: "model", name: "Recall View", icon: "Bookmark", key: "H", context: false, native: true, undoable: false, tool: true },
    // Live mirror editing (req_2758): toggle a symmetry plane — while on, gizmo edits land
    // reflected on each moved element's twin across that plane (plane at 0; Center first).
    { id: "mesh-sym-x", menu: "Edit", scope: "model", name: "Mirror Edit X", icon: "FlipHorizontal2", key: "", context: true, native: true, undoable: false, tool: true },
    { id: "mesh-sym-y", menu: "Edit", scope: "model", name: "Mirror Edit Y", icon: "FlipHorizontal2", key: "", context: true, native: true, undoable: false, tool: true },
    { id: "mesh-sym-z", menu: "Edit", scope: "model", name: "Mirror Edit Z", icon: "FlipHorizontal2", key: "", context: true, native: true, undoable: false, tool: true },
    // Contextual topology ops — edge mode has edge extrude/create-face; face mode has face extrude.
    { id: "mesh-extrude", menu: "Edit", scope: "model", name: "Extrude Edge", icon: "ArrowUpFromLine", key: "E", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-extrude-face", menu: "Edit", scope: "model", name: "Extrude Face", icon: "ArrowUpFromLine", key: "E", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-create-face", menu: "Edit", scope: "model", name: "Create Face", icon: "SquarePlus", key: "C", context: true, native: true, undoable: true, tool: true },
    // Studio's req_1182 face correction, restored on the active host-native surface:
    // reverse winding + UV corner order so an inside-out created face points outward.
    { id: "mesh-flip-face", menu: "Edit", scope: "model", name: "Flip Face", icon: "FlipVertical2", key: "X", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-loopcut", menu: "Edit", scope: "model", name: "Loop Cut", icon: "Scissors", key: "L", context: true, native: true, undoable: true, tool: true },
    // Basic cut subdivides ONLY selected faces; loop cut propagates around the ring.
    { id: "mesh-cut", menu: "Edit", scope: "model", name: "Cut", icon: "Slice", key: "T", context: true, native: true, undoable: true, tool: true },
    // Face-selection ops: detach peels the selection into a NEW part; glass toggles translucency;
    // solidify thickens in place; merge fuses 2+ authored faces into one.
    { id: "mesh-detach", menu: "Edit", scope: "model", name: "Detach Faces", icon: "Ungroup", key: "D", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-glass", menu: "Edit", scope: "model", name: "Glass Faces", icon: "GlassWater", key: "B", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-solidify", menu: "Edit", scope: "model", name: "Solidify", icon: "Boxes", key: "O", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-merge-faces", menu: "Edit", scope: "model", name: "Merge Faces", icon: "Combine", key: "M", context: true, native: true, undoable: true, tool: true },
    // Part ops (the focused outliner part): duplicate / mirrored duplicate / merge the
    // exact shift-selected set. The id keeps its old spelling for persisted keymaps, but
    // the operation is NEVER based on outliner order (req_2811 / req_2870).
    { id: "mesh-duplicate-part", menu: "Edit", scope: "model", name: "Duplicate Part", icon: "CopyPlus", key: "", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-path-array", menu: "Edit", scope: "model", name: "Path Array...", icon: "Route", key: "", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-mirror-x", menu: "Edit", scope: "model", name: "Mirror Part X", icon: "FlipHorizontal2", key: "", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-mirror-y", menu: "Edit", scope: "model", name: "Mirror Part Y", icon: "FlipHorizontal2", key: "", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-mirror-z", menu: "Edit", scope: "model", name: "Mirror Part Z", icon: "FlipHorizontal2", key: "", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-merge-down", menu: "Edit", scope: "model", name: "Merge Selected Parts", icon: "Merge", key: "", context: true, native: true, undoable: true, tool: true },
    // Cross-model reuse: append a saved library model into the OPEN model as new part(s).
    { id: "mesh-import-part", menu: "Edit", scope: "model", name: "Add From Library...", icon: "PackagePlus", key: "", context: true, native: true, undoable: true, tool: true },
    // Paint sub-tools — bucket, free brush, and the shared closed pen path.
    { id: "mesh-paint-fill", menu: "Edit", scope: "model", name: "Fill Face", icon: "PaintBucket", key: "B", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-paint-brush", menu: "Edit", scope: "model", name: "Free Brush", icon: "Paintbrush", key: "N", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-paint-pen", menu: "Edit", scope: "model", name: "Pen Fill", icon: "PenTool", key: "V", context: true, native: true, undoable: true, tool: true },
    { id: "mesh-paint-safety", menu: "Edit", scope: "model", name: "Face Safety", icon: "Lock", key: "X", context: true, native: true, undoable: false, tool: true },
    { id: "mesh-paint-detail", menu: "Edit", scope: "model", name: "Brush Detail", icon: "Grid2x2", key: "Y", context: true, native: true, undoable: false, tool: true }
  ];
  function blockingOverlay(state) {
    const mv = state.modelTool.blocking;
    if (mv === "loop-cut") return { id: "loop-cut", label: "Loop Cut" };
    if (mv === "paint-atlas") return { id: "paint-atlas", label: "Create Paint Atlas" };
    if (mv === "face-guard") return { id: "face-guard", label: "Unsafe Face Edit" };
    if (state.newMeshPrompt) return { id: "new-mesh", label: state.newMeshPrompt.mode === "add" ? "Add Mesh" : "New Mesh" };
    if (state.fileExplorerOpen) return { id: "file-explorer", label: "Asset Explorer" };
    if (state.mapDocumentOpen) return { id: "map-documents", label: "Map Workspaces" };
    if (state.buildDialogOpen) return { id: "build-journal", label: "Build Journal", closerCommandId: "toggle-build-journal" };
    if (state.addChunkOpen) return { id: "add-chunk", label: "Add Chunk" };
    return null;
  }
  var g_colorStudioUndoDepths = { undo: 0, redo: 0, source: "material" };
  function undoDepths(state) {
    if (activeSurface(state) === "knowledge") return { undo: 0, redo: 0, source: "knowledge" };
    if (activeSurface(state) === "material") return g_colorStudioUndoDepths;
    if (activeSurface(state) === "model") {
      if (state.modelTool.paint) {
        try {
          const j = globalThis.__mesh_paint_history?.();
          if (typeof j === "string" && j) {
            const o = JSON.parse(j);
            return { undo: (o.undo ?? 0) | 0, redo: (o.redo ?? 0) | 0, source: "strokes" };
          }
        } catch {
        }
        return { undo: 0, redo: 0, source: "strokes" };
      }
      try {
        const j = globalThis.__mesh_history?.();
        if (typeof j === "string" && j) {
          const o = JSON.parse(j);
          return { undo: (o.undo ?? 0) | 0, redo: (o.redo ?? 0) | 0, source: "mesh" };
        }
      } catch {
      }
      return { undo: 0, redo: 0, source: "mesh" };
    }
    return { undo: state.worldUndo.length, redo: state.worldRedo.length, source: "world" };
  }
  var g_undoDepths = { undo: 0, redo: 0, source: "world" };
  function commandEnabled(cmd2, state) {
    const block = blockingOverlay(state);
    if (block && cmd2.id !== block.closerCommandId) {
      return { on: false, reason: `resolve ${block.label} first` };
    }
    const surface = activeSurface(state);
    if (cmd2.scope !== "global" && cmd2.scope !== surface) {
      return { on: false, reason: `only in the ${cmd2.scope} editor` };
    }
    const canRotateArmedGhost = cmd2.id === WORLD_PIECE_ROTATE_COMMAND_ID && surface === "world" && state.activeCommandId === "place-piece" && state.armedPieceId !== null;
    if (cmd2.needsSelection && !hasSelection(state, surface) && !canRotateArmedGhost) {
      return { on: false, reason: "select something first" };
    }
    if (cmd2.id === "undo-local" || cmd2.id === "redo-local") {
      const d = undoDepths(state);
      const n = cmd2.id === "undo-local" ? d.undo : d.redo;
      if (n <= 0) {
        return {
          on: false,
          reason: cmd2.id === "undo-local" ? d.source === "strokes" ? "nothing to undo in paint" : d.source === "mesh" ? "mesh journal empty" : d.source === "material" ? "nothing to undo in Color Studio" : "nothing to undo on the world" : d.source === "strokes" ? "nothing to redo in paint" : d.source === "mesh" ? "nothing to redo in the mesh journal" : d.source === "material" ? "nothing to redo in Color Studio" : "nothing to redo on the world"
        };
      }
    }
    return { on: true };
  }
  var cmd = (id) => ({ kind: "cmd", id });
  var section = (label) => ({ kind: "section", label });
  var MESH_SUBMENU = {
    kind: "sub",
    id: "Mesh",
    label: "Mesh",
    icon: "Boxes",
    scope: "model",
    children: [
      section("Select"),
      cmd("mesh-vertex"),
      cmd("mesh-edge"),
      cmd("mesh-face"),
      section("Transform"),
      cmd("mesh-move"),
      cmd("mesh-scale"),
      cmd("mesh-scale-by"),
      cmd("mesh-rotate"),
      cmd("mesh-sym-x"),
      cmd("mesh-sym-y"),
      cmd("mesh-sym-z"),
      cmd("mesh-focus"),
      cmd("mesh-wire"),
      section("Topology"),
      cmd("mesh-extrude"),
      cmd("mesh-extrude-face"),
      cmd("mesh-create-face"),
      cmd("mesh-flip-face"),
      cmd("mesh-loopcut"),
      cmd("mesh-cut"),
      cmd("mesh-detach"),
      cmd("mesh-glass"),
      cmd("mesh-solidify"),
      cmd("mesh-merge-faces"),
      section("Parts"),
      { kind: "sub", id: "Add Primitive", label: "Add Primitive", icon: "Boxes", scope: "model", children: ADD_MESH_COMMANDS.map((c) => cmd(c.id)) },
      cmd("mesh-duplicate-part"),
      cmd("mesh-path-array"),
      cmd("mesh-mirror-x"),
      cmd("mesh-mirror-y"),
      cmd("mesh-mirror-z"),
      cmd("mesh-merge-down"),
      cmd("mesh-import-part"),
      section("Paint"),
      cmd("mesh-paint"),
      cmd("mesh-paint-fill"),
      cmd("mesh-paint-brush"),
      cmd("mesh-paint-pen"),
      cmd("mesh-paint-safety"),
      cmd("mesh-paint-detail"),
      { kind: "sub", id: "Paint Resolution", label: "Paint Resolution", icon: "Grid3x3", scope: "model", children: PAINT_RES_COMMANDS.map((c) => cmd(c.id)) }
    ]
  };
  var MENU_TREE = {
    File: [
      cmd("new-map"),
      {
        kind: "sub",
        id: "New Mesh",
        label: "New Mesh",
        icon: "Boxes",
        scope: "global",
        children: [
          section("Primitives"),
          ...NEW_MESH_COMMANDS.map((c) => cmd(c.id)),
          {
            kind: "sub",
            id: "Build Pieces",
            label: "Build Pieces",
            icon: "Building2",
            scope: "global",
            children: NEW_BUILD_STARTER_COMMANDS.map((c) => cmd(c.id))
          },
          section("Characters"),
          cmd("new-model-player")
        ]
      },
      cmd("open-map"),
      cmd("open-file-explorer"),
      cmd("find-import-source"),
      cmd("import-model-file"),
      cmd("save-snapshot"),
      // Export → Build Piece → <kind>. Nested so Export can grow other targets later.
      {
        kind: "sub",
        id: "Export",
        label: "Export",
        icon: "Upload",
        scope: "model",
        children: [
          { kind: "sub", id: "Export Build Piece", label: "Build Piece", icon: "PackagePlus", scope: "model", children: EXPORT_BUILD_COMMANDS.map((c) => cmd(c.id)) },
          { kind: "sub", id: "Export Prop", label: "Prop", icon: "Armchair", scope: "model", children: EXPORT_PROP_COMMANDS.map((c) => cmd(c.id)) },
          cmd("export-character")
        ]
      }
    ],
    Edit: [cmd("undo-local"), cmd("redo-local"), cmd("duplicate-selection"), cmd("delete-selection"), MESH_SUBMENU],
    View: [cmd("toggle-minimap"), cmd("focus-selection"), cmd("model-ref-images")],
    Map: [cmd("add-chunk"), cmd("world.floor.step")],
    Build: [cmd("select-tool"), cmd("place-piece"), cmd("move-selection"), cmd(WORLD_PIECE_ROTATE_COMMAND_ID), cmd("paint-faces"), cmd("place-sticker"), cmd("paint-facade"), cmd("open-color-studio")],
    Globals: [cmd("globals-physics"), cmd("globals-animation")],
    Window: [cmd("toggle-eventbus"), cmd("toggle-performance"), cmd("toggle-memory"), cmd("toggle-build-journal")]
  };
  function menuNodes(menu) {
    return MENU_TREE[menu] ?? [];
  }
  var MESH_TOOL_IDS = ["mesh-vertex", "mesh-edge", "mesh-face", "mesh-move", "mesh-scale", "mesh-rotate", "mesh-sym-x", "mesh-sym-y", "mesh-sym-z", "mesh-paint", "mesh-path-plane", "mesh-focus", "mesh-wire", "mesh-cam-lock", "mesh-cam-store", "mesh-cam-recall"];
  function meshToolCommands() {
    return MESH_TOOL_IDS.map(commandById);
  }
  function meshTopoCommands(tool, selectedPartCount = 0) {
    if (tool.sel < 1) return [];
    if (tool.selMode === 2) {
      return tool.sel === 1 ? [commandById("mesh-extrude"), commandById("mesh-loopcut")] : [commandById("mesh-create-face")];
    }
    if (tool.selMode === 3) {
      return [
        ...tool.sel === 1 ? [commandById("mesh-extrude-face")] : [],
        commandById("mesh-flip-face"),
        commandById("mesh-loopcut"),
        commandById("mesh-cut"),
        commandById("mesh-detach"),
        commandById("mesh-glass"),
        commandById("mesh-solidify"),
        // Outliner multi-select is represented host-side by selecting every authored face
        // in those parts. Offering Merge Faces here would collapse all of those groups to
        // one face and strand zero-face outliner rows (req_2870). The parts command below
        // owns that gesture instead and preserves each pre-merge authored face.
        ...selectedPartCount >= 2 ? [] : [commandById("mesh-merge-faces")]
      ];
    }
    return [];
  }
  function meshPartCommands(hasActivePart, selectedPartCount) {
    const out = [];
    if (hasActivePart) {
      out.push(commandById("mesh-duplicate-part"), commandById("mesh-path-array"), commandById("mesh-mirror-x"), commandById("mesh-mirror-y"), commandById("mesh-mirror-z"));
      if (selectedPartCount >= 2) out.push(commandById("mesh-merge-down"));
    }
    out.push(commandById("mesh-import-part"));
    return out;
  }
  var MODEL_CONTEXT_GROUPS = [
    { id: "select", label: "Select Mode", icon: "Grip", commandIds: ["mesh-vertex", "mesh-edge", "mesh-face"] },
    { id: "gizmo", label: "Gizmo", icon: "Move", commandIds: ["mesh-move", "mesh-scale", "mesh-scale-by", "mesh-rotate"] },
    { id: "mirror", label: "Mirror", icon: "FlipHorizontal2", commandIds: ["mesh-sym-x", "mesh-sym-y", "mesh-sym-z"] },
    { id: "view", label: "View", icon: "Grid3x3", commandIds: ["mesh-focus", "mesh-wire", "mesh-cam-lock", "mesh-cam-store", "mesh-cam-recall"] }
  ];
  var MODEL_CONTEXT_MIRROR_PART_IDS = /* @__PURE__ */ new Set(["mesh-mirror-x", "mesh-mirror-y", "mesh-mirror-z"]);
  var MODEL_CONTEXT_GROUPED_TOOL_IDS = new Set(MODEL_CONTEXT_GROUPS.flatMap((group) => group.commandIds));
  function modelContextMenuLayout(hasActivePart, selectedPartCount) {
    const partCommands = meshPartCommands(hasActivePart, selectedPartCount);
    const mirrorPartCommands = partCommands.filter((command) => MODEL_CONTEXT_MIRROR_PART_IDS.has(command.id));
    return {
      groups: MODEL_CONTEXT_GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
        icon: group.icon,
        commands: [
          ...group.commandIds.map(commandById),
          ...group.id === "mirror" ? mirrorPartCommands : []
        ]
      })),
      // Paint Faces stays direct. Any future always-on tool also stays visible until
      // it is intentionally assigned to a family above.
      directToolCommands: meshToolCommands().filter((command) => !MODEL_CONTEXT_GROUPED_TOOL_IDS.has(command.id)),
      // Duplicate / path array / structural merge / import are primary part verbs. Only mirrored
      // duplication moves into Mirror, where all six axis controls live together.
      directPartCommands: partCommands.filter((command) => !MODEL_CONTEXT_MIRROR_PART_IDS.has(command.id))
    };
  }
  function commandById(id) {
    const found = COMMANDS.find((command) => command.id === id) ?? COMMANDS[0];
    if (found.id === "undo-local" || found.id === "redo-local") {
      const n = found.id === "undo-local" ? g_undoDepths.undo : g_undoDepths.redo;
      return { ...found, name: `${found.name} (${n} ${g_undoDepths.source})` };
    }
    return found;
  }
  function worldActionBarCommands(state) {
    const activeTool = commandById(state.activeCommandId);
    const menu = activeTool.tool && activeTool.scope === "world" ? activeTool.menu : "Build";
    return COMMANDS.filter((command) => command.menu === menu && command.scope !== "model" && !command.submenu);
  }

  // cart/editor/data/keymap.ts
  var GLOBAL_CHORDS = {
    "ctrl+n": "new-map",
    "ctrl+o": "open-map",
    "ctrl+p": "open-file-explorer",
    "ctrl+shift+p": "find-import-source",
    "ctrl+i": "import-model-file",
    "ctrl+s": "save-snapshot",
    "ctrl+z": "undo-local",
    "ctrl+shift+z": "redo-local",
    "ctrl+y": "redo-local",
    "ctrl+h": "toggle-eventbus",
    "ctrl+,": "open-preferences"
  };
  var WORLD_KEYS = {
    b: "place-piece",
    v: "move-selection",
    n: "paint-faces",
    k: "place-sticker",
    c: "open-color-studio",
    m: "toggle-minimap",
    f: "focus-selection",
    // W/A/S/D are the camera pan (WorldViewport owns them) — so no bare-key world command may claim
    // them. 'd' used to be Duplicate, which fired on every strafe and spammed copies of the phantom
    // selection (req_2558); 's' was the inert Set Spawn placeholder. Neither owns a world key now.
    "]": "world.floor.step",
    delete: WORLD_PIECE_DELETE_COMMAND_ID,
    // R rotates the selected placed piece 90° (req_2733) — free on the world surface; the model
    // surface's R (rotate gizmo) lives in MODEL_KEYS and never collides.
    r: WORLD_PIECE_ROTATE_COMMAND_ID,
    // Esc drops back to the neutral Select tool — the modal "put the click down" (req_2550).
    escape: "select-tool"
  };
  var MODEL_KEYS = [
    { key: "1", commandId: "mesh-vertex" },
    { key: "2", commandId: "mesh-edge" },
    { key: "3", commandId: "mesh-face" },
    { key: "g", commandId: "mesh-move" },
    { key: "s", commandId: "mesh-scale" },
    { key: "r", commandId: "mesh-rotate" },
    { key: "p", commandId: "mesh-paint" },
    { key: "f", commandId: "mesh-focus" },
    { key: "w", commandId: "mesh-wire" },
    { key: "k", commandId: "mesh-cam-lock" },
    { key: "h", commandId: "mesh-cam-recall" },
    { key: "e", commandId: "mesh-extrude" },
    { key: "l", commandId: "mesh-loopcut" },
    { key: "t", commandId: "mesh-cut" },
    { key: "c", commandId: "mesh-create-face" },
    // X is contextual exactly as the Studio control contract was: flip winding in
    // face mode, Face Safety while painting.
    { key: "x", commandId: "mesh-flip-face", mode: "face" },
    { key: "d", commandId: "mesh-detach" },
    { key: "o", commandId: "mesh-solidify" },
    { key: "m", commandId: "mesh-merge-faces" },
    { key: "b", commandId: "mesh-paint-fill", mode: "paint" },
    { key: "b", commandId: "mesh-glass", mode: "face" },
    { key: "n", commandId: "mesh-paint-brush", mode: "paint" },
    { key: "x", commandId: "mesh-paint-safety", mode: "paint" },
    { key: "y", commandId: "mesh-paint-detail", mode: "paint" }
  ];
  function chord(key, mods) {
    const parts = [];
    if (mods.ctrl || mods.meta) parts.push("ctrl");
    if (mods.shift) parts.push("shift");
    if (mods.alt) parts.push("alt");
    parts.push(key);
    return parts.join("+");
  }
  function modelCommandForKey(key, tool) {
    for (const b of MODEL_KEYS) {
      if (b.key !== key) continue;
      if (!b.mode) return b.commandId;
      if (b.mode === "paint" && tool.paint) return b.commandId;
      if (b.mode === "face" && tool.selMode === 3 && !tool.paint) return b.commandId;
    }
    return null;
  }
  function commandForKeyEvent(state, key, mods) {
    const gate = (id) => commandEnabled(commandById(id), state).on ? id : null;
    const global = GLOBAL_CHORDS[chord(key, mods)];
    if (global) return gate(global);
    if (mods.ctrl || mods.meta || mods.alt) return null;
    const surface = activeSurface(state);
    if (surface === "world") {
      const world = WORLD_KEYS[key];
      if (world) return gate(world);
    } else if (surface === "model") {
      const model = modelCommandForKey(key, state.modelTool);
      if (model) return gate(model);
    }
    return null;
  }

  // cart/editor/data/commands.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(`${s}
`));
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      log(`  ok  ${name}`);
    } catch (e) {
      failed += 1;
      log(`FAIL  ${name}: ${e.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  var ids = (commands) => commands.map((command) => command.id);
  test("Save and Preferences are application commands on every document surface", () => {
    const save = commandById("save-snapshot");
    const preferences = commandById("open-preferences");
    assert(save.menu === "File" && save.scope === "global" && save.key === "Ctrl+S", "Save is not the global document command");
    assert(preferences.menu === "Edit" && preferences.scope === "global" && preferences.key === "Ctrl+,", "Preferences is not globally discoverable");
  });
  test("ordinary face selection still offers authored-face merge", () => {
    const commands = ids(meshTopoCommands({ selMode: 3, sel: 2 }, 1));
    assert(commands.includes("mesh-merge-faces"), "Merge Faces remains available for a real face selection");
    assert(commands.includes("mesh-flip-face"), "Flip Face is available for any real face selection");
  });
  test("a single face exposes the winding correction beside face extrude", () => {
    const commands = ids(meshTopoCommands({ selMode: 3, sel: 1 }, 1));
    assert(commands.includes("mesh-extrude-face"), "single-face Extrude disappeared");
    assert(commands.includes("mesh-flip-face"), "single-face Flip disappeared");
  });
  test("multi-part outliner selection cannot fall through to Merge Faces", () => {
    const commands = ids(meshTopoCommands({ selMode: 3, sel: 12 }, 2));
    assert(!commands.includes("mesh-merge-faces"), "Merge Faces is hidden while selected faces represent multiple parts");
  });
  test("structural merge requires the explicit selected set, not list adjacency", () => {
    const one = ids(meshPartCommands(true, 1));
    const many = ids(meshPartCommands(true, 2));
    assert(!one.includes("mesh-merge-down"), "one selected row cannot infer a neighbor from list order");
    assert(many.includes("mesh-merge-down"), "two selected rows expose structural merge");
  });
  test("model context menu folds stable tool families without hiding a command", () => {
    const layout = modelContextMenuLayout(true, 2);
    assert(layout.groups.map((group) => group.id).join("|") === "select|gizmo|mirror|view", "context groups drifted");
    assert(ids(layout.groups[0].commands).join("|") === "mesh-vertex|mesh-edge|mesh-face", "select modes escaped their group");
    assert(ids(layout.groups[1].commands).join("|") === "mesh-move|mesh-scale|mesh-scale-by|mesh-rotate", "gizmos escaped their group");
    assert(ids(layout.groups[2].commands).join("|") === "mesh-sym-x|mesh-sym-y|mesh-sym-z|mesh-mirror-x|mesh-mirror-y|mesh-mirror-z", "mirror edit and part axes are not together");
    assert(ids(layout.groups[3].commands).join("|") === "mesh-focus|mesh-wire|mesh-cam-lock|mesh-cam-store|mesh-cam-recall", "view tools escaped their group");
    assert(ids(layout.directToolCommands).join("|") === "mesh-paint|mesh-path-plane", "Paint Faces and Pen Plane must remain one click away");
    assert(ids(layout.directPartCommands).join("|") === "mesh-duplicate-part|mesh-path-array|mesh-merge-down|mesh-import-part", "primary part verbs must remain direct");
    const expected = ids([...meshToolCommands(), commandById("mesh-scale-by"), ...meshPartCommands(true, 2)]).sort().join("|");
    const presented = ids([
      ...layout.groups.flatMap((group) => group.commands),
      ...layout.directToolCommands,
      ...layout.directPartCommands
    ]).sort().join("|");
    assert(presented === expected, `context layout lost or duplicated commands: ${presented}`);
  });
  test("model context mirror group omits part actions without a focused part", () => {
    const layout = modelContextMenuLayout(false, 0);
    const mirror = layout.groups.find((group) => group.id === "mirror");
    assert(!!mirror, "Mirror group disappeared");
    assert(ids(mirror.commands).join("|") === "mesh-sym-x|mesh-sym-y|mesh-sym-z", "part mirrors appeared without a focused part");
    assert(ids(layout.directPartCommands).join("|") === "mesh-import-part", "part generators need focus while library import remains global to the model");
  });
  test("New Mesh exposes every semantic build starter under one nested menu", () => {
    const newMesh = menuNodes("File").find((node) => node.kind === "sub" && node.id === "New Mesh");
    assert(!!newMesh, "File menu lost New Mesh");
    const build = newMesh.children.find((node) => node.kind === "sub" && node.id === "Build Pieces");
    assert(!!build, "New Mesh lost its Build Pieces submenu");
    const commandIds = build.children.filter((node) => node.kind === "cmd").map((node) => node.id);
    const expected = BUILD_PIECE_STARTERS.map((starter) => `new-build-starter-${starter.id}`);
    assert(commandIds.join("|") === expected.join("|"), `starter menu drifted: ${commandIds.join(", ")}`);
    assert(newMesh.children.some((node) => node.kind === "cmd" && node.id === "new-model-player"), "Player / NPC starter disappeared");
  });
  test("Export Build Piece exposes explicit door-wall meanings without a door tile", () => {
    const exportMenu = menuNodes("File").find((node) => node.kind === "sub" && node.id === "Export");
    const build = exportMenu?.children.find((node) => node.kind === "sub" && node.id === "Export Build Piece");
    assert(!!build, "File menu lost Export Build Piece");
    const commandIds = build.children.filter((node) => node.kind === "cmd").map((node) => node.id);
    const expected = BUILD_PIECE_EXPORT_TARGETS.map((target) => `export-build-piece-${target.id}`);
    assert(commandIds.join("|") === expected.join("|"), `build export menu drifted: ${commandIds.join(", ")}`);
    assert(commandIds.includes("export-build-piece-door-wall"), "Door Wall export is missing");
    assert(!commandIds.includes("export-build-piece-door"), "the unrelated door tile leaked into mesh export");
  });
  test("Export Prop exposes gameplay roles for intersections and transit stops", () => {
    const exportMenu = menuNodes("File").find((node) => node.kind === "sub" && node.id === "Export");
    const props = exportMenu?.children.find((node) => node.kind === "sub" && node.id === "Export Prop");
    assert(!!props, "File menu lost Export Prop");
    const commandIds = props.children.filter((node) => node.kind === "cmd").map((node) => node.id);
    const expected = PROP_EXPORT_TARGETS.map(propExportCommandId);
    assert(commandIds.join("|") === expected.join("|"), `prop export menu drifted: ${commandIds.join(", ")}`);
    for (const id of ["export-prop-stop-sign", "export-prop-traffic-light", "export-prop-bus-stop", "export-prop-train-stop"]) {
      assert(commandIds.includes(id), `${id} is missing`);
    }
  });
  test("dead placeholder commands and their empty menus are absent", () => {
    const commandIds = new Set(COMMANDS.map((command) => command.id));
    const removed = [
      "compile-rle",
      "toggle-view-mode",
      "paint-material",
      "sample-material",
      "add-trigger",
      "set-spawn",
      "mission-point",
      "author-sequence",
      "show-pipeline"
    ];
    for (const id of removed) assert(!commandIds.has(id), `${id} is still registered`);
    assert(!MENUS.some((menu) => menu === "Story" || menu === "Help"), "an empty placeholder menu remains in chrome");
  });
  test("Section D follows the armed tool and contains only real Build tools", () => {
    const build = worldActionBarCommands({ activeCommandId: "select-tool" });
    assert(build.every((command) => command.menu === "Build"), "default world bar mirrors unrelated menu history");
    assert(build.some((command) => command.id === "place-piece"), "real Build tools disappeared");
    const toolIds = /* @__PURE__ */ new Set(["select-tool", "place-piece", "move-selection", "paint-faces", "place-sticker"]);
    assert(build.filter((command) => toolIds.has(command.id)).every((command) => !command.undoable), "arming a tool still claims to be an authored edit");
    const afterFloor = worldActionBarCommands({ activeCommandId: "world.floor.step" });
    assert(afterFloor.map((command) => command.id).join("|") === build.map((command) => command.id).join("|"), "floor report swapped Section D family");
    assert(!afterFloor.some((command) => command.id === "paint-material" || command.id === "sample-material"), "legacy material tools leaked into Section D");
  });
  test("the live world key bridge reaches every authority-backed tool identity", () => {
    const state = {
      workspaceDocuments: [{ id: "world", kind: "world", title: "World" }],
      activeWorkspaceDocumentId: "world",
      materialFocused: false,
      modelTool: { blocking: null },
      newMeshPrompt: null,
      fileExplorerOpen: false,
      mapDocumentOpen: false,
      buildDialogOpen: false,
      addChunkOpen: false,
      selectedPieceId: null,
      selectedObjectId: "",
      worldUndo: [],
      worldRedo: []
    };
    const mods = { ctrl: false, shift: false, alt: false, meta: false };
    const expected = [
      ["escape", "select-tool"],
      ["b", "place-piece"],
      ["v", "move-selection"],
      ["f", "focus-selection"],
      ["n", "paint-faces"],
      ["k", "place-sticker"]
    ];
    for (const [key, id] of expected) {
      assert(commandForKeyEvent(state, key, mods) === id, `${key} did not reach ${id}`);
    }
    const selected = { ...state, selectedPieceId: "bp_7" };
    assert(commandForKeyEvent(selected, "r", mods) === WORLD_PIECE_ROTATE_COMMAND_ID, "R did not resolve the authored rotate identity");
    assert(commandForKeyEvent(selected, "delete", mods) === WORLD_PIECE_DELETE_COMMAND_ID, "Delete did not resolve the authored delete identity");
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
