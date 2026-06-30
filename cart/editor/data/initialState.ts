// editor/data/initialState.ts - seed world objects, seed history, initial state.
import { CATALOG_DIAGNOSTICS, DEFAULT_ASSET_ID, DEFAULT_CONTENT_FOLDER, MATERIAL_ASSET_COUNT, MODEL_PACKAGE_COUNT } from './catalog';
import { WORLD_DOCUMENT, WORLD_DOCUMENT_ID } from './documents';
import { INITIAL_EXPLORER_DIRECTORY_HISTORY, INITIAL_EXPLORER_HISTORY } from './fileExplorer';
import type { MockState, WorldObject } from './types';

export const INITIAL_OBJECTS: WorldObject[] = [
  { id: 'obj-tile', kind: 'TILE', name: 'Selected material', assetId: DEFAULT_ASSET_ID, left: 248, top: 116, width: 78, height: 70, metrics: [] },
];

export function initialState(): MockState {
  return {
    openMenu: null,
    presetMenuOpen: false,
    actionMenu: 'Build',
    activeDomain: 'world',
    activeTab: 'Skins',
    activeCommandId: 'move-selection',
    activeAssetId: DEFAULT_ASSET_ID,
    assetPage: 0,
    materialFocused: false,
    colorStudioMaterial: 'rot',
    colorStudioVariant: 1,
    colorStudioSeed: 4,
    colorStudioQuality: 3,
    colorStudioActiveSlot: 2,
    colorStudioOverrides: {},
    buildDialogOpen: false,
    eventbusPopoverOpen: false,
    perfPopoverOpen: false,
    memoryPopoverOpen: false,
    fileExplorerOpen: false,
    fileExplorerQuery: '',
    fileExplorerFolder: 'imports-models',
    fileExplorerExpanded: { workspace: true, imports: true, 'imports-models': true, mock: true, 'hmsc-int': true, 'hmsc-int-game': true, runtime: true },
    fileExplorerSelectedId: 'desk-glb',
    fileExplorerHistory: INITIAL_EXPLORER_HISTORY,
    fileExplorerDirectoryHistory: INITIAL_EXPLORER_DIRECTORY_HISTORY,
    selectedObjectId: 'obj-tile',
    contentFolder: DEFAULT_CONTENT_FOLDER,
    expandedFolders: { game: true, models: true, 'models-build': true, 'models-props': true, missions: true, bankheist: true, materials: true, architecture: true },
    search: '',
    surfacePreset: 'default',
    snapIndex: 0,
    snapGridMeters: 0,
    snapAngleDegrees: 0,
    floorIndex: 1,
    viewMode: '3D',
    workspaceDocuments: [WORLD_DOCUMENT],
    activeWorkspaceDocumentId: WORLD_DOCUMENT_ID,
    rightPane: 'inspector',
    contextOpen: false,
    status: `eventbus idle - ${MODEL_PACKAGE_COUNT} model homes + ${MATERIAL_ASSET_COUNT} materials indexed from ${CATALOG_DIAGNOSTICS.source} in ${CATALOG_DIAGNOSTICS.loadedMs}ms`,
    cursor: { x: 0, y: 0, z: 0 },
    history: [],
    redo: [],
    seq: 1,
    objects: INITIAL_OBJECTS,
    assetOverrides: {},
  };
}
