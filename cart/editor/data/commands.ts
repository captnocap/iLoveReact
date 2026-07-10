// editor/data/commands.ts — command table + enablement + menu geometry/tree.
//
// The file menus are the source-of-truth command registry (DESIGN_INTAKE). Every command
// declares the surface it's relevant on (`scope`) and whether it exists yet (`available`);
// commandEnabled folds those into the sane-app "grayed-with-reason" state, and menuNodes
// lays the registry out as the nested tree the dropdown renders. Pure data + pure helpers.
import { activeSurface, hasSelection } from './surfaces';
import { KIND_ORDER, KIND_LABEL } from '../world/buildCatalog';
import { BUILD_PIECE_STARTERS } from './buildStarters';
import type { Command, Menu, EditorState, PrimitiveKind } from './types';

export const MENUS: Menu[] = ['File', 'Edit', 'View', 'Map', 'Build', 'Story', 'Globals', 'Window', 'Help'];
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
  id: `new-build-starter-${starter.kind}`,
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
const EXPORT_BUILD_COMMANDS: Command[] = KIND_ORDER.map((k) => ({
  id: `export-build-piece-${k}`, menu: 'File', submenu: 'Export Build Piece', name: KIND_LABEL[k], icon: 'PackagePlus',
  key: '', context: false, native: true, undoable: false, scope: 'model',
}));

// Export → Prop (req_2712): export the OPEN model as a free-placing PROP,
// carrying its rig (pockets/placements/seats — the Inspector's Rig section) in
// the package manifest. One leaf — props have no snap-affinity flyout.
const EXPORT_PROP_COMMAND: Command = {
  id: 'export-prop', menu: 'File', submenu: 'Export', name: 'Prop', icon: 'Armchair',
  key: '', context: false, native: true, undoable: false, scope: 'model',
};

// Export → Player / NPC Model (req_2771): export the OPEN model as a CHARACTER.
// Opens the role dialog — the game's ONE played model vs an NPC population
// model — and the confirmed role lands in manifest.placeable (req_2718 truth).
const EXPORT_CHARACTER_COMMAND: Command = {
  id: 'export-character', menu: 'File', submenu: 'Export', name: 'Player / NPC Model...', icon: 'PersonStanding',
  key: '', context: false, native: true, undoable: false, scope: 'model',
};

// Menu-bar geometry, derived from the Chrome styles (workspace.cls HW_*). The dropdown is mounted
// at the app root, so these are window-relative pixels: the first menu item begins after the chrome
// padding + brand block + chrome gap.
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
  // Save writes the ACTIVE model to the library → only meaningful on a model surface.
  { id: 'save-snapshot', menu: 'File', name: 'Save Model to Library', icon: 'Save', key: 'Ctrl+S', context: false, native: true, undoable: false, scope: 'model' },
  ...EXPORT_BUILD_COMMANDS,
  EXPORT_PROP_COMMAND,
  EXPORT_CHARACTER_COMMAND,
  // Compile bakes the WORLD to RLE game data; the pipeline isn't wired yet (returns 0/0).
  { id: 'compile-rle', menu: 'File', name: 'Compile RLE Game Data', icon: 'PackageCheck', key: 'F9', context: false, native: true, undoable: false, scope: 'world', available: false },

  // ── Edit ──────────────────────────────────────────────────────────────────────────────────
  // Undo/redo route per surface in runCommand (model → host mesh journal; world → local history).
  { id: 'undo-local', menu: 'Edit', name: 'Undo', icon: 'Undo2', key: 'Ctrl+Z', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'redo-local', menu: 'Edit', name: 'Redo', icon: 'Redo2', key: 'Ctrl+Shift+Z', context: false, native: true, undoable: false, scope: 'global' },
  { id: 'duplicate-selection', menu: 'Edit', name: 'Duplicate Selection', icon: 'Copy', key: 'D', context: true, native: true, undoable: true, scope: 'world', needsSelection: true },
  // Delete acts on whatever's selected on the active surface (world object or mesh element).
  { id: 'delete-selection', menu: 'Edit', name: 'Delete Selection', icon: 'Trash2', key: 'Del', context: true, native: true, undoable: true, tool: true, scope: 'global', needsSelection: true },
  ...ADD_MESH_COMMANDS,
  ...PAINT_RES_COMMANDS,

  // ── View ──────────────────────────────────────────────────────────────────────────────────
  { id: 'toggle-view-mode', menu: 'View', name: 'Switch 2D/3D View', icon: 'PanelTop', key: 'Tab', context: false, native: true, undoable: false, scope: 'world' },
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
  { id: 'add-trigger', menu: 'Map', name: 'Add Trigger Volume', icon: 'BoxSelect', key: 'T', context: true, native: true, undoable: true, tool: true, scope: 'world', available: false },
  { id: 'set-spawn', menu: 'Map', name: 'Set Spawn Point', icon: 'MapPin', key: 'S', context: true, native: true, undoable: true, tool: true, scope: 'world', available: false },
  // FLOORCTL req_2485: steps the REAL active storey (0 = Ground) up, wrapping past the cap.
  { id: 'cycle-floor', menu: 'Map', name: 'Cycle Active Floor', icon: 'Layers', key: ']', context: false, native: true, undoable: false, scope: 'world' },

  // ── Build (world) ─────────────────────────────────────────────────────────────────────────
  // Select is the neutral default (req_2550): a viewport click picks the piece under it and places
  // nothing. It's the tool the editor boots into; Esc returns to it. Arming any other tool takes
  // the click away from placement — that's the modality the world was missing.
  { id: 'select-tool', menu: 'Build', name: 'Select', icon: 'MousePointer2', key: '', context: false, native: true, undoable: false, tool: true, scope: 'world' },
  { id: 'place-piece', menu: 'Build', name: 'Place Piece', icon: 'Pencil', key: 'B', context: true, native: true, undoable: true, tool: true, scope: 'world' },
  // Move is an armable mode: click a piece to grab it. Not selection-gated — the click selects.
  { id: 'move-selection', menu: 'Build', name: 'Move Selection', icon: 'Move', key: 'V', context: true, native: true, undoable: false, tool: true, scope: 'world' },
  // R is mode-sensitive (req_0598): it spins the selected placed piece when one
  // exists, otherwise the armed placement ghost. The enablement gate below keeps
  // both routes discoverable on the world surface.
  { id: 'rotate-selection', menu: 'Build', name: 'Rotate Piece', icon: 'RotateCw', key: 'R', context: true, native: true, undoable: true, scope: 'world', needsSelection: true },
  { id: 'paint-material', menu: 'Build', name: 'Paint Material', icon: 'Brush', key: 'P', context: true, native: true, undoable: true, tool: true, scope: 'world', needsSelection: true },
  // Paint Faces (req_2879): an armable brush MODE — touch a placed piece's face and the
  // browser's active material lands in THAT face's slot (front vs back stay separate, so the
  // exterior and interior of one wall paint independently). A drag sweeps across faces. Not
  // selection-gated — the touch provides the target, like Focus/Move.
  { id: 'paint-faces', menu: 'Build', name: 'Paint Faces', icon: 'Paintbrush', key: 'N', context: true, native: true, undoable: true, tool: true, scope: 'world' },
  { id: 'open-color-studio', menu: 'Build', name: 'Open Color Studio', icon: 'Palette', key: 'C', context: true, native: true, undoable: false, tool: true, scope: 'world', needsSelection: true },
  { id: 'sample-material', menu: 'Build', name: 'Sample Material', icon: 'Pipette', key: 'I', context: true, native: true, undoable: false, tool: true, scope: 'world', needsSelection: true },

  // ── Story (world) ─────────────────────────────────────────────────────────────────────────
  { id: 'mission-point', menu: 'Story', name: 'Place Mission Point', icon: 'Flag', key: 'G', context: true, native: true, undoable: true, tool: true, scope: 'world', available: false },
  { id: 'author-sequence', menu: 'Story', name: 'Author Sequence Marker', icon: 'Route', key: 'Q', context: true, native: true, undoable: true, tool: true, scope: 'world', available: false },

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

  // ── Help ──────────────────────────────────────────────────────────────────────────────────
  { id: 'show-pipeline', menu: 'Help', name: 'Show Feature Pipeline', icon: 'Workflow', key: '?', context: false, native: false, undoable: false, scope: 'global', available: false },

  // ── Model-surface mesh tools (Edit → Mesh; the host-native mesh editor) ──────────────────────
  // scope 'model' → only enabled when a model document is the active surface. Keys resolve per
  // surface through the keymap; ModelView owns their live dispatch.
  { id: 'mesh-vertex', menu: 'Edit', scope: 'model', name: 'Vertex Select', icon: 'Grip', key: '1', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-edge', menu: 'Edit', scope: 'model', name: 'Edge Select', icon: 'Spline', key: '2', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-face', menu: 'Edit', scope: 'model', name: 'Face Select', icon: 'Triangle', key: '3', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-move', menu: 'Edit', scope: 'model', name: 'Move Gizmo', icon: 'Move', key: 'G', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-scale', menu: 'Edit', scope: 'model', name: 'Scale Gizmo', icon: 'Scale3d', key: 'S', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-rotate', menu: 'Edit', scope: 'model', name: 'Rotate Gizmo', icon: 'Rotate3d', key: 'R', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint', menu: 'Edit', scope: 'model', name: 'Paint Faces', icon: 'Brush', key: 'P', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-focus', menu: 'Edit', scope: 'model', name: 'Focus Pivot', icon: 'Focus', key: 'F', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-wire', menu: 'Edit', scope: 'model', name: 'Wireframe', icon: 'Grid3x3', key: 'W', context: false, native: true, undoable: false, tool: true },
  // Live mirror editing (req_2758): toggle a symmetry plane — while on, gizmo edits land
  // reflected on each moved element's twin across that plane (plane at 0; Center first).
  { id: 'mesh-sym-x', menu: 'Edit', scope: 'model', name: 'Mirror Edit X', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-sym-y', menu: 'Edit', scope: 'model', name: 'Mirror Edit Y', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-sym-z', menu: 'Edit', scope: 'model', name: 'Mirror Edit Z', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: false, tool: true },
  // Contextual topology ops — edge mode has edge extrude/create-face; face mode has face extrude.
  { id: 'mesh-extrude', menu: 'Edit', scope: 'model', name: 'Extrude Edge', icon: 'ArrowUpFromLine', key: 'E', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-extrude-face', menu: 'Edit', scope: 'model', name: 'Extrude Face', icon: 'ArrowUpFromLine', key: 'E', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-create-face', menu: 'Edit', scope: 'model', name: 'Create Face', icon: 'SquarePlus', key: 'C', context: true, native: true, undoable: true, tool: true },
  // Studio's req_1182 face correction, restored on the active host-native surface:
  // reverse winding + UV corner order so an inside-out created face points outward.
  { id: 'mesh-flip-face', menu: 'Edit', scope: 'model', name: 'Flip Face', icon: 'FlipVertical2', key: 'X', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-loopcut', menu: 'Edit', scope: 'model', name: 'Loop Cut', icon: 'Scissors', key: 'L', context: true, native: true, undoable: true, tool: true },
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
  { id: 'mesh-mirror-x', menu: 'Edit', scope: 'model', name: 'Mirror Part X', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-y', menu: 'Edit', scope: 'model', name: 'Mirror Part Y', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-z', menu: 'Edit', scope: 'model', name: 'Mirror Part Z', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-merge-down', menu: 'Edit', scope: 'model', name: 'Merge Selected Parts', icon: 'Merge', key: '', context: true, native: true, undoable: true, tool: true },
  // Cross-model reuse: append a saved library model into the OPEN model as new part(s).
  { id: 'mesh-import-part', menu: 'Edit', scope: 'model', name: 'Add From Library...', icon: 'PackagePlus', key: '', context: true, native: true, undoable: true, tool: true },
  // Paint sub-tools — the two brush behaviours plus the free-form face-safety and detail toggles.
  { id: 'mesh-paint-fill', menu: 'Edit', scope: 'model', name: 'Fill Face', icon: 'PaintBucket', key: 'B', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint-brush', menu: 'Edit', scope: 'model', name: 'Free Brush', icon: 'Paintbrush', key: 'N', context: true, native: true, undoable: true, tool: true },
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
export type UndoDepths = { undo: number; redo: number; source: 'mesh' | 'world' | 'strokes' };
export function undoDepths(state: EditorState): UndoDepths {
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

// ── Enablement (the sane-app grayed-with-reason gate) ─────────────────────────────────────────
// A command is off when: a blocking overlay is unresolved (modal discipline), the capability
// doesn't exist yet, its surface isn't in view, it needs a selection and there is none, or it's
// undo/redo with an empty stack. Off commands render grayed with the reason; they never vanish.
export function commandEnabled(cmd: Command, state: EditorState): { on: boolean; reason?: string } {
  const block = blockingOverlay(state);
  if (block && cmd.id !== block.closerCommandId) {
    return { on: false, reason: `resolve ${block.label} first` };
  }
  if (cmd.available === false) return { on: false, reason: 'not available yet' };
  const surface = activeSurface(state);
  if (cmd.scope !== 'global' && cmd.scope !== surface) {
    return { on: false, reason: `only in the ${cmd.scope} editor` };
  }
  // R follows the ruled build convention: selection turns first; with no
  // selection, an armed placement ghost turns in place before it is dropped.
  const canRotateArmedGhost = cmd.id === 'rotate-selection'
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
          ? (d.source === 'strokes' ? 'nothing to undo in paint' : d.source === 'mesh' ? 'mesh journal empty' : 'nothing to undo on the world')
          : (d.source === 'strokes' ? 'nothing to redo in paint' : d.source === 'mesh' ? 'nothing to redo in the mesh journal' : 'nothing to redo on the world'),
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
    section('Select'), cmd('mesh-vertex'), cmd('mesh-edge'), cmd('mesh-face'),
    section('Transform'), cmd('mesh-move'), cmd('mesh-scale'), cmd('mesh-rotate'), cmd('mesh-sym-x'), cmd('mesh-sym-y'), cmd('mesh-sym-z'), cmd('mesh-focus'), cmd('mesh-wire'),
    section('Topology'), cmd('mesh-extrude'), cmd('mesh-extrude-face'), cmd('mesh-create-face'), cmd('mesh-flip-face'), cmd('mesh-loopcut'), cmd('mesh-detach'), cmd('mesh-glass'), cmd('mesh-solidify'), cmd('mesh-merge-faces'),
    section('Parts'),
    { kind: 'sub', id: 'Add Primitive', label: 'Add Primitive', icon: 'Boxes', scope: 'model', children: ADD_MESH_COMMANDS.map((c) => cmd(c.id)) },
    cmd('mesh-duplicate-part'), cmd('mesh-mirror-x'), cmd('mesh-mirror-y'), cmd('mesh-mirror-z'), cmd('mesh-merge-down'), cmd('mesh-import-part'),
    section('Paint'), cmd('mesh-paint'), cmd('mesh-paint-fill'), cmd('mesh-paint-brush'), cmd('mesh-paint-safety'), cmd('mesh-paint-detail'),
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
        cmd('export-prop'),
        cmd('export-character'),
      ],
    },
    cmd('compile-rle'),
  ],
  Edit: [cmd('undo-local'), cmd('redo-local'), cmd('duplicate-selection'), cmd('delete-selection'), MESH_SUBMENU],
  View: [cmd('toggle-view-mode'), cmd('toggle-minimap'), cmd('focus-selection'), cmd('model-ref-images')],
  Map: [cmd('add-chunk'), cmd('add-trigger'), cmd('set-spawn'), cmd('cycle-floor')],
  Build: [cmd('select-tool'), cmd('place-piece'), cmd('move-selection'), cmd('rotate-selection'), cmd('paint-material'), cmd('paint-faces'), cmd('open-color-studio'), cmd('sample-material')],
  Story: [cmd('mission-point'), cmd('author-sequence')],
  Globals: [cmd('globals-physics'), cmd('globals-animation')],
  Window: [cmd('toggle-eventbus'), cmd('toggle-performance'), cmd('toggle-memory'), cmd('toggle-build-journal')],
  Help: [cmd('show-pipeline')],
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
const MESH_TOOL_IDS = ['mesh-vertex', 'mesh-edge', 'mesh-face', 'mesh-move', 'mesh-scale', 'mesh-rotate', 'mesh-sym-x', 'mesh-sym-y', 'mesh-sym-z', 'mesh-paint', 'mesh-focus', 'mesh-wire'];

export function meshToolCommands(): Command[] {
  return MESH_TOOL_IDS.map(commandById);
}

// The contextual topology ops that apply to the current selection: extrude/loop-cut on a single
// edge, create-face on two or more, and the face-selection toolset (loop-cut/detach/glass/
// solidify/merge) in face mode — loop cut on a FACE is the studio's Blockbench treatment
// (popup: direction/cuts/offset, live preview). Empty when nothing applies. Surfaces the
// same way in the toolbar and context menu.
export function meshTopoCommands(tool: { selMode: number; sel: number }, selectedPartCount = 0): Command[] {
  if (tool.sel < 1) return [];
  if (tool.selMode === 2) {
    return tool.sel === 1
      ? [commandById('mesh-extrude'), commandById('mesh-loopcut')]
      : [commandById('mesh-create-face')];
  }
  if (tool.selMode === 3) {
    return [
      ...(tool.sel === 1 ? [commandById('mesh-extrude-face')] : []),
      commandById('mesh-flip-face'), commandById('mesh-loopcut'), commandById('mesh-detach'), commandById('mesh-glass'), commandById('mesh-solidify'),
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
    out.push(commandById('mesh-duplicate-part'), commandById('mesh-mirror-x'), commandById('mesh-mirror-y'), commandById('mesh-mirror-z'));
    if (selectedPartCount >= 2) out.push(commandById('mesh-merge-down'));
  }
  out.push(commandById('mesh-import-part'));
  return out;
}

// The two brush behaviours (fill · free-form), surfaced as toolbar icon buttons only while painting.
export function meshPaintCommands(tool: { paint: boolean }): Command[] {
  if (!tool.paint) return [];
  return [commandById('mesh-paint-fill'), commandById('mesh-paint-brush')];
}

export function isMeshToolCommand(id: string): boolean {
  return commandById(id).scope === 'model';
}

// Is this model tool the active one, given the live tool snapshot? Drives the toolbar/context-menu
// highlight. Gizmo tools only read active inside a select mode; view/paint/focus are exclusive.
export function meshToolActive(id: string, tool: { selMode: number; gizmoTool: number; paint: boolean; focus: boolean; wire: boolean; brushTool?: string; safety?: number; detail?: number; mirror?: number }): boolean {
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
    case 'mesh-paint-fill': return tool.paint && tool.brushTool === 'fill';
    case 'mesh-paint-brush': return tool.paint && tool.brushTool !== 'fill';
    case 'mesh-focus': return tool.focus;
    case 'mesh-wire': return tool.wire;
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
  return Math.max(MENU_DROPDOWN_GUTTER, left);
}

export function activeMenuFor(state: EditorState): Menu {
  return state.openMenu ?? state.actionMenu;
}
