// editor/data/initialState.ts - seed world objects, seed history, initial state.
import { CATALOG_DIAGNOSTICS, DEFAULT_ASSET_ID, DEFAULT_CONTENT_FOLDER, MATERIAL_ASSET_COUNT, MODEL_PACKAGE_COUNT } from './catalog';
import { WORLD_DOCUMENT, WORLD_DOCUMENT_ID } from './documents';
import type { EditorState, ModelToolSnapshot, WorldObject } from './types';
import { SPINE_DEFAULT_CURRENT, SPINE_DEFAULT_PALETTE } from './colorSpine';
import { DEFAULT_BRUSH, defaultPalette } from '../../../runtime/paint/model';
import { defaultMapPaint } from '../stage/mapPaint';

export const INITIAL_OBJECTS: WorldObject[] = [
  { id: 'obj-tile', kind: 'TILE', name: 'Selected material', assetId: DEFAULT_ASSET_ID, left: 248, top: 116, width: 78, height: 70, metrics: [] },
];

// A freshly re-mounted, view-mode viewer's tool state — shared by initialState() and the
// hot-reload reset so the toolbar highlight always matches a clean viewer. A fresh palette
// per call (defaultPalette()) keeps the recents ring from being shared across resets.
export function defaultModelTool(): ModelToolSnapshot {
  return { selMode: 0, gizmoTool: 0, paint: false, focus: false, wire: false, sel: 0, quality: 1, tris: 0, brushTool: 'fill', safety: 0, detail: 1, brush: DEFAULT_BRUSH, palette: defaultPalette(), litFlat: false, litKey: true, litFill: true, litRim: false };
}

export function initialState(): EditorState {
  return {
    openMenu: null,
    presetMenuOpen: false,
    actionMenu: 'Build',
    activeDomain: 'world',
    activeTab: 'Skins',
    activeCommandId: 'select-tool',
    activeAssetId: DEFAULT_ASSET_ID,
    assetPage: 0,
    materialFocused: false,
    colorStudioMaterial: 'b-rot-siding',
    colorStudioVariant: 1,
    colorStudioSeed: 4,
    colorStudioQuality: 3,
    colorStudioActiveSlot: 2,
    colorStudioOverrides: {},
    colorStudioView: 'materialPalette',
    colorSpineCurrent: { ...SPINE_DEFAULT_CURRENT },
    colorSpinePalette: SPINE_DEFAULT_PALETTE.map((c) => ({ ...c })),
    colorSpineScenePick: null,
    buildDialogOpen: false,
    eventbusPopoverOpen: false,
    perfPopoverOpen: false,
    memoryPopoverOpen: false,
    fileExplorerOpen: false,
    fileExplorerQuery: '',
    fileExplorerFolder: 'all',
    fileExplorerExpanded: { all: true, 'virt:imports': true },
    fileExplorerSelectedId: '',
    fileExplorerHistory: [],
    fileExplorerDirectoryHistory: [],
    selectedObjectId: 'obj-tile',
    contentFolder: DEFAULT_CONTENT_FOLDER,
    expandedFolders: { game: true, models: true, 'models-build': true, 'models-props': true, missions: true, bankheist: true, materials: true, architecture: true },
    search: '',
    surfacePreset: 'default',
    snapIndex: 0,
    snapGridMeters: 0,
    snapAngleDegrees: 0,
    // FLOORCTL req_2485: the REAL active storey (0 = Ground) — boots aligned
    // with the viewport instead of the old mock's "Floor 1" mismatch.
    floorIndex: 0,
    wallsDown: false,
    viewMode: '3D',
    workspaceDocuments: [WORLD_DOCUMENT],
    activeWorkspaceDocumentId: WORLD_DOCUMENT_ID,
    rightPane: 'inspector',
    contextOpen: false,
    modelTool: defaultModelTool(),
    status: `eventbus idle - ${MODEL_PACKAGE_COUNT} model homes + ${MATERIAL_ASSET_COUNT} materials indexed from ${CATALOG_DIAGNOSTICS.source} in ${CATALOG_DIAGNOSTICS.loadedMs}ms`,
    cursor: { x: 0, y: 0, z: 0 },
    history: [],
    redo: [],
    seq: 1,
    objects: INITIAL_OBJECTS,
    assetOverrides: {},
    modelOverrides: {},
    modelDupes: [],
    modelRenamingId: null,
    modelParts: {},
    modelActivePartId: null,
    mapPaint: defaultMapPaint(),
  };
}
