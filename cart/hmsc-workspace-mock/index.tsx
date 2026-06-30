import { useMemo, useState } from 'react';
import { ThemeProvider } from '../../runtime/classifier';
import { Icon } from '../../runtime/icons/Icon';
import FileExplorerDialog from './FileExplorerDialog';
import { EXPLORER_FILES, INITIAL_EXPLORER_DIRECTORY_HISTORY, INITIAL_EXPLORER_HISTORY, explorerFileById, explorerFolderLabel, explorerMatchesFolder, type ExplorerDirectoryHistoryEntry, type ExplorerFolderId, type ExplorerHistoryEntry } from './fileExplorerData';
import { WORKSPACE_COLORS, WORKSPACE_STYLES } from './theme';
import { C, accentFor } from './workspace.cls';

type Menu = 'File' | 'Edit' | 'View' | 'Map' | 'Build' | 'Story' | 'Window' | 'Help';
type LibraryTab = 'Build' | 'Props' | 'Skins';
type ViewMode = '3D' | '2D';
type ContentFolderId =
  | 'game'
  | 'audio'
  | 'characters'
  | 'locations'
  | 'missions'
  | 'bankheist'
  | 'mission-assets'
  | 'scripts'
  | 'ui'
  | 'materials'
  | 'materials-core'
  | 'materials-generated'
  | 'materials-favorites'
  | 'materials-recent'
  | 'architecture'
  | 'build-pieces'
  | 'prefabs'
  | 'vehicles'
  | 'weapons'
  | 'props'
  | 'fx';

type Command = {
  id: string;
  menu: Menu;
  name: string;
  icon: string;
  key: string;
  context: boolean;
  native: boolean;
  undoable: boolean;
  tool?: boolean;
};

type BuildNote = {
  request: string;
  build: string;
  title: string;
  status: string;
  agent: string;
  handled: string;
  trace: string[];
};

type BuildThread = {
  id: string;
  title: string;
  status: string;
  history: string[];
};

type Asset = {
  id: string;
  tab: LibraryTab;
  name: string;
  color: string;
  favorite?: boolean;
  recent?: boolean;
  used: number;
  recipe?: string;
  seed?: number;
  variants?: string[];
};

type AssetOverride = {
  name?: string;
  favorite?: boolean;
};

type MaterialSource = {
  name: string;
  color: string;
  recipe: string;
  variants: string[];
};

type ContentNode = {
  id: ContentFolderId;
  label: string;
  icon?: string;
  children?: ContentNode[];
};

type WorldObject = {
  id: string;
  kind: string;
  name: string;
  assetId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  metrics: Array<[string, string]>;
  hidden?: boolean;
};

type HistoryEvent = {
  id: string;
  verb: string;
  target: string;
  meta: string;
  undoable: boolean;
  editMs?: number;
  emptyMs?: number;
  richMs?: number;
};

type MockState = {
  openMenu: Menu | null;
  presetMenuOpen: boolean;
  actionMenu: Menu;
  activeDomain: string;
  activeTab: LibraryTab;
  activeCommandId: string;
  activeAssetId: string;
  assetPage: number;
  materialFocused: boolean;
  buildDialogOpen: boolean;
  eventbusPopoverOpen: boolean;
  fileExplorerOpen: boolean;
  fileExplorerQuery: string;
  fileExplorerFolder: ExplorerFolderId;
  fileExplorerExpanded: Partial<Record<ExplorerFolderId, boolean>>;
  fileExplorerSelectedId: string;
  fileExplorerHistory: ExplorerHistoryEntry[];
  fileExplorerDirectoryHistory: ExplorerDirectoryHistoryEntry[];
  selectedObjectId: string;
  contentFolder: ContentFolderId;
  expandedFolders: Partial<Record<ContentFolderId, boolean>>;
  search: string;
  surfacePreset: string;
  snapIndex: number;
  floorIndex: number;
  viewMode: ViewMode;
  rightPane: string;
  contextOpen: boolean;
  status: string;
  cursor: { x: number; y: number; z: number };
  history: HistoryEvent[];
  redo: HistoryEvent[];
  seq: number;
  objects: WorldObject[];
  assetOverrides: Record<string, AssetOverride>;
};

const MENUS: Menu[] = ['File', 'Edit', 'View', 'Map', 'Build', 'Story', 'Window', 'Help'];

const COMMANDS: Command[] = [
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
  { id: 'sample-material', menu: 'Build', name: 'Sample Material', icon: 'Pipette', key: 'I', context: true, native: true, undoable: false, tool: true },
  { id: 'add-trigger', menu: 'Map', name: 'Add Trigger Volume', icon: 'BoxSelect', key: 'T', context: true, native: true, undoable: true, tool: true },
  { id: 'set-spawn', menu: 'Map', name: 'Set Spawn Point', icon: 'MapPin', key: 'S', context: true, native: true, undoable: true, tool: true },
  { id: 'cycle-floor', menu: 'Map', name: 'Cycle Active Floor', icon: 'Layers', key: '[ ]', context: false, native: true, undoable: false },
  { id: 'mission-point', menu: 'Story', name: 'Place Mission Point', icon: 'Flag', key: 'G', context: true, native: true, undoable: true, tool: true },
  { id: 'author-sequence', menu: 'Story', name: 'Author Sequence Marker', icon: 'Route', key: 'Q', context: true, native: true, undoable: true, tool: true },
  { id: 'toggle-history', menu: 'Window', name: 'Toggle Eventbus Strip', icon: 'Workflow', key: 'Ctrl+H', context: false, native: true, undoable: false },
  { id: 'show-pipeline', menu: 'Help', name: 'Show Feature Pipeline', icon: 'Workflow', key: '?', context: false, native: false, undoable: false },
];

const CORE_MATERIALS: Asset[] = [
  { id: 'grass', tab: 'Skins', name: 'Grass', color: '#426739', favorite: true, recent: true, used: 94, recipe: 'bot-siding', seed: 156, variants: ['v0', 'v1', 'v2'] },
  { id: 'road', tab: 'Skins', name: 'Road', color: '#303136', favorite: true, used: 82, recipe: 'asphalt-crack', seed: 42, variants: ['clean', 'worn', 'wet'] },
  { id: 'concrete', tab: 'Skins', name: 'Concrete', color: '#6f7176', recent: true, used: 75, recipe: 'poured-slab', seed: 88, variants: ['flat', 'stained', 'chipped'] },
  { id: 'brick', tab: 'Skins', name: 'Brick', color: '#9f5547', used: 61, recipe: 'brick-stack', seed: 103, variants: ['red', 'aged', 'painted'] },
  { id: 'sand', tab: 'Skins', name: 'Sand', color: '#c8b176', used: 48, recipe: 'grain-field', seed: 12, variants: ['dry', 'packed', 'dirty'] },
  { id: 'water', tab: 'Skins', name: 'Water', color: '#2e8993', used: 28, recipe: 'shallow-ripple', seed: 76, variants: ['still', 'ripple', 'drain'] },
  { id: 'moss', tab: 'Skins', name: 'Moss', color: '#52643f', used: 22, recipe: 'soft-growth', seed: 33, variants: ['thin', 'heavy', 'edge'] },
  { id: 'tile', tab: 'Skins', name: 'Tile', color: '#878f97', used: 20, recipe: 'ceramic-grid', seed: 57, variants: ['white', 'mint', 'broken'] },
];

const BUILD_ASSETS: Asset[] = [
  { id: 'wall-kit', tab: 'Build', name: 'Wall Kit', color: '#85909c', favorite: true, used: 91 },
  { id: 'door-cut', tab: 'Build', name: 'Door Cut', color: '#a77e52', recent: true, used: 67 },
  { id: 'shop-front', tab: 'Build', name: 'Shop Front', color: '#52643f', used: 44 },
  { id: 'window-bay', tab: 'Build', name: 'Window Bay', color: '#6d7f91', used: 39 },
];

const PROP_ASSETS: Asset[] = [
  { id: 'street-light', tab: 'Props', name: 'Street Light', color: '#b6bfc8', favorite: true, used: 58 },
  { id: 'cashier-desk', tab: 'Props', name: 'Cashier Desk', color: '#8b735e', recent: true, used: 46 },
  { id: 'trash-bin', tab: 'Props', name: 'Trash Bin', color: '#485463', used: 35 },
  { id: 'neon-sign', tab: 'Props', name: 'Neon Sign', color: '#55b7c8', used: 31 },
];

const MATERIAL_SOURCES: MaterialSource[] = [
  { name: 'Asphalt', color: '#303136', recipe: 'asphalt-crack', variants: ['clean', 'worn', 'wet'] },
  { name: 'Concrete', color: '#6f7176', recipe: 'poured-slab', variants: ['flat', 'stained', 'chipped'] },
  { name: 'Brick', color: '#9f5547', recipe: 'brick-stack', variants: ['red', 'aged', 'painted'] },
  { name: 'Sand', color: '#c8b176', recipe: 'grain-field', variants: ['dry', 'packed', 'dirty'] },
  { name: 'Water', color: '#2e8993', recipe: 'shallow-ripple', variants: ['still', 'ripple', 'drain'] },
  { name: 'Moss', color: '#52643f', recipe: 'soft-growth', variants: ['thin', 'heavy', 'edge'] },
  { name: 'Tile', color: '#878f97', recipe: 'ceramic-grid', variants: ['white', 'mint', 'broken'] },
  { name: 'Carpet', color: '#734a62', recipe: 'fabric-loop', variants: ['clean', 'worn', 'burnt'] },
  { name: 'Vinyl', color: '#5f766d', recipe: 'vinyl-sheet', variants: ['matte', 'gloss', 'torn'] },
  { name: 'Metal', color: '#75818f', recipe: 'sheet-metal', variants: ['brushed', 'rust', 'painted'] },
  { name: 'Glass', color: '#4f8790', recipe: 'glass-pane', variants: ['clear', 'frost', 'cracked'] },
  { name: 'Plaster', color: '#b6afa3', recipe: 'wall-plaster', variants: ['smooth', 'dirty', 'split'] },
  { name: 'Drywall', color: '#a99888', recipe: 'drywall-paper', variants: ['plain', 'patched', 'peeled'] },
  { name: 'Roof', color: '#57616a', recipe: 'roof-shingle', variants: ['new', 'weather', 'missing'] },
  { name: 'Mud', color: '#6c5c48', recipe: 'mud-track', variants: ['damp', 'rutted', 'dry'] },
  { name: 'Oil', color: '#262b2e', recipe: 'oil-spill', variants: ['slick', 'thin', 'rainbow'] },
  { name: 'Paint', color: '#7d8ea3', recipe: 'paint-layer', variants: ['fresh', 'scuffed', 'flaking'] },
  { name: 'Rubber', color: '#2f3439', recipe: 'rubber-mat', variants: ['clean', 'grit', 'torn'] },
  { name: 'Gravel', color: '#73716b', recipe: 'gravel-bed', variants: ['fine', 'mixed', 'loose'] },
  { name: 'Paper', color: '#b9b0a0', recipe: 'paper-trash', variants: ['flat', 'wet', 'torn'] },
];

const GENERATED_MATERIAL_COUNT = 240;
const ASSET_PAGE_SIZE = 12;
const MATERIAL_PAGE_SIZE = 6;

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function shadeHex(hex: string, offset: number): string {
  const clean = hex.replace('#', '');
  const parts = [0, 2, 4].map((start) => {
    const channel = parseInt(clean.slice(start, start + 2), 16);
    return clampChannel(channel + offset).toString(16).padStart(2, '0');
  });
  return `#${parts.join('')}`;
}

function variantColor(asset: Asset, index: number): string {
  return shadeHex(asset.color, (index - 1) * 13);
}

function makeGeneratedMaterials(count: number): Asset[] {
  return Array.from({ length: count }, (_, index) => {
    const source = MATERIAL_SOURCES[index % MATERIAL_SOURCES.length]!;
    const batch = Math.floor(index / MATERIAL_SOURCES.length);
    const serial = String(index + 1).padStart(3, '0');
    const shadeOffset = ((batch % 7) - 3) * 7;
    return {
      id: `mock-mat-${serial}`,
      tab: 'Skins',
      name: `${source.name} ${serial}`,
      color: shadeHex(source.color, shadeOffset),
      favorite: index % 53 === 0,
      recent: index % 37 === 0,
      used: 97 - (index % 91),
      recipe: `${source.recipe}-${batch + 1}`,
      seed: 20 + ((index * 17) % 181),
      variants: source.variants,
    };
  });
}

const ASSETS: Asset[] = [
  ...CORE_MATERIALS,
  ...makeGeneratedMaterials(GENERATED_MATERIAL_COUNT),
  ...BUILD_ASSETS,
  ...PROP_ASSETS,
];

const MATERIAL_ASSET_COUNT = ASSETS.filter((asset) => asset.tab === 'Skins').length;

const DOMAINS = [
  ['world', 'Eye'],
  ['grid', 'Grid3X3'],
  ['pieces', 'Box'],
  ['actors', 'UserRound'],
  ['data', 'Table2'],
  ['pipeline', 'Workflow'],
];
const RIGHT_PANES = [
  ['inspector', 'SlidersHorizontal'],
  ['layers', 'Layers'],
  ['grid', 'LayoutGrid'],
  ['mission', 'Flag'],
  ['routes', 'Route'],
];
const CONTENT_TREE: ContentNode[] = [
  {
    id: 'game',
    label: '/Game',
    children: [
      { id: 'audio', label: 'Audio' },
      { id: 'characters', label: 'Characters' },
      { id: 'locations', label: 'Locations' },
      {
        id: 'missions',
        label: 'Missions',
        children: [
          {
            id: 'bankheist',
            label: 'BankHeist',
            children: [
              { id: 'mission-assets', label: 'Assets' },
              { id: 'scripts', label: 'Scripts' },
              { id: 'ui', label: 'UI' },
            ],
          },
        ],
      },
      {
        id: 'materials',
        label: 'Materials',
        children: [
          { id: 'materials-core', label: 'Core' },
          { id: 'materials-generated', label: 'Generated' },
          { id: 'materials-favorites', label: 'Favorites' },
          { id: 'materials-recent', label: 'Recent' },
        ],
      },
      {
        id: 'architecture',
        label: 'Architecture',
        children: [
          { id: 'build-pieces', label: 'Build Pieces' },
          { id: 'prefabs', label: 'Prefabs' },
        ],
      },
      { id: 'vehicles', label: 'Vehicles' },
      { id: 'weapons', label: 'Weapons' },
      { id: 'props', label: 'Props' },
      { id: 'fx', label: 'FX' },
    ],
  },
];
const SNAP_MODES = ['surface + edge', 'grid', 'free', 'vertex'];
const FLOORS = ['Floor 2', 'Floor 1', 'Basement'];
const PRESETS = ['default', 'slow', 'fast', 'custom'];

const INITIAL_OBJECTS: WorldObject[] = [
  { id: 'obj-tile', kind: 'TILE', name: 'Grass', assetId: 'grass', left: 248, top: 116, width: 78, height: 70, metrics: [['height m', '0.06'], ['opacity', '0.00'], ['lightThru', '0.97'], ['friction', '0.60']] },
  { id: 'obj-wall-a', kind: 'PIECE', name: 'Wall Kit A', assetId: 'wall-kit', left: 214, top: 58, width: 64, height: 88, metrics: [['solid', 'yes'], ['cover', '0.74'], ['soundOcc', '0.80'], ['durability', '0.62']] },
  { id: 'obj-door', kind: 'CUTOUT', name: 'Door Cutout', assetId: 'door-cut', left: 330, top: 202, width: 96, height: 44, metrics: [['portal', 'yes'], ['width m', '1.20'], ['snap', 'edge'], ['room link', '2']] },
  { id: 'obj-shop', kind: 'PREFAB', name: 'Shop Front', assetId: 'shop-front', left: 376, top: 162, width: 70, height: 86, metrics: [['pieces', '14'], ['skins', '5'], ['cover', '0.41'], ['bake', 'clean']] },
];

const INITIAL_HISTORY: HistoryEvent[] = [
  { id: 'h-6', verb: 'place', target: 'Wall Kit A', meta: 'semantic piece insert, catalog reference', undoable: true, editMs: 14.2, emptyMs: 13.9, richMs: 14.2 },
  { id: 'h-5', verb: 'paint', target: 'Grass -> Road', meta: 'eventbus mutation, context retained', undoable: true, editMs: 10.8, emptyMs: 10.5, richMs: 10.8 },
  { id: 'h-4', verb: 'move', target: 'Door Cutout', meta: 'free/snap domain preserved', undoable: true, editMs: 8.7, emptyMs: 8.5, richMs: 8.7 },
  { id: 'h-3', verb: 'trigger', target: 'Night Raid volume', meta: 'native volume op queued', undoable: true, editMs: 12.1, emptyMs: 11.8, richMs: 12.1 },
  { id: 'h-2', verb: 'compile', target: 'RLE preview', meta: 'autosave checkpoint only', undoable: false, editMs: 19.4, emptyMs: 19.1, richMs: 19.4 },
  { id: 'h-1', verb: 'select', target: 'Wall Kit A', meta: 'route return restored focus', undoable: false, editMs: 3.2, emptyMs: 3.1, richMs: 3.2 },
];

const BUILD_NOTES: BuildNote[] = [
  {
    request: 'req_2118',
    build: '1.0.0.2118',
    title: 'Eventbus dock popover',
    status: 'mocked',
    agent: 'codex',
    handled: 'Moved the always-visible Eventbus strip into the bottom dock as an expandable review popover so event data is available without permanently consuming workspace height.',
    trace: ['eventbus', 'bottom dock', 'popover', 'workspace space'],
  },
  {
    request: 'req_2113',
    build: '1.0.0.2113',
    title: 'Inspector preset dropdown',
    status: 'mocked',
    agent: 'codex',
    handled: 'Replaced surface-default pill selectors with a compact dropdown select so dense property panels do not become button fields.',
    trace: ['inspector', 'dropdown select', 'surface defaults', 'density'],
  },
  {
    request: 'req_2112',
    build: '1.0.0.2112',
    title: 'Authoring telemetry dock',
    status: 'mocked',
    agent: 'codex',
    handled: 'Added an expandable in-memory edit history and live authoring-cost readout to watch average edit time and rich-map placement delta.',
    trace: ['bottom dock', 'edit history', 'authoring latency', 'placement parity'],
  },
  {
    request: 'req_2111',
    build: '1.0.0.2111',
    title: 'Fixed material browser pages',
    status: 'mocked',
    agent: 'codex',
    handled: 'Packed the content browser into fixed material page slots so selected-material controls stay visible without scrolling.',
    trace: ['content browser', 'fixed pages', 'materials', 'no scroll'],
  },
  {
    request: 'req_2108',
    build: '1.0.0.2108',
    title: 'Bottom dock and build journal',
    status: 'mocked',
    agent: 'codex',
    handled: 'Promoted request-ledger visibility into a thin bottom dock with clickable build notes.',
    trace: ['bottom dock', 'request journal', 'build number', 'bug threads'],
  },
  {
    request: 'req_2107',
    build: '1.0.0.2107',
    title: 'Concept art absorbed',
    status: 'review',
    agent: 'codex',
    handled: 'Captured concept-art direction into design intake: professional content suite, dense panels, rich scoped asset browsers.',
    trace: ['concept art', 'content browser', 'density'],
  },
  {
    request: 'req_2106',
    build: '1.0.0.2106',
    title: 'Traditional content browser',
    status: 'review',
    agent: 'codex',
    handled: 'Added /Game folder tree and scoped material/build/prop content renderers.',
    trace: ['asset hierarchy', 'materials', 'no context leakage'],
  },
  {
    request: 'req_2105',
    build: '1.0.0.2105',
    title: 'Material scale and vertical usage',
    status: 'review',
    agent: 'codex',
    handled: 'Expanded material rows with visible variants, usage stats, favorite, and rename controls.',
    trace: ['materials', 'variants', 'rename', 'favorite'],
  },
  {
    request: 'req_2104',
    build: '1.0.0.2104',
    title: 'Large material catalog',
    status: 'review',
    agent: 'codex',
    handled: 'Generated hundreds of mock materials to stress pagination, search, and visual catalog density.',
    trace: ['materials', 'catalog size', 'performance'],
  },
];

const BUILD_THREADS: BuildThread[] = [
  {
    id: 'bug-gpu-bind-groups',
    title: 'GPU bind-group creation cliff',
    status: 'watch',
    history: ['req_1739 root cause: 240 -> 4fps cliff', 'future repeats attach here instead of creating isolated memory'],
  },
  {
    id: 'ux-request-ledger',
    title: 'Request ledger visibility and closure burden',
    status: 'active',
    history: ['req_2108 turns requests into build notes', 'manual review becomes journal state, not a blocking chore'],
  },
  {
    id: 'ux-material-browser',
    title: 'Material browser scale and usability',
    status: 'active',
    history: ['req_2104 generated catalog scale', 'req_2105 added stats/variants/actions', 'req_2106 moved it under content browser hierarchy', 'req_2111 fixed page slots keep controls visible'],
  },
  {
    id: 'perf-authoring-parity',
    title: 'Authoring cost must not scale with map richness',
    status: 'watch',
    history: ['req_2112 exposes avg/p95 edit timing in the dock', 'placement on an empty map and a rich map should stay the same delta'],
  },
  {
    id: 'ux-eventbus-review',
    title: 'Eventbus review should not occupy permanent workspace space',
    status: 'active',
    history: ['req_2118 moves event stream review into a dock popover', 'event data stays one click away without shrinking the editor stage'],
  },
];

const ACTIVE_BUILD = BUILD_NOTES[0]!;

function applyAssetOverride(asset: Asset, override?: AssetOverride): Asset {
  return {
    ...asset,
    name: override?.name ?? asset.name,
    favorite: override?.favorite ?? asset.favorite,
  };
}

function applyAssetOverrides(assets: Asset[], overrides: Record<string, AssetOverride>): Asset[] {
  return assets.map((asset) => applyAssetOverride(asset, overrides[asset.id]));
}

function assetById(id: string, overrides: Record<string, AssetOverride> = {}): Asset {
  const asset = ASSETS.find((item) => item.id === id) ?? ASSETS[0]!;
  return applyAssetOverride(asset, overrides[asset.id]);
}

function assetPageSizeFor(tab: LibraryTab): number {
  return tab === 'Skins' ? MATERIAL_PAGE_SIZE : ASSET_PAGE_SIZE;
}

function commandById(id: string): Command {
  return COMMANDS.find((command) => command.id === id) ?? COMMANDS[0]!;
}

function editTimingFor(seq: number, commandId: string): Pick<HistoryEvent, 'editMs' | 'emptyMs' | 'richMs'> {
  const baseByCommand: Record<string, number> = {
    'place-piece': 14,
    'move-selection': 8,
    'paint-material': 11,
    'duplicate-selection': 12,
    'delete-selection': 9,
    'add-trigger': 13,
    'set-spawn': 10,
    'mission-point': 12,
    'author-sequence': 15,
    'compile-rle': 21,
    favorite: 4,
  };
  const base = baseByCommand[commandId] ?? 7;
  const emptyMs = base + (seq % 4) * 0.6;
  const richMs = emptyMs + 0.2 + (seq % 3) * 0.1;
  return { editMs: richMs, emptyMs, richMs };
}

function editSamples(history: HistoryEvent[]): Array<HistoryEvent & { editMs: number; emptyMs: number; richMs: number }> {
  return history.filter((event): event is HistoryEvent & { editMs: number; emptyMs: number; richMs: number } =>
    typeof event.editMs === 'number' && typeof event.emptyMs === 'number' && typeof event.richMs === 'number',
  );
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]!;
}

function editTelemetry(history: HistoryEvent[]) {
  const samples = editSamples(history);
  const richValues = samples.map((event) => event.richMs);
  const deltas = samples.map((event) => event.richMs - event.emptyMs);
  const delta = average(deltas);
  return {
    samples,
    avg: average(richValues),
    p95: percentile(richValues, 0.95),
    delta,
    parity: delta <= 1 ? 'stable' : 'watch',
  };
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function activeMenuFor(state: MockState): Menu {
  return state.openMenu ?? state.actionMenu;
}

function panelModeFor(state: MockState, object: WorldObject): LibraryTab {
  const command = commandById(state.activeCommandId);
  if (command.id === 'paint-material' || command.id === 'sample-material') return 'Skins';
  if (object.kind === 'TILE' || object.kind === 'CUTOUT') return 'Skins';
  if (object.kind === 'PROP') return 'Props';
  if (command.id === 'place-piece' || object.kind === 'PIECE' || object.kind === 'PREFAB') return 'Build';
  return state.activeTab;
}

function tabForContentFolder(folder: ContentFolderId): LibraryTab | null {
  if (folder === 'materials' || folder === 'materials-core' || folder === 'materials-generated' || folder === 'materials-favorites' || folder === 'materials-recent') return 'Skins';
  if (folder === 'props') return 'Props';
  if (folder === 'architecture' || folder === 'build-pieces' || folder === 'prefabs' || folder === 'mission-assets') return 'Build';
  return null;
}

function folderForAsset(asset: Asset): ContentFolderId {
  if (asset.tab === 'Skins') return asset.id.startsWith('mock-mat-') ? 'materials-generated' : 'materials-core';
  if (asset.tab === 'Build') return 'build-pieces';
  return 'props';
}

function contentFolderLabel(folder: ContentFolderId): string {
  const findNode = (nodes: ContentNode[]): ContentNode | null => {
    for (const node of nodes) {
      if (node.id === folder) return node;
      const found = node.children ? findNode(node.children) : null;
      if (found) return found;
    }
    return null;
  };
  return findNode(CONTENT_TREE)?.label ?? folder;
}

function isMaterialFolder(folder: ContentFolderId): boolean {
  return tabForContentFolder(folder) === 'Skins';
}

function assetMatchesContentFolder(asset: Asset, folder: ContentFolderId): boolean {
  if (folder === 'game') return true;
  if (folder === 'materials') return asset.tab === 'Skins';
  if (folder === 'materials-core') return asset.tab === 'Skins' && !asset.id.startsWith('mock-mat-');
  if (folder === 'materials-generated') return asset.tab === 'Skins' && asset.id.startsWith('mock-mat-');
  if (folder === 'materials-favorites') return asset.tab === 'Skins' && Boolean(asset.favorite);
  if (folder === 'materials-recent') return asset.tab === 'Skins' && Boolean(asset.recent);
  if (folder === 'props') return asset.tab === 'Props';
  if (folder === 'architecture' || folder === 'build-pieces' || folder === 'prefabs' || folder === 'mission-assets') return asset.tab === 'Build';
  return false;
}

function countAssetsForFolder(assets: Asset[], folder: ContentFolderId): number {
  if (folder === 'game') return assets.length;
  return assets.filter((asset) => assetMatchesContentFolder(asset, folder)).length;
}

function rankAssets(a: Asset, b: Asset): number {
  const score = (asset: Asset): number =>
    (asset.favorite ? 3000 : 0) + (asset.recent ? 2000 : 0) + asset.used;
  const byScore = score(b) - score(a);
  return byScore !== 0 ? byScore : a.name.localeCompare(b.name);
}

function selectedObject(state: MockState): WorldObject {
  return state.objects.find((object) => object.id === state.selectedObjectId && !object.hidden)
    ?? state.objects.find((object) => !object.hidden)
    ?? INITIAL_OBJECTS[0]!;
}

function initialState(): MockState {
  return {
    openMenu: 'Build',
    presetMenuOpen: false,
    actionMenu: 'Build',
    activeDomain: 'world',
    activeTab: 'Skins',
    activeCommandId: 'move-selection',
    activeAssetId: 'grass',
    assetPage: 0,
    materialFocused: false,
    buildDialogOpen: false,
    eventbusPopoverOpen: false,
    fileExplorerOpen: false,
    fileExplorerQuery: '',
    fileExplorerFolder: 'imports-models',
    fileExplorerExpanded: { workspace: true, imports: true, 'imports-models': true, mock: true, 'hmsc-int': true, 'hmsc-int-game': true, runtime: true },
    fileExplorerSelectedId: 'desk-glb',
    fileExplorerHistory: INITIAL_EXPLORER_HISTORY,
    fileExplorerDirectoryHistory: INITIAL_EXPLORER_DIRECTORY_HISTORY,
    selectedObjectId: 'obj-tile',
    contentFolder: 'materials',
    expandedFolders: { game: true, missions: true, bankheist: true, materials: true, architecture: true },
    search: '',
    surfacePreset: 'default',
    snapIndex: 0,
    floorIndex: 1,
    viewMode: '3D',
    rightPane: 'inspector',
    contextOpen: true,
    status: `eventbus idle - ${MATERIAL_ASSET_COUNT} materials indexed`,
    cursor: { x: 142, y: 0, z: 88 },
    history: INITIAL_HISTORY,
    redo: [],
    seq: 7,
    objects: INITIAL_OBJECTS,
    assetOverrides: {},
  };
}

function AppFrame() {
  const [state, setState] = useState<MockState>(initialState);

  const activeCommand = commandById(state.activeCommandId);
  const activeObject = selectedObject(state);
  const catalogAssets = useMemo(() => applyAssetOverrides(ASSETS, state.assetOverrides), [state.assetOverrides]);
  const activeAsset = assetById(state.activeAssetId, state.assetOverrides);
  const contextPanelMode = panelModeFor(state, activeObject);
  const panelMode = tabForContentFolder(state.contentFolder) ?? contextPanelMode;

  const filteredAssets = useMemo(() => {
    const needle = state.search.trim().toLowerCase();
    return catalogAssets
      .filter((asset) => assetMatchesContentFolder(asset, state.contentFolder))
      .filter((asset) => !needle || asset.name.toLowerCase().includes(needle) || (asset.recipe ?? '').toLowerCase().includes(needle))
      .sort(rankAssets);
  }, [catalogAssets, panelMode, state.contentFolder, state.search]);

  const pushHistory = (prev: MockState, command: Command, target: string, meta: string): Pick<MockState, 'history' | 'redo' | 'seq'> => ({
    history: [
      { id: `h-${prev.seq}`, verb: command.name.split(' ')[0]!.toLowerCase(), target, meta, undoable: command.undoable, ...editTimingFor(prev.seq, command.id) },
      ...prev.history,
    ].slice(0, 8),
    redo: command.undoable ? [] : prev.redo,
    seq: prev.seq + 1,
  });

  const runCommand = (commandId: string, source: string) => {
    const command = commandById(commandId);
    if (command.id === 'undo-local') {
      undoLocal();
      return;
    }
    if (command.id === 'redo-local') {
      redoLocal();
      return;
    }
    if (command.id === 'open-map' || command.id === 'open-file-explorer' || command.id === 'find-import-source') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'File',
        fileExplorerOpen: true,
        fileExplorerQuery: command.id === 'find-import-source' ? 'imports' : prev.fileExplorerQuery,
        status: command.id === 'find-import-source'
          ? 'in-app file explorer opened for import search'
          : 'in-app file explorer opened',
      }));
      return;
    }

    setState((prev) => {
      const object = selectedObject(prev);
      const asset = assetById(prev.activeAssetId, prev.assetOverrides);
      let next: MockState = {
        ...prev,
        openMenu: source === 'stage' ? prev.openMenu : null,
        actionMenu: command.menu,
        activeCommandId: command.tool ? command.id : prev.activeCommandId,
        status: `${command.name} - ${source}`,
        contextOpen: source === 'context' ? false : prev.contextOpen,
      };

      if (command.id === 'toggle-view-mode') {
        next = { ...next, viewMode: prev.viewMode === '3D' ? '2D' : '3D' };
      } else if (command.id === 'cycle-floor') {
        next = { ...next, floorIndex: (prev.floorIndex + 1) % FLOORS.length };
      } else if (command.id === 'toggle-minimap') {
        next = { ...next, rightPane: prev.rightPane === 'grid' ? 'inspector' : 'grid' };
      } else if (command.id === 'focus-selection') {
        next = { ...next, cursor: { x: object.left, y: 0, z: object.top } };
      } else if (command.id === 'place-piece') {
        const placed: WorldObject = {
          id: `obj-${prev.seq}`,
          kind: asset.tab === 'Props' ? 'PROP' : asset.tab === 'Build' ? 'PIECE' : 'TILE',
          name: asset.name,
          assetId: asset.id,
          left: 160 + (prev.seq % 5) * 42,
          top: 112 + (prev.seq % 4) * 32,
          width: asset.tab === 'Props' ? 42 : 64,
          height: asset.tab === 'Props' ? 30 : 52,
          metrics: [['snap', SNAP_MODES[prev.snapIndex]!], ['floor', FLOORS[prev.floorIndex]!], ['source', 'mock'], ['bake', 'pending']],
        };
        next = { ...next, objects: [...prev.objects, placed], selectedObjectId: placed.id, cursor: { x: placed.left, y: 0, z: placed.top } };
      } else if (command.id === 'move-selection') {
        next = {
          ...next,
          objects: prev.objects.map((item) => item.id === object.id ? { ...item, left: item.left + 18, top: item.top + 10 } : item),
          cursor: { x: object.left + 18, y: 0, z: object.top + 10 },
        };
      } else if (command.id === 'paint-material') {
        next = {
          ...next,
          objects: prev.objects.map((item) => item.id === object.id ? { ...item, assetId: asset.id, name: item.kind === 'TILE' ? asset.name : item.name } : item),
        };
      } else if (command.id === 'sample-material') {
        next = { ...next, activeAssetId: object.assetId, activeTab: assetById(object.assetId, prev.assetOverrides).tab };
      } else if (command.id === 'duplicate-selection') {
        const duplicate: WorldObject = { ...object, id: `obj-${prev.seq}`, name: `${object.name} copy`, left: object.left + 32, top: object.top + 22 };
        next = { ...next, objects: [...prev.objects, duplicate], selectedObjectId: duplicate.id };
      } else if (command.id === 'delete-selection') {
        const remaining = prev.objects.filter((item) => item.id !== object.id && !item.hidden);
        next = {
          ...next,
          objects: prev.objects.map((item) => item.id === object.id ? { ...item, hidden: true } : item),
          selectedObjectId: remaining[0]?.id ?? object.id,
        };
      } else if (command.id === 'add-trigger' || command.id === 'set-spawn' || command.id === 'mission-point' || command.id === 'author-sequence') {
        next = { ...next, rightPane: 'mission' };
      } else if (command.id === 'show-pipeline') {
        next = { ...next, activeDomain: 'pipeline', rightPane: 'routes' };
      }

      const target = command.id === 'paint-material' || command.id === 'place-piece' ? asset.name : object.name;
      const event = command.id === 'sample-material'
        ? { history: prev.history, redo: prev.redo, seq: prev.seq }
        : pushHistory(prev, command, target, `${source} - ${command.native ? 'native-ready' : 'design-only'}`);
      return { ...next, ...event };
    });
  };

  const undoLocal = () => {
    setState((prev) => {
      const event = prev.history.find((item) => item.undoable);
      if (!event) return { ...prev, status: 'nothing undoable in mock history' };
      return {
        ...prev,
        history: prev.history.filter((item) => item.id !== event.id),
        redo: [event, ...prev.redo].slice(0, 8),
        status: `undo ${event.verb} - ${event.target}`,
      };
    });
  };

  const redoLocal = () => {
    setState((prev) => {
      const [event, ...rest] = prev.redo;
      if (!event) return { ...prev, status: 'nothing to redo in mock history' };
      return {
        ...prev,
        history: [event, ...prev.history].slice(0, 8),
        redo: rest,
        status: `redo ${event.verb} - ${event.target}`,
      };
    });
  };

  const selectAsset = (asset: Asset) => {
    setState((prev) => ({
      ...prev,
      activeAssetId: asset.id,
      activeTab: asset.tab,
      contentFolder: folderForAsset(asset),
      status: `selected ${asset.name} - context preserved`,
    }));
  };

  const selectObject = (id: string) => {
    setState((prev) => {
      const object = prev.objects.find((item) => item.id === id) ?? selectedObject(prev);
      return {
        ...prev,
        selectedObjectId: object.id,
        activeAssetId: object.assetId,
        activeTab: assetById(object.assetId, prev.assetOverrides).tab,
        contentFolder: folderForAsset(assetById(object.assetId, prev.assetOverrides)),
        cursor: { x: object.left, y: 0, z: object.top },
        status: `selected ${object.name}`,
      };
    });
  };

  const selectContentFolder = (contentFolder: ContentFolderId) => {
    setState((prev) => {
      const tab = tabForContentFolder(contentFolder);
      return {
        ...prev,
        contentFolder,
        activeTab: tab ?? prev.activeTab,
        assetPage: 0,
        expandedFolders: { ...prev.expandedFolders, [contentFolder]: true },
        status: `content browser: ${contentFolderLabel(contentFolder)}`,
      };
    });
  };

  const toggleContentFolder = (folder: ContentFolderId) => {
    setState((prev) => ({
      ...prev,
      expandedFolders: { ...prev.expandedFolders, [folder]: !prev.expandedFolders[folder] },
      status: `${prev.expandedFolders[folder] ? 'collapsed' : 'expanded'} ${contentFolderLabel(folder)}`,
    }));
  };

  const toggleFavorite = (assetId: string) => {
    setState((prev) => {
      const asset = assetById(assetId, prev.assetOverrides);
      const nextFavorite = !asset.favorite;
      return {
        ...prev,
        assetOverrides: {
          ...prev.assetOverrides,
          [assetId]: { ...prev.assetOverrides[assetId], favorite: nextFavorite },
        },
        history: [
          { id: `h-${prev.seq}`, verb: nextFavorite ? 'favorite' : 'unfavorite', target: asset.name, meta: 'catalog metadata override', undoable: true, ...editTimingFor(prev.seq, 'favorite') },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `${nextFavorite ? 'favorited' : 'unfavorited'} ${asset.name}`,
      };
    });
  };

  const renameAsset = (assetId: string, name: string) => {
    setState((prev) => {
      const asset = assetById(assetId, prev.assetOverrides);
      return {
        ...prev,
        assetOverrides: {
          ...prev.assetOverrides,
          [assetId]: { ...prev.assetOverrides[assetId], name },
        },
        objects: prev.objects.map((object) => object.assetId === assetId && object.kind === 'TILE' ? { ...object, name } : object),
        status: `renamed ${asset.name} -> ${name || 'untitled material'}`,
      };
    });
  };

  const selectExplorerFolder = (fileExplorerFolder: ExplorerFolderId) => {
    setState((prev) => {
      const firstFile = EXPLORER_FILES.find((file) => explorerMatchesFolder(file, fileExplorerFolder));
      return {
        ...prev,
        fileExplorerFolder,
        fileExplorerSelectedId: firstFile?.id ?? prev.fileExplorerSelectedId,
        fileExplorerExpanded: { ...prev.fileExplorerExpanded, [fileExplorerFolder]: true },
        fileExplorerDirectoryHistory: [
          {
            id: `dh-${prev.seq}`,
            folderId: fileExplorerFolder,
            label: explorerFolderLabel(fileExplorerFolder),
            path: explorerFolderLabel(fileExplorerFolder),
            at: 'now',
          },
          ...prev.fileExplorerDirectoryHistory.filter((entry) => entry.folderId !== fileExplorerFolder),
        ].slice(0, 4),
        seq: prev.seq + 1,
        status: `file explorer folder: ${fileExplorerFolder} - directory memory retained`,
      };
    });
  };

  const toggleExplorerFolder = (folder: ExplorerFolderId) => {
    setState((prev) => ({
      ...prev,
      fileExplorerExpanded: { ...prev.fileExplorerExpanded, [folder]: !prev.fileExplorerExpanded[folder] },
      status: `${prev.fileExplorerExpanded[folder] ? 'collapsed' : 'expanded'} file folder ${folder}`,
    }));
  };

  const openExplorerFile = (fileId: string, action: string) => {
    setState((prev) => {
      const file = explorerFileById(fileId);
      const historyEntry: ExplorerHistoryEntry = {
        id: `fh-${prev.seq}`,
        fileId,
        action,
        query: prev.fileExplorerQuery.trim() || file.name,
        at: 'now',
      };
      return {
        ...prev,
        fileExplorerSelectedId: fileId,
        fileExplorerHistory: [
          historyEntry,
          ...prev.fileExplorerHistory.filter((entry) => entry.fileId !== fileId),
        ].slice(0, 5),
        seq: prev.seq + 1,
        status: `${action} ${file.path} - in-app explorer history retained`,
      };
    });
  };

  return (
    <C.HW_App>
      <Chrome
        state={state}
        activeCommand={activeCommand}
        onMenu={(menu) => setState((prev) => ({ ...prev, actionMenu: menu, openMenu: prev.openMenu === menu ? null : menu }))}
        onCommand={runCommand}
        onUndo={undoLocal}
        onRedo={redoLocal}
      />
      <C.HW_Body>
        <LeftRail state={state} onDomain={(activeDomain) => setState((prev) => ({ ...prev, activeDomain, status: `workspace context: ${activeDomain}` }))} />
        <LibraryPanel
          state={state}
          catalogAssets={catalogAssets}
          assets={filteredAssets}
          mode={panelMode}
          activeAsset={activeAsset}
          activeObject={activeObject}
          contentFolder={state.contentFolder}
          expandedFolders={state.expandedFolders}
          onSearch={(search) => setState((prev) => ({ ...prev, search, assetPage: 0 }))}
          onAsset={selectAsset}
          onFolder={selectContentFolder}
          onToggleFolder={toggleContentFolder}
          onFavorite={toggleFavorite}
          onRename={renameAsset}
          onPage={(delta) => setState((prev) => {
            const maxPage = Math.max(0, Math.ceil(filteredAssets.length / assetPageSizeFor(panelMode)) - 1);
            return { ...prev, assetPage: Math.max(0, Math.min(maxPage, prev.assetPage + delta)) };
          })}
          onFocusMaterial={() => setState((prev) => ({ ...prev, materialFocused: true, status: `focused material editor: ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
          onMaterialAction={(label) => setState((prev) => ({ ...prev, status: `${label}: ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
        />
        <Workspace
          state={state}
          activeCommand={activeCommand}
          activeAsset={activeAsset}
          onCommand={runCommand}
          onTool={(id) => setState((prev) => ({ ...prev, actionMenu: commandById(id).menu, activeCommandId: id, status: `armed ${commandById(id).name}` }))}
          onSnap={() => setState((prev) => ({ ...prev, snapIndex: (prev.snapIndex + 1) % SNAP_MODES.length, status: `snap: ${SNAP_MODES[(prev.snapIndex + 1) % SNAP_MODES.length]}` }))}
          onFloor={() => runCommand('cycle-floor', 'toolbar')}
          onViewMode={(viewMode) => setState((prev) => ({ ...prev, viewMode, status: `view mode: ${viewMode}` }))}
          onStage={() => runCommand(state.activeCommandId, 'stage')}
          onContext={() => setState((prev) => ({ ...prev, contextOpen: !prev.contextOpen, openMenu: null, status: prev.contextOpen ? 'context menu closed' : 'context menu opened' }))}
          onObject={selectObject}
          onExitMaterialFocus={() => setState((prev) => ({ ...prev, materialFocused: false, status: `returned to world with ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
          onMaterialAction={(label) => setState((prev) => ({ ...prev, status: `${label}: ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
        />
        <Inspector
          state={state}
          activeObject={activeObject}
          activeAsset={assetById(activeObject.assetId, state.assetOverrides)}
          onPane={(rightPane) => setState((prev) => ({ ...prev, rightPane, status: `inspector pane: ${rightPane}` }))}
        onCommand={runCommand}
        onPreset={() => setState((prev) => ({ ...prev, presetMenuOpen: !prev.presetMenuOpen, status: prev.presetMenuOpen ? 'surface preset menu closed' : 'surface preset menu opened' }))}
        onPresetOption={(surfacePreset) => setState((prev) => ({ ...prev, surfacePreset, presetMenuOpen: false, status: `surface preset: ${surfacePreset}` }))}
        />
      </C.HW_Body>
      <BuildDock
        state={state}
        onBuild={() => setState((prev) => ({ ...prev, buildDialogOpen: true, eventbusPopoverOpen: false, status: `opened build journal ${ACTIVE_BUILD.build}` }))}
        onEventbus={() => setState((prev) => ({ ...prev, eventbusPopoverOpen: !prev.eventbusPopoverOpen, status: prev.eventbusPopoverOpen ? 'eventbus review closed' : 'eventbus review opened' }))}
      />
      {state.eventbusPopoverOpen ? (
        <EventBusPopover
          state={state}
          onClose={() => setState((prev) => ({ ...prev, eventbusPopoverOpen: false, status: 'eventbus review closed' }))}
        />
      ) : null}
      {state.buildDialogOpen ? (
        <BuildJournalDialog onClose={() => setState((prev) => ({ ...prev, buildDialogOpen: false, eventbusPopoverOpen: false, status: 'build journal closed' }))} />
      ) : null}
      {state.fileExplorerOpen ? (
        <FileExplorerDialog
          query={state.fileExplorerQuery}
          selectedFolder={state.fileExplorerFolder}
          expandedFolders={state.fileExplorerExpanded}
          selectedFileId={state.fileExplorerSelectedId}
          history={state.fileExplorerHistory}
          folderHistory={state.fileExplorerDirectoryHistory}
          onQuery={(fileExplorerQuery) => setState((prev) => ({ ...prev, fileExplorerQuery, status: `file search: ${fileExplorerQuery || 'all indexed files'}` }))}
          onFolder={selectExplorerFolder}
          onToggleFolder={toggleExplorerFolder}
          onSelectFile={(fileExplorerSelectedId) => setState((prev) => ({ ...prev, fileExplorerSelectedId, status: `selected file ${explorerFileById(fileExplorerSelectedId).path}` }))}
          onOpenFile={openExplorerFile}
          onClose={() => setState((prev) => ({ ...prev, fileExplorerOpen: false, status: 'file explorer closed' }))}
        />
      ) : null}
    </C.HW_App>
  );
}

function Chrome(props: {
  state: MockState;
  activeCommand: Command;
  onMenu: (menu: Menu) => void;
  onCommand: (id: string, source: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const undoCount = props.state.history.filter((event) => event.undoable).length;
  const activeMenu = activeMenuFor(props.state);
  return (
    <C.HW_Chrome>
      <C.HW_Brand>
        <Icon name="Box" size={15} color={accentFor('primary')} />
        <C.HW_BrandText>WORLD EDITOR</C.HW_BrandText>
      </C.HW_Brand>
      <C.HW_MenuBar>
        {MENUS.map((menu) => {
          const ActiveItem = activeMenu === menu ? C.HW_MenuItemOn : C.HW_MenuItem;
          const ActiveText = activeMenu === menu ? C.HW_MenuTextOn : C.HW_MenuText;
          return (
            <ActiveItem key={menu} onPress={() => props.onMenu(menu)}>
              <ActiveText>{menu}</ActiveText>
            </ActiveItem>
          );
        })}
      </C.HW_MenuBar>
      <C.HW_Spacer />
      <C.HW_Pill>
        <Icon name={props.activeCommand.icon} size={12} color={accentFor('primary')} />
        <C.HW_PillText>{props.activeCommand.name}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Pill onPress={props.onUndo}>
        <Icon name="Undo2" size={12} color={accentFor(undoCount > 0 ? 'textSecondary' : 'textFaint')} />
        <C.HW_PillText>{String(undoCount).padStart(3, '0')}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Pill onPress={props.onRedo}>
        <Icon name="Redo2" size={12} color={accentFor(props.state.redo.length > 0 ? 'textSecondary' : 'textFaint')} />
        <C.HW_PillText>{String(props.state.redo.length).padStart(3, '0')}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Compile onPress={() => props.onCommand('compile-rle', 'chrome')}>
        <Icon name="Download" size={13} color={accentFor('primary')} />
        <C.HW_PillTextOn>Compile</C.HW_PillTextOn>
      </C.HW_Compile>
      <C.HW_StatusText>shell 0.42s</C.HW_StatusText>
    </C.HW_Chrome>
  );
}

function LeftRail({ state, onDomain }: { state: MockState; onDomain: (domain: string) => void }) {
  return (
    <C.HW_LeftRail>
      {DOMAINS.map(([domain, icon]) => {
        const Btn = state.activeDomain === domain ? C.HW_RailButtonOn : C.HW_RailButton;
        return (
          <Btn key={domain} onPress={() => onDomain(domain)}>
            <Icon name={icon} size={15} color={accentFor(state.activeDomain === domain ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
      <C.HW_Spacer />
      <C.HW_RailButton onPress={() => onDomain('playtest')}><Icon name="PlayCircle" size={15} color={accentFor('textDim')} /></C.HW_RailButton>
      <C.HW_RailButton onPress={() => onDomain('lighting')}><Icon name="Sun" size={15} color={accentFor('textDim')} /></C.HW_RailButton>
    </C.HW_LeftRail>
  );
}

function BuildDock({ state, onBuild, onEventbus }: { state: MockState; onBuild: () => void; onEventbus: () => void }) {
  const reversible = state.history.filter((event) => event.undoable).length;
  const telemetry = editTelemetry(state.history);
  return (
    <C.HW_BuildDock>
      <C.HW_DockBuild onPress={onBuild}>
        <C.HW_DockLabel>Build:</C.HW_DockLabel>
        <C.HW_DockValue>{ACTIVE_BUILD.build}</C.HW_DockValue>
        <Icon name="CircleCheck" size={15} color={accentFor('success')} />
      </C.HW_DockBuild>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <Icon name="CircleCheck" size={12} color={accentFor('success')} />
        <C.HW_DockValue>No Errors</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <Icon name="TriangleAlert" size={12} color={accentFor('warning')} />
        <C.HW_DockValue>2 Warnings</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <C.HW_DockLabel>GO TO POSITION</C.HW_DockLabel>
        <C.HW_DockCoord>X {state.cursor.x}</C.HW_DockCoord>
        <C.HW_DockCoord>Y {state.cursor.y}</C.HW_DockCoord>
        <C.HW_DockCoord>Z {state.cursor.z}</C.HW_DockCoord>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <C.HW_DockLabel>GRID</C.HW_DockLabel>
        <C.HW_DockValue>0.25m</C.HW_DockValue>
        <C.HW_DockLabel>ANGLE</C.HW_DockLabel>
        <C.HW_DockValue>45 deg</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockBuild onPress={onEventbus}>
        <Icon name="Workflow" size={12} color={accentFor(state.eventbusPopoverOpen ? 'primary' : 'textSecondary')} />
        <C.HW_DockLabel>EVENTBUS</C.HW_DockLabel>
        <C.HW_DockValue>{state.history.length} events</C.HW_DockValue>
      </C.HW_DockBuild>
      <C.HW_DockGroup>
        <C.HW_DockLabel>AVG</C.HW_DockLabel>
        <C.HW_DockValue>{formatMs(telemetry.avg)}</C.HW_DockValue>
        <C.HW_DockLabel>P95</C.HW_DockLabel>
        <C.HW_DockValue>{formatMs(telemetry.p95)}</C.HW_DockValue>
        <C.HW_DockLabel>DELTA</C.HW_DockLabel>
        <C.HW_DockCoord>+{formatMs(telemetry.delta)}</C.HW_DockCoord>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <Icon name={telemetry.parity === 'stable' ? 'CircleCheck' : 'TriangleAlert'} size={12} color={accentFor(telemetry.parity === 'stable' ? 'success' : 'warning')} />
        <C.HW_DockValue>placement parity {telemetry.parity}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <C.HW_DockLabel>Triangles:</C.HW_DockLabel>
        <C.HW_DockValue>12,846</C.HW_DockValue>
        <C.HW_DockLabel>Draw Calls:</C.HW_DockLabel>
        <C.HW_DockValue>7</C.HW_DockValue>
        <C.HW_DockLabel>FPS:</C.HW_DockLabel>
        <C.HW_DockValue>60</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <Icon name="GitMerge" size={12} color={accentFor('primary')} />
        <C.HW_DockValue>{BUILD_NOTES.length} build notes</C.HW_DockValue>
        <C.HW_DockLabel>{reversible} reversible</C.HW_DockLabel>
      </C.HW_DockGroup>
      <C.HW_Spacer />
      <C.HW_DockGroup>
        <Icon name="CircleCheck" size={13} color={accentFor('success')} />
        <C.HW_DockValue>Up to date</C.HW_DockValue>
        <C.HW_DockLabel>12.4 GB / 31.9 GB</C.HW_DockLabel>
      </C.HW_DockGroup>
    </C.HW_BuildDock>
  );
}

function EventBusPopover({ state, onClose }: { state: MockState; onClose: () => void }) {
  const telemetry = editTelemetry(state.history);
  const latest = telemetry.samples[0];
  const undoable = state.history.filter((event) => event.undoable).length;
  return (
    <C.HW_DockPopover>
      <C.HW_DockPopoverHead>
        <Icon name="Workflow" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Eventbus Review</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{state.history.length} in-memory events</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{undoable} undoable</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill><C.HW_PillText>{state.redo.length} redo</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
      <C.HW_DockPerfGrid>
        <C.HW_PerfTile>
          <C.HW_PerfValue>{formatMs(telemetry.avg)}</C.HW_PerfValue>
          <C.HW_PerfLabel>avg time / edit</C.HW_PerfLabel>
        </C.HW_PerfTile>
        <C.HW_PerfTile>
          <C.HW_PerfValue>{formatMs(telemetry.p95)}</C.HW_PerfValue>
          <C.HW_PerfLabel>p95 edit cost</C.HW_PerfLabel>
        </C.HW_PerfTile>
        <C.HW_PerfTile>
          <C.HW_PerfValue>+{formatMs(telemetry.delta)}</C.HW_PerfValue>
          <C.HW_PerfLabel>rich map delta</C.HW_PerfLabel>
        </C.HW_PerfTile>
        <C.HW_PerfTile>
          <C.HW_PerfValue>{latest ? formatMs(latest.richMs) : '0.0ms'}</C.HW_PerfValue>
          <C.HW_PerfLabel>latest event</C.HW_PerfLabel>
        </C.HW_PerfTile>
      </C.HW_DockPerfGrid>
      <C.HW_DockTrace>
        <C.HW_GroupTitle>
          <Icon name="Activity" size={12} color={accentFor('primary')} />
          <C.HW_GroupText>AUTHORING COST TRACE</C.HW_GroupText>
          <C.HW_Spacer />
          <C.HW_StatusText>target: empty map placement ~= fully authored rich map placement</C.HW_StatusText>
        </C.HW_GroupTitle>
        <C.HW_Sparkline>
          {telemetry.samples.map((event) => (
            <C.HW_SparkCell key={event.id} style={{ height: Math.max(8, Math.min(38, Math.floor(event.richMs * 1.8))), backgroundColor: event.richMs - event.emptyMs <= 1 ? accentFor('primary') : accentFor('warning') }} />
          ))}
        </C.HW_Sparkline>
      </C.HW_DockTrace>
      <C.HW_EventSummary>
        <C.HW_DockGroup>
          <Icon name="CircleCheck" size={12} color={accentFor('success')} />
          <C.HW_DockValue>autosave ready</C.HW_DockValue>
        </C.HW_DockGroup>
        <C.HW_DockGroup>
          <Icon name="Radio" size={12} color={accentFor('primary')} />
          <C.HW_DockValue>session local</C.HW_DockValue>
        </C.HW_DockGroup>
        <C.HW_DockGroup>
          <Icon name="Users" size={12} color={accentFor('textDim')} />
          <C.HW_DockValue>invite idle</C.HW_DockValue>
        </C.HW_DockGroup>
        <C.HW_Spacer />
        <C.HW_StatusText>review surface only - editor canvas keeps its height</C.HW_StatusText>
      </C.HW_EventSummary>
      <C.HW_DockHistoryRows>
        {state.history.map((event) => (
          <C.HW_DockHistoryRow key={event.id}>
            <C.HW_KeyText>{event.verb.toUpperCase()}</C.HW_KeyText>
            <C.HW_FormValue>{event.target}</C.HW_FormValue>
            <C.HW_HistoryMeta>{event.meta}</C.HW_HistoryMeta>
            <C.HW_Spacer />
            <C.HW_DockLabel>empty</C.HW_DockLabel>
            <C.HW_DockValue>{formatMs(event.emptyMs ?? 0)}</C.HW_DockValue>
            <C.HW_DockLabel>rich</C.HW_DockLabel>
            <C.HW_DockValue>{formatMs(event.richMs ?? 0)}</C.HW_DockValue>
            <C.HW_DockLabel>{event.undoable ? 'undoable' : 'checkpoint'}</C.HW_DockLabel>
          </C.HW_DockHistoryRow>
        ))}
      </C.HW_DockHistoryRows>
    </C.HW_DockPopover>
  );
}

function BuildJournalDialog({ onClose }: { onClose: () => void }) {
  return (
    <C.HW_DialogScrim>
      <C.HW_BuildDialog>
        <C.HW_DialogHead>
          <Icon name="FileClock" size={15} color={accentFor('primary')} />
          <C.HW_HeadTitle>Build Journal</C.HW_HeadTitle>
          <C.HW_PillOn><C.HW_PillTextOn>{ACTIVE_BUILD.build}</C.HW_PillTextOn></C.HW_PillOn>
          <C.HW_Spacer />
          <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
        </C.HW_DialogHead>
        <C.HW_DialogBody>
          <C.HW_JournalIntro>
            <C.HW_HeadTitle>Requests become build notes</C.HW_HeadTitle>
            <C.HW_StatusText>Handled requests auto-increment the editor build and remain searchable history. Review is metadata, not a blocking inbox.</C.HW_StatusText>
          </C.HW_JournalIntro>
          <C.HW_JournalLayout>
            <C.HW_JournalColumn>
              <C.HW_GroupTitle>
                <Icon name="ListChecks" size={12} color={accentFor('primary')} />
                <C.HW_GroupText>RECENT BUILD NOTES</C.HW_GroupText>
              </C.HW_GroupTitle>
              {BUILD_NOTES.map((note) => (
                <C.HW_BuildNoteCard key={note.request}>
                  <C.HW_BuildNoteHead>
                    <C.HW_DockValue>{note.build}</C.HW_DockValue>
                    <C.HW_Spacer />
                    <C.HW_DockLabel>{note.request}</C.HW_DockLabel>
                    <C.HW_Tag><C.HW_TagText>{note.status}</C.HW_TagText></C.HW_Tag>
                  </C.HW_BuildNoteHead>
                  <C.HW_HistoryTitle>{note.title}</C.HW_HistoryTitle>
                  <C.HW_HistoryMeta>{note.agent}: {note.handled}</C.HW_HistoryMeta>
                  <C.HW_TraceRow>
                    {note.trace.map((trace) => <C.HW_TraceChip key={trace}><C.HW_KeyText>{trace}</C.HW_KeyText></C.HW_TraceChip>)}
                  </C.HW_TraceRow>
                </C.HW_BuildNoteCard>
              ))}
            </C.HW_JournalColumn>
            <C.HW_JournalColumn>
              <C.HW_GroupTitle>
                <Icon name="Bug" size={12} color={accentFor('warning')} />
                <C.HW_GroupText>ONGOING THREADS</C.HW_GroupText>
              </C.HW_GroupTitle>
              {BUILD_THREADS.map((thread) => (
                <C.HW_ThreadCard key={thread.id}>
                  <C.HW_BuildNoteHead>
                    <C.HW_HistoryTitle>{thread.title}</C.HW_HistoryTitle>
                    <C.HW_Spacer />
                    <C.HW_DockLabel>{thread.status}</C.HW_DockLabel>
                  </C.HW_BuildNoteHead>
                  {thread.history.map((item) => (
                    <C.HW_ReadRow key={item}>
                      <C.HW_AccentBar style={{ backgroundColor: accentFor(thread.status === 'active' ? 'primary' : 'warning') }} />
                      <C.HW_ReadValue>{item}</C.HW_ReadValue>
                    </C.HW_ReadRow>
                  ))}
                </C.HW_ThreadCard>
              ))}
            </C.HW_JournalColumn>
          </C.HW_JournalLayout>
        </C.HW_DialogBody>
      </C.HW_BuildDialog>
    </C.HW_DialogScrim>
  );
}

function LibraryPanel(props: {
  state: MockState;
  catalogAssets: Asset[];
  assets: Asset[];
  mode: LibraryTab;
  activeAsset: Asset;
  activeObject: WorldObject;
  contentFolder: ContentFolderId;
  expandedFolders: Partial<Record<ContentFolderId, boolean>>;
  onSearch: (search: string) => void;
  onAsset: (asset: Asset) => void;
  onFolder: (folder: ContentFolderId) => void;
  onToggleFolder: (folder: ContentFolderId) => void;
  onFavorite: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
  onPage: (delta: number) => void;
  onFocusMaterial: () => void;
  onMaterialAction: (label: string) => void;
}) {
  const pageSize = assetPageSizeFor(props.mode);
  const maxPage = Math.max(0, Math.ceil(props.assets.length / pageSize) - 1);
  const page = Math.min(props.state.assetPage, maxPage);
  const pageAssets = props.assets.slice(page * pageSize, page * pageSize + pageSize);
  const firstAsset = props.assets.length === 0 ? 0 : page * pageSize + 1;
  const lastAsset = Math.min(props.assets.length, firstAsset + pageAssets.length - 1);
  const emptySlots = Math.max(0, pageSize - pageAssets.length);
  const title = props.mode === 'Skins'
    ? contentFolderLabel(props.contentFolder).toUpperCase()
    : props.mode === 'Build'
      ? contentFolderLabel(props.contentFolder).toUpperCase()
      : contentFolderLabel(props.contentFolder).toUpperCase();
  const folderTab = tabForContentFolder(props.contentFolder);
  const showMaterialCatalog = isMaterialFolder(props.contentFolder);
  const canBrowseAssets = showMaterialCatalog || Boolean(folderTab);
  const selectedFolderCount = countAssetsForFolder(props.catalogAssets, props.contentFolder);
  return (
    <C.HW_SidePanel>
      <C.HW_PanelHead>
        <Icon name="FolderOpen" size={13} color={accentFor('primary')} />
        <C.HW_Kicker>CONTENT BROWSER</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_StatusText>{MATERIAL_ASSET_COUNT} materials</C.HW_StatusText>
      </C.HW_PanelHead>
      <C.HW_Search placeholder="search assets..." value={props.state.search} onChange={props.onSearch} />
      <ContentTree
        nodes={CONTENT_TREE}
        assets={props.catalogAssets}
        selected={props.contentFolder}
        expanded={props.expandedFolders}
        onFolder={props.onFolder}
        onToggle={props.onToggleFolder}
      />
      <C.HW_ContentCrumb>
        <C.HW_Kicker>{title}</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_StatusText>{selectedFolderCount} items</C.HW_StatusText>
      </C.HW_ContentCrumb>
      {canBrowseAssets ? (
        <C.HW_PageBar>
          <C.HW_Pill onPress={() => props.onPage(-1)}><Icon name="ChevronLeft" size={11} color={accentFor('textDim')} /></C.HW_Pill>
          <C.HW_PageText>{firstAsset}-{lastAsset} / {props.assets.length} - {pageSize} fixed slots</C.HW_PageText>
          <C.HW_Spacer />
          <C.HW_PageText>{page + 1}/{maxPage + 1}</C.HW_PageText>
          <C.HW_Pill onPress={() => props.onPage(1)}><Icon name="ChevronRight" size={11} color={accentFor('textDim')} /></C.HW_Pill>
        </C.HW_PageBar>
      ) : null}
      {showMaterialCatalog ? (
        <C.HW_MaterialList>
          {pageAssets.length === 0 ? (
            <C.HW_EmptyState>
              <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
              <C.HW_StatusText>no catalog entries</C.HW_StatusText>
            </C.HW_EmptyState>
          ) : pageAssets.map((asset) => (
            <MaterialCatalogRow
              key={asset.id}
              asset={asset}
              active={props.state.activeAssetId === asset.id}
              onAsset={props.onAsset}
              onFavorite={props.onFavorite}
              onVariant={props.onMaterialAction}
            />
          )).concat(
            Array.from({ length: emptySlots }, (_, index) => (
              <C.HW_MaterialSlotEmpty key={`empty-slot-${page}-${index}`}>
                <C.HW_StatusText>empty fixed page slot</C.HW_StatusText>
              </C.HW_MaterialSlotEmpty>
            )),
          )}
        </C.HW_MaterialList>
      ) : folderTab ? (
        <C.HW_AssetGrid>
          {pageAssets.length === 0 ? (
          <C.HW_EmptyState>
            <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
            <C.HW_StatusText>no catalog entries</C.HW_StatusText>
          </C.HW_EmptyState>
          ) : pageAssets.map((asset) => {
            const Card = props.state.activeAssetId === asset.id ? C.HW_AssetCardOn : C.HW_AssetCard;
            return (
              <Card key={asset.id} onPress={() => props.onAsset(asset)}>
                <C.HW_AssetSwatch style={{ backgroundColor: asset.color }} />
                <C.HW_AssetLabel>{asset.name}</C.HW_AssetLabel>
                <C.HW_AssetMeta>{asset.favorite ? 'favorite' : asset.recent ? 'recent' : `${asset.used} uses`}</C.HW_AssetMeta>
              </Card>
            );
          })}
        </C.HW_AssetGrid>
      ) : (
        <FolderSummary folder={props.contentFolder} />
      )}
      {showMaterialCatalog ? (
        <MaterialControls
          asset={props.activeAsset}
          onFocus={props.onFocusMaterial}
          onAction={props.onMaterialAction}
          onFavorite={props.onFavorite}
          onRename={props.onRename}
        />
      ) : folderTab ? (
        <ContextToolControls mode={props.mode} activeObject={props.activeObject} onAction={props.onMaterialAction} />
      ) : null}
    </C.HW_SidePanel>
  );
}

function ContentTree(props: {
  nodes: ContentNode[];
  assets: Asset[];
  selected: ContentFolderId;
  expanded: Partial<Record<ContentFolderId, boolean>>;
  onFolder: (folder: ContentFolderId) => void;
  onToggle: (folder: ContentFolderId) => void;
}) {
  return (
    <C.HW_ContentTree>
      {props.nodes.map((node) => (
        <ContentTreeNode
          key={node.id}
          node={node}
          depth={0}
          assets={props.assets}
          selected={props.selected}
          expanded={props.expanded}
          onFolder={props.onFolder}
          onToggle={props.onToggle}
        />
      ))}
    </C.HW_ContentTree>
  );
}

function ContentTreeNode(props: {
  node: ContentNode;
  depth: number;
  assets: Asset[];
  selected: ContentFolderId;
  expanded: Partial<Record<ContentFolderId, boolean>>;
  onFolder: (folder: ContentFolderId) => void;
  onToggle: (folder: ContentFolderId) => void;
}) {
  const hasChildren = Boolean(props.node.children?.length);
  const isExpanded = Boolean(props.expanded[props.node.id]);
  const Row = props.selected === props.node.id ? C.HW_TreeRowOn : C.HW_TreeRow;
  const count = countAssetsForFolder(props.assets, props.node.id);
  return (
    <>
      <Row onPress={() => props.onFolder(props.node.id)}>
        {Array.from({ length: props.depth }, (_, index) => <C.HW_TreeIndent key={index} />)}
        <C.HW_TreeToggle onPress={() => hasChildren ? props.onToggle(props.node.id) : props.onFolder(props.node.id)}>
          <Icon name={hasChildren ? (isExpanded ? 'ChevronDown' : 'ChevronRight') : 'Minus'} size={11} color={accentFor('textDim')} />
        </C.HW_TreeToggle>
        <Icon name={props.node.icon ?? 'Folder'} size={13} color={accentFor(props.selected === props.node.id ? 'primary' : 'textDim')} />
        <C.HW_TreeLabel>{props.node.label}</C.HW_TreeLabel>
        <C.HW_Spacer />
        {count > 0 ? <C.HW_TreeCount>{count}</C.HW_TreeCount> : null}
      </Row>
      {hasChildren && isExpanded ? props.node.children!.map((child) => (
        <ContentTreeNode
          key={child.id}
          node={child}
          depth={props.depth + 1}
          assets={props.assets}
          selected={props.selected}
          expanded={props.expanded}
          onFolder={props.onFolder}
          onToggle={props.onToggle}
        />
      )) : null}
    </>
  );
}

function FolderSummary({ folder }: { folder: ContentFolderId }) {
  return (
    <C.HW_FolderSummary>
      <Icon name="FolderOpen" size={18} color={accentFor('textFaint')} />
      <C.HW_HeadTitle>{contentFolderLabel(folder)}</C.HW_HeadTitle>
      <C.HW_StatusText>no indexed assets in this mock folder</C.HW_StatusText>
    </C.HW_FolderSummary>
  );
}

function MaterialCatalogRow(props: {
  asset: Asset;
  active: boolean;
  onAsset: (asset: Asset) => void;
  onFavorite: (assetId: string) => void;
  onVariant: (label: string) => void;
}) {
  const Row = props.active ? C.HW_MaterialCardOn : C.HW_MaterialCard;
  const variants = props.asset.variants ?? ['base', 'aged', 'wet'];
  const bank = props.asset.favorite ? 'favorite' : props.asset.recent ? 'recent' : 'catalog';
  return (
    <Row onPress={() => props.onAsset(props.asset)}>
      <C.HW_MaterialSwatch style={{ backgroundColor: props.asset.color }} />
      <C.HW_MaterialInfo>
        <C.HW_MaterialTitleRow>
          <C.HW_MaterialName>{props.asset.name}</C.HW_MaterialName>
          <C.HW_Spacer />
          <C.HW_MaterialStat>{props.asset.used} uses</C.HW_MaterialStat>
        </C.HW_MaterialTitleRow>
        <C.HW_MaterialStatsRow>
          <C.HW_MaterialStat>{props.asset.recipe ?? 'catalog asset'}</C.HW_MaterialStat>
          <C.HW_MaterialStat>seed {props.asset.seed ?? 80}</C.HW_MaterialStat>
          <C.HW_MaterialStat>{bank}</C.HW_MaterialStat>
        </C.HW_MaterialStatsRow>
        <C.HW_VariantStrip>
          {variants.map((variant, index) => (
            <C.HW_VariantPill key={variant} onPress={() => props.onVariant(`${props.asset.name} variant ${variant}`)}>
              <C.HW_VariantSwatch style={{ backgroundColor: variantColor(props.asset, index) }} />
              <C.HW_VariantLabel>{variant}</C.HW_VariantLabel>
            </C.HW_VariantPill>
          ))}
        </C.HW_VariantStrip>
      </C.HW_MaterialInfo>
      <C.HW_MaterialActions>
        <C.HW_IconMiniButton onPress={() => props.onFavorite(props.asset.id)}>
          <Icon name="Star" size={13} color={accentFor(props.asset.favorite ? 'warning' : 'textFaint')} />
        </C.HW_IconMiniButton>
      </C.HW_MaterialActions>
    </Row>
  );
}

function MaterialControls({
  asset,
  onFocus,
  onAction,
  onFavorite,
  onRename,
}: {
  asset: Asset;
  onFocus: () => void;
  onAction: (label: string) => void;
  onFavorite: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
}) {
  const variants = asset.variants ?? ['v0', 'v1', 'v2'];
  return (
    <C.HW_ToolPanel>
      <C.HW_GroupTitle>
        <Icon name="Sparkles" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>SELECTED MATERIAL</C.HW_GroupText>
      </C.HW_GroupTitle>
      <C.HW_RenameRow>
        <C.HW_RenameInput value={asset.name} onChange={(name) => onRename(asset.id, name)} />
        <C.HW_IconMiniButton onPress={() => onFavorite(asset.id)}>
          <Icon name="Star" size={13} color={accentFor(asset.favorite ? 'warning' : 'textFaint')} />
        </C.HW_IconMiniButton>
      </C.HW_RenameRow>
      <C.HW_StatGrid>
        <C.HW_StatCell>
          <C.HW_StatValue>{asset.used}</C.HW_StatValue>
          <C.HW_StatLabel>uses</C.HW_StatLabel>
        </C.HW_StatCell>
        <C.HW_StatCell>
          <C.HW_StatValue>{Math.max(2, Math.floor(asset.used / 9))}</C.HW_StatValue>
          <C.HW_StatLabel>maps</C.HW_StatLabel>
        </C.HW_StatCell>
        <C.HW_StatCell>
          <C.HW_StatValue>{variants.length}</C.HW_StatValue>
          <C.HW_StatLabel>variants</C.HW_StatLabel>
        </C.HW_StatCell>
      </C.HW_StatGrid>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>recipe</C.HW_ToolLabel>
        <C.HW_ToolValue>{asset.recipe ?? 'catalog asset'}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_SelectedVariants>
        {variants.map((variant, index) => (
          <C.HW_SelectedVariant key={variant} onPress={() => onAction(`${asset.name} variant ${variant}`)}>
            <C.HW_SelectedVariantSwatch style={{ backgroundColor: variantColor(asset, index) }} />
            <C.HW_ToolValue>{variant}</C.HW_ToolValue>
            <C.HW_ToolHint>{index === 0 ? 'default' : index === 1 ? 'alt' : 'override'}</C.HW_ToolHint>
          </C.HW_SelectedVariant>
        ))}
      </C.HW_SelectedVariants>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>seed</C.HW_ToolLabel>
        <C.HW_MiniBar><C.HW_MiniFill style={{ width: `${Math.max(18, (asset.seed ?? 80) % 100)}%` }} /></C.HW_MiniBar>
        <C.HW_ToolValue>{asset.seed ?? 80}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>detail</C.HW_ToolLabel>
        <C.HW_MiniBar><C.HW_MiniFill style={{ width: '58%' }} /></C.HW_MiniBar>
        <C.HW_ToolValue>preview</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>bank</C.HW_ToolLabel>
        <C.HW_ToolValue>{asset.favorite ? 'pinned' : asset.recent ? 'recent' : 'catalog'}</C.HW_ToolValue>
        <C.HW_Spacer />
        <C.HW_ToolHint>no route change</C.HW_ToolHint>
      </C.HW_ToolRow>
      <C.HW_ButtonRow>
        <C.HW_SmallButton onPress={onFocus}><C.HW_FormValue>focus material</C.HW_FormValue></C.HW_SmallButton>
        <C.HW_SmallButton onPress={() => onAction('export variant')}><C.HW_FormValue>save variant</C.HW_FormValue></C.HW_SmallButton>
      </C.HW_ButtonRow>
    </C.HW_ToolPanel>
  );
}

function ContextToolControls({ mode, activeObject, onAction }: { mode: LibraryTab; activeObject: WorldObject; onAction: (label: string) => void }) {
  return (
    <C.HW_ToolPanel>
      <C.HW_GroupTitle>
        <Icon name={mode === 'Build' ? 'Box' : 'Package'} size={12} color={accentFor('primary')} />
        <C.HW_GroupText>{mode === 'Build' ? 'PLACEMENT CONTROLS' : 'PROP CONTROLS'}</C.HW_GroupText>
      </C.HW_GroupTitle>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>focus</C.HW_ToolLabel>
        <C.HW_ToolValue>{activeObject.name}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>snap</C.HW_ToolLabel>
        <C.HW_ChipRow>
          {['grid', 'edge', 'surface'].map((snap, index) => {
            const Chip = index === 0 ? C.HW_PresetChipOn : C.HW_PresetChip;
            return <Chip key={snap} onPress={() => onAction(`snap ${snap}`)}><C.HW_ToolValue>{snap}</C.HW_ToolValue></Chip>;
          })}
        </C.HW_ChipRow>
      </C.HW_ToolRow>
      <C.HW_ButtonRow>
        <C.HW_SmallButton onPress={() => onAction('save prefab')}><C.HW_FormValue>save prefab</C.HW_FormValue></C.HW_SmallButton>
        <C.HW_SmallButton onPress={() => onAction('favorite asset')}><C.HW_FormValue>favorite</C.HW_FormValue></C.HW_SmallButton>
      </C.HW_ButtonRow>
    </C.HW_ToolPanel>
  );
}

function Workspace(props: {
  state: MockState;
  activeCommand: Command;
  activeAsset: Asset;
  onCommand: (id: string, source: string) => void;
  onTool: (id: string) => void;
  onSnap: () => void;
  onFloor: () => void;
  onViewMode: (mode: ViewMode) => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  onExitMaterialFocus: () => void;
  onMaterialAction: (label: string) => void;
}) {
  return (
    <C.HW_Workspace>
      <ToolOptions {...props} />
      <Stage {...props} />
    </C.HW_Workspace>
  );
}

function ToolOptions(props: {
  state: MockState;
  activeCommand: Command;
  onCommand: (id: string, source: string) => void;
  onTool: (id: string) => void;
  onSnap: () => void;
  onFloor: () => void;
  onViewMode: (mode: ViewMode) => void;
}) {
  const activeMenu = activeMenuFor(props.state);
  const actionCommands = COMMANDS.filter((command) => command.menu === activeMenu);
  return (
    <C.HW_ToolOptions>
      <C.HW_PillOn>
        <C.HW_OptionLabel>{activeMenu.toUpperCase()}</C.HW_OptionLabel>
        <C.HW_PillTextOn>{actionCommands.length} commands</C.HW_PillTextOn>
      </C.HW_PillOn>
      {actionCommands.map((command) => {
        const Btn = props.state.activeCommandId === command.id ? C.HW_IconButtonOn : C.HW_IconButton;
        return (
          <Btn key={command.id} onPress={() => command.tool ? props.onTool(command.id) : props.onCommand(command.id, 'action bar')}>
            <Icon name={command.icon} size={14} color={accentFor(props.state.activeCommandId === command.id ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
      <C.HW_OptionDivider />
      <C.HW_PillOn onPress={props.onSnap}>
        <C.HW_OptionLabel>SNAP</C.HW_OptionLabel>
        <C.HW_PillTextOn>{SNAP_MODES[props.state.snapIndex]}</C.HW_PillTextOn>
      </C.HW_PillOn>
      <C.HW_Pill onPress={() => props.onTool('move-selection')}>
        <C.HW_OptionLabel>TOOL</C.HW_OptionLabel>
        <C.HW_PillText>{props.activeCommand.key}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Pill onPress={props.onFloor}>
        <Icon name="Layers" size={12} color={accentFor('textSecondary')} />
        <C.HW_PillText>{FLOORS[props.state.floorIndex]}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Spacer />
      {(['3D', '2D'] as ViewMode[]).map((mode) => {
        const Pill = props.state.viewMode === mode ? C.HW_PillOn : C.HW_Pill;
        const Label = props.state.viewMode === mode ? C.HW_PillTextOn : C.HW_PillText;
        return <Pill key={mode} onPress={() => props.onViewMode(mode)}><Label>{mode}</Label></Pill>;
      })}
    </C.HW_ToolOptions>
  );
}

function Stage(props: {
  state: MockState;
  activeAsset: Asset;
  onCommand: (id: string, source: string) => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  onExitMaterialFocus: () => void;
  onMaterialAction: (label: string) => void;
}) {
  return (
      <C.HW_Stage onPress={props.state.materialFocused ? () => undefined : props.onStage} onRightClick={props.onContext}>
      <C.HW_CanvasGrid />
      {props.state.materialFocused ? (
        <MaterialFocusSurface
          state={props.state}
          activeAsset={props.activeAsset}
          onExit={props.onExitMaterialFocus}
          onAction={props.onMaterialAction}
        />
      ) : (
        <>
          <IsoMap state={props.state} onObject={props.onObject} />
          {props.state.contextOpen ? <ContextMenu state={props.state} onCommand={props.onCommand} /> : null}
          <MiniMap state={props.state} onObject={props.onObject} />
        </>
      )}
      {props.state.openMenu ? <DropdownMenu state={props.state} onCommand={props.onCommand} /> : null}
    </C.HW_Stage>
  );
}

function MaterialFocusSurface(props: {
  state: MockState;
  activeAsset: Asset;
  onExit: () => void;
  onAction: (label: string) => void;
}) {
  const variants = props.activeAsset.variants ?? ['base', 'alt', 'detail'];
  const layers = [
    ['base color', 'locked default'],
    ['edge wear', 'override ready'],
    ['noise mask', 'seed linked'],
    ['export slot', 'new variant'],
  ];
  const brushes = [
    ['round', '32'],
    ['line', '12'],
    ['mask', '18'],
    ['erase', '24'],
  ];
  return (
    <C.HW_MaterialFocus>
      <C.HW_FocusHeader>
        <Icon name="Brush" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>{props.activeAsset.name} Material</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{props.activeAsset.recipe ?? 'catalog recipe'}</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Spacer />
        <C.HW_Pill onPress={() => props.onAction('export focused material')}><C.HW_PillText>export variant</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill onPress={props.onExit}><C.HW_PillText>return to world</C.HW_PillText></C.HW_Pill>
      </C.HW_FocusHeader>
      <C.HW_FocusLayout>
        <C.HW_FocusRail>
          <C.HW_GroupTitle>
            <Icon name="SlidersHorizontal" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>SHADER RECIPE</C.HW_GroupText>
          </C.HW_GroupTitle>
          <C.HW_ToolRow>
            <C.HW_ToolLabel>recipe</C.HW_ToolLabel>
            <C.HW_ToolValue>{props.activeAsset.recipe ?? 'catalog asset'}</C.HW_ToolValue>
          </C.HW_ToolRow>
          <C.HW_ToolRow>
            <C.HW_ToolLabel>seed</C.HW_ToolLabel>
            <C.HW_MiniBar><C.HW_MiniFill style={{ width: `${Math.max(18, (props.activeAsset.seed ?? 72) % 100)}%` }} /></C.HW_MiniBar>
            <C.HW_ToolValue>{props.activeAsset.seed ?? 72}</C.HW_ToolValue>
          </C.HW_ToolRow>
          <C.HW_ToolRow>
            <C.HW_ToolLabel>detail</C.HW_ToolLabel>
            <C.HW_MiniBar><C.HW_MiniFill style={{ width: '64%' }} /></C.HW_MiniBar>
            <C.HW_ToolValue>std</C.HW_ToolValue>
          </C.HW_ToolRow>
          <C.HW_ToolRow>
            <C.HW_ToolLabel>variant</C.HW_ToolLabel>
            <C.HW_ChipRow>
              {variants.map((variant, index) => {
                const Chip = index === 1 ? C.HW_PresetChipOn : C.HW_PresetChip;
                return <Chip key={variant} onPress={() => props.onAction(`focus variant ${variant}`)}><C.HW_ToolValue>{variant}</C.HW_ToolValue></Chip>;
              })}
            </C.HW_ChipRow>
          </C.HW_ToolRow>
          <C.HW_ToolRow>
            <C.HW_ToolLabel>bus</C.HW_ToolLabel>
            <C.HW_ToolValue>session local</C.HW_ToolValue>
            <C.HW_Spacer />
            <C.HW_ToolHint>autosave</C.HW_ToolHint>
          </C.HW_ToolRow>
        </C.HW_FocusRail>
        <C.HW_FocusPreview>
          <C.HW_PreviewToolbar>
            <C.HW_PillOn><C.HW_PillTextOn>paint layer</C.HW_PillTextOn></C.HW_PillOn>
            <C.HW_Pill><C.HW_PillText>mask</C.HW_PillText></C.HW_Pill>
            <C.HW_Pill><C.HW_PillText>compose</C.HW_PillText></C.HW_Pill>
            <C.HW_Spacer />
            <C.HW_StatusText>same route - context retained</C.HW_StatusText>
          </C.HW_PreviewToolbar>
          <C.HW_PreviewGrid>
            {Array.from({ length: 40 }, (_, index) => (
              <C.HW_PreviewTile
                key={index}
                style={{
                  backgroundColor: index % 7 === 0
                    ? '#111922'
                    : index % 5 === 0
                      ? '#728082'
                      : props.activeAsset.color,
                }}
              />
            ))}
          </C.HW_PreviewGrid>
        </C.HW_FocusPreview>
        <C.HW_FocusRail>
          <C.HW_GroupTitle>
            <Icon name="Layers" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>LAYERS</C.HW_GroupText>
          </C.HW_GroupTitle>
          {layers.map(([name, value], index) => {
            const Row = index === 1 ? C.HW_LayerRowOn : C.HW_LayerRow;
            return (
              <Row key={name} onPress={() => props.onAction(`layer ${name}`)}>
                <C.HW_FormValue>{name}</C.HW_FormValue>
                <C.HW_Spacer />
                <C.HW_KeyText>{value}</C.HW_KeyText>
              </Row>
            );
          })}
          <C.HW_GroupTitle>
            <Icon name="Paintbrush" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>CORE BRUSHES</C.HW_GroupText>
          </C.HW_GroupTitle>
          <C.HW_BrushGrid>
            {brushes.map(([name, size]) => (
              <C.HW_BrushCell key={name} onPress={() => props.onAction(`brush ${name}`)}>
                <C.HW_BrushDot style={{ width: Number(size), height: Number(size), borderRadius: Number(size) / 2 }} />
                <C.HW_KeyText>{name}</C.HW_KeyText>
              </C.HW_BrushCell>
            ))}
          </C.HW_BrushGrid>
        </C.HW_FocusRail>
      </C.HW_FocusLayout>
    </C.HW_MaterialFocus>
  );
}

function IsoMap({ state, onObject }: { state: MockState; onObject: (id: string) => void }) {
  const tiles = Array.from({ length: 42 }, (_, i) => ({
    left: 130 + (i % 7) * 45,
    top: 78 + Math.floor(i / 7) * 28,
    tint: i % 9 === 0 ? '#253f21' : i % 7 === 0 ? '#222a31' : '#121b23',
  }));
  const visibleObjects = state.objects.filter((object) => !object.hidden);
  return (
    <C.HW_MapDeck>
      {tiles.map((tile, index) => <C.HW_Tile key={index} style={{ left: tile.left, top: tile.top, backgroundColor: tile.tint }} />)}
      {visibleObjects.map((object) => {
        const asset = assetById(object.assetId);
        return (
          <C.HW_Block key={object.id} style={{ left: object.left, top: object.top, width: object.width, height: object.height, backgroundColor: asset.color }} />
        );
      })}
      {visibleObjects.map((object) => (
        <C.HW_BlockHit
          key={`${object.id}-hit`}
          onPress={() => onObject(object.id)}
          style={{ left: object.left, top: object.top, width: object.width, height: object.height }}
        />
      ))}
      {visibleObjects.map((object) => object.id === state.selectedObjectId ? (
        <C.HW_SelectionBox key={`${object.id}-selection`} style={{ left: object.left - 4, top: object.top - 4, width: object.width + 8, height: object.height + 8 }} />
      ) : null)}
      {[1, 2, 3].map((n, i) => (
        <C.HW_PointBadge key={n} style={{ left: 278 + i * 50, top: 105 + i * 55 }}>
          <C.HW_PointText>{n}</C.HW_PointText>
        </C.HW_PointBadge>
      ))}
    </C.HW_MapDeck>
  );
}

function DropdownMenu({ state, onCommand }: { state: MockState; onCommand: (id: string, source: string) => void }) {
  const rows = COMMANDS.filter((command) => command.menu === state.openMenu);
  return (
    <C.HW_MenuDropdown style={{ left: 154 + MENUS.indexOf(state.openMenu ?? 'Build') * 46 }}>
      <C.HW_MenuDropHead>
        <Icon name="Wrench" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>{state.openMenu} capabilities</C.HW_HeadTitle>
        <C.HW_Spacer />
        <C.HW_Kicker>SSOT</C.HW_Kicker>
      </C.HW_MenuDropHead>
      {rows.map((command) => (
        <C.HW_MenuDropRow key={command.id} onPress={() => onCommand(command.id, 'menu')}>
          <Icon name={command.icon} size={13} color={accentFor(command.native ? 'primary' : 'textDim')} />
          <C.HW_MenuDropText>{command.name}</C.HW_MenuDropText>
          <C.HW_Spacer />
          <C.HW_MenuDropSub>{command.key}</C.HW_MenuDropSub>
          {command.context ? (
            <C.HW_CheckCell><Icon name="MousePointerClick" size={9} color={accentFor('primary')} /></C.HW_CheckCell>
          ) : <C.HW_CheckCellOff />}
          {command.native ? (
            <C.HW_CheckCell><Icon name="Cpu" size={9} color={accentFor('primary')} /></C.HW_CheckCell>
          ) : <C.HW_CheckCellOff />}
          {command.undoable ? (
            <C.HW_CheckCell><Icon name="History" size={9} color={accentFor('primary')} /></C.HW_CheckCell>
          ) : <C.HW_CheckCellOff />}
        </C.HW_MenuDropRow>
      ))}
    </C.HW_MenuDropdown>
  );
}

function ContextMenu({ state, onCommand }: { state: MockState; onCommand: (id: string, source: string) => void }) {
  const rows = COMMANDS.filter((command) => command.context);
  return (
    <C.HW_ContextMenu>
      <C.HW_ContextHead>
        <C.HW_Kicker>CONTEXT</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_KeyText>{commandById(state.activeCommandId).name}</C.HW_KeyText>
      </C.HW_ContextHead>
      {rows.map((command) => (
        <C.HW_ContextRow key={command.id} onPress={() => onCommand(command.id, 'context')}>
          <Icon name={command.icon} size={12} color={accentFor(command.id === state.activeCommandId ? 'primary' : 'textDim')} />
          <C.HW_ContextText>{command.name}</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{command.key}</C.HW_KeyText>
        </C.HW_ContextRow>
      ))}
    </C.HW_ContextMenu>
  );
}

function MiniMap({ state, onObject }: { state: MockState; onObject: (id: string) => void }) {
  const grid = Array.from({ length: 12 }, (_, i) => i);
  return (
    <C.HW_FloatingCard style={{ right: 16, bottom: 18, width: 280, height: 190 }}>
      <C.HW_ContextHead>
        <Icon name="Map" size={12} color={accentFor('textDim')} />
        <C.HW_KeyText>2D MAP</C.HW_KeyText>
        <C.HW_PillOn style={{ height: 16, paddingLeft: 5, paddingRight: 5 }}>
          <C.HW_PillTextOn>{state.viewMode === '3D' ? 'linked' : 'active'}</C.HW_PillTextOn>
        </C.HW_PillOn>
        <C.HW_Spacer />
        <Icon name="SlidersHorizontal" size={12} color={accentFor('textFaint')} />
      </C.HW_ContextHead>
      <C.HW_MiniMap>
        {grid.map((i) => <C.HW_MiniLine key={`v-${i}`} style={{ left: i * 24, top: 0, width: 1, height: 166 }} />)}
        {grid.slice(0, 8).map((i) => <C.HW_MiniLine key={`h-${i}`} style={{ left: 0, top: i * 22, width: 278, height: 1 }} />)}
        {state.objects.filter((object) => !object.hidden).map((object) => (
          <C.HW_MiniShape
            key={object.id}
            onPress={() => onObject(object.id)}
            style={{
              left: Math.max(8, Math.floor(object.left / 2.6) - 50),
              top: Math.max(10, Math.floor(object.top / 2.3) - 10),
              width: Math.max(18, Math.floor(object.width / 1.8)),
              height: Math.max(14, Math.floor(object.height / 2.3)),
              backgroundColor: assetById(object.assetId).color,
            }}
          />
        ))}
        <C.HW_SelectionBox style={{ left: 86, top: 78, width: 128, height: 54, borderColor: '#f1bd58', backgroundColor: 'transparent' }} />
        <C.HW_PointBadge style={{ left: 66, top: 56, width: 11, height: 11, borderRadius: 6 }} />
        <C.HW_PointBadge style={{ left: 166, top: 66, width: 11, height: 11, borderRadius: 6 }} />
      </C.HW_MiniMap>
    </C.HW_FloatingCard>
  );
}

function Inspector(props: {
  state: MockState;
  activeObject: WorldObject;
  activeAsset: Asset;
  onPane: (pane: string) => void;
  onCommand: (id: string, source: string) => void;
  onPreset: () => void;
  onPresetOption: (preset: string) => void;
}) {
  const activeCommand = commandById(props.state.activeCommandId);
  const pathRows = props.activeObject.kind === 'TILE'
    ? [
      ['walkable', 'yes'],
      ['surface preset', props.state.surfacePreset],
      ['floor', FLOORS[props.state.floorIndex]!],
    ]
    : props.activeObject.kind === 'PIECE' || props.activeObject.kind === 'PREFAB'
      ? [
        ['collision', 'solid'],
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['floor', FLOORS[props.state.floorIndex]!],
      ]
      : [
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['placement', props.activeObject.kind.toLowerCase()],
        ['floor', FLOORS[props.state.floorIndex]!],
      ];
  const visibilityRows = props.activeObject.kind === 'PROP'
    ? [
      ['occlusion', 'object local'],
      ['bake', 'prop pass'],
      ['channel', 'decor'],
    ]
    : [
      ['conceal', props.activeObject.kind === 'PIECE' ? '0.34' : '0.12'],
      ['lightThru', props.activeObject.kind === 'CUTOUT' ? '0.88' : '0.97'],
      ['soundOcc', props.activeObject.kind === 'PIECE' ? '0.80' : '0.04'],
    ];
  const showMission = props.state.rightPane === 'mission' || activeCommand.menu === 'Story';
  return (
    <C.HW_RightPanel>
      <C.HW_Inspector>
        <C.HW_PanelHead>
          <C.HW_Kicker>{props.state.rightPane.toUpperCase()}</C.HW_Kicker>
          <C.HW_Spacer />
          <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
        </C.HW_PanelHead>
        <C.HW_ObjectHead>
          <C.HW_Tag><C.HW_TagText>{props.activeObject.kind}</C.HW_TagText></C.HW_Tag>
          <C.HW_ObjectTitle>{props.activeObject.name}</C.HW_ObjectTitle>
          <C.HW_Spacer />
          <C.HW_Swatch style={{ backgroundColor: props.activeAsset.color }} />
        </C.HW_ObjectHead>
        <C.HW_MetricRow>
          {props.activeObject.metrics.map(([label, value]) => (
            <C.HW_Metric key={label}>
              <C.HW_MetricValue>{value}</C.HW_MetricValue>
              <C.HW_MetricLabel>{label}</C.HW_MetricLabel>
            </C.HW_Metric>
          ))}
        </C.HW_MetricRow>
        <ReadOnlySection title={`${props.activeObject.kind} FACTS`} color="primary" rows={[
          ['asset', props.activeAsset.name],
          ['tool', activeCommand.name],
          ['key', activeCommand.key],
        ]} />
        {props.activeObject.kind === 'TILE' ? (
          <PresetSection
            title="SURFACE DEFAULTS"
            color="warning"
            active={props.state.surfacePreset}
            options={PRESETS}
            open={props.state.presetMenuOpen}
            onPreset={props.onPreset}
            onOption={props.onPresetOption}
            rows={[
              ['actual friction', '0.60'],
              ['actual speed factor', props.state.surfacePreset === 'fast' ? '1.20' : props.state.surfacePreset === 'slow' ? '0.80' : '1.00'],
            ]}
          />
        ) : null}
        <ReadOnlySection title="PLACEMENT" color="primary" rows={pathRows} />
        <ReadOnlySection title="VISIBILITY" color="primary" rows={visibilityRows} />
        {showMission ? (
          <MissionSection
            rows={[
              ['in mission', 'editing'],
              ['spawn on', 'Mission 1'],
              ['render during', 'Night Raid'],
            ]}
            onCommand={props.onCommand}
          />
        ) : null}
      </C.HW_Inspector>
      <C.HW_RightRail>
        {RIGHT_PANES.map(([pane, icon]) => {
          const Btn = props.state.rightPane === pane ? C.HW_RailButtonOn : C.HW_RailButton;
          return (
            <Btn key={pane} onPress={() => props.onPane(pane)}>
              <Icon name={icon} size={14} color={accentFor(props.state.rightPane === pane ? 'primary' : 'textDim')} />
            </Btn>
          );
        })}
      </C.HW_RightRail>
    </C.HW_RightPanel>
  );
}

function ReadOnlySection(props: {
  title: string;
  color: string;
  rows: string[][];
}) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor(props.color) }} />
        <C.HW_SectionTitle style={{ color: accentFor(props.color) }}>{props.title}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>{props.rows.length}</C.HW_KeyText>
      </C.HW_SectionHead>
      {props.rows.map(([label, value]) => (
        <C.HW_ReadRow key={label}>
          <C.HW_FormLabel>{label}</C.HW_FormLabel>
          <C.HW_Spacer />
          <C.HW_ReadValue>{value}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
    </C.HW_Section>
  );
}

function PresetSection(props: {
  title: string;
  color: string;
  active: string;
  options: string[];
  open: boolean;
  rows: string[][];
  onPreset: () => void;
  onOption: (preset: string) => void;
}) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor(props.color) }} />
        <C.HW_SectionTitle style={{ color: accentFor(props.color) }}>{props.title}</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>editable</C.HW_KeyText>
      </C.HW_SectionHead>
      <C.HW_SelectRow>
        <C.HW_FormLabel>preset</C.HW_FormLabel>
        <C.HW_SelectControl onPress={props.onPreset}>
          <C.HW_FormValue>{props.active}</C.HW_FormValue>
          <C.HW_Spacer />
          <Icon name={props.open ? 'ChevronUp' : 'ChevronDown'} size={12} color={accentFor('textDim')} />
        </C.HW_SelectControl>
      </C.HW_SelectRow>
      {props.open ? (
        <C.HW_SelectMenu>
          {props.options.map((preset) => (
            <C.HW_SelectOption key={preset} onPress={() => props.onOption(preset)}>
              <C.HW_FormValue>{preset}</C.HW_FormValue>
              <C.HW_Spacer />
              {preset === props.active ? <Icon name="Check" size={12} color={accentFor('primary')} /> : null}
            </C.HW_SelectOption>
          ))}
        </C.HW_SelectMenu>
      ) : null}
      {props.rows.map(([label, value]) => (
        <C.HW_ReadRow key={label}>
          <C.HW_FormLabel>{label}</C.HW_FormLabel>
          <C.HW_Spacer />
          <C.HW_ReadValue>{value}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
    </C.HW_Section>
  );
}

function MissionSection(props: {
  rows: string[][];
  onCommand: (id: string, source: string) => void;
}) {
  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor('success') }} />
        <C.HW_SectionTitle style={{ color: accentFor('success') }}>MISSION</C.HW_SectionTitle>
        <C.HW_Spacer />
        <C.HW_KeyText>applicable</C.HW_KeyText>
      </C.HW_SectionHead>
      {props.rows.map(([label, value]) => (
        <C.HW_ReadRow key={label}>
          <C.HW_FormLabel>{label}</C.HW_FormLabel>
          <C.HW_Spacer />
          <C.HW_ReadValue>{value}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
      <C.HW_ButtonRow>
        <C.HW_SmallButton onPress={() => props.onCommand('add-trigger', 'inspector')}><C.HW_FormValue>triggers - 2</C.HW_FormValue></C.HW_SmallButton>
        <C.HW_SmallButton onPress={() => props.onCommand('mission-point', 'inspector')}><C.HW_FormValue>points - 3</C.HW_FormValue></C.HW_SmallButton>
      </C.HW_ButtonRow>
    </C.HW_Section>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={WORKSPACE_COLORS} styles={WORKSPACE_STYLES}>
      <AppFrame />
    </ThemeProvider>
  );
}
