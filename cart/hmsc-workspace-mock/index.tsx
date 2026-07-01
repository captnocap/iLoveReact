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
  | 'models'
  | 'models-props'
  | 'models-props-wip'
  | 'model-vase'
  | 'model-cd-player'
  | 'model-ball'
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

type ThreadCapture = {
  id: string;
  name: string;
  channels: string[];
  range: string;
  build: string;
  context: string;
  note: string;
};

type BuildThread = {
  id: string;
  title: string;
  status: string;
  aliases: string[];
  tags: string[];
  deliveries: string[];
  captures: ThreadCapture[];
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

type ModelAtlas = {
  id: string;
  label: string;
  scope: string;
  resolution: string;
  paints: number;
  color: string;
};

type ModelPaintVariant = {
  id: string;
  name: string;
  atlas: string;
  used: number;
  shaderRefs: string[];
  imageRefs: string[];
  color: string;
};

type ModelPackage = {
  id: string;
  folderId: ContentFolderId;
  name: string;
  path: string;
  kind: 'prop' | 'character' | 'vehicle';
  stage: 'wip' | 'ready' | 'locked';
  color: string;
  source: string;
  rig: string;
  data: string;
  triangles: number;
  lods: number;
  decompositions: string[];
  atlases: ModelAtlas[];
  paints: ModelPaintVariant[];
};

type Rgb = [number, number, number];
type ColorStudioMaterialKey = 'rot' | 'stucco' | 'pool';

type ShaderSlot = {
  name: string;
  role: string;
};

type ShaderMaterial = {
  key: ColorStudioMaterialKey;
  name: string;
  shaderFn: string;
  board: string;
  materialId: number;
  heroSlot: number;
  slots: ShaderSlot[];
  variants: Rgb[][];
};

type PaletteSet = {
  name: string;
  tag: string;
  colors: Rgb[];
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

const QUALITY_LABELS = ['PSX', 'PS2', 'Prev', 'Std', 'Max'];

const SHADER_MATERIALS: Record<ColorStudioMaterialKey, ShaderMaterial> = {
  rot: {
    key: 'rot',
    name: 'Rot Siding',
    shaderFn: 'rot_siding',
    board: 'B / Condemned',
    materialId: 18,
    heroSlot: 2,
    slots: [
      { name: 'Wood low', role: 'grain shadow' },
      { name: 'Wood high', role: 'grain lift' },
      { name: 'Paint', role: 'variant color' },
      { name: 'Rot', role: 'damage mask' },
      { name: 'Seam', role: 'board cut' },
    ],
    variants: [
      [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.58, 0.62, 0.54], [0.035, 0.04, 0.026], [0.018, 0.016, 0.014]],
      [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.28, 0.47, 0.58], [0.035, 0.04, 0.026], [0.018, 0.016, 0.014]],
      [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.70, 0.56, 0.35], [0.035, 0.04, 0.026], [0.018, 0.016, 0.014]],
    ],
  },
  stucco: {
    key: 'stucco',
    name: 'Neon Stucco',
    shaderFn: 'neon_stucco',
    board: 'D / NeonRot',
    materialId: 31,
    heroSlot: 1,
    slots: [
      { name: 'Base low', role: 'plaster shadow' },
      { name: 'Base high', role: 'plaster lift' },
      { name: 'Drip', role: 'leak accent' },
    ],
    variants: [
      [[0.50, 0.10, 0.24], [0.98, 0.45, 0.66], [0.98, 0.78, 0.18]],
      [[0.07, 0.37, 0.42], [0.36, 0.92, 0.88], [0.98, 0.78, 0.18]],
      [[0.26, 0.19, 0.46], [0.84, 0.68, 0.96], [0.98, 0.78, 0.18]],
    ],
  },
  pool: {
    key: 'pool',
    name: 'Pool Tile',
    shaderFn: 'pool_tile',
    board: 'D / NeonRot',
    materialId: 34,
    heroSlot: 1,
    slots: [
      { name: 'Tile A', role: 'checker low' },
      { name: 'Tile B', role: 'checker high' },
      { name: 'Caustic', role: 'light sweep' },
      { name: 'Mildew', role: 'grout dirt' },
    ],
    variants: [
      [[0.05, 0.50, 0.62], [0.48, 0.96, 0.92], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]],
      [[0.12, 0.10, 0.42], [0.96, 0.20, 0.56], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]],
      [[0.16, 0.44, 0.34], [0.86, 0.74, 0.34], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]],
    ],
  },
};

const COLOR_LIBRARY_SETS: PaletteSet[] = [
  { name: 'Condemned Wood', tag: 'rot siding compatible', colors: [[0.28, 0.17, 0.09], [0.58, 0.39, 0.20], [0.28, 0.47, 0.58], [0.035, 0.04, 0.026]] },
  { name: 'Neon Motel', tag: 'stucco night read', colors: [[0.50, 0.10, 0.24], [0.98, 0.45, 0.66], [0.36, 0.92, 0.88], [0.98, 0.78, 0.18]] },
  { name: 'Pool Rot', tag: 'wet tile breakup', colors: [[0.05, 0.50, 0.62], [0.48, 0.96, 0.92], [0.90, 1.00, 0.85], [0.015, 0.05, 0.035]] },
  { name: 'Ashphalt Warm', tag: 'street grime', colors: [[0.13, 0.15, 0.16], [0.31, 0.32, 0.31], [0.62, 0.55, 0.40], [0.72, 0.36, 0.29]] },
];

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
  colorStudioMaterial: ColorStudioMaterialKey;
  colorStudioVariant: number;
  colorStudioSeed: number;
  colorStudioQuality: number;
  colorStudioActiveSlot: number;
  colorStudioOverrides: Record<string, string>;
  buildDialogOpen: boolean;
  threads: BuildThread[];
  journalAttachRequest: string | null;
  journalThreadQuery: string;
  journalRenameThreadId: string | null;
  journalThreadDraft: string;
  journalCaptureForThread: string | null;
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
const MENU_DROPDOWN_WIDTH = 420;
const MENU_LEFT_BASE = 154;
const MENU_LEFT_STEP = 46;
const MENU_STAGE_GUTTER = 12;

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

const MODEL_PACKAGES: ModelPackage[] = [
  {
    id: 'vase',
    folderId: 'model-vase',
    name: 'vase',
    path: '/models/props/vase',
    kind: 'prop',
    stage: 'ready',
    color: '#8f7a68',
    source: 'source/vase_high.glb',
    rig: 'rig/prop_static.anchor.json',
    data: 'data/model.package.json',
    triangles: 8420,
    lods: 4,
    decompositions: ['decomp/intact', 'decomp/shards_12', 'decomp/chunks_04'],
    atlases: [
      { id: 'vase-atlas-main', label: 'atlas/main', scope: 'intact model', resolution: '2048', paints: 7, color: '#8f7a68' },
      { id: 'vase-atlas-shards', label: 'atlas/shards_12', scope: 'explosion shards', resolution: '1024', paints: 4, color: '#6f5f55' },
      { id: 'vase-atlas-lod', label: 'atlas/lod_proxy', scope: 'low detail proxy', resolution: '512', paints: 2, color: '#514844' },
    ],
    paints: [
      { id: 'vase-paint-porcelain', name: 'blue porcelain', atlas: 'atlas/main', used: 18, shaderRefs: ['ceramic_clearcoat'], imageRefs: ['stamp-floral-02'], color: '#6f8fa5' },
      { id: 'vase-paint-cracked', name: 'cracked motel', atlas: 'atlas/main', used: 9, shaderRefs: ['edge_dirt'], imageRefs: ['scratch-mask-01'], color: '#b1a18e' },
      { id: 'vase-paint-shards', name: 'broken inside', atlas: 'atlas/shards_12', used: 4, shaderRefs: ['fresh_ceramic_cut'], imageRefs: ['dust-noise-03'], color: '#7d7068' },
    ],
  },
  {
    id: 'cd-player',
    folderId: 'model-cd-player',
    name: 'cd_player',
    path: '/models/props/cd_player',
    kind: 'prop',
    stage: 'ready',
    color: '#56616d',
    source: 'source/cd_player_scan.glb',
    rig: 'rig/hinge_lid.socket.json',
    data: 'data/model.package.json',
    triangles: 12840,
    lods: 3,
    decompositions: ['decomp/body_lid_buttons', 'decomp/explosion_09'],
    atlases: [
      { id: 'cd-atlas-body', label: 'atlas/body', scope: 'body + lid', resolution: '2048', paints: 5, color: '#56616d' },
      { id: 'cd-atlas-buttons', label: 'atlas/buttons', scope: 'button decomp', resolution: '512', paints: 3, color: '#2c343d' },
      { id: 'cd-atlas-scrap', label: 'atlas/scrap_09', scope: 'explosion pieces', resolution: '1024', paints: 2, color: '#3f4a55' },
    ],
    paints: [
      { id: 'cd-paint-black', name: 'black plastic', atlas: 'atlas/body', used: 12, shaderRefs: ['dusty_plastic'], imageRefs: ['label-compact-disc'], color: '#252b31' },
      { id: 'cd-paint-store', name: 'thrift sticker', atlas: 'atlas/body', used: 6, shaderRefs: ['sticker_edge_lift'], imageRefs: ['price-tag-99c'], color: '#6a737d' },
      { id: 'cd-paint-broken', name: 'opened broken', atlas: 'atlas/scrap_09', used: 3, shaderRefs: ['sharp_plastic_edge'], imageRefs: ['scratch-mask-02'], color: '#404852' },
    ],
  },
  {
    id: 'ball',
    folderId: 'model-ball',
    name: 'ball',
    path: '/models/props/wip/ball',
    kind: 'prop',
    stage: 'wip',
    color: '#b06a58',
    source: 'source/ball_blockout.glb',
    rig: 'rig/physics_sphere.anchor.json',
    data: 'data/model.package.json',
    triangles: 2160,
    lods: 2,
    decompositions: ['decomp/intact', 'decomp/deflated_shell'],
    atlases: [
      { id: 'ball-atlas-main', label: 'atlas/main', scope: 'sphere body', resolution: '1024', paints: 11, color: '#b06a58' },
      { id: 'ball-atlas-deflated', label: 'atlas/deflated_shell', scope: 'damage state', resolution: '512', paints: 3, color: '#7f5148' },
      { id: 'ball-atlas-lod', label: 'atlas/lod_billboard', scope: 'distance card', resolution: '256', paints: 2, color: '#553d3a' },
    ],
    paints: [
      { id: 'ball-paint-red', name: 'red rubber', atlas: 'atlas/main', used: 20, shaderRefs: ['rubber_scuff'], imageRefs: ['court-grime-01'], color: '#b94d3f' },
      { id: 'ball-paint-soccer', name: 'panel soccer', atlas: 'atlas/main', used: 14, shaderRefs: ['stitched_panel'], imageRefs: ['hex-panel-mask'], color: '#d4d2c8' },
      { id: 'ball-paint-deflated', name: 'deflated dirty', atlas: 'atlas/deflated_shell', used: 5, shaderRefs: ['rubber_fold_shadow'], imageRefs: ['mud-splatter-02'], color: '#7b5a4f' },
    ],
  },
];

const MODEL_PACKAGE_COUNT = MODEL_PACKAGES.length;

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
        id: 'models',
        label: 'Models',
        icon: 'Box',
        children: [
          {
            id: 'models-props',
            label: 'props',
            children: [
              { id: 'models-props-wip', label: 'wip' },
              { id: 'model-vase', label: 'vase' },
              { id: 'model-cd-player', label: 'cd_player' },
              { id: 'model-ball', label: 'ball' },
            ],
          },
        ],
      },
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
        label: 'Global Materials',
        children: [
          { id: 'materials-core', label: 'Defaults' },
          { id: 'materials-generated', label: 'Procedural' },
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
    request: 'req_2172',
    build: '1.0.0.2172',
    title: 'V8 layout validation gate',
    status: 'mocked',
    agent: 'codex',
    handled: 'Added a no-Python TS/V8 layout validator that checks the mock breakpoint, fixed workspace budgets, menu dropdown reachability, fixed page slots, scroll reachability, and wrap allow-list before visual review.',
    trace: ['layout validation', 'v8 cli', 'fixed budgets', 'reachable menus'],
  },
  {
    request: 'req_2171',
    build: '1.0.0.2171',
    title: 'Workspace reachability checks',
    status: 'mocked',
    agent: 'codex',
    handled: 'Formalized the layout expectation that fixed panels, dropdowns, paged content, and scroll containers must be verifiable at the target breakpoint before opening the app.',
    trace: ['layout gate', 'scroll containers', 'content reachability', 'fixed sizes'],
  },
  {
    request: 'req_2170',
    build: '1.0.0.2170',
    title: 'Shitty Games platform framing',
    status: 'mocked',
    agent: 'codex',
    handled: 'Reframed the workspace mock around Shitty Games as an engine-first nogame release: the editor/tooling can ship independently while hmsc becomes a loadable game data package.',
    trace: ['branding', 'nogame release', 'loader', 'engine as platform'],
  },
  {
    request: 'req_2169',
    build: '1.0.0.2169',
    title: 'Color Studio material palette',
    status: 'mocked',
    agent: 'codex',
    handled: 'Turned the focused material surface into a shader-slot Color Studio mock where baked vec3f defaults are exposed per material, variant, seed, and quality with reset and fill-assist flows.',
    trace: ['color studio', 'material palette', 'shader slots', 'vec3f defaults'],
  },
  {
    request: 'req_2168',
    build: '1.0.0.2168',
    title: 'Model package content browser',
    status: 'mocked',
    agent: 'codex',
    handled: 'Changed the content browser architecture so model folders own source mesh, rig data, decompositions, atlas sets, paint variants, and captured shader/image references while global materials remain separate.',
    trace: ['content browser', 'models folder', 'texture atlas', 'paint variants'],
  },
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

// Diagnostic captures the raw console can mint from the live feed; any of these
// can be attached onto an ongoing bug/build thread so a useful slice travels
// with the issue history instead of getting lost in a file somewhere.
const CAPTURE_POOL: ThreadCapture[] = [
  { id: 'cap-gpu-cliff', name: 'gpu cliff 4fps', channels: ['gpu.bindgroup', 'render.frame'], range: '14:02-14:05', build: '1.0.0.2118', context: 'city_block_04', note: 'bind-group count spikes once the map gets dense' },
  { id: 'cap-place-latency', name: 'rich map place lag', channels: ['edit.place', 'authoring.cost'], range: '09:41-09:43', build: '1.0.0.2112', context: 'motel_prefab', note: 'p95 edit time climbs with city size' },
  { id: 'cap-eventbus-flood', name: 'idle eventbus burst', channels: ['eventbus.emit', 'render.rebake'], range: '11:20-11:21', build: '1.0.0.2118', context: 'traffic_layers', note: 'idle re-render storm floods the bus' },
  { id: 'cap-layout-clip', name: 'menu clipped offscreen', channels: ['layout.validate'], range: '16:09-16:10', build: '1.0.0.2172', context: 'mission_night_raid', note: 'dropdown ran past the stage gutter' },
];

const BUILD_THREADS: BuildThread[] = [
  {
    id: 'bug-gpu-bind-groups',
    title: 'GPU bind-group creation cliff',
    status: 'watch',
    aliases: ['jesus water walking', 'frame cliff'],
    tags: ['gpu', 'perf', 'regression'],
    deliveries: [],
    captures: [CAPTURE_POOL[0]!],
    history: ['req_1739 root cause: 240 -> 4fps cliff', 'future repeats attach here instead of creating isolated memory'],
  },
  {
    id: 'ux-request-ledger',
    title: 'Request ledger visibility and closure burden',
    status: 'active',
    aliases: ['build journal'],
    tags: ['ux', 'journal', 'requests'],
    deliveries: ['req_2108'],
    captures: [],
    history: ['req_2108 turns requests into build notes', 'manual review becomes journal state, not a blocking chore'],
  },
  {
    id: 'ux-material-browser',
    title: 'Material browser scale and usability',
    status: 'active',
    aliases: ['material catalog'],
    tags: ['ux', 'materials', 'browser'],
    deliveries: ['req_2104', 'req_2105', 'req_2106', 'req_2111', 'req_2168', 'req_2169'],
    captures: [],
    history: ['req_2104 generated catalog scale', 'req_2105 added stats/variants/actions', 'req_2106 moved it under content browser hierarchy', 'req_2111 fixed page slots keep controls visible', 'req_2168 splits model-owned paint/atlas data from global materials', 'req_2169 exposes shader color constants as named slots'],
  },
  {
    id: 'platform-nogame-release',
    title: 'Shitty Games engine-first release',
    status: 'active',
    aliases: ['nogame release'],
    tags: ['platform', 'branding', 'release'],
    deliveries: ['req_2170'],
    captures: [],
    history: ['req_2170 frames the public release as a nogame engine/tooling build', 'hmsc remains the first loadable game package, not the whole platform', 'engine data formats should keep serving other games built on the loader'],
  },
  {
    id: 'ux-layout-validation',
    title: 'Layout reachability must be preflighted',
    status: 'active',
    aliases: ['layout gate'],
    tags: ['layout', 'validation', 'ci'],
    deliveries: ['req_2171', 'req_2172'],
    captures: [],
    history: ['req_2171 defines fixed breakpoint validation for menus/content', 'req_2172 locks the validator to the repo TS/V8 CLI toolchain, no Python'],
  },
  {
    id: 'perf-authoring-parity',
    title: 'Authoring cost must not scale with map richness',
    status: 'watch',
    aliases: ['placement parity'],
    tags: ['perf', 'authoring', 'latency'],
    deliveries: ['req_2112'],
    captures: [],
    history: ['req_2112 exposes avg/p95 edit timing in the dock', 'placement on an empty map and a rich map should stay the same delta'],
  },
  {
    id: 'ux-eventbus-review',
    title: 'Eventbus review should not occupy permanent workspace space',
    status: 'active',
    aliases: ['eventbus dock'],
    tags: ['ux', 'eventbus', 'dock'],
    deliveries: ['req_2118'],
    captures: [],
    history: ['req_2118 moves event stream review into a dock popover', 'event data stays one click away without shrinking the editor stage'],
  },
];

const ACTIVE_BUILD = BUILD_NOTES[0]!;

function buildNoteByRequest(request: string): BuildNote | undefined {
  return BUILD_NOTES.find((note) => note.request === request);
}

function threadForRequest(threads: BuildThread[], request: string): BuildThread | undefined {
  return threads.find((thread) => thread.deliveries.includes(request));
}

function threadStatusAccent(status: string): string {
  if (status === 'active') return 'primary';
  if (status === 'watch') return 'warning';
  return 'textDim';
}

function threadSearchHaystack(thread: BuildThread): string {
  return [thread.title, thread.id, ...thread.aliases, ...thread.tags, ...thread.deliveries].join(' ').toLowerCase();
}

function matchThreads(threads: BuildThread[], query: string): BuildThread[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return threads;
  const tokens = needle.split(/\s+/);
  return threads.filter((thread) => tokens.every((token) => threadSearchHaystack(thread).includes(token)));
}

function unattachedCaptures(threads: BuildThread[]): ThreadCapture[] {
  const used = new Set(threads.flatMap((thread) => thread.captures.map((capture) => capture.id)));
  return CAPTURE_POOL.filter((capture) => !used.has(capture.id));
}

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

function menuDropdownLeft(menu: Menu | null): number {
  const viewportWidth = 1536;
  const stageWidth = viewportWidth - 48 - 350 - 326;
  const rawLeft = MENU_LEFT_BASE + MENUS.indexOf(menu ?? 'Build') * MENU_LEFT_STEP;
  return Math.max(MENU_STAGE_GUTTER, Math.min(rawLeft, stageWidth - MENU_DROPDOWN_WIDTH - MENU_STAGE_GUTTER));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rgbToCss(rgb: Rgb): string {
  return `rgb(${Math.round(clamp01(rgb[0]) * 255)}, ${Math.round(clamp01(rgb[1]) * 255)}, ${Math.round(clamp01(rgb[2]) * 255)})`;
}

function rgbToVec3(rgb: Rgb): string {
  return `vec3f(${rgb.map((value) => value.toFixed(3)).join(', ')})`;
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return [
    clamp01(a[0] + (b[0] - a[0]) * t),
    clamp01(a[1] + (b[1] - a[1]) * t),
    clamp01(a[2] + (b[2] - a[2]) * t),
  ];
}

function complementRgb(rgb: Rgb): Rgb {
  return mixRgb([1 - rgb[0], 1 - rgb[1], 1 - rgb[2]], [0.14, 0.34, 0.48], 0.42);
}

function colorStudioMaterial(state: MockState): ShaderMaterial {
  return SHADER_MATERIALS[state.colorStudioMaterial] ?? SHADER_MATERIALS.rot;
}

function colorStudioOverrideKey(material: ColorStudioMaterialKey, variant: number, slot: number): string {
  return `${material}:${variant}:${slot}`;
}

function bakedSlotRgb(material: ShaderMaterial, variant: number, slot: number): Rgb {
  return material.variants[variant]?.[slot] ?? material.variants[0]?.[slot] ?? [0, 0, 0];
}

function resolvedSlotColor(state: MockState, material: ShaderMaterial, slot: number): string {
  const key = colorStudioOverrideKey(material.key, state.colorStudioVariant, slot);
  return state.colorStudioOverrides[key] ?? rgbToCss(bakedSlotRgb(material, state.colorStudioVariant, slot));
}

function materialPreviewCells(material: ShaderMaterial, colors: string[], seed: number, quality: number): string[] {
  const cells = Array.from({ length: 72 }, (_, index) => index);
  return cells.map((index) => {
    const col = index % 9;
    const row = Math.floor(index / 9);
    const jitter = (index * 17 + seed * 11 + row * 5) % 29;
    if (material.key === 'rot') {
      if (col === 0 || col === 8 || (col + seed) % 7 === 0) return colors[4] ?? '#111';
      if (jitter === 0 || jitter === 1) return colors[3] ?? '#111';
      if (row < 3) return colors[2] ?? '#777';
      return jitter % 3 === 0 ? colors[0] ?? '#333' : colors[1] ?? '#666';
    }
    if (material.key === 'stucco') {
      if ((col + seed) % 11 === 0 && row > 1) return colors[2] ?? '#f4c542';
      if (jitter < 8 + quality) return colors[1] ?? '#ddd';
      return colors[0] ?? '#333';
    }
    if (col % 4 === 0 || row % 4 === 0) return jitter < 8 ? colors[3] ?? '#092014' : '#071014';
    if ((index + seed) % (13 - Math.min(quality, 4)) === 0) return colors[2] ?? '#fff';
    return (col + row + seed) % 2 === 0 ? colors[0] ?? '#088' : colors[1] ?? '#aff';
  });
}

function slotAssistColors(material: ShaderMaterial, state: MockState): Array<{ label: string; color: string }> {
  const base = bakedSlotRgb(material, state.colorStudioVariant, Math.min(material.heroSlot, material.slots.length - 1));
  const gray = ((base[0] + base[1] + base[2]) / 3) as number;
  const warm: Rgb = [clamp01(base[0] + 0.18), clamp01(base[1] + 0.07), clamp01(base[2] * 0.78)];
  const cool: Rgb = [clamp01(base[0] * 0.76), clamp01(base[1] + 0.08), clamp01(base[2] + 0.20)];
  return [
    { label: 'shade', color: rgbToCss(mixRgb(base, [0, 0, 0], 0.42)) },
    { label: 'tint', color: rgbToCss(mixRgb(base, [1, 1, 1], 0.40)) },
    { label: 'mute', color: rgbToCss(mixRgb(base, [gray, gray, gray], 0.58)) },
    { label: 'warm', color: rgbToCss(warm) },
    { label: 'cool', color: rgbToCss(cool) },
    { label: 'comp', color: rgbToCss(complementRgb(base)) },
  ];
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
  if (isModelFolder(folder)) return null;
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

function isModelFolder(folder: ContentFolderId): boolean {
  return folder === 'models' ||
    folder === 'models-props' ||
    folder === 'models-props-wip' ||
    MODEL_PACKAGES.some((model) => model.folderId === folder);
}

function modelPackagesForFolder(folder: ContentFolderId, search: string): ModelPackage[] {
  const needle = search.trim().toLowerCase();
  return MODEL_PACKAGES
    .filter((model) => {
      if (folder === 'models') return true;
      if (folder === 'models-props') return model.kind === 'prop';
      if (folder === 'models-props-wip') return model.stage === 'wip';
      return model.folderId === folder;
    })
    .filter((model) => {
      if (!needle) return true;
      const haystack = [
        model.name,
        model.path,
        model.source,
        model.rig,
        model.data,
        ...model.decompositions,
        ...model.atlases.map((atlas) => `${atlas.label} ${atlas.scope}`),
        ...model.paints.map((paint) => `${paint.name} ${paint.atlas} ${paint.shaderRefs.join(' ')} ${paint.imageRefs.join(' ')}`),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
}

function exactModelForFolder(folder: ContentFolderId): ModelPackage | null {
  return MODEL_PACKAGES.find((model) => model.folderId === folder) ?? null;
}

function assetMatchesContentFolder(asset: Asset, folder: ContentFolderId): boolean {
  if (isModelFolder(folder)) return false;
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
  if (folder === 'game') return assets.length + MODEL_PACKAGE_COUNT;
  if (isModelFolder(folder)) return modelPackagesForFolder(folder, '').length;
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
    colorStudioMaterial: 'rot',
    colorStudioVariant: 1,
    colorStudioSeed: 4,
    colorStudioQuality: 3,
    colorStudioActiveSlot: 2,
    colorStudioOverrides: {},
    buildDialogOpen: false,
    threads: BUILD_THREADS,
    journalAttachRequest: null,
    journalThreadQuery: '',
    journalRenameThreadId: null,
    journalThreadDraft: '',
    journalCaptureForThread: null,
    eventbusPopoverOpen: false,
    fileExplorerOpen: false,
    fileExplorerQuery: '',
    fileExplorerFolder: 'imports-models',
    fileExplorerExpanded: { workspace: true, imports: true, 'imports-models': true, mock: true, 'hmsc-int': true, 'hmsc-int-game': true, runtime: true },
    fileExplorerSelectedId: 'desk-glb',
    fileExplorerHistory: INITIAL_EXPLORER_HISTORY,
    fileExplorerDirectoryHistory: INITIAL_EXPLORER_DIRECTORY_HISTORY,
    selectedObjectId: 'obj-tile',
    contentFolder: 'model-vase',
    expandedFolders: { game: true, models: true, 'models-props': true, missions: true, bankheist: true, materials: true, architecture: true },
    search: '',
    surfacePreset: 'default',
    snapIndex: 0,
    floorIndex: 1,
    viewMode: '3D',
    rightPane: 'inspector',
    contextOpen: true,
    status: `eventbus idle - ${MODEL_PACKAGE_COUNT} model homes + ${MATERIAL_ASSET_COUNT} global materials indexed`,
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
      } else if (command.id === 'open-color-studio') {
        next = { ...next, materialFocused: true, contextOpen: false, openMenu: null };
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

  const selectColorStudioMaterial = (materialKey: ColorStudioMaterialKey) => {
    setState((prev) => {
      const material = SHADER_MATERIALS[materialKey];
      return {
        ...prev,
        colorStudioMaterial: materialKey,
        colorStudioVariant: 0,
        colorStudioActiveSlot: material.heroSlot,
        status: `Color Studio material: ${material.name} - hero slot selected`,
      };
    });
  };

  const setColorStudioVariant = (variant: number) => {
    setState((prev) => {
      const material = colorStudioMaterial(prev);
      return {
        ...prev,
        colorStudioVariant: variant,
        colorStudioActiveSlot: Math.min(prev.colorStudioActiveSlot, material.slots.length - 1),
        status: `Color Studio variant v${variant}: ${material.name}`,
      };
    });
  };

  const rollColorStudioSeed = () => {
    setState((prev) => {
      const nextSeed = ((prev.colorStudioSeed * 37 + 19) % 97) + 1;
      return {
        ...prev,
        colorStudioSeed: nextSeed,
        status: `Color Studio seed rolled: ${nextSeed}`,
      };
    });
  };

  const setColorStudioQuality = (quality: number) => {
    setState((prev) => ({
      ...prev,
      colorStudioQuality: quality,
      status: `Color Studio quality D[3]: ${QUALITY_LABELS[quality] ?? quality}`,
    }));
  };

  const activateColorStudioSlot = (slot: number) => {
    setState((prev) => {
      const material = colorStudioMaterial(prev);
      const slotName = material.slots[slot]?.name ?? 'slot';
      return {
        ...prev,
        colorStudioActiveSlot: slot,
        status: `Color Studio active slot: ${material.name} / ${slotName}`,
      };
    });
  };

  const fillColorStudioSlot = (color: string, source: string) => {
    setState((prev) => {
      const material = colorStudioMaterial(prev);
      const slot = Math.min(prev.colorStudioActiveSlot, material.slots.length - 1);
      const slotName = material.slots[slot]?.name ?? 'slot';
      const key = colorStudioOverrideKey(material.key, prev.colorStudioVariant, slot);
      return {
        ...prev,
        colorStudioOverrides: { ...prev.colorStudioOverrides, [key]: color },
        history: [
          { id: `h-${prev.seq}`, verb: 'slot', target: `${material.name} ${slotName}`, meta: `${source} -> ${color}`, undoable: true, ...editTimingFor(prev.seq, 'paint-material') },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `filled ${material.name} ${slotName} from ${source}`,
      };
    });
  };

  const resetColorStudioSlots = () => {
    setState((prev) => {
      const material = colorStudioMaterial(prev);
      const nextOverrides = { ...prev.colorStudioOverrides };
      material.slots.forEach((_, slot) => delete nextOverrides[colorStudioOverrideKey(material.key, prev.colorStudioVariant, slot)]);
      return {
        ...prev,
        colorStudioOverrides: nextOverrides,
        history: [
          { id: `h-${prev.seq}`, verb: 'reset', target: `${material.name} v${prev.colorStudioVariant}`, meta: 'Color Studio reset to baked vec3f defaults', undoable: true, ...editTimingFor(prev.seq, 'paint-material') },
          ...prev.history,
        ].slice(0, 8),
        redo: [],
        seq: prev.seq + 1,
        status: `reset ${material.name} v${prev.colorStudioVariant} to baked defaults`,
      };
    });
  };

  const openThreadAttach = (request: string) =>
    setState((prev) => ({ ...prev, journalAttachRequest: request, journalThreadQuery: '', journalCaptureForThread: null, status: `attach ${request} to a thread` }));

  const cancelThreadAttach = () =>
    setState((prev) => ({ ...prev, journalAttachRequest: null, journalThreadQuery: '', status: 'thread attach cancelled' }));

  const setThreadQuery = (journalThreadQuery: string) =>
    setState((prev) => ({ ...prev, journalThreadQuery }));

  const attachDeliveryToThread = (threadId: string) =>
    setState((prev) => {
      const request = prev.journalAttachRequest;
      if (!request) return prev;
      const threads = prev.threads.map((thread) => {
        const without = thread.deliveries.filter((delivery) => delivery !== request);
        if (thread.id === threadId) return { ...thread, deliveries: [request, ...without] };
        return without.length === thread.deliveries.length ? thread : { ...thread, deliveries: without };
      });
      const target = threads.find((thread) => thread.id === threadId);
      return { ...prev, threads, journalAttachRequest: null, journalThreadQuery: '', status: `attached ${request} to "${target?.title ?? threadId}"` };
    });

  const createThreadFromDelivery = () =>
    setState((prev) => {
      const request = prev.journalAttachRequest;
      if (!request) return prev;
      const note = buildNoteByRequest(request);
      const name = prev.journalThreadQuery.trim() || note?.title || request;
      const id = `thread-${request}`;
      const cleaned = prev.threads.map((thread) => ({ ...thread, deliveries: thread.deliveries.filter((delivery) => delivery !== request) }));
      const opened: BuildThread = {
        id,
        title: name,
        status: 'active',
        aliases: [],
        tags: note ? note.trace.slice(0, 3) : [],
        deliveries: [request],
        captures: [],
        history: [`opened from ${request}${note ? ` (${note.build})` : ''}`, 'future repeats attach here instead of a fresh card'],
      };
      return { ...prev, threads: [opened, ...cleaned], journalAttachRequest: null, journalThreadQuery: '', status: `opened thread "${name}" from ${request}` };
    });

  const detachDelivery = (threadId: string, request: string) =>
    setState((prev) => ({
      ...prev,
      threads: prev.threads.map((thread) => (thread.id === threadId ? { ...thread, deliveries: thread.deliveries.filter((delivery) => delivery !== request) } : thread)),
      status: `detached ${request} from thread`,
    }));

  const startRenameThread = (threadId: string) =>
    setState((prev) => {
      const thread = prev.threads.find((item) => item.id === threadId);
      return { ...prev, journalRenameThreadId: threadId, journalThreadDraft: thread?.title ?? '', status: `rename "${thread?.title ?? threadId}"` };
    });

  const setThreadDraft = (journalThreadDraft: string) =>
    setState((prev) => ({ ...prev, journalThreadDraft }));

  const commitRenameThread = () =>
    setState((prev) => {
      const id = prev.journalRenameThreadId;
      if (!id) return prev;
      const draft = prev.journalThreadDraft.trim();
      const threads = prev.threads.map((thread) => {
        if (thread.id !== id || !draft || draft === thread.title) return thread;
        const aliases = thread.aliases.includes(thread.title) ? thread.aliases : [thread.title, ...thread.aliases];
        return { ...thread, title: draft, aliases };
      });
      const renamed = threads.find((thread) => thread.id === id);
      return { ...prev, threads, journalRenameThreadId: null, journalThreadDraft: '', status: `named "${renamed?.title ?? draft}" - links stay on ${id}` };
    });

  const beginCaptureAttach = (threadId: string) =>
    setState((prev) => ({ ...prev, journalCaptureForThread: prev.journalCaptureForThread === threadId ? null : threadId, status: 'attach a diagnostic capture' }));

  const attachCaptureToThread = (threadId: string, captureId: string) =>
    setState((prev) => {
      const capture = CAPTURE_POOL.find((item) => item.id === captureId);
      if (!capture) return prev;
      return {
        ...prev,
        threads: prev.threads.map((thread) => (thread.id === threadId ? { ...thread, captures: [capture, ...thread.captures.filter((item) => item.id !== captureId)] } : thread)),
        journalCaptureForThread: null,
        status: `attached capture "${capture.name}"`,
      };
    });

  const copyCapture = (capture: ThreadCapture) =>
    setState((prev) => ({ ...prev, status: `copied "${capture.name}" feed (${capture.channels.length} channels) to clipboard` }));

  const closeBuildJournal = () =>
    setState((prev) => ({ ...prev, buildDialogOpen: false, eventbusPopoverOpen: false, journalAttachRequest: null, journalThreadQuery: '', journalRenameThreadId: null, journalThreadDraft: '', journalCaptureForThread: null, status: 'build journal closed' }));

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
          onSelectColorStudioMaterial={selectColorStudioMaterial}
          onColorStudioVariant={setColorStudioVariant}
          onColorStudioSeed={rollColorStudioSeed}
          onColorStudioQuality={setColorStudioQuality}
          onColorStudioSlot={activateColorStudioSlot}
          onColorStudioFill={fillColorStudioSlot}
          onColorStudioReset={resetColorStudioSlots}
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
        <BuildJournalDialog
          threads={state.threads}
          attachRequest={state.journalAttachRequest}
          threadQuery={state.journalThreadQuery}
          renameThreadId={state.journalRenameThreadId}
          threadDraft={state.journalThreadDraft}
          captureForThread={state.journalCaptureForThread}
          onClose={closeBuildJournal}
          onAttachOpen={openThreadAttach}
          onAttachCancel={cancelThreadAttach}
          onThreadQuery={setThreadQuery}
          onAttachToThread={attachDeliveryToThread}
          onCreateThread={createThreadFromDelivery}
          onDetach={detachDelivery}
          onRenameStart={startRenameThread}
          onThreadDraft={setThreadDraft}
          onRenameCommit={commitRenameThread}
          onCaptureAttachBegin={beginCaptureAttach}
          onCaptureAttach={attachCaptureToThread}
          onCaptureCopy={copyCapture}
        />
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
        <C.HW_BrandText>SHITTY GAMES</C.HW_BrandText>
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
        <C.HW_DockLabel>{state.threads.length} threads</C.HW_DockLabel>
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

type JournalDialogProps = {
  threads: BuildThread[];
  attachRequest: string | null;
  threadQuery: string;
  renameThreadId: string | null;
  threadDraft: string;
  captureForThread: string | null;
  onClose: () => void;
  onAttachOpen: (request: string) => void;
  onAttachCancel: () => void;
  onThreadQuery: (query: string) => void;
  onAttachToThread: (threadId: string) => void;
  onCreateThread: () => void;
  onDetach: (threadId: string, request: string) => void;
  onRenameStart: (threadId: string) => void;
  onThreadDraft: (text: string) => void;
  onRenameCommit: () => void;
  onCaptureAttachBegin: (threadId: string) => void;
  onCaptureAttach: (threadId: string, captureId: string) => void;
  onCaptureCopy: (capture: ThreadCapture) => void;
};

function BuildJournalDialog(props: JournalDialogProps) {
  const attached = props.threads.reduce((count, thread) => count + thread.deliveries.length, 0);
  return (
    <C.HW_DialogScrim>
      <C.HW_BuildDialog>
        <C.HW_DialogHead>
          <Icon name="FileClock" size={15} color={accentFor('primary')} />
          <C.HW_HeadTitle>Build Journal</C.HW_HeadTitle>
          <C.HW_PillOn><C.HW_PillTextOn>{ACTIVE_BUILD.build}</C.HW_PillTextOn></C.HW_PillOn>
          <C.HW_Spacer />
          <C.HW_Pill onPress={props.onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
        </C.HW_DialogHead>
        <C.HW_DialogBody>
          <C.HW_JournalIntro>
            <C.HW_HeadTitle>Deliveries roll into ongoing threads</C.HW_HeadTitle>
            <C.HW_StatusText>{BUILD_NOTES.length} build notes, {attached} attached to {props.threads.length} threads. Send a delivery to a remembered thread so a recurring bug keeps its history instead of fresh isolated cards.</C.HW_StatusText>
          </C.HW_JournalIntro>
          <C.HW_JournalLayout>
            <C.HW_JournalColumn>
              <C.HW_GroupTitle>
                <Icon name="ListChecks" size={12} color={accentFor('primary')} />
                <C.HW_GroupText>RECENT DELIVERIES</C.HW_GroupText>
              </C.HW_GroupTitle>
              {BUILD_NOTES.map((note) => (
                <JournalDeliveryCard
                  key={note.request}
                  note={note}
                  thread={threadForRequest(props.threads, note.request)}
                  active={props.attachRequest === note.request}
                  onAttachOpen={props.onAttachOpen}
                />
              ))}
            </C.HW_JournalColumn>
            {props.attachRequest ? (
              <ThreadAttachPanel props={props} request={props.attachRequest} />
            ) : (
              <C.HW_JournalColumn>
                <C.HW_GroupTitle>
                  <Icon name="Bug" size={12} color={accentFor('warning')} />
                  <C.HW_GroupText>ONGOING THREADS</C.HW_GroupText>
                </C.HW_GroupTitle>
                {props.threads.map((thread) => (
                  <ThreadCard key={thread.id} thread={thread} props={props} />
                ))}
              </C.HW_JournalColumn>
            )}
          </C.HW_JournalLayout>
        </C.HW_DialogBody>
      </C.HW_BuildDialog>
    </C.HW_DialogScrim>
  );
}

function JournalDeliveryCard({ note, thread, active, onAttachOpen }: { note: BuildNote; thread: BuildThread | undefined; active: boolean; onAttachOpen: (request: string) => void }) {
  const Card = active ? C.HW_BuildNoteCardOn : C.HW_BuildNoteCard;
  return (
    <Card>
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
      <C.HW_BuildNoteFoot>
        {thread ? (
          <>
            <Icon name="GitMerge" size={11} color={accentFor('primary')} />
            <C.HW_KeyText>{thread.title}</C.HW_KeyText>
            <C.HW_Spacer />
            <C.HW_MiniBtn onPress={() => onAttachOpen(note.request)}><C.HW_MiniText>move thread</C.HW_MiniText></C.HW_MiniBtn>
          </>
        ) : (
          <>
            <Icon name="GitBranchPlus" size={11} color={accentFor('textDim')} />
            <C.HW_KeyText>no thread</C.HW_KeyText>
            <C.HW_Spacer />
            <C.HW_MiniBtnOn onPress={() => onAttachOpen(note.request)}><C.HW_MiniTextOn>thread it</C.HW_MiniTextOn></C.HW_MiniBtnOn>
          </>
        )}
      </C.HW_BuildNoteFoot>
    </Card>
  );
}

function ThreadAttachPanel({ props, request }: { props: JournalDialogProps; request: string }) {
  const note = buildNoteByRequest(request);
  const matched = matchThreads(props.threads, props.threadQuery);
  const newName = props.threadQuery.trim() || note?.title || request;
  return (
    <C.HW_AttachPanel>
      <C.HW_GroupTitle>
        <Icon name="GitBranchPlus" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>SEND {request} TO A THREAD</C.HW_GroupText>
        <C.HW_Spacer />
        <C.HW_MiniBtn onPress={props.onAttachCancel}><C.HW_MiniText>cancel</C.HW_MiniText></C.HW_MiniBtn>
      </C.HW_GroupTitle>
      <C.HW_StatusText>Type a remembered name. Pick an ongoing thread to inherit its history, or open a new one.</C.HW_StatusText>
      <C.HW_FileSearch placeholder="search threads by name, alias, tag..." value={props.threadQuery} onChange={props.onThreadQuery} />
      <C.HW_CreateThreadBtn onPress={props.onCreateThread}>
        <Icon name="Plus" size={12} color={accentFor('primary')} />
        <C.HW_HistoryMeta>open new thread "{newName}"</C.HW_HistoryMeta>
      </C.HW_CreateThreadBtn>
      <C.HW_AttachResults>
        {matched.map((thread) => (
          <C.HW_AttachRow key={thread.id} onPress={() => props.onAttachToThread(thread.id)}>
            <C.HW_AccentBar style={{ backgroundColor: accentFor(threadStatusAccent(thread.status)) }} />
            <C.HW_AttachMain>
              <C.HW_HistoryTitle>{thread.title}</C.HW_HistoryTitle>
              <C.HW_HistoryMeta>{thread.deliveries.length} deliveries · {thread.captures.length} captures · {thread.tags.join(' ')}</C.HW_HistoryMeta>
            </C.HW_AttachMain>
            <C.HW_DockLabel>{thread.status}</C.HW_DockLabel>
          </C.HW_AttachRow>
        ))}
        {matched.length === 0 ? <C.HW_HistoryMeta>no thread matches "{props.threadQuery}" - open a new one above</C.HW_HistoryMeta> : null}
      </C.HW_AttachResults>
    </C.HW_AttachPanel>
  );
}

function ThreadCard({ thread, props }: { thread: BuildThread; props: JournalDialogProps }) {
  const renaming = props.renameThreadId === thread.id;
  const accent = threadStatusAccent(thread.status);
  const pickingCapture = props.captureForThread === thread.id;
  const available = unattachedCaptures(props.threads);
  return (
    <C.HW_ThreadCard>
      <C.HW_BuildNoteHead>
        {renaming ? (
          <C.HW_ThreadNameInput placeholder="semantic name" value={props.threadDraft} onChange={props.onThreadDraft} />
        ) : (
          <C.HW_HistoryTitle>{thread.title}</C.HW_HistoryTitle>
        )}
        <C.HW_Spacer />
        {renaming ? (
          <C.HW_MiniBtnOn onPress={props.onRenameCommit}><C.HW_MiniTextOn>save</C.HW_MiniTextOn></C.HW_MiniBtnOn>
        ) : (
          <C.HW_MiniBtn onPress={() => props.onRenameStart(thread.id)}><C.HW_MiniText>rename</C.HW_MiniText></C.HW_MiniBtn>
        )}
        <C.HW_DockLabel>{thread.status}</C.HW_DockLabel>
      </C.HW_BuildNoteHead>
      <C.HW_ThreadIdRow>
        <C.HW_KeyText>{thread.id}</C.HW_KeyText>
        {thread.aliases.map((alias) => <C.HW_AliasChip key={alias}><C.HW_KeyText>aka {alias}</C.HW_KeyText></C.HW_AliasChip>)}
      </C.HW_ThreadIdRow>
      {thread.tags.length > 0 ? (
        <C.HW_TraceRow>
          {thread.tags.map((tag) => <C.HW_TraceChip key={tag}><C.HW_KeyText>{tag}</C.HW_KeyText></C.HW_TraceChip>)}
        </C.HW_TraceRow>
      ) : null}
      {thread.deliveries.map((request) => {
        const note = buildNoteByRequest(request);
        return (
          <C.HW_ThreadDelivery key={request}>
            <Icon name="GitCommitHorizontal" size={11} color={accentFor('primary')} />
            <C.HW_ThreadDeliveryMain>
              <C.HW_ReadValue>{note?.build ?? request} · {note?.title ?? request}</C.HW_ReadValue>
              <C.HW_HistoryMeta>{request}{note ? ` · ${note.agent}` : ''}</C.HW_HistoryMeta>
            </C.HW_ThreadDeliveryMain>
            <C.HW_MiniBtn onPress={() => props.onDetach(thread.id, request)}><C.HW_MiniText>detach</C.HW_MiniText></C.HW_MiniBtn>
          </C.HW_ThreadDelivery>
        );
      })}
      {thread.history.map((item) => (
        <C.HW_ReadRow key={item}>
          <C.HW_AccentBar style={{ backgroundColor: accentFor(accent) }} />
          <C.HW_ReadValue>{item}</C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
      {thread.captures.map((capture) => (
        <C.HW_CaptureRow key={capture.id}>
          <Icon name="FileText" size={11} color={accentFor('warning')} />
          <C.HW_CaptureMain>
            <C.HW_ReadValue>{capture.name}</C.HW_ReadValue>
            <C.HW_HistoryMeta>{capture.channels.join(', ')} · {capture.range} · {capture.build} · {capture.context}</C.HW_HistoryMeta>
          </C.HW_CaptureMain>
          <C.HW_MiniBtn onPress={() => props.onCaptureCopy(capture)}><C.HW_MiniText>copy</C.HW_MiniText></C.HW_MiniBtn>
        </C.HW_CaptureRow>
      ))}
      {pickingCapture ? (
        <C.HW_CaptureAttach>
          {available.map((capture) => (
            <C.HW_AttachRow key={capture.id} onPress={() => props.onCaptureAttach(thread.id, capture.id)}>
              <Icon name="Paperclip" size={11} color={accentFor('primary')} />
              <C.HW_AttachMain>
                <C.HW_ReadValue>{capture.name}</C.HW_ReadValue>
                <C.HW_HistoryMeta>{capture.channels.join(', ')} · {capture.build}</C.HW_HistoryMeta>
              </C.HW_AttachMain>
            </C.HW_AttachRow>
          ))}
          {available.length === 0 ? <C.HW_HistoryMeta>no unattached captures in the console feed</C.HW_HistoryMeta> : null}
        </C.HW_CaptureAttach>
      ) : (
        <C.HW_CaptureAttachBtn onPress={() => props.onCaptureAttachBegin(thread.id)}>
          <Icon name="Paperclip" size={11} color={accentFor('textDim')} />
          <C.HW_MiniText>attach diagnostic capture</C.HW_MiniText>
        </C.HW_CaptureAttachBtn>
      )}
    </C.HW_ThreadCard>
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
  const showModelPackages = isModelFolder(props.contentFolder);
  const showMaterialCatalog = isMaterialFolder(props.contentFolder);
  const canBrowseAssets = showMaterialCatalog || Boolean(folderTab);
  const selectedFolderCount = countAssetsForFolder(props.catalogAssets, props.contentFolder);
  return (
    <C.HW_SidePanel>
      <C.HW_PanelHead>
        <Icon name="FolderOpen" size={13} color={accentFor('primary')} />
        <C.HW_Kicker>CONTENT BROWSER</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_StatusText>{MODEL_PACKAGE_COUNT} models · {MATERIAL_ASSET_COUNT} materials</C.HW_StatusText>
      </C.HW_PanelHead>
      <C.HW_Search placeholder="search models, paints, materials..." value={props.state.search} onChange={props.onSearch} />
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
      {showModelPackages ? (
        <ModelPackageBrowser
          folder={props.contentFolder}
          search={props.state.search}
          onFolder={props.onFolder}
          onAction={props.onMaterialAction}
        />
      ) : showMaterialCatalog ? (
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

function ModelPackageBrowser({
  folder,
  search,
  onFolder,
  onAction,
}: {
  folder: ContentFolderId;
  search: string;
  onFolder: (folder: ContentFolderId) => void;
  onAction: (label: string) => void;
}) {
  const exactModel = exactModelForFolder(folder);
  const models = modelPackagesForFolder(folder, search);
  if (exactModel) {
    return <ModelPackageDetail model={exactModel} onAction={onAction} />;
  }
  return (
    <C.HW_ModelBrowser>
      <C.HW_GroupTitle>
        <Icon name="Box" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>MODEL HOMES</C.HW_GroupText>
        <C.HW_Spacer />
        <C.HW_StatusText>{models.length} folders</C.HW_StatusText>
      </C.HW_GroupTitle>
      {models.length === 0 ? (
        <C.HW_EmptyState>
          <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
          <C.HW_StatusText>no model homes</C.HW_StatusText>
        </C.HW_EmptyState>
      ) : models.map((model) => (
        <C.HW_ModelCard key={model.id} onPress={() => onFolder(model.folderId)}>
          <C.HW_ModelThumb style={{ backgroundColor: model.color }} />
          <C.HW_ModelCardMain>
            <C.HW_MaterialTitleRow>
              <C.HW_MaterialName>{model.name}</C.HW_MaterialName>
              <C.HW_Spacer />
              <C.HW_MaterialStat>{model.stage}</C.HW_MaterialStat>
            </C.HW_MaterialTitleRow>
            <C.HW_ModelPath>{model.path}</C.HW_ModelPath>
            <C.HW_ModelMetaRow>
              <C.HW_MaterialStat>{model.atlases.length} atlases</C.HW_MaterialStat>
              <C.HW_MaterialStat>{model.paints.length} paints</C.HW_MaterialStat>
              <C.HW_MaterialStat>{model.decompositions.length} decomps</C.HW_MaterialStat>
            </C.HW_ModelMetaRow>
          </C.HW_ModelCardMain>
          <C.HW_IconMiniButton onPress={() => onAction(`open model home ${model.name}`)}>
            <Icon name="FolderOpen" size={13} color={accentFor('primary')} />
          </C.HW_IconMiniButton>
        </C.HW_ModelCard>
      ))}
      {Array.from({ length: Math.max(0, 4 - models.length) }, (_, index) => (
        <C.HW_MaterialSlotEmpty key={`model-empty-${index}`}>
          <C.HW_StatusText>empty model slot</C.HW_StatusText>
        </C.HW_MaterialSlotEmpty>
      ))}
    </C.HW_ModelBrowser>
  );
}

function ModelPackageDetail({ model, onAction }: { model: ModelPackage; onAction: (label: string) => void }) {
  return (
    <C.HW_ModelBrowser>
      <C.HW_ModelHomePanel>
        <C.HW_ModelTop>
          <C.HW_ModelThumb style={{ backgroundColor: model.color }} />
          <C.HW_ModelCardMain>
            <C.HW_MaterialTitleRow>
              <C.HW_MaterialName>{model.name}</C.HW_MaterialName>
              <C.HW_Spacer />
              <C.HW_MaterialStat>{model.stage}</C.HW_MaterialStat>
            </C.HW_MaterialTitleRow>
            <C.HW_ModelPath>{model.path}</C.HW_ModelPath>
            <C.HW_ModelMetaRow>
              <C.HW_MaterialStat>{model.triangles.toLocaleString()} tris</C.HW_MaterialStat>
              <C.HW_MaterialStat>{model.lods} LoD</C.HW_MaterialStat>
              <C.HW_MaterialStat>{model.paints.reduce((sum, paint) => sum + paint.used, 0)} uses</C.HW_MaterialStat>
            </C.HW_ModelMetaRow>
          </C.HW_ModelCardMain>
        </C.HW_ModelTop>

        <C.HW_ModelSection>
          <C.HW_ModelSectionHead>
            <Icon name="PackageCheck" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>FOLDER CONTRACT</C.HW_GroupText>
          </C.HW_ModelSectionHead>
          {[
            ['source model', model.source],
            ['rig data', model.rig],
            ['manifest', model.data],
          ].map(([label, value]) => (
            <C.HW_ModelDataRow key={label} onPress={() => onAction(`${model.name} ${label}`)}>
              <C.HW_ToolLabel>{label}</C.HW_ToolLabel>
              <C.HW_ToolValue>{value}</C.HW_ToolValue>
            </C.HW_ModelDataRow>
          ))}
        </C.HW_ModelSection>

        <C.HW_ModelSection>
          <C.HW_ModelSectionHead>
            <Icon name="Layers" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>ATLAS SETS</C.HW_GroupText>
          </C.HW_ModelSectionHead>
          {model.atlases.map((atlas) => (
            <C.HW_ModelAtlasCard key={atlas.id} onPress={() => onAction(`${model.name} ${atlas.label}`)}>
              <C.HW_VariantSwatch style={{ backgroundColor: atlas.color }} />
              <C.HW_ModelCardMain>
                <C.HW_MaterialTitleRow>
                  <C.HW_ToolValue>{atlas.label}</C.HW_ToolValue>
                  <C.HW_Spacer />
                  <C.HW_MaterialStat>{atlas.resolution}px</C.HW_MaterialStat>
                </C.HW_MaterialTitleRow>
                <C.HW_ModelMetaRow>
                  <C.HW_MaterialStat>{atlas.scope}</C.HW_MaterialStat>
                  <C.HW_MaterialStat>{atlas.paints} paints</C.HW_MaterialStat>
                </C.HW_ModelMetaRow>
              </C.HW_ModelCardMain>
            </C.HW_ModelAtlasCard>
          ))}
        </C.HW_ModelSection>

        <C.HW_ModelSection>
          <C.HW_ModelSectionHead>
            <Icon name="Brush" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>PAINT VARIANTS</C.HW_GroupText>
          </C.HW_ModelSectionHead>
          <C.HW_ModelPaintGrid>
            {model.paints.map((paint) => (
              <C.HW_ModelPaintCard key={paint.id} onPress={() => onAction(`${model.name} paint ${paint.name}`)}>
                <C.HW_SelectedVariantSwatch style={{ backgroundColor: paint.color }} />
                <C.HW_ToolValue>{paint.name}</C.HW_ToolValue>
                <C.HW_ToolHint>{paint.atlas}</C.HW_ToolHint>
              </C.HW_ModelPaintCard>
            ))}
          </C.HW_ModelPaintGrid>
        </C.HW_ModelSection>

        <C.HW_ModelSection>
          <C.HW_ModelSectionHead>
            <Icon name="Workflow" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>CAPTURED REFERENCES</C.HW_GroupText>
          </C.HW_ModelSectionHead>
          <C.HW_ChipRow>
            {Array.from(new Set(model.paints.flatMap((paint) => [...paint.shaderRefs, ...paint.imageRefs]))).map((ref) => (
              <C.HW_TraceChip key={ref} onPress={() => onAction(`${model.name} reference ${ref}`)}>
                <C.HW_MaterialStat>{ref}</C.HW_MaterialStat>
              </C.HW_TraceChip>
            ))}
          </C.HW_ChipRow>
        </C.HW_ModelSection>

        <C.HW_ButtonRow>
          <C.HW_SmallButton onPress={() => onAction(`open painter for ${model.name}`)}><C.HW_FormValue>paint model</C.HW_FormValue></C.HW_SmallButton>
          <C.HW_SmallButton onPress={() => onAction(`save new variant for ${model.name}`)}><C.HW_FormValue>save variant</C.HW_FormValue></C.HW_SmallButton>
        </C.HW_ButtonRow>
      </C.HW_ModelHomePanel>
    </C.HW_ModelBrowser>
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
  onSelectColorStudioMaterial: (material: ColorStudioMaterialKey) => void;
  onColorStudioVariant: (variant: number) => void;
  onColorStudioSeed: () => void;
  onColorStudioQuality: (quality: number) => void;
  onColorStudioSlot: (slot: number) => void;
  onColorStudioFill: (color: string, source: string) => void;
  onColorStudioReset: () => void;
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
  onSelectColorStudioMaterial: (material: ColorStudioMaterialKey) => void;
  onColorStudioVariant: (variant: number) => void;
  onColorStudioSeed: () => void;
  onColorStudioQuality: (quality: number) => void;
  onColorStudioSlot: (slot: number) => void;
  onColorStudioFill: (color: string, source: string) => void;
  onColorStudioReset: () => void;
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
          onSelectMaterial={props.onSelectColorStudioMaterial}
          onVariant={props.onColorStudioVariant}
          onSeed={props.onColorStudioSeed}
          onQuality={props.onColorStudioQuality}
          onSlot={props.onColorStudioSlot}
          onFill={props.onColorStudioFill}
          onReset={props.onColorStudioReset}
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
  onSelectMaterial: (material: ColorStudioMaterialKey) => void;
  onVariant: (variant: number) => void;
  onSeed: () => void;
  onQuality: (quality: number) => void;
  onSlot: (slot: number) => void;
  onFill: (color: string, source: string) => void;
  onReset: () => void;
}) {
  const material = colorStudioMaterial(props.state);
  const materialKeys = Object.keys(SHADER_MATERIALS) as ColorStudioMaterialKey[];
  const slotColors = material.slots.map((slot, index) => ({
    slot,
    index,
    color: resolvedSlotColor(props.state, material, index),
    baked: bakedSlotRgb(material, props.state.colorStudioVariant, index),
    active: index === props.state.colorStudioActiveSlot,
  }));
  const previewCells = materialPreviewCells(material, slotColors.map((slot) => slot.color), props.state.colorStudioSeed, props.state.colorStudioQuality);
  const activeSlot = slotColors[Math.min(props.state.colorStudioActiveSlot, slotColors.length - 1)] ?? slotColors[0]!;
  const activeOverrideKey = colorStudioOverrideKey(material.key, props.state.colorStudioVariant, activeSlot.index);
  const hasOverride = props.state.colorStudioOverrides[activeOverrideKey] !== undefined;
  const assistColors = slotAssistColors(material, props.state);
  const dDescriptor = `[${material.materialId}, ${props.state.colorStudioVariant}, ${props.state.colorStudioSeed}, ${props.state.colorStudioQuality}, ${material.board.split(' ')[0]}]`;

  return (
    <C.HW_MaterialFocus>
      <C.HW_FocusHeader>
        <Icon name="Palette" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Color Studio</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>Material Palette</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{material.shaderFn}</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill><C.HW_PillText>D {dDescriptor}</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={() => props.onAction(`save ${material.name} palette variant`)}><C.HW_PillText>save variant</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill onPress={props.onExit}><C.HW_PillText>return to world</C.HW_PillText></C.HW_Pill>
      </C.HW_FocusHeader>
      <C.HW_ColorStudioShell>
        <C.HW_ColorMaterialStrip>
          {materialKeys.map((key) => {
            const option = SHADER_MATERIALS[key];
            const Card = key === material.key ? C.HW_ColorMaterialCardOn : C.HW_ColorMaterialCard;
            const first = option.variants[0]!;
            return (
              <Card key={key} onPress={() => props.onSelectMaterial(key)}>
                <C.HW_ColorMaterialMini>
                  {first.slice(0, 4).map((rgb, index) => (
                    <C.HW_ColorMiniBand key={index} style={{ backgroundColor: rgbToCss(rgb) }} />
                  ))}
                </C.HW_ColorMaterialMini>
                <C.HW_ColorMaterialText>
                  <C.HW_FormValue>{option.name}</C.HW_FormValue>
                  <C.HW_KeyText>{option.board} - {option.shaderFn}</C.HW_KeyText>
                </C.HW_ColorMaterialText>
                <C.HW_Spacer />
                <C.HW_PillText>{option.slots.length} slots</C.HW_PillText>
              </Card>
            );
          })}
        </C.HW_ColorMaterialStrip>
        <C.HW_ColorStudioBody>
          <C.HW_ColorPreviewPanel>
            <C.HW_ColorPreviewHead>
              <Icon name="SwatchBook" size={13} color={accentFor('primary')} />
              <C.HW_HeadTitle>{material.name}</C.HW_HeadTitle>
              <C.HW_PillOn><C.HW_PillTextOn>{material.board}</C.HW_PillTextOn></C.HW_PillOn>
              <C.HW_Pill><C.HW_PillText>opened from {props.activeAsset.name}</C.HW_PillText></C.HW_Pill>
              <C.HW_Spacer />
              <C.HW_StatusText>{hasOverride ? 'override active' : 'baked defaults'}</C.HW_StatusText>
            </C.HW_ColorPreviewHead>
            <C.HW_ColorPreviewGrid>
              {previewCells.map((color, index) => (
                <C.HW_ColorPreviewCell
                  key={index}
                  style={{
                    backgroundColor: color,
                    borderColor: props.state.colorStudioQuality <= 1 ? accentFor('stageBg') : accentFor('borderSoft'),
                  }}
                />
              ))}
            </C.HW_ColorPreviewGrid>
            <C.HW_ColorControlRow>
              <C.HW_ColorControlGroup>
                <C.HW_KeyText>VARIANT</C.HW_KeyText>
                <C.HW_ColorSegmentTrack>
                  {[0, 1, 2].map((variant) => {
                    const Btn = variant === props.state.colorStudioVariant ? C.HW_ColorSegmentOn : C.HW_ColorSegment;
                    const Label = variant === props.state.colorStudioVariant ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
                    return <Btn key={variant} onPress={() => props.onVariant(variant)}><Label>v{variant}</Label></Btn>;
                  })}
                </C.HW_ColorSegmentTrack>
              </C.HW_ColorControlGroup>
              <C.HW_ColorControlGroup>
                <C.HW_KeyText>SEED</C.HW_KeyText>
                <C.HW_ColorSeedButton onPress={props.onSeed}>
                  <Icon name="Dices" size={12} color={accentFor('primary')} />
                  <C.HW_FormValue>{props.state.colorStudioSeed}</C.HW_FormValue>
                </C.HW_ColorSeedButton>
              </C.HW_ColorControlGroup>
              <C.HW_ColorControlGroupWide>
                <C.HW_KeyText>QUALITY - D[3]</C.HW_KeyText>
                <C.HW_ColorSegmentTrack>
                  {QUALITY_LABELS.map((label, quality) => {
                    const Btn = quality === props.state.colorStudioQuality ? C.HW_ColorSegmentOn : C.HW_ColorSegment;
                    const Label = quality === props.state.colorStudioQuality ? C.HW_ColorSegmentLabelOn : C.HW_ColorSegmentLabel;
                    return <Btn key={label} onPress={() => props.onQuality(quality)}><Label>{label}</Label></Btn>;
                  })}
                </C.HW_ColorSegmentTrack>
              </C.HW_ColorControlGroupWide>
            </C.HW_ColorControlRow>
            <C.HW_ColorSlotHead>
              <C.HW_GroupTitle>
                <Icon name="Pipette" size={12} color={accentFor('primary')} />
                <C.HW_GroupText>PALETTE SLOTS</C.HW_GroupText>
              </C.HW_GroupTitle>
              <C.HW_Spacer />
              <C.HW_Pill onPress={props.onReset}><C.HW_PillText>reset to baked</C.HW_PillText></C.HW_Pill>
            </C.HW_ColorSlotHead>
            <C.HW_ColorSlotGrid>
              {slotColors.map((entry) => {
                const Slot = entry.active ? C.HW_ColorSlotOn : C.HW_ColorSlot;
                const overrideKey = colorStudioOverrideKey(material.key, props.state.colorStudioVariant, entry.index);
                return (
                  <Slot key={entry.slot.name} onPress={() => props.onSlot(entry.index)}>
                    <C.HW_ColorSlotSwatch style={{ backgroundColor: entry.color }} />
                    <C.HW_ColorSlotText>
                      <C.HW_FormValue>{entry.slot.name}</C.HW_FormValue>
                      <C.HW_KeyText>{entry.slot.role}</C.HW_KeyText>
                    </C.HW_ColorSlotText>
                    <C.HW_Spacer />
                    <C.HW_KeyText>{props.state.colorStudioOverrides[overrideKey] ? 'owned' : 'baked'}</C.HW_KeyText>
                  </Slot>
                );
              })}
            </C.HW_ColorSlotGrid>
          </C.HW_ColorPreviewPanel>
          <C.HW_ColorAssistPanel>
            <C.HW_GroupTitle>
              <Icon name="SlidersHorizontal" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>ACTIVE SLOT</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ColorActiveSlot>
              <C.HW_ColorActiveSwatch style={{ backgroundColor: activeSlot.color }} />
              <C.HW_ColorActiveText>
                <C.HW_HeadTitle>{activeSlot.slot.name}</C.HW_HeadTitle>
                <C.HW_KeyText>{activeSlot.slot.role} - {hasOverride ? 'you own it' : 'shader default'}</C.HW_KeyText>
                <C.HW_ColorCode>was baked: {rgbToVec3(activeSlot.baked)}</C.HW_ColorCode>
              </C.HW_ColorActiveText>
            </C.HW_ColorActiveSlot>
            <C.HW_ColorReadoutGrid>
              <C.HW_PerfTile>
                <C.HW_PerfValue>{material.materialId}</C.HW_PerfValue>
                <C.HW_PerfLabel>materialId</C.HW_PerfLabel>
              </C.HW_PerfTile>
              <C.HW_PerfTile>
                <C.HW_PerfValue>{props.state.colorStudioVariant}</C.HW_PerfValue>
                <C.HW_PerfLabel>variant</C.HW_PerfLabel>
              </C.HW_PerfTile>
              <C.HW_PerfTile>
                <C.HW_PerfValue>{props.state.colorStudioSeed}</C.HW_PerfValue>
                <C.HW_PerfLabel>seed</C.HW_PerfLabel>
              </C.HW_PerfTile>
            </C.HW_ColorReadoutGrid>
            <C.HW_GroupTitle>
              <Icon name="Sparkles" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>FITS {material.name.toUpperCase()}</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ColorAssistGrid>
              {assistColors.map((entry) => (
                <C.HW_ColorAssistSwatch key={entry.label} onPress={() => props.onFill(entry.color, `fit ${entry.label}`)}>
                  <C.HW_ColorAssistChip style={{ backgroundColor: entry.color }} />
                  <C.HW_KeyText>{entry.label}</C.HW_KeyText>
                </C.HW_ColorAssistSwatch>
              ))}
            </C.HW_ColorAssistGrid>
            <C.HW_GroupTitle>
              <Icon name="Library" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>LIBRARY SLOT PULL</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ColorLibraryList>
              {COLOR_LIBRARY_SETS.map((set) => (
                <C.HW_ColorLibraryRow key={set.name}>
                  <C.HW_ColorLibraryName>
                    <C.HW_FormValue>{set.name}</C.HW_FormValue>
                    <C.HW_KeyText>{set.tag}</C.HW_KeyText>
                  </C.HW_ColorLibraryName>
                  <C.HW_ColorLibrarySwatches>
                    {set.colors.map((rgb, index) => {
                      const color = rgbToCss(rgb);
                      return <C.HW_ColorLibrarySwatch key={index} onPress={() => props.onFill(color, set.name)} style={{ backgroundColor: color }} />;
                    })}
                  </C.HW_ColorLibrarySwatches>
                </C.HW_ColorLibraryRow>
              ))}
            </C.HW_ColorLibraryList>
          </C.HW_ColorAssistPanel>
        </C.HW_ColorStudioBody>
      </C.HW_ColorStudioShell>
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
    <C.HW_MenuDropdown style={{ left: menuDropdownLeft(state.openMenu), width: MENU_DROPDOWN_WIDTH }}>
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
