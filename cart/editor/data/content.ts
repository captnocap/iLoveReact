// editor/data/content.ts — content tree, navigation enums, and folder helpers.
//
// Cloned from the hmsc-workspace-mock god-file. Pure data + pure helpers.
import { MODEL_PACKAGES, MODEL_PACKAGE_COUNT } from './catalog';
import { commandById } from './commands';
import { INITIAL_OBJECTS } from './initialState';
import type { Asset, ContentFolderId, ContentNode, LibraryTab, MockState, ModelPackage, WorldObject } from './types';

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
export const CONTENT_TREE: ContentNode[] = [
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
  if (asset.tab === 'Skins') return asset.id.startsWith('mock-mat-') ? 'materials-generated' : 'materials-core';
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
  return findNode(CONTENT_TREE)?.label ?? folder;
}

export function isMaterialFolder(folder: ContentFolderId): boolean {
  return tabForContentFolder(folder) === 'Skins';
}

export function isModelFolder(folder: ContentFolderId): boolean {
  return folder === 'models' ||
    folder === 'models-props' ||
    folder === 'models-props-wip' ||
    MODEL_PACKAGES.some((model) => model.folderId === folder);
}

export function modelPackagesForFolder(folder: ContentFolderId, search: string): ModelPackage[] {
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

export function exactModelForFolder(folder: ContentFolderId): ModelPackage | null {
  return MODEL_PACKAGES.find((model) => model.folderId === folder) ?? null;
}

export function assetMatchesContentFolder(asset: Asset, folder: ContentFolderId): boolean {
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

export function countAssetsForFolder(assets: Asset[], folder: ContentFolderId): number {
  if (folder === 'game') return assets.length + MODEL_PACKAGE_COUNT;
  if (isModelFolder(folder)) return modelPackagesForFolder(folder, '').length;
  return assets.filter((asset) => assetMatchesContentFolder(asset, folder)).length;
}

export function rankAssets(a: Asset, b: Asset): number {
  const score = (asset: Asset): number =>
    (asset.favorite ? 3000 : 0) + (asset.recent ? 2000 : 0) + asset.used;
  const byScore = score(b) - score(a);
  return byScore !== 0 ? byScore : a.name.localeCompare(b.name);
}

export function selectedObject(state: MockState): WorldObject {
  return state.objects.find((object) => object.id === state.selectedObjectId && !object.hidden)
    ?? state.objects.find((object) => !object.hidden)
    ?? INITIAL_OBJECTS[0]!;
}

export function panelModeFor(state: MockState, object: WorldObject): LibraryTab {
  const command = commandById(state.activeCommandId);
  if (command.id === 'paint-material' || command.id === 'sample-material') return 'Skins';
  if (object.kind === 'TILE' || object.kind === 'CUTOUT') return 'Skins';
  if (object.kind === 'PROP') return 'Props';
  if (command.id === 'place-piece' || object.kind === 'PIECE' || object.kind === 'PREFAB') return 'Build';
  return state.activeTab;
}
