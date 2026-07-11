// editor/data/initialState.ts - seed world objects, seed history, initial state.
import { CATALOG_DIAGNOSTICS, DEFAULT_ASSET_ID, DEFAULT_CONTENT_FOLDER, MATERIAL_ASSET_COUNT, MODEL_PACKAGES, MODEL_PACKAGE_COUNT } from './catalog';
import { WORLD_DOCUMENT, WORLD_DOCUMENT_ID } from './documents';
import type { EditorState, ModelToolSnapshot, WorldObject } from './types';
import { SPINE_DEFAULT_CURRENT, SPINE_DEFAULT_PALETTE } from './colorSpine';
import { DEFAULT_BRUSH, defaultPalette } from '../../../runtime/paint/model';
import { defaultMapPaint } from '../stage/mapPaint';
import { activeMapDocumentStem, mapDocumentName } from './mapDocuments';
import { defaultWorldGlobals } from './globals';
import { nsGet, nsSet } from '../../../runtime/hooks/localstore';
import { authoredIdFor, type AuthoredBuildPiece } from '../world/authoredRegistry';

// Authored placeables: the ON-DISK MANIFEST is the source of truth (USER RULING
// req_2718 — the package declares "I am a prop / a wall piece"); localstore is
// only the legacy cache. Geometry is re-resolved from the model store on load
// (authoredMesh); this list is metadata.
const AUTHORED_STORE = { ns: 'editor', key: 'authoredBuildPieces' };
export function loadAuthoredPieces(): AuthoredBuildPiece[] {
  try {
    const raw = nsGet(AUTHORED_STORE.ns, AUTHORED_STORE.key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export function saveAuthoredPieces(list: readonly AuthoredBuildPiece[]): void {
  try { nsSet(AUTHORED_STORE.ns, AUTHORED_STORE.key, JSON.stringify(list)); } catch { /* non-fatal */ }
}

/** The model id an authored placeable renders by (the resident-mesh key) — the
 *  package id minus its `studio:` source prefix. */
export function authoredModelIdForPackage(pkgId: string): string {
  return pkgId.startsWith('studio:') ? pkgId.slice('studio:'.length) : pkgId;
}

// The boot scan (req_2718): derive the placeable list from the DISK-loaded
// package roster (manifest.placeable). Legacy localstore-only entries whose
// package still exists merge in behind the disk records — AppFrame backfills
// their manifests on mount so next boot they're disk-derived too. Entries whose
// package is GONE drop: the cache never resurrects a deleted export.
export function bootAuthoredPieces(): AuthoredBuildPiece[] {
  const fromDisk: AuthoredBuildPiece[] = [];
  for (const pkg of MODEL_PACKAGES) {
    if (!pkg.placeable) continue;
    // Characters (player/NPC exports, req_2771) are compile-bake material, not
    // build-bar placeables — they never join the palette.
    if (pkg.placeable.as === 'character') continue;
    const kind = pkg.placeable.as === 'prop' ? ('prop' as const) : pkg.placeable.kind;
    const modelId = authoredModelIdForPackage(pkg.id);
    fromDisk.push({
      id: authoredIdFor(modelId, kind), modelId, pkgId: pkg.id, label: pkg.name, kind, hex: pkg.color,
      ...(pkg.placeable.as === 'build-piece' && pkg.placeable.edit ? { edit: pkg.placeable.edit } : {}),
      ...(pkg.placeable.as === 'prop' ? { propRole: pkg.placeable.role ?? 'scenery' } : {}),
    });
  }
  const seen = new Set(fromDisk.map((p) => p.id));
  const legacy = loadAuthoredPieces().filter((p) => !seen.has(p.id) && MODEL_PACKAGES.some((m) => m.id === p.pkgId));
  return [...fromDisk, ...legacy];
}

export const INITIAL_OBJECTS: WorldObject[] = [
  { id: 'obj-tile', kind: 'TILE', name: 'Selected material', assetId: DEFAULT_ASSET_ID, left: 248, top: 116, width: 78, height: 70, metrics: [] },
];

// A freshly re-mounted, view-mode viewer's tool state — shared by initialState() and the
// hot-reload reset so the toolbar highlight always matches a clean viewer. A fresh palette
// per call (defaultPalette()) keeps the recents ring from being shared across resets.
export function defaultModelTool(): ModelToolSnapshot {
  return { selMode: 0, gizmoTool: 0, paint: false, focus: false, wire: false, camLock: false, sel: 0, quality: 1, tris: 0, brushTool: 'fill', safety: 0, detail: 1, brush: DEFAULT_BRUSH, palette: defaultPalette(), litFlat: false, litKey: true, litFill: true, litRim: false, blocking: null, mirror: 0 };
}

export function initialState(): EditorState {
  const activeMapStem = activeMapDocumentStem();
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
    mapDocumentOpen: false,
    activeMapStem,
    activeMapName: mapDocumentName(activeMapStem),
    addChunkOpen: false,
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
    worldUndo: [],
    worldRedo: [],
    worldPieces: [],
    selectedPieceId: null,
    // Default armed piece = a concrete floor (the placeholder Place piece the
    // surface always dropped). The Build bar (Phase 2) overwrites this on pick.
    armedPieceId: 'floor.concrete.common',
    armedYawDegrees: 0,
    armedStamp: null,
    recentMaterialIds: [],
    authoredBuildPieces: bootAuthoredPieces(),
    modelRigs: {},
    objects: INITIAL_OBJECTS,
    assetOverrides: {},
    modelOverrides: {},
    modelDupes: [],
    modelRenamingId: null,
    modelDirty: {},
    modelParts: {},
    modelActivePartId: null,
    mapPaint: defaultMapPaint(),
    worldGlobals: defaultWorldGlobals(),
  };
}
