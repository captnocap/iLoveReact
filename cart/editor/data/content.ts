// editor/data/content.ts - content tree, navigation enums, and folder helpers.
import { MODEL_PACKAGES, MODEL_PACKAGE_COUNT } from './catalog';
import { HMSC_EDITOR_CATALOG, modelCategoryNodes } from './hmscAssetCatalog';
import { commandById } from './commands';
import { INITIAL_OBJECTS } from './initialState';
import type { Asset, ContentFolderId, ContentNode, LibraryTab, EditorState, ModelOverride, ModelPackage, WorldObject } from './types';

export const DOMAINS = [
  ['world', 'Eye'],
  ['grid', 'Grid3X3'],
  ['pieces', 'Box'],
  ['actors', 'UserRound'],
  ['data', 'Table2'],
  ['pipeline', 'Workflow'],
];
export const RIGHT_PANES = [
  ['inspector', 'SlidersHorizontal'],
  ['layers', 'Layers'],
  ['grid', 'LayoutGrid'],
  ['mission', 'Flag'],
  ['routes', 'Route'],
];
export const CONTENT_TREE: ContentNode[] = HMSC_EDITOR_CATALOG.contentTree;
export const SNAP_MODES = ['surface + edge', 'grid', 'free', 'vertex'];
export const FLOORS = ['Floor 2', 'Floor 1', 'Basement'];
export const PRESETS = ['default', 'slow', 'fast', 'custom'];

export function tabForContentFolder(folder: ContentFolderId): LibraryTab | null {
  if (isModelFolder(folder)) return null;
  if (folder === 'materials' || folder === 'materials-core' || folder === 'materials-generated' || folder === 'materials-favorites' || folder === 'materials-recent') return 'Skins';
  if (folder === 'props') return 'Props';
  if (folder === 'architecture' || folder === 'build-pieces' || folder === 'prefabs' || folder === 'mission-assets') return 'Build';
  return null;
}

export function folderForAsset(asset: Asset): ContentFolderId {
  if (asset.tab === 'Skins') {
    return asset.sourceKind === 'shader-preset' ? 'materials-generated' : 'materials-core';
  }
  if (asset.tab === 'Build') return 'build-pieces';
  return 'props';
}

export function contentFolderLabel(folder: ContentFolderId): string {
  const findNode = (nodes: ContentNode[]): ContentNode | null => {
    for (const node of nodes) {
      if (node.id === folder) return node;
      const found = node.children ? findNode(node.children) : null;
      if (found) return found;
    }
    return null;
  };
  const node = findNode(CONTENT_TREE);
  if (node) return node.label;
  const model = exactModelForFolder(folder);
  return model?.name ?? folder;
}

export function isMaterialFolder(folder: ContentFolderId): boolean {
  return tabForContentFolder(folder) === 'Skins';
}

export function isModelFolder(folder: ContentFolderId): boolean {
  return folder === 'models' ||
    folder === 'models-build' ||
    folder === 'models-props' ||
    folder === 'models-characters' ||
    folder === 'models-vehicles' ||
    folder === 'models-props-wip' ||
    String(folder).startsWith('model-');
}

// How many model thumbnails fill one gallery page. Shared by the picture
// gallery and AppFrame's page clamp so paging never disagrees with the grid.
export const MODEL_GALLERY_PAGE_SIZE = 12;

// The live model list: the catalog packages plus any duplicates, with per-model
// renames/favorites applied and deleted (hidden) models removed. Everything that
// lists models — the gallery, the tree, the counts — reads through this so a
// right-click rename/delete/duplicate stays consistent everywhere.
export function visibleModelPackages(
  overrides: Record<string, ModelOverride>,
  dupes: ModelPackage[],
): ModelPackage[] {
  return [...MODEL_PACKAGES, ...dupes]
    .map((model) => {
      const override = overrides[model.id];
      if (!override) return model;
      return { ...model, name: override.name ?? model.name, favorite: override.favorite ?? model.favorite };
    })
    .filter((model) => !overrides[model.id]?.hidden);
}

export function modelPackagesForFolder(
  folder: ContentFolderId,
  search: string,
  models: ModelPackage[] = MODEL_PACKAGES,
): ModelPackage[] {
  const needle = search.trim().toLowerCase();
  return models
    .filter((model) => {
      if (folder === 'models') return true;
      if (folder === 'models-build') return model.kind === 'build';
      if (folder === 'models-props') return model.kind === 'prop';
      if (folder === 'models-characters') return model.kind === 'character';
      if (folder === 'models-vehicles') return model.kind === 'vehicle';
      if (folder === 'models-props-wip') return model.sourceKind === 'studio-model' || model.stage === 'wip';
      return model.folderId === folder;
    })
    .filter((model) => {
      if (!needle) return true;
      const haystack = [
        model.name,
        model.path,
        model.kind,
        model.semanticKind ?? '',
        model.source,
        model.viewerPath ?? '',
        model.viewerMeshRef ?? '',
        model.rig,
        model.data,
        ...model.decompositions,
        ...model.atlases.map((atlas) => `${atlas.label} ${atlas.scope}`),
        ...model.paints.map((paint) => `${paint.name} ${paint.atlas} ${paint.shaderRefs.join(' ')} ${paint.imageRefs.join(' ')}`),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
}

export function modelPackageById(id: string): ModelPackage | null {
  return MODEL_PACKAGES.find((model) => model.id === id) ?? null;
}

export function exactModelForFolder(folder: ContentFolderId): ModelPackage | null {
  return MODEL_PACKAGES.find((model) => model.folderId === folder) ?? null;
}

export function assetMatchesContentFolder(asset: Asset, folder: ContentFolderId): boolean {
  if (isModelFolder(folder)) return false;
  if (folder === 'game') return true;
  if (folder === 'materials') return asset.tab === 'Skins';
  if (folder === 'materials-core') return asset.tab === 'Skins' && asset.sourceKind !== 'shader-preset';
  if (folder === 'materials-generated') return asset.tab === 'Skins' && asset.sourceKind === 'shader-preset';
  if (folder === 'materials-favorites') return asset.tab === 'Skins' && Boolean(asset.favorite);
  if (folder === 'materials-recent') return asset.tab === 'Skins' && Boolean(asset.recent);
  if (folder === 'props') return asset.tab === 'Props';
  if (folder === 'architecture' || folder === 'build-pieces' || folder === 'prefabs' || folder === 'mission-assets') return asset.tab === 'Build';
  return false;
}

export function countAssetsForFolder(
  assets: Asset[],
  folder: ContentFolderId,
  models: ModelPackage[] = MODEL_PACKAGES,
): number {
  if (folder === 'game') return assets.length + models.length;
  if (isModelFolder(folder)) return modelPackagesForFolder(folder, '', models).length;
  return assets.filter((asset) => assetMatchesContentFolder(asset, folder)).length;
}

// The content tree with its Models subtree rebuilt from a live model list, so
// renames / duplicates / deletes show up in the tree exactly as they do in the
// gallery. Only the Models node's children are swapped; the rest is untouched.
export function liveContentTree(models: ModelPackage[]): ContentNode[] {
  const swap = (node: ContentNode): ContentNode => {
    if (node.id === 'models') return { ...node, children: modelCategoryNodes(models) };
    if (node.children) return { ...node, children: node.children.map(swap) };
    return node;
  };
  return CONTENT_TREE.map(swap);
}

export function rankAssets(a: Asset, b: Asset): number {
  const score = (asset: Asset): number =>
    (asset.favorite ? 3000 : 0) + (asset.recent ? 2000 : 0) + asset.used;
  const byScore = score(b) - score(a);
  if (byScore !== 0) return byScore;
  const byMaterialSource = materialSourceRank(a) - materialSourceRank(b);
  if (byMaterialSource !== 0) return byMaterialSource;
  return a.name.localeCompare(b.name);
}

function materialSourceRank(asset: Asset): number {
  if (asset.tab !== 'Skins') return 0;
  if (asset.sourceKind === 'shader-recipe') return 0;
  if (asset.sourceKind === 'stored-material') return 1;
  if (asset.sourceKind === 'texture-file') return 2;
  if (asset.sourceKind === 'shader-preset') return 3;
  return 4;
}

export function selectedObject(state: EditorState): WorldObject {
  return state.objects.find((object) => object.id === state.selectedObjectId && !object.hidden)
    ?? state.objects.find((object) => !object.hidden)
    ?? INITIAL_OBJECTS[0]!;
}

export function panelModeFor(state: EditorState, object: WorldObject): LibraryTab {
  const command = commandById(state.activeCommandId);
  if (command.id === 'paint-material' || command.id === 'sample-material') return 'Skins';
  if (object.kind === 'TILE' || object.kind === 'CUTOUT') return 'Skins';
  if (object.kind === 'PROP') return 'Props';
  if (command.id === 'place-piece' || object.kind === 'PIECE' || object.kind === 'PREFAB') return 'Build';
  return state.activeTab;
}
