// editor/data/commands.ts — command table + menu geometry helpers.
//
// Cloned from the hmsc-workspace-mock god-file. Pure data + pure helpers.
import type { Command, Menu, EditorState, PrimitiveKind } from './types';

export const MENUS: Menu[] = ['File', 'Edit', 'View', 'Map', 'Build', 'Story', 'Window', 'Help'];
export const MENU_DROPDOWN_WIDTH = 420;

// The starter primitives under File → New Mesh. ONE list drives the submenu commands
// (below), the id→kind dispatch (AppFrame), and the geometry (primitiveMeshData) — add a
// row here + a generator case and the whole path lights up.
export const PRIMITIVE_MESHES: { kind: PrimitiveKind; name: string; icon: string }[] = [
  { kind: 'cube', name: 'Cube', icon: 'Box' },
  { kind: 'cylinder', name: 'Cylinder', icon: 'Cylinder' },
  { kind: 'cone', name: 'Cone', icon: 'Cone' },
  { kind: 'pyramid', name: 'Pyramid', icon: 'Pyramid' },
  { kind: 'plane', name: 'Plane', icon: 'Square' },
  { kind: 'sphere', name: 'Sphere', icon: 'Globe' },
  { kind: 'icosphere', name: 'Icosphere', icon: 'Hexagon' },
];
const NEW_MESH_COMMANDS: Command[] = PRIMITIVE_MESHES.map((p) => ({
  id: `new-mesh-${p.kind}`, menu: 'File', submenu: 'New Mesh', name: p.name, icon: p.icon,
  key: '', context: false, native: true, undoable: false,
}));

// Paint resolution — texels per TRIANGLE patch for free-form model painting (a quad face
// is two triangle patches; "face" would misread a cube's 6 as its 12 — req_2509). A deep
// File submenu (nested, out of the way) with the FULL range: pick any and the host takes
// it (dense meshes clamp to the atlas budget). Higher = finer strokes; a cube at 512 fits
// real text on a face.
export const PAINT_RESOLUTIONS = [16, 32, 64, 128, 256, 512] as const;
const PAINT_RES_COMMANDS: Command[] = PAINT_RESOLUTIONS.map((px) => ({
  id: `paint-res-${px}`, menu: 'File', submenu: 'Paint Resolution', name: `${px}×${px} texels / triangle`, icon: 'Grid3x3',
  key: '', context: false, native: true, undoable: false,
}));

// Menu-bar geometry, derived from the Chrome styles (workspace.cls HW_*). The
// dropdown is mounted at the app root, so these are window-relative pixels: the
// first menu item begins after the chrome padding + brand block + chrome gap.
const MENU_BAR_LEFT = 156;     // HW_Chrome paddingLeft(10) + HW_Brand(136) + HW_Chrome gap(10)
const MENU_ITEM_PAD = 18;      // HW_MenuItem paddingLeft(9) + paddingRight(9)
const MENU_ITEM_GAP = 2;       // HW_MenuBar gap between items
const MENU_GLYPH_ADVANCE = 6.4; // ~per-glyph advance of HW_MenuText at fontSize 11
const MENU_DROPDOWN_GUTTER = 12; // keep the panel off the window edge

export const COMMANDS: Command[] = [
  { id: 'new-map', menu: 'File', name: 'New Map Workspace', icon: 'FilePlus2', key: 'Ctrl+N', context: false, native: true, undoable: false },
  // File → New Mesh → {Cube, Cylinder, …}. A fresh primitive opens as its own model document
  // with the host-native mesh editor live. Generated from PRIMITIVE_MESHES so the submenu,
  // dispatch, and geometry stay in lockstep.
  ...NEW_MESH_COMMANDS,
  ...PAINT_RES_COMMANDS,
  { id: 'open-map', menu: 'File', name: 'Open Workspace', icon: 'FolderOpen', key: 'Ctrl+O', context: false, native: true, undoable: false },
  { id: 'open-file-explorer', menu: 'File', name: 'Open Project File Explorer', icon: 'FolderSearch', key: 'Ctrl+P', context: false, native: true, undoable: false },
  { id: 'find-import-source', menu: 'File', name: 'Find Import Source', icon: 'SearchCode', key: 'Ctrl+Shift+P', context: false, native: true, undoable: false },
  // Import a .glb/.obj from anywhere on disk via the OS picker — the same native mesh
  // importer (__mesh_load_file) the explorer's in-project model rows open through.
  { id: 'import-model-file', menu: 'File', name: 'Import Model (.glb / .obj)...', icon: 'FolderInput', key: 'Ctrl+I', context: false, native: true, undoable: false },
  { id: 'save-snapshot', menu: 'File', name: 'Save Materialized Snapshot', icon: 'Save', key: 'Ctrl+S', context: false, native: true, undoable: false },
  { id: 'compile-rle', menu: 'File', name: 'Compile RLE Game Data', icon: 'PackageCheck', key: 'F9', context: false, native: true, undoable: false },
  { id: 'undo-local', menu: 'Edit', name: 'Undo Local Step', icon: 'Undo2', key: 'Ctrl+Z', context: false, native: true, undoable: false },
  { id: 'redo-local', menu: 'Edit', name: 'Redo Local Step', icon: 'Redo2', key: 'Ctrl+Shift+Z', context: false, native: true, undoable: false },
  { id: 'duplicate-selection', menu: 'Edit', name: 'Duplicate Selection', icon: 'Copy', key: 'D', context: true, native: true, undoable: true },
  { id: 'delete-selection', menu: 'Edit', name: 'Delete Selection', icon: 'Trash2', key: 'Del', context: true, native: true, undoable: true, tool: true },
  { id: 'toggle-minimap', menu: 'View', name: 'Toggle Linked 2D Map', icon: 'Map', key: 'M', context: false, native: true, undoable: false },
  { id: 'toggle-view-mode', menu: 'View', name: 'Switch 2D/3D View', icon: 'PanelTop', key: 'Tab', context: false, native: true, undoable: false },
  { id: 'focus-selection', menu: 'View', name: 'Focus Selection', icon: 'ScanSearch', key: 'F', context: true, native: true, undoable: false },
  { id: 'place-piece', menu: 'Build', name: 'Place Piece', icon: 'Pencil', key: 'B', context: true, native: true, undoable: true, tool: true },
  { id: 'move-selection', menu: 'Build', name: 'Move Selection', icon: 'Move', key: 'V', context: true, native: true, undoable: true, tool: true },
  { id: 'paint-material', menu: 'Build', name: 'Paint Material', icon: 'Brush', key: 'P', context: true, native: true, undoable: true, tool: true },
  { id: 'open-color-studio', menu: 'Build', name: 'Open Color Studio', icon: 'Palette', key: 'C', context: true, native: true, undoable: false, tool: true },
  { id: 'sample-material', menu: 'Build', name: 'Sample Material', icon: 'Pipette', key: 'I', context: true, native: true, undoable: false, tool: true },
  { id: 'add-trigger', menu: 'Map', name: 'Add Trigger Volume', icon: 'BoxSelect', key: 'T', context: true, native: true, undoable: true, tool: true },
  { id: 'set-spawn', menu: 'Map', name: 'Set Spawn Point', icon: 'MapPin', key: 'S', context: true, native: true, undoable: true, tool: true },
  // FLOORCTL req_2485: steps the REAL active storey (0 = Ground) up, wrapping
  // past the cap — the same state the action bar's ▼/▲ floor control drives.
  { id: 'cycle-floor', menu: 'Map', name: 'Cycle Active Floor', icon: 'Layers', key: '[ ]', context: false, native: true, undoable: false },
  { id: 'mission-point', menu: 'Story', name: 'Place Mission Point', icon: 'Flag', key: 'G', context: true, native: true, undoable: true, tool: true },
  { id: 'author-sequence', menu: 'Story', name: 'Author Sequence Marker', icon: 'Route', key: 'Q', context: true, native: true, undoable: true, tool: true },
  { id: 'toggle-history', menu: 'Window', name: 'Toggle Eventbus Strip', icon: 'Workflow', key: 'Ctrl+H', context: false, native: true, undoable: false },
  { id: 'show-pipeline', menu: 'Help', name: 'Show Feature Pipeline', icon: 'Workflow', key: '?', context: false, native: false, undoable: false },

  // Model-surface tools — the host-native mesh editor the model viewer brought.
  // They only surface when a model document is active (toolbar + context menu +
  // hotkeys), mirroring one registry instead of the viewer's floating buttons.
  { id: 'mesh-vertex', menu: 'Edit', surface: 'model', name: 'Vertex Select', icon: 'Grip', key: '1', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-edge', menu: 'Edit', surface: 'model', name: 'Edge Select', icon: 'Spline', key: '2', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-face', menu: 'Edit', surface: 'model', name: 'Face Select', icon: 'Triangle', key: '3', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-move', menu: 'Edit', surface: 'model', name: 'Move Gizmo', icon: 'Move', key: 'G', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-scale', menu: 'Edit', surface: 'model', name: 'Scale Gizmo', icon: 'Scale3d', key: 'S', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-rotate', menu: 'Edit', surface: 'model', name: 'Rotate Gizmo', icon: 'Rotate3d', key: 'R', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint', menu: 'Edit', surface: 'model', name: 'Paint Faces', icon: 'Brush', key: 'P', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-focus', menu: 'Edit', surface: 'model', name: 'Focus Pivot', icon: 'Focus', key: 'F', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-wire', menu: 'Edit', surface: 'model', name: 'Wireframe', icon: 'Grid3x3', key: 'W', context: false, native: true, undoable: false, tool: true },
  // Contextual topology ops — only valid on an edge selection (1 edge -> extrude,
  // 2+ edges -> create face). Surfaced in the toolbar + context menu only when
  // applicable; see meshTopoCommands.
  { id: 'mesh-extrude', menu: 'Edit', surface: 'model', name: 'Extrude Edge', icon: 'ArrowUpFromLine', key: 'E', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-create-face', menu: 'Edit', surface: 'model', name: 'Create Face', icon: 'SquarePlus', key: 'C', context: true, native: true, undoable: true, tool: true },
  // Loop cut: slice the ring perpendicular to the ONE selected edge (host-native op).
  { id: 'mesh-loopcut', menu: 'Edit', surface: 'model', name: 'Loop Cut', icon: 'Scissors', key: 'L', context: true, native: true, undoable: true, tool: true },
  // Face-selection ops (the old studio's face-mode toolset, host-native + journaled):
  // detach peels the selection into a NEW part; glass toggles translucency; solidify
  // thickens in place; merge fuses 2+ authored faces into one.
  { id: 'mesh-detach', menu: 'Edit', surface: 'model', name: 'Detach Faces', icon: 'Ungroup', key: 'D', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-glass', menu: 'Edit', surface: 'model', name: 'Glass Faces', icon: 'GlassWater', key: 'B', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-solidify', menu: 'Edit', surface: 'model', name: 'Solidify', icon: 'Boxes', key: 'O', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-merge-faces', menu: 'Edit', surface: 'model', name: 'Merge Faces', icon: 'Combine', key: 'M', context: true, native: true, undoable: true, tool: true },
  // Part ops (the focused outliner part): duplicate / mirrored duplicate / merge down.
  { id: 'mesh-duplicate-part', menu: 'Edit', surface: 'model', name: 'Duplicate Part', icon: 'CopyPlus', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-x', menu: 'Edit', surface: 'model', name: 'Mirror Part X', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-y', menu: 'Edit', surface: 'model', name: 'Mirror Part Y', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-mirror-z', menu: 'Edit', surface: 'model', name: 'Mirror Part Z', icon: 'FlipHorizontal2', key: '', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-merge-down', menu: 'Edit', surface: 'model', name: 'Merge Part Down', icon: 'Merge', key: '', context: true, native: true, undoable: true, tool: true },
  // Cross-model reuse: append a saved library model into the OPEN model as new part(s).
  { id: 'mesh-import-part', menu: 'Edit', surface: 'model', name: 'Add From Library...', icon: 'PackagePlus', key: '', context: true, native: true, undoable: true, tool: true },
  // Paint sub-tools — the two brush behaviours plus the free-form face-safety and detail
  // toggles. Surface only while paint mode is active (see meshPaintCommands); the brush's
  // colour/size/flow live in the Model Focus dock's BrushKit, not the toolbar.
  { id: 'mesh-paint-fill', menu: 'Edit', surface: 'model', name: 'Fill Face', icon: 'PaintBucket', key: 'B', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint-brush', menu: 'Edit', surface: 'model', name: 'Free Brush', icon: 'Paintbrush', key: 'N', context: true, native: true, undoable: true, tool: true },
  { id: 'mesh-paint-safety', menu: 'Edit', surface: 'model', name: 'Face Safety', icon: 'Lock', key: 'X', context: true, native: true, undoable: false, tool: true },
  { id: 'mesh-paint-detail', menu: 'Edit', surface: 'model', name: 'Brush Detail', icon: 'Grid2x2', key: 'Y', context: true, native: true, undoable: false, tool: true },
];

// The always-on model tool group (select / gizmo / toggles), in display order.
// Kept as an explicit id list so the contextual topology ops stay out of it.
const MESH_TOOL_IDS = ['mesh-vertex', 'mesh-edge', 'mesh-face', 'mesh-move', 'mesh-scale', 'mesh-rotate', 'mesh-paint', 'mesh-focus', 'mesh-wire'];

export function meshToolCommands(): Command[] {
  return MESH_TOOL_IDS.map(commandById);
}

// The contextual topology ops that apply to the current selection: extrude/loop-cut
// on a single edge, create-face on two or more, and the face-selection toolset
// (detach / glass / solidify / merge) in face mode. Empty when nothing applies.
// Surfaces the same way in the toolbar and the context menu.
export function meshTopoCommands(tool: { selMode: number; sel: number }): Command[] {
  if (tool.sel < 1) return [];
  if (tool.selMode === 2) {
    // One edge → extrude OR loop-cut across its ring; two+ edges → bridge into a face.
    return tool.sel === 1
      ? [commandById('mesh-extrude'), commandById('mesh-loopcut')]
      : [commandById('mesh-create-face')];
  }
  if (tool.selMode === 3) {
    return [commandById('mesh-detach'), commandById('mesh-glass'), commandById('mesh-solidify'), commandById('mesh-merge-faces')];
  }
  return [];
}

// The part-level verbs for the FOCUSED outliner part (duplicate / mirrored duplicate /
// merge down) plus the always-available library import. Rendered in the model context
// menu; the outliner rows carry quick duplicate/delete icons.
export function meshPartCommands(hasActivePart: boolean, partCount: number): Command[] {
  const out: Command[] = [];
  if (hasActivePart) {
    out.push(commandById('mesh-duplicate-part'), commandById('mesh-mirror-x'), commandById('mesh-mirror-y'), commandById('mesh-mirror-z'));
    if (partCount >= 2) out.push(commandById('mesh-merge-down'));
  }
  out.push(commandById('mesh-import-part'));
  return out;
}

// The two brush behaviours (fill · free-form), surfaced as toolbar icon buttons only while
// paint mode is active. The safety + detail toggles render as their own state-reading pills
// (see ToolOptions), so they're not in this icon-button list.
export function meshPaintCommands(tool: { paint: boolean }): Command[] {
  if (!tool.paint) return [];
  return [commandById('mesh-paint-fill'), commandById('mesh-paint-brush')];
}

export function isMeshToolCommand(id: string): boolean {
  return commandById(id).surface === 'model';
}

// Is this model tool the active one, given the live tool snapshot? Drives the
// toolbar/context-menu highlight. Gizmo tools only read active inside a select
// mode (they act on a selection); view/paint/focus are mutually exclusive.
export function meshToolActive(id: string, tool: { selMode: number; gizmoTool: number; paint: boolean; focus: boolean; wire: boolean; brushTool?: string; safety?: number; detail?: number }): boolean {
  switch (id) {
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
  return COMMANDS.find((command) => command.id === id) ?? COMMANDS[0]!;
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
