// editor/data/commands.ts — command table + menu geometry helpers.
//
// Cloned from the hmsc-workspace-mock god-file. Pure data + pure helpers.
import type { Command, Menu, MockState } from './types';

export const MENUS: Menu[] = ['File', 'Edit', 'View', 'Map', 'Build', 'Story', 'Window', 'Help'];
export const MENU_DROPDOWN_WIDTH = 420;

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
  { id: 'open-map', menu: 'File', name: 'Open Workspace', icon: 'FolderOpen', key: 'Ctrl+O', context: false, native: true, undoable: false },
  { id: 'open-file-explorer', menu: 'File', name: 'Open Project File Explorer', icon: 'FolderSearch', key: 'Ctrl+P', context: false, native: true, undoable: false },
  { id: 'find-import-source', menu: 'File', name: 'Find Import Source', icon: 'SearchCode', key: 'Ctrl+Shift+P', context: false, native: true, undoable: false },
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
];

// The always-on model tool group (select / gizmo / toggles), in display order.
// Kept as an explicit id list so the contextual topology ops stay out of it.
const MESH_TOOL_IDS = ['mesh-vertex', 'mesh-edge', 'mesh-face', 'mesh-move', 'mesh-scale', 'mesh-rotate', 'mesh-paint', 'mesh-focus', 'mesh-wire'];

export function meshToolCommands(): Command[] {
  return MESH_TOOL_IDS.map(commandById);
}

// The contextual topology ops that apply to the current selection: extrude on a
// single edge, create-face on two or more. Empty when nothing applies. Surfaces
// the same way in the toolbar and the context menu.
export function meshTopoCommands(tool: { selMode: number; sel: number }): Command[] {
  if (tool.selMode !== 2 || tool.sel < 1) return [];
  return [commandById(tool.sel === 1 ? 'mesh-extrude' : 'mesh-create-face')];
}

export function isMeshToolCommand(id: string): boolean {
  return commandById(id).surface === 'model';
}

// Is this model tool the active one, given the live tool snapshot? Drives the
// toolbar/context-menu highlight. Gizmo tools only read active inside a select
// mode (they act on a selection); view/paint/focus are mutually exclusive.
export function meshToolActive(id: string, tool: { selMode: number; gizmoTool: number; paint: boolean; focus: boolean; wire: boolean }): boolean {
  switch (id) {
    case 'mesh-vertex': return tool.selMode === 1 && !tool.paint && !tool.focus;
    case 'mesh-edge': return tool.selMode === 2 && !tool.paint && !tool.focus;
    case 'mesh-face': return tool.selMode === 3 && !tool.paint && !tool.focus;
    case 'mesh-move': return tool.selMode !== 0 && tool.gizmoTool === 0;
    case 'mesh-scale': return tool.selMode !== 0 && tool.gizmoTool === 1;
    case 'mesh-rotate': return tool.selMode !== 0 && tool.gizmoTool === 2;
    case 'mesh-paint': return tool.paint;
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

export function activeMenuFor(state: MockState): Menu {
  return state.openMenu ?? state.actionMenu;
}
