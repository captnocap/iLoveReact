// editor/data/commands.ts — command table + menu geometry helpers.
//
// Cloned from the hmsc-workspace-mock god-file. Pure data + pure helpers.
import type { Command, Menu, MockState } from './types';

export const MENUS: Menu[] = ['File', 'Edit', 'View', 'Map', 'Build', 'Story', 'Window', 'Help'];
export const MENU_DROPDOWN_WIDTH = 420;
export const MENU_LEFT_BASE = 154;
export const MENU_LEFT_STEP = 46;
export const MENU_STAGE_GUTTER = 12;

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
];

export function commandById(id: string): Command {
  return COMMANDS.find((command) => command.id === id) ?? COMMANDS[0]!;
}

export function menuDropdownLeft(menu: Menu | null): number {
  const viewportWidth = 1536;
  const stageWidth = viewportWidth - 48 - 350 - 326;
  const rawLeft = MENU_LEFT_BASE + MENUS.indexOf(menu ?? 'Build') * MENU_LEFT_STEP;
  return Math.max(MENU_STAGE_GUTTER, Math.min(rawLeft, stageWidth - MENU_DROPDOWN_WIDTH - MENU_STAGE_GUTTER));
}

export function activeMenuFor(state: MockState): Menu {
  return state.openMenu ?? state.actionMenu;
}
