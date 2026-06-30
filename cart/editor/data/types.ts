// editor/data/types.ts — shared type vocabulary for the editor workspace.
//
// Cloned from the hmsc-workspace-mock god-file (its types/data/helpers region).
// Pure type declarations; no runtime values. Component files import these.
import type {
  ExplorerDirectoryHistoryEntry,
  ExplorerFolderId,
  ExplorerHistoryEntry,
} from './fileExplorer';
import type { DecalDoc } from '../../hmsc-int/game/textures/decal';

export type Menu = 'File' | 'Edit' | 'View' | 'Map' | 'Build' | 'Story' | 'Window' | 'Help';
export type LibraryTab = 'Build' | 'Props' | 'Skins';
export type ViewMode = '3D' | '2D';
export type WorkspaceDocumentKind = 'world' | 'model' | 'material';
export type WorkspaceDocument = {
  id: string;
  kind: WorkspaceDocumentKind;
  title: string;
  subtitle?: string;
  sourceId?: string;
};
export type ContentFolderId =
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
  | 'models-build'
  | 'models-props'
  | 'models-props-wip'
  | `model-${string}`
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

export type Command = {
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

export type BuildNote = {
  request: string;
  build: string;
  title: string;
  status: string;
  agent: string;
  ask: string;
  handled: string;
  trace: string[];
};

export type BuildThread = {
  id: string;
  title: string;
  status: string;
  history: string[];
};

export type BuildJournalSnapshot = {
  activeBuild: string;
  notes: BuildNote[];
  threads: BuildThread[];
  requestCount: number;
  deliveryCount: number;
  source: string;
  loadedAt: string;
  error?: string;
};

export type Asset = {
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
  sourceKind?: 'shader-recipe' | 'shader-preset' | 'stored-material' | 'texture-file' | 'cooked-asset';
  sourceId?: string;
  sourcePath?: string;
  semanticKind?: string;
  stats?: string[];
  preview?: AssetPreview;
};

export type AssetPreview =
  | { kind: 'shader'; shader: string; data: number[] }
  | { kind: 'image'; source: string }
  | { kind: 'texture-blob'; ref: string }
  | { kind: 'decal'; doc: DecalDoc }
  | { kind: 'color'; color: string };

export type AssetOverride = {
  name?: string;
  favorite?: boolean;
};

export type MaterialSource = {
  name: string;
  color: string;
  recipe: string;
  variants: string[];
};

export type ModelAtlas = {
  id: string;
  label: string;
  scope: string;
  resolution: string;
  paints: number;
  color: string;
};

export type ModelPaintVariant = {
  id: string;
  name: string;
  atlas: string;
  used: number;
  shaderRefs: string[];
  imageRefs: string[];
  color: string;
};

export type ModelPackage = {
  id: string;
  folderId: ContentFolderId;
  name: string;
  path: string;
  kind: 'build' | 'prop' | 'character' | 'vehicle';
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
  sourceKind?: 'cooked-asset' | 'studio-model';
  semanticKind?: string;
};

export type Rgb = [number, number, number];
export type ColorStudioMaterialKey = 'rot' | 'stucco' | 'pool';

export type ShaderSlot = {
  name: string;
  role: string;
};

export type ShaderMaterial = {
  key: ColorStudioMaterialKey;
  name: string;
  shaderFn: string;
  board: string;
  materialId: number;
  heroSlot: number;
  slots: ShaderSlot[];
  variants: Rgb[][];
};

export type PaletteSet = {
  name: string;
  tag: string;
  colors: Rgb[];
};

export type ContentNode = {
  id: ContentFolderId;
  label: string;
  icon?: string;
  children?: ContentNode[];
};

export type WorldObject = {
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

export type HistoryEvent = {
  id: string;
  verb: string;
  target: string;
  meta: string;
  undoable: boolean;
  editMs?: number;
  emptyMs?: number;
  richMs?: number;
};

export type MockState = {
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
  eventbusPopoverOpen: boolean;
  perfPopoverOpen: boolean;
  memoryPopoverOpen: boolean;
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
  snapGridMeters: number;
  snapAngleDegrees: number;
  floorIndex: number;
  viewMode: ViewMode;
  workspaceDocuments: WorkspaceDocument[];
  activeWorkspaceDocumentId: string;
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
