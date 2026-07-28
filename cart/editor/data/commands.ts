// editor/data/commands.ts — command table + enablement + menu geometry/tree.
//
// Compatibility presentation table while editor commands migrate into the framework
// CommandAuthority. Every row declares its relevant surface (`scope`); commandEnabled
// supplies the grayed-with-reason gate and menuNodes lays out the current hand-authored
// dropdown. Migrated rows use the exact authority command id—never a second callback id.
import { activeSurface, hasSelection } from './surfaces';
import { BUILD_PIECE_STARTERS } from './buildStarters';
import { BUILD_PIECE_EXPORT_TARGETS } from './buildExports';
import { PROP_EXPORT_TARGETS, propExportCommandId } from './propExports';
import { WORLD_PIECE_DELETE_COMMAND_ID, WORLD_PIECE_ROTATE_COMMAND_ID, WORLD_PIECE_SPIN_COMMAND_ID } from '../world/pieceCommandIds';
import type { Command, Menu, EditorState, PrimitiveKind } from './types';

export const MENUS: Menu[] = ['File', 'Edit', 'View', 'Map', 'Build', 'Globals', 'Window'];
export const MENU_DROPDOWN_WIDTH = 420;

// The starter primitives under File → New Mesh (fresh document) and Edit → Mesh → Add Primitive
// (a part on the model in view). ONE list drives both submenus, the id→kind dispatch (AppFrame),
// and the geometry (primitiveMeshData) — add a row + a generator case and the whole path lights up.
export const PRIMITIVE_MESHES: { kind: PrimitiveKind; name: string; icon: string }[] = [
  { kind: 'cube', name: 'Cube', icon: 'Box' },
  { kind: 'cylinder', name: 'Cylinder', icon: 'Cylinder' },
  { kind: 'cone', name: 'Cone', icon: 'Cone' },
  { kind: 'pyramid', name: 'Pyramid', icon: 'Pyramid' },
  { kind: 'plane', name: 'Plane', icon: 'Square' },
  { kind: 'sphere', name: 'Sphere', icon: 'Globe' },
  { kind: 'icosphere', name: 'Icosphere', icon: 'Hexagon' },
];
// New Mesh = a FRESH model document seeded with the primitive (the 'new' verb). Global scope:
// works on any surface; picking it while a model is open opens a SECOND document, never a part.
const NEW_MESH_COMMANDS: Command[] = PRIMITIVE_MESHES.map((p) => ({
  id: `new-mesh-${p.kind}`, menu: 'File', submenu: 'New Mesh', name: p.name, icon: p.icon,
  key: '', context: false, native: true, undoable: false, scope: 'global',
}));
// Add Primitive = APPEND the primitive as a new part to the model in view (the 'add' verb the
// outliner + also drives). Model scope: only when a model document is the active surface.
const ADD_MESH_COMMANDS: Command[] = PRIMITIVE_MESHES.map((p) => ({
  id: `add-mesh-${p.kind}`, menu: 'Edit', submenu: 'Add Primitive', name: p.name, icon: p.icon,
  key: '', context: true, native: true, undoable: true, tool: false, scope: 'model',
}));
// Starter models under File → New Mesh — a fresh MULTI-PART document seeded as a whole
// authored thing (the player/NPC body, req_2761: one part per body bone, skeleton on the
// package). No size dialog: a starter's dimensions ARE its data table.
const NEW_PLAYER_MODEL_COMMAND: Command = {
  id: 'new-model-player', menu: 'File', submenu: 'New Mesh', name: 'Player / NPC Model', icon: 'PersonStanding',
  key: '', context: false, native: true, undoable: false, scope: 'global',
};

// Semantic building bases under File → New Mesh → Build Pieces. Unlike generic
// primitives these open at the build catalog's real module dimensions and shape.
const NEW_BUILD_STARTER_COMMANDS: Command[] = BUILD_PIECE_STARTERS.map((starter) => ({
  id: `new-build-starter-${starter.id}`,
  menu: 'File',
  submenu: 'Build Pieces',
  name: starter.name,
  icon: starter.icon,
  key: '',
  context: false,
  native: true,
  undoable: false,
  scope: 'global',
}));

// Paint resolution — texels per TRIANGLE patch for free-form model painting (a quad face is two
// triangle patches; "face" would misread a cube's 6 as its 12 — req_2509). A MODEL-surface control
// (it drives the mesh painter's atlas budget), nested under Edit → Mesh → Paint where the rest of
// the brush lives — NOT File, where it was inert on the world and duplicated the toolbar's DETAIL
// pill (req_2540). Pick any; dense meshes clamp to the atlas budget. Higher = finer strokes.
export const PAINT_RESOLUTIONS = [16, 32, 64, 128, 256, 512] as const;
const PAINT_RES_COMMANDS: Command[] = PAINT_RESOLUTIONS.map((px) => ({
  id: `mesh-paint-res-${px}`, menu: 'Edit', submenu: 'Paint Resolution', name: `${px}×${px} texels / triangle`, icon: 'Grid3x3',
  key: '', context: false, native: true, undoable: false, scope: 'model',
}));

// Export → Build Piece → <kind> (req_2583): export the OPEN model as a placeable
// build piece of the chosen base kind. One leaf per kind, under the nested Export
// flyout — the parent grows as we add more export targets. Model scope.
const EXPORT_BUILD_COMMANDS: Command[] = BUILD_PIECE_EXPORT_TARGETS.map((target) => ({
  id: `export-build-piece-${target.id}`, menu: 'File', submenu: 'Export Build Piece', name: target.label, icon: 'PackagePlus',
  key: '', context: false, native: true, undoable: false, scope: 'model',
}));

// Export → Prop → <role>: the OPEN model remains a free-placing prop carrying
// its rig, while the manifest role lets derived intersections/transit stops
// request the correct model without name heuristics (req_2938).
const EXPORT_PROP_COMMANDS: Command[] = PROP_EXPORT_TARGETS.map((target) => ({
  id: propExportCommandId(target), menu: 'File', submenu: 'Export Prop', name: target.label, icon: target.icon,
  key: '', context: false, native: true, undoable: false, scope: 'model',
}));

const EXPORT_FLORA_COMMANDS: Command[] = [
  { id: 'export-flora-grass', name: 'Grass / Groundcover', icon: 'Sprout' },
  { id: 'export-flora-tree', name: 'Tree', icon: 'Trees' },
  { id: 'export-flora-bush', name: 'Bush / Shrub', icon: 'Leaf' },
].map((target) => ({
  ...target,
  menu: 'File' as const,
  submenu: 'Export Flora',
  key: '',
  context: false,
  native: true,
  undoable: false,
  scope: 'model' as const,
}));

// Export → Player / NPC Model (req_2771): export the OPEN model as a CHARACTER.
// Opens the role dialog — the game's ONE played model vs an NPC population
// model — and the confirmed role lands in manifest.placeable (req_2718 truth).
const EXPORT_CHARACTER_COMMAND: Command = {
  id: 'export-character', menu: 'File', submenu: 'Export', name: 'Player / NPC Model...', icon: 'PersonStanding',
  key: '', context: false, native: true, undoable: false, scope: 'model',
};

// Menu-bar geometry, derived from the Chrome styles (workspace.cls HW_*). The dropdown is mounted
// at the app root, so these are window-relative pixels: the first menu item begins after the chrome
// padding + brand block + chrome gap. Panels center on their trigger — a wide
// menu that begins at File's left edge makes every choice land unexpectedly far
// to the right of the cursor.
const MENU_BAR_LEFT = 156;     // HW_Chrome paddingLeft(10) + HW_Brand(136) + HW_Chrome gap(10)
const MENU_ITEM_PAD = 18;      // HW_MenuItem paddingLeft(9) + paddingRight(9)
const MENU_ITEM_GAP = 2;       // HW_MenuBar gap between items
const MENU_GLYPH_ADVANCE = 6.4; // ~per-glyph advance of HW_MenuText at fontSize 11
const MENU_DROPDOWN_GUTTER = 12; // keep the panel off the window edge

export const COMMANDS: Command[] = [
  // ── File ──────────────────────────────────────────────────────────────────────────────────
  { id: 'new-map', menu: 'File', name: 'New Map Workspace', icon: 'FilePlus2', key: 'Ctrl+N', context: false, native: true, undoable: false, scope: 'global' },
  ...NEW_MESH_COMMANDS,
  ...NEW_BUILD_STARTER_COMMANDS,
  NEW_PLAYER_MODEL_COMMAND,
  { id: 'open-map', menu: 'File', name: 'Open Workspace', icon: 'FolderOpen', key: 'Ctrl+O', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'open-file-explorer', menu: 'File', name: 'Open Project Asset Explorer', icon: 'FolderSearch', key: 'Ctrl+P', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'find-import-source', menu: 'File', name: 'Find Import Source', icon: 'SearchCode', key: 'Ctrl+Shift+P', context: false, native: true, undoable: false, scope: 'global' },
  // Import a .glb/.obj from anywhere on disk via the OS picker — the same native mesh importer
  // (__mesh_load_file) the explorer's in-project model rows open through.
  { id: 'import-model-file', menu: 'File', name: 'Import Model (.glb / .obj)...', icon: 'FolderInput', key: 'Ctrl+I', context: false, native: true, undoable: false, scope: 'global' },
  // Every document has one explicit Save entrance. The active surface decides
  // which durable document is committed; autosave never replaces this command.
  { id: 'save-snapshot', menu: 'File', name: 'Save', icon: 'Save', key: 'Ctrl+S', context: false, native: true, undoable: false, scope: 'global' },
  ...EXPORT_BUILD_COMMANDS,
  ...EXPORT_PROP_COMMANDS,
  ...EXPORT_FLORA_COMMANDS,
  EXPORT_CHARACTER_COMMAND,
  // ── Edit ──────────────────────────────────────────────────────────────────────────────────
  // Undo/redo route per surface in runCommand (model → host mesh journal; world → local history).
  { id: 'undo-local', menu: 'Edit', name: 'Undo', icon: 'Undo2', key: 'Ctrl+Z', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'redo-local', menu: 'Edit', name: 'Redo', icon: 'Redo2', key: 'Ctrl+Shift+Z', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'open-preferences', menu: 'Edit', name: 'Preferences...', icon: 'Settings', key: 'Ctrl+,', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'duplicate-selection', menu: 'Edit', name: 'Duplicate Selection', icon: 'Copy', key: 'D', context: true, native: true, undoable: true, scope: 'world', needsSelection: true },
  { id: 'create-prefab', menu: 'Edit', name: 'Create Prefab from Selection...', icon: 'PackagePlus', key: '', context: true, native: true, undoable: true, scope: 'world', needsSelection: true },
  // Delete acts on whatever's selected on the active surface (world object or mesh element).
  { id: 'delete-selection', menu: 'Edit', name: 'Delete Selection', icon: 'Trash2', key: 'Del', context: true, native: true, undoable: true, tool: true, scope: 'global', needsSelection: true },
  ...ADD_MESH_COMMANDS,
  ...PAINT_RES_COMMANDS,

  // ── View ──────────────────────────────────────────────────────────────────────────────────
  { id: 'toggle-minimap', menu: 'View', name: 'Toggle Linked 2D Map', icon: 'Map', key: 'M', context: false, native: true, undoable: false, scope: 'world' },
  // Focus is an armable viewport MODE (req_2550): arm it, then click a piece to frame it. As a
  // mode it isn't selection-gated (the click provides the target), so no needsSelection.
  { id: 'focus-selection', menu: 'View', name: 'Focus Selection', icon: 'ScanSearch', key: 'F', context: true, native: true, undoable: false, tool: true, scope: 'world' },
  // Reference images (req_2758 — the old studio's tracing backdrops, req_1280): drop a
  // blueprint/photo on one of the six cardinal planes behind the model and build over it.
  { id: 'model-ref-images', menu: 'View', scope: 'model', name: 'Reference Images...', icon: 'Image', key: '', context: true, native: false, undoable: false },

  // ── Map (world) ───────────────────────────────────────────────────────────────────────────
  // Grow the world by 120 m chunks from a 2D topology view (req_2703): the dialog
  // shows the map's chunk occupancy with a "+" on every open edge slot.
  { id: 'add-chunk', menu: 'Map', name: 'Add Chunk...', icon: 'Grid2x2Plus', key: '', context: false, native: true, undoable: false, scope: 'world' },
  // FLOORCTL req_2485: steps the REAL active storey (0 = Ground) up, wrapping past the cap.
  { id: 'world.floor.step', menu: 'Map', name: 'Step Active Floor', icon: 'Layers', key: ']', context: false, native: true, undoable: false, scope: 'world' },

  // ── Build (world) ─────────────────────────────────────────────────────────────────────────
  // Select is the neutral default (req_2550): a viewport click picks the piece under it and places
  // nothing. It's the tool the editor boots into; Esc returns to it. Arming any other tool takes
  // the click away from placement — that's the modality the world was missing.
  { id: 'select-tool', menu: 'Build', name: 'Select', icon: 'MousePointer2', key: 'Esc', context: false, native: true, undoable: false, tool: true, scope: 'world' },
  { id: 'place-piece', menu: 'Build', name: 'Place Piece', icon: 'Pencil', key: 'B', context: true, native: true, undoable: false, tool: true, scope: 'world' },
  // Move is an armable mode: click a piece to grab it. Not selection-gated — the click selects.
  { id: 'move-selection', menu: 'Build', name: 'Move Selection', icon: 'Move', key: 'V', context: true, native: true, undoable: false, tool: true, scope: 'world' },
  // R is mode-sensitive (req_0598): it spins the selected placed piece when one
  // exists, otherwise the armed placement ghost. The enablement gate below keeps
  // both routes discoverable on the world surface.
  { id: WORLD_PIECE_ROTATE_COMMAND_ID, menu: 'Build', name: 'Rotate Piece', icon: 'RotateCw', key: 'R', context: true, native: true, undoable: true, scope: 'world', needsSelection: true },
  // Spin (SPINPROP req_3128): toggles a continuous visual spin on the selected AUTHORED
  // prop — the rotating business-sign. Visual only; the collider keeps the placed yaw.
  { id: WORLD_PIECE_SPIN_COMMAND_ID, menu: 'Build', name: 'Spin Piece', icon: 'Orbit', key: '', context: true, native: true, undoable: true, scope: 'world', needsSelection: true },
  { id: WORLD_PIECE_DELETE_COMMAND_ID, menu: 'Edit', name: 'Delete World Piece', icon: 'Trash2', key: 'Del', context: true, native: true, undoable: true, scope: 'world', needsSelection: true },
  // Paint Faces (req_2879): an armable brush MODE — touch a placed piece's face and the
  // browser's active material lands in THAT face's slot (front vs back stay separate, so the
  // exterior and interior of one wall paint independently). A drag sweeps across faces. Not
  // selection-gated — the touch provides the target, like Focus/Move.
  { id: 'paint-faces', menu: 'Build', name: 'Paint Faces', icon: 'Paintbrush', key: 'N', context: true, native: true, undoable: false, tool: true, scope: 'world' },
  // Place Sticker (req_3025): an armable stamp MODE — the click's face hit takes the armed
  // sticker at its true meter size (4x6 label default). Not selection-gated; the touch is
  // the target, like Paint Faces. The armed sticker/rot/scale live in state.stickerArm.
  { id: 'place-sticker', menu: 'Build', name: 'Place Sticker', icon: 'Sticker', key: 'K', context: true, native: true, undoable: false, tool: true, scope: 'world' },
  // Paint Facade (req_3057): from the piece quick menu — gathers the coplanar wall run
  // around the clicked piece and opens it as ONE meter-true paint canvas (256 px/m).
  { id: 'paint-facade', menu: 'Build', name: 'Paint Facade', icon: 'SprayCan', key: '', context: true, native: true, undoable: false, scope: 'world', needsSelection: true },
  { id: 'open-color-studio', menu: 'Build', name: 'Open Color Studio', icon: 'Palette', key: 'C', context: true, native: true, undoable: false, scope: 'world', needsSelection: true },

  // ── Globals (GLOBALS req_2770) — the game's world-level tunables ──────────────────────────
  // Each leaf opens the PLAYTEST tab (the editor world with the embodied player) and puts
  // that domain's settings in the focus panel: tune a value, feel it the same second, and
  // the micro-save locks it in. Physics is the first domain; the menu grows by addition.
  { id: 'globals-physics', menu: 'Globals', name: 'Physics', icon: 'Gauge', key: '', context: false, native: true, undoable: false, scope: 'global' },
  // Globals → Animation (req_2786): the CAPTURE surface — webcam feed beside the
  // exported player model, live pose sync driving the body; the record verb grows here.
  { id: 'globals-animation', menu: 'Globals', name: 'Animation', icon: 'PersonStanding', key: '', context: false, native: true, undoable: false, scope: 'global' },

  // ── Window (real popover toggles — flip the existing dock popover state) ─────────────────────
  { id: 'toggle-eventbus', menu: 'Window', name: 'Event Bus', icon: 'Workflow', key: 'Ctrl+H', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'toggle-performance', menu: 'Window', name: 'Performance', icon: 'Gauge', key: '', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'toggle-memory', menu: 'Window', name: 'Memory', icon: 'MemoryStick', key: '', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'toggle-build-journal', menu: 'Window', name: 'Build Journal', icon: 'BookOpen', key: '', context: false, native: true, undoable: false, scope: 'global' },

  // ── Model-surface mesh tools (Edit → Mesh; the host-native mesh editor) ──────────────────────
  // scope 'model' → only enabled when a model document is the active surface. Keys resolve per
  // surface through the keymap; ModelView owns their live dispatch.
  { id: 'mesh-vertex', menu: 'Edit', scope: 'model', name: 'Vertex Select', icon: 'Grip', key: '1', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-edge', menu: 'Edit', scope: 'model', name: 'Edge Select', icon: 'Spline', key: '2', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-face', menu: 'Edit', scope: 'model', name: 'Face Select', icon: 'Triangle', key: '3', context: true, native: true, undoable: false, tool: true },
  // UV direction collection (req_3388): one selected 3D face expands to every
  // atlas island projected from the same signed axis, without joining the mesh.
  { id: 'mesh-select-uv-orientation', menu: 'Edit', scope: 'model', name: 'Collect Same UV Orientation', icon: 'Layers3', key: '', context: true, native: true, undoable: false, tool: true, needsSelection: true },
  { id: 'mesh-move', menu: 'Edit', scope: 'model', name: 'Move Gizmo', icon: 'Move', key: 'G', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-scale', menu: 'Edit', scope: 'model', name: 'Scale Gizmo', icon: 'Scale3d', key: 'S', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-scale-by', menu: 'Edit', scope: 'model', name: 'Scale By…', icon: 'Scale3d', key: '', context: true, native: true, undoable: true },
  { id: 'mesh-rotate', menu: 'Edit', scope: 'model', name: 'Rotate Gizmo', icon: 'Rotate3d', key: 'R', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint', menu: 'Edit', scope: 'model', name: 'Paint Faces', icon: 'Brush', key: 'P', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-path-plane', menu: 'Edit', scope: 'model', name: 'Pen Plane', icon: 'PenTool', key: '', context: true, native: true, undoable: true, tool: true },
  // Pen Edges: the same pen path, committed as naked wire edges (open or closed) with NO
  // fill face — the outline's anchors become welded verts you pull with the move gizmo.
  { id: 'mesh-path-edges', menu: 'Edit', scope: 'model', name: 'Pen Edges', icon: 'Spline', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-focus', menu: 'Edit', scope: 'model', name: 'Focus Pivot', icon: 'Focus', key: 'F', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-wire', menu: 'Edit', scope: 'model', name: 'Wireframe', icon: 'Grid3x3', key: 'W', context: false, native: true, undoable: false, tool: true },
  // Camera lock (req_2893): freeze the orbit view where the user set it — every camera
  // motion (drag/zoom/pan/double-click focus/compass snap) no-ops host-side while on.
  { id: 'mesh-cam-lock', menu: 'Edit', scope: 'model', name: 'Lock Camera', icon: 'Lock', key: 'K', context: false, native: true, undoable: false, tool: true },
  // Saved view (req_3067): pin the current orbit pose, then jump back to it after any
  // amount of orbiting — a double-click focus otherwise loses the working angle for good.
  { id: 'mesh-cam-store', menu: 'Edit', scope: 'model', name: 'Store View', icon: 'BookmarkPlus', key: '', context: false, native: true, undoable: false, tool: true },
  { id: 'mesh-cam-recall', menu: 'Edit', scope: 'model', name: 'Recall View', icon: 'Bookmark', key: 'H', context: false, native: true, undoable: false, tool: true },
  // Live mirror editing (req_2758): toggle a symmetry plane — while on, gizmo edits land
  // reflected on each moved element's twin across that plane (plane at 0; Center first).
  { id: 'mesh-sym-x', menu: 'Edit', scope: 'model', name: 'Mirror Edit X', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-sym-y', menu: 'Edit', scope: 'model', name: 'Mirror Edit Y', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-sym-z', menu: 'Edit', scope: 'model', name: 'Mirror Edit Z', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: false, tool: true },
  // Contextual topology ops — edge mode has edge extrude/create-face; face mode has face extrude.
  { id: 'mesh-extrude', menu: 'Edit', scope: 'model', name: 'Extrude Edge', icon: 'ArrowUpFromLine', key: 'E', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-extrude-face', menu: 'Edit', scope: 'model', name: 'Extrude Face', icon: 'ArrowUpFromLine', key: 'E', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-create-face', menu: 'Edit', scope: 'model', name: 'Create Face', icon: 'SquarePlus', key: 'C', context: true, native: true, undoable: true, tool: true },
  // Weld (req_3382): merge the selected vertices at their center — Blender's
  // Merge-at-Center. Edge mode collapses the selected edges' endpoints.
  { id: 'mesh-weld', menu: 'Edit', scope: 'model', name: 'Weld', icon: 'Magnet', key: 'M', context: true, native: true, undoable: true, tool: true },
  // Studio bevel: one selected sharp manifold edge or 3+-edge corner opens the
  // shared live width popup; Apply is one native topology journal entry.
  { id: 'mesh-bevel', menu: 'Edit', scope: 'model', name: 'Bevel', icon: 'Slice', key: 'B', context: true, native: true, undoable: true, tool: true },
  // Studio's req_1182 face correction, restored on the active host-native surface:
  // reverse winding + UV corner order so an inside-out created face points outward.
  { id: 'mesh-flip-face', menu: 'Edit', scope: 'model', name: 'Flip Face', icon: 'FlipVertical2', key: 'X', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-loopcut', menu: 'Edit', scope: 'model', name: 'Loop Cut', icon: 'Scissors', key: 'L', context: true, native: true, undoable: true, tool: true },
  // Basic cut subdivides ONLY selected faces; loop cut propagates around the ring.
  { id: 'mesh-cut', menu: 'Edit', scope: 'model', name: 'Cut', icon: 'Slice', key: 'T', context: true, native: true, undoable: true, tool: true },
  // Face-selection ops: detach peels the selection into a NEW part; glass toggles translucency;
  // solidify thickens in place; merge fuses 2+ authored faces into one.
  { id: 'mesh-detach', menu: 'Edit', scope: 'model', name: 'Detach Faces', icon: 'Ungroup', key: 'D', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-glass', menu: 'Edit', scope: 'model', name: 'Glass Faces', icon: 'GlassWater', key: 'B', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-solidify', menu: 'Edit', scope: 'model', name: 'Solidify', icon: 'Boxes', key: 'O', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-merge-faces', menu: 'Edit', scope: 'model', name: 'Merge Faces', icon: 'Combine', key: 'M', context: true, native: true, undoable: true, tool: true },
  // Part ops (the focused outliner part): duplicate / mirrored duplicate / merge the
  // exact shift-selected set. The id keeps its old spelling for persisted keymaps, but
  // the operation is NEVER based on outliner order (req_2811 / req_2870).
  { id: 'mesh-duplicate-part', menu: 'Edit', scope: 'model', name: 'Duplicate Part', icon: 'CopyPlus', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-path-array', menu: 'Edit', scope: 'model', name: 'Path Array...', icon: 'Route', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-x', menu: 'Edit', scope: 'model', name: 'Mirror Part X', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-y', menu: 'Edit', scope: 'model', name: 'Mirror Part Y', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-z', menu: 'Edit', scope: 'model', name: 'Mirror Part Z', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-merge-down', menu: 'Edit', scope: 'model', name: 'Merge Selected Parts', icon: 'Merge', key: '', context: true, native: true, undoable: true, tool: true },
  // Cross-model reuse: append a saved library model into the OPEN model as new part(s).
  { id: 'mesh-import-part', menu: 'Edit', scope: 'model', name: 'Add From Library...', icon: 'PackagePlus', key: '', context: true, native: true, undoable: true, tool: true },
  // Paint sub-tools — bucket, free brush, and the shared closed pen path.
  { id: 'mesh-paint-fill', menu: 'Edit', scope: 'model', name: 'Fill Face', icon: 'PaintBucket', key: 'B', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint-brush', menu: 'Edit', scope: 'model', name: 'Free Brush', icon: 'Paintbrush', key: 'N', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint-pen', menu: 'Edit', scope: 'model', name: 'Pen Fill', icon: 'PenTool', key: 'V', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint-safety', menu: 'Edit', scope: 'model', name: 'Face Safety', icon: 'Lock', key: 'X', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-paint-detail', menu: 'Edit', scope: 'model', name: 'Brush Detail', icon: 'Grid2x2', key: 'Y', context: true, native: true, undoable: false, tool: true },
];

// ── Blocking overlays (modal discipline, req_2626 gap HH) ─────────────────────────────────────
// USER LAW: while a blocking session/dialog is unresolved, every other input surface is inert —
// no mode switches, no new dialogs, no tool commands stacked over a captured base mesh. This is
// the ONE state-visible predicate; AppFrame layers its component-local dialogs (import image /
// import part) on top. `closerCommandId` is the single command still allowed while blocked (it
// CLOSES the blocker — e.g. Window → Build Journal toggles its own dialog shut).
export type BlockingOverlay = { id: string; label: string; closerCommandId?: string };
export function blockingOverlay(state: EditorState): BlockingOverlay | null {
  const mv = state.modelTool.blocking;
  if (mv === 'bevel') return { id: 'bevel', label: 'Bevel' };
  if (mv === 'loop-cut') return { id: 'loop-cut', label: 'Loop Cut' };
  if (mv === 'paint-atlas') return { id: 'paint-atlas', label: 'Create Paint Atlas' };
  if (mv === 'face-guard') return { id: 'face-guard', label: 'Unsafe Face Edit' };
  if (state.newMeshPrompt) return { id: 'new-mesh', label: state.newMeshPrompt.mode === 'add' ? 'Add Mesh' : 'New Mesh' };
  if (state.fileExplorerOpen) return { id: 'file-explorer', label: 'Asset Explorer' };
  if (state.mapDocumentOpen) return { id: 'map-documents', label: 'Map Workspaces' };
  if (state.buildDialogOpen) return { id: 'build-journal', label: 'Build Journal', closerCommandId: 'toggle-build-journal' };
  if (state.addChunkOpen) return { id: 'add-chunk', label: 'Add Chunk' };
  return null;
}

// ── Live undo/redo depths (req_2620 gap W) ────────────────────────────────────────────────────
// The TRUTH behind every undo/redo control: on a model surface the HOST mesh journal's depths
// (__mesh_history — the door cart code never called before this), on the world the real
// worldUndo/worldRedo stacks. Menus, the dock buttons, and the hotkey gate all read this — a
// button that would do nothing renders disabled with the reason instead.
export type UndoDepths = { undo: number; redo: number; source: 'mesh' | 'world' | 'strokes' | 'material' | 'knowledge' };
let g_colorStudioUndoDepths: UndoDepths = { undo: 0, redo: 0, source: 'material' };
export function undoDepths(state: EditorState): UndoDepths {
  if (activeSurface(state) === 'knowledge') return { undo: 0, redo: 0, source: 'knowledge' };
  if (activeSurface(state) === 'material') return g_colorStudioUndoDepths;
  if (activeSurface(state) === 'model') {
    // While the paint session is live the STROKE journal is the undo truth (req_2672):
    // menu rows read "Undo (N strokes)" and an empty journal refuses honestly instead
    // of silently falling through to the mesh journal.
    if (state.modelTool.paint) {
      try {
        const j = (globalThis as any).__mesh_paint_history?.();
        if (typeof j === 'string' && j) {
          const o = JSON.parse(j);
          return { undo: (o.undo ?? 0) | 0, redo: (o.redo ?? 0) | 0, source: 'strokes' };
        }
      } catch { /* door missing/malformed → honest zeros below */ }
      return { undo: 0, redo: 0, source: 'strokes' };
    }
    try {
      const j = (globalThis as any).__mesh_history?.();
      if (typeof j === 'string' && j) {
        const o = JSON.parse(j);
        return { undo: (o.undo ?? 0) | 0, redo: (o.redo ?? 0) | 0, source: 'mesh' };
      }
    } catch { /* door missing/malformed → honest zeros below */ }
    return { undo: 0, redo: 0, source: 'mesh' };
  }
  return { undo: state.worldUndo.length, redo: state.worldRedo.length, source: 'world' };
}

// Menu-row count annotation: commandById has no state parameter (DropdownMenu calls it bare), so
// AppFrame publishes the current depths each render and commandById folds them into the Undo/Redo
// row names — "Undo (3 mesh)" is the journal talking, not decoration.
let g_undoDepths: UndoDepths = { undo: 0, redo: 0, source: 'world' };
export function publishUndoDepths(d: UndoDepths): void { g_undoDepths = d; }
export function publishColorStudioUndoDepths(undo: number, redo: number): void {
  g_colorStudioUndoDepths = { undo, redo, source: 'material' };
}

// ── Enablement (the sane-app grayed-with-reason gate) ─────────────────────────────────────────
// A command is off when: a blocking overlay is unresolved (modal discipline), its surface isn't
// in view, it needs a selection and there is none, or it's undo/redo with an empty stack. Off
// commands render grayed with the reason; unimplemented commands are not registered at all.
export function commandEnabled(cmd: Command, state: EditorState): { on: boolean; reason?: string } {
  const block = blockingOverlay(state);
  if (block && cmd.id !== block.closerCommandId) {
    return { on: false, reason: `resolve ${block.label} first` };
  }
  const surface = activeSurface(state);
  if (cmd.scope !== 'global' && cmd.scope !== surface) {
    return { on: false, reason: `only in the ${cmd.scope} editor` };
  }
  // R follows the ruled build convention: selection turns first; with no
  // selection, an armed placement ghost turns in place before it is dropped.
  const canRotateArmedGhost = cmd.id === WORLD_PIECE_ROTATE_COMMAND_ID
    && surface === 'world'
    && state.activeCommandId === 'place-piece'
    && state.armedPieceId !== null;
  if (cmd.needsSelection && !hasSelection(state, surface) && !canRotateArmedGhost) {
    return { on: false, reason: 'select something first' };
  }
  if (cmd.id === 'undo-local' || cmd.id === 'redo-local') {
    const d = undoDepths(state);
    const n = cmd.id === 'undo-local' ? d.undo : d.redo;
    if (n <= 0) {
      return {
        on: false,
        reason: cmd.id === 'undo-local'
          ? (d.source === 'strokes' ? 'nothing to undo in paint' : d.source === 'mesh' ? 'mesh journal empty' : d.source === 'material' ? 'nothing to undo in Color Studio' : 'nothing to undo on the world')
          : (d.source === 'strokes' ? 'nothing to redo in paint' : d.source === 'mesh' ? 'nothing to redo in the mesh journal' : d.source === 'material' ? 'nothing to redo in Color Studio' : 'nothing to redo on the world'),
      };
    }
  }
  return { on: true };
}

// ── Menu tree (the nested structure the dropdown renders) ─────────────────────────────────────
// A node is a command row, a non-interactive section header, or an inline-expandable submenu whose
// children can themselves nest. A submenu carries its own `scope` so the whole flyout grays off its
// surface (Edit → Mesh is dead weight on the world; New Mesh works anywhere).
export type MenuNode =
  | { kind: 'cmd'; id: string }
  | { kind: 'section'; label: string }
  | { kind: 'sub'; id: string; label: string; icon: string; scope: Command['scope']; children: MenuNode[] };

const cmd = (id: string): MenuNode => ({ kind: 'cmd', id });
const section = (label: string): MenuNode => ({ kind: 'section', label });

// The Edit → Mesh flyout: the full host-native mesh editor, sectioned. Disabled off a model surface.
const MESH_SUBMENU: MenuNode = {
  kind: 'sub', id: 'Mesh', label: 'Mesh', icon: 'Boxes', scope: 'model',
  children: [
    section('Select'), cmd('mesh-vertex'), cmd('mesh-edge'), cmd('mesh-face'), cmd('mesh-select-uv-orientation'),
    section('Transform'), cmd('mesh-move'), cmd('mesh-scale'), cmd('mesh-scale-by'), cmd('mesh-rotate'), cmd('mesh-sym-x'), cmd('mesh-sym-y'), cmd('mesh-sym-z'), cmd('mesh-focus'), cmd('mesh-wire'),
    section('Topology'), cmd('mesh-extrude'), cmd('mesh-extrude-face'), cmd('mesh-create-face'), cmd('mesh-weld'), cmd('mesh-bevel'), cmd('mesh-flip-face'), cmd('mesh-loopcut'), cmd('mesh-cut'), cmd('mesh-detach'), cmd('mesh-glass'), cmd('mesh-solidify'), cmd('mesh-merge-faces'),
    section('Parts'),
    { kind: 'sub', id: 'Add Primitive', label: 'Add Primitive', icon: 'Boxes', scope: 'model', children: ADD_MESH_COMMANDS.map((c) => cmd(c.id)) },
    cmd('mesh-duplicate-part'), cmd('mesh-path-array'), cmd('mesh-mirror-x'), cmd('mesh-mirror-y'), cmd('mesh-mirror-z'), cmd('mesh-merge-down'), cmd('mesh-import-part'),
    section('Paint'), cmd('mesh-paint'), cmd('mesh-paint-fill'), cmd('mesh-paint-brush'), cmd('mesh-paint-pen'), cmd('mesh-paint-safety'), cmd('mesh-paint-detail'),
    { kind: 'sub', id: 'Paint Resolution', label: 'Paint Resolution', icon: 'Grid3x3', scope: 'model', children: PAINT_RES_COMMANDS.map((c) => cmd(c.id)) },
  ],
};

const MENU_TREE: Record<Menu, MenuNode[]> = {
  File: [
    cmd('new-map'),
    {
      kind: 'sub', id: 'New Mesh', label: 'New Mesh', icon: 'Boxes', scope: 'global', children: [
        section('Primitives'),
        ...NEW_MESH_COMMANDS.map((c) => cmd(c.id)),
        {
          kind: 'sub', id: 'Build Pieces', label: 'Build Pieces', icon: 'Building2', scope: 'global',
          children: NEW_BUILD_STARTER_COMMANDS.map((c) => cmd(c.id)),
        },
        section('Characters'), cmd('new-model-player'),
      ],
    },
    cmd('open-map'), cmd('open-file-explorer'), cmd('find-import-source'), cmd('import-model-file'), cmd('save-snapshot'),
    // Export → Build Piece → <kind>. Nested so Export can grow other targets later.
    {
      kind: 'sub', id: 'Export', label: 'Export', icon: 'Upload', scope: 'model', children: [
        { kind: 'sub', id: 'Export Build Piece', label: 'Build Piece', icon: 'PackagePlus', scope: 'model', children: EXPORT_BUILD_COMMANDS.map((c) => cmd(c.id)) },
        { kind: 'sub', id: 'Export Prop', label: 'Prop', icon: 'Armchair', scope: 'model', children: EXPORT_PROP_COMMANDS.map((c) => cmd(c.id)) },
        { kind: 'sub', id: 'Export Flora', label: 'Flora', icon: 'Sprout', scope: 'model', children: EXPORT_FLORA_COMMANDS.map((c) => cmd(c.id)) },
        cmd('export-character'),
      ],
    },
  ],
  Edit: [cmd('undo-local'), cmd('redo-local'), cmd('duplicate-selection'), cmd('create-prefab'), cmd('delete-selection'), MESH_SUBMENU],
  View: [cmd('toggle-minimap'), cmd('focus-selection'), cmd('model-ref-images')],
  Map: [cmd('add-chunk'), cmd('world.floor.step')],
  Build: [cmd('select-tool'), cmd('place-piece'), cmd('move-selection'), cmd(WORLD_PIECE_ROTATE_COMMAND_ID), cmd('create-prefab'), cmd('paint-faces'), cmd('place-sticker'), cmd('paint-facade'), cmd('open-color-studio')],
  Globals: [cmd('globals-physics'), cmd('globals-animation')],
  Window: [cmd('toggle-eventbus'), cmd('toggle-performance'), cmd('toggle-memory'), cmd('toggle-build-journal')],
};

export function menuNodes(menu: Menu): MenuNode[] {
  return MENU_TREE[menu] ?? [];
}

/** A submenu grays off its surface, exactly like a command's scope rule. */
export function submenuEnabled(scope: Command['scope'], state: EditorState): boolean {
  return scope === 'global' || scope === activeSurface(state);
}

// ── Model tool groups (toolbar + context menu; unchanged callers) ──────────────────────────────
// The always-on model tool group (select / gizmo / toggles), in display order.
const MESH_TOOL_IDS = ['mesh-vertex', 'mesh-edge', 'mesh-face', 'mesh-move', 'mesh-scale', 'mesh-rotate', 'mesh-sym-x', 'mesh-sym-y', 'mesh-sym-z', 'mesh-paint', 'mesh-path-plane', 'mesh-path-edges', 'mesh-focus', 'mesh-wire', 'mesh-cam-lock', 'mesh-cam-store', 'mesh-cam-recall'];

export function meshToolCommands(): Command[] {
  return MESH_TOOL_IDS.map(commandById);
}

// The contextual topology pair stays ordered as cmd('mesh-loopcut'), cmd('mesh-cut').
// The contextual topology ops that apply to the current selection: extrude/loop-cut on a single
// edge, create-face on two or more, and the face-selection toolset (loop-cut/detach/glass/
// solidify/merge) in face mode — loop cut on a FACE is the studio's Blockbench treatment
// (popup: direction/cuts/offset, live preview). Empty when nothing applies. Surfaces the
// same way in the toolbar and context menu.
export function meshTopoCommands(tool: { selMode: number; sel: number }, selectedPartCount = 0): Command[] {
  if (tool.sel < 1) return [];
  // Vertex mode: one real corner bevels; two or more selected verts weld at center.
  if (tool.selMode === 1) {
    return tool.sel === 1 ? [commandById('mesh-bevel')] : [commandById('mesh-weld')];
  }
  if (tool.selMode === 2) {
    // Weld collapses the selected edges' endpoints — one edge = an edge collapse.
    return tool.sel === 1
      ? [commandById('mesh-extrude'), commandById('mesh-bevel'), commandById('mesh-loopcut'), commandById('mesh-weld')]
      : [commandById('mesh-create-face'), commandById('mesh-weld')];
  }
  if (tool.selMode === 3) {
    return [
      commandById('mesh-select-uv-orientation'),
      ...(tool.sel === 1 ? [commandById('mesh-extrude-face')] : []),
      commandById('mesh-flip-face'), commandById('mesh-loopcut'), commandById('mesh-cut'), commandById('mesh-detach'), commandById('mesh-glass'), commandById('mesh-solidify'),
      // Outliner multi-select is represented host-side by selecting every authored face
      // in those parts. Offering Merge Faces here would collapse all of those groups to
      // one face and strand zero-face outliner rows (req_2870). The parts command below
      // owns that gesture instead and preserves each pre-merge authored face.
      ...(selectedPartCount >= 2 ? [] : [commandById('mesh-merge-faces')]),
    ];
  }
  return [];
}

// The part-level verbs for the FOCUSED outliner part plus the always-available library import.
// Merge exists only for an explicit 2+ row selection: list adjacency is never a target rule.
export function meshPartCommands(hasActivePart: boolean, selectedPartCount: number): Command[] {
  const out: Command[] = [];
  if (hasActivePart) {
    out.push(commandById('mesh-duplicate-part'), commandById('mesh-path-array'), commandById('mesh-mirror-x'), commandById('mesh-mirror-y'), commandById('mesh-mirror-z'));
    if (selectedPartCount >= 2) out.push(commandById('mesh-merge-down'));
  }
  out.push(commandById('mesh-import-part'));
  return out;
}

// The model right-click menu is deliberately shallower than the full Edit → Mesh
// catalog: frequent/contextual verbs stay one click away while stable tool families
// collapse behind four small rows. Keep this layout in data so a presentation cleanup
// can never silently lose a command from the canonical mesh tool/part lists.
export type ModelContextMenuGroupId = 'select' | 'gizmo' | 'mirror' | 'view';

export type ModelContextMenuGroup = {
  id: ModelContextMenuGroupId;
  label: string;
  icon: string;
  commands: Command[];
};

export type ModelContextMenuLayout = {
  groups: ModelContextMenuGroup[];
  directToolCommands: Command[];
  directPartCommands: Command[];
};

const MODEL_CONTEXT_GROUPS: {
  id: ModelContextMenuGroupId;
  label: string;
  icon: string;
  commandIds: string[];
}[] = [
  { id: 'select', label: 'Select Mode', icon: 'Grip', commandIds: ['mesh-vertex', 'mesh-edge', 'mesh-face'] },
  { id: 'gizmo', label: 'Gizmo', icon: 'Move', commandIds: ['mesh-move', 'mesh-scale', 'mesh-scale-by', 'mesh-rotate'] },
  { id: 'mirror', label: 'Mirror', icon: 'FlipHorizontal2', commandIds: ['mesh-sym-x', 'mesh-sym-y', 'mesh-sym-z'] },
  { id: 'view', label: 'View', icon: 'Grid3x3', commandIds: ['mesh-focus', 'mesh-wire', 'mesh-cam-lock', 'mesh-cam-store', 'mesh-cam-recall'] },
];

const MODEL_CONTEXT_MIRROR_PART_IDS = new Set(['mesh-mirror-x', 'mesh-mirror-y', 'mesh-mirror-z']);
const MODEL_CONTEXT_GROUPED_TOOL_IDS = new Set(MODEL_CONTEXT_GROUPS.flatMap((group) => group.commandIds));

export function modelContextMenuLayout(hasActivePart: boolean, selectedPartCount: number): ModelContextMenuLayout {
  const partCommands = meshPartCommands(hasActivePart, selectedPartCount);
  const mirrorPartCommands = partCommands.filter((command) => MODEL_CONTEXT_MIRROR_PART_IDS.has(command.id));

  return {
    groups: MODEL_CONTEXT_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      icon: group.icon,
      commands: [
        ...group.commandIds.map(commandById),
        ...(group.id === 'mirror' ? mirrorPartCommands : []),
      ],
    })),
    // Paint Faces stays direct. Any future always-on tool also stays visible until
    // it is intentionally assigned to a family above.
    directToolCommands: meshToolCommands().filter((command) => !MODEL_CONTEXT_GROUPED_TOOL_IDS.has(command.id)),
    // Duplicate / path array / structural merge / import are primary part verbs. Only mirrored
    // duplication moves into Mirror, where all six axis controls live together.
    directPartCommands: partCommands.filter((command) => !MODEL_CONTEXT_MIRROR_PART_IDS.has(command.id)),
  };
}

// Paint behaviours, surfaced as toolbar icon buttons only while painting.
export function meshPaintCommands(tool: { paint: boolean }): Command[] {
  if (!tool.paint) return [];
  return [commandById('mesh-paint-fill'), commandById('mesh-paint-brush'), commandById('mesh-paint-pen')];
}

export function isMeshToolCommand(id: string): boolean {
  return commandById(id).scope === 'model';
}

// Is this model tool the active one, given the live tool snapshot? Drives the toolbar/context-menu
// highlight. Gizmo tools only read active inside a select mode; view/paint/focus are exclusive.
export function meshToolActive(id: string, tool: { selMode: number; gizmoTool: number; paint: boolean; pathPlane?: boolean; pathEdges?: boolean; focus: boolean; wire: boolean; camLock?: boolean; camSaved?: boolean; brushTool?: string; safety?: number; detail?: number; mirror?: number }): boolean {
  switch (id) {
    case 'mesh-sym-x': return ((tool.mirror ?? 0) & 1) !== 0;
    case 'mesh-sym-y': return ((tool.mirror ?? 0) & 2) !== 0;
    case 'mesh-sym-z': return ((tool.mirror ?? 0) & 4) !== 0;
    case 'mesh-vertex': return tool.selMode === 1 && !tool.paint && !tool.focus;
    case 'mesh-edge': return tool.selMode === 2 && !tool.paint && !tool.focus;
    case 'mesh-face': return tool.selMode === 3 && !tool.paint && !tool.focus;
    case 'mesh-move': return tool.selMode !== 0 && tool.gizmoTool === 0;
    case 'mesh-scale': return tool.selMode !== 0 && tool.gizmoTool === 1;
    case 'mesh-rotate': return tool.selMode !== 0 && tool.gizmoTool === 2;
    case 'mesh-paint': return tool.paint;
    case 'mesh-path-plane': return tool.pathPlane === true;
    case 'mesh-path-edges': return tool.pathEdges === true;
    case 'mesh-paint-fill': return tool.paint && tool.brushTool === 'fill';
    case 'mesh-paint-brush': return tool.paint && tool.brushTool === 'brush';
    case 'mesh-paint-pen': return tool.paint && tool.brushTool === 'pen';
    case 'mesh-focus': return tool.focus;
    case 'mesh-wire': return tool.wire;
    case 'mesh-cam-lock': return tool.camLock === true;
    // "Active" = a view is pinned — the store button stays lit so the user can see a
    // bookmark exists before trusting Recall with their camera.
    case 'mesh-cam-store': return tool.camSaved === true;
    default: return false;
  }
}

export function commandById(id: string): Command {
  const found = COMMANDS.find((command) => command.id === id) ?? COMMANDS[0]!;
  // Count-annotate the Undo/Redo rows from the LIVE depths (published by AppFrame each
  // render): "Undo (3 mesh)" tells the truth about which journal answers and how deep.
  if (found.id === 'undo-local' || found.id === 'redo-local') {
    const n = found.id === 'undo-local' ? g_undoDepths.undo : g_undoDepths.redo;
    return { ...found, name: `${found.name} (${n} ${g_undoDepths.source})` };
  }
  return found;
}

/** True only for commands with a live registry entry. Used to discard stale hot-view
 * selections after a command is removed instead of silently resolving them to COMMANDS[0]. */
export function commandExists(id: string): boolean {
  return COMMANDS.some((command) => command.id === id);
}

function menuItemWidth(menu: Menu): number {
  return MENU_ITEM_PAD + menu.length * MENU_GLYPH_ADVANCE;
}

export function menuDropdownLeft(menu: Menu | null): number {
  if (!menu) return MENU_BAR_LEFT;
  let left = MENU_BAR_LEFT;
  for (const candidate of MENUS) {
    if (candidate === menu) break;
    left += menuItemWidth(candidate) + MENU_ITEM_GAP;
  }
  const triggerCenter = left + menuItemWidth(menu) / 2;
  return Math.max(MENU_DROPDOWN_GUTTER, triggerCenter - MENU_DROPDOWN_WIDTH / 2);
}

export function activeMenuFor(state: EditorState): Menu {
  return state.openMenu ?? state.actionMenu;
}

/** Section D follows the armed world-tool family, not command/menu history.
 * Report-only commands therefore cannot swap the toolbar. */
export function worldActionBarCommands(state: Pick<EditorState, 'activeCommandId'>): Command[] {
  const activeTool = commandById(state.activeCommandId);
  const menu: Menu = activeTool.tool && activeTool.scope === 'world' ? activeTool.menu : 'Build';
  return COMMANDS.filter((command) =>
    command.menu === menu && command.scope !== 'model' && !command.submenu);
}
