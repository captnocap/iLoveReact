// editor/data/initialState.ts — seed world objects, seed history, initial state.
//
// Cloned from the hmsc-workspace-mock god-file. Pure data + the state factory.
import { MATERIAL_ASSET_COUNT, MODEL_PACKAGE_COUNT } from './catalog';
import { INITIAL_EXPLORER_DIRECTORY_HISTORY, INITIAL_EXPLORER_HISTORY } from './fileExplorer';
import type { HistoryEvent, MockState, WorldObject } from './types';

export const INITIAL_OBJECTS: WorldObject[] = [
  { id: 'obj-tile', kind: 'TILE', name: 'Grass', assetId: 'grass', left: 248, top: 116, width: 78, height: 70, metrics: [['height m', '0.06'], ['opacity', '0.00'], ['lightThru', '0.97'], ['friction', '0.60']] },
  { id: 'obj-wall-a', kind: 'PIECE', name: 'Wall Kit A', assetId: 'wall-kit', left: 214, top: 58, width: 64, height: 88, metrics: [['solid', 'yes'], ['cover', '0.74'], ['soundOcc', '0.80'], ['durability', '0.62']] },
  { id: 'obj-door', kind: 'CUTOUT', name: 'Door Cutout', assetId: 'door-cut', left: 330, top: 202, width: 96, height: 44, metrics: [['portal', 'yes'], ['width m', '1.20'], ['snap', 'edge'], ['room link', '2']] },
  { id: 'obj-shop', kind: 'PREFAB', name: 'Shop Front', assetId: 'shop-front', left: 376, top: 162, width: 70, height: 86, metrics: [['pieces', '14'], ['skins', '5'], ['cover', '0.41'], ['bake', 'clean']] },
];

export const INITIAL_HISTORY: HistoryEvent[] = [
  { id: 'h-6', verb: 'place', target: 'Wall Kit A', meta: 'semantic piece insert, catalog reference', undoable: true, editMs: 14.2, emptyMs: 13.9, richMs: 14.2 },
  { id: 'h-5', verb: 'paint', target: 'Grass -> Road', meta: 'eventbus mutation, context retained', undoable: true, editMs: 10.8, emptyMs: 10.5, richMs: 10.8 },
  { id: 'h-4', verb: 'move', target: 'Door Cutout', meta: 'free/snap domain preserved', undoable: true, editMs: 8.7, emptyMs: 8.5, richMs: 8.7 },
  { id: 'h-3', verb: 'trigger', target: 'Night Raid volume', meta: 'native volume op queued', undoable: true, editMs: 12.1, emptyMs: 11.8, richMs: 12.1 },
  { id: 'h-2', verb: 'compile', target: 'RLE preview', meta: 'autosave checkpoint only', undoable: false, editMs: 19.4, emptyMs: 19.1, richMs: 19.4 },
  { id: 'h-1', verb: 'select', target: 'Wall Kit A', meta: 'route return restored focus', undoable: false, editMs: 3.2, emptyMs: 3.1, richMs: 3.2 },
];

export function initialState(): MockState {
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
