// AppFrame — the editor workspace composition root. Owns the (mock) authoring
// state and slots every region component in. Extracted verbatim from the mock
// god-file; only the imports changed (one component per file, shared data/cls).
// State will migrate onto the real foundation systems (editorbus / hot index /
// commands / tunables) incrementally; this is the faithful layout first.
import { useState, useMemo, useEffect, useRef } from 'react';
import { C } from '../workspace.cls';
import { Box } from '../../../runtime/primitives';
import type { CommandAppliedOutcome } from '../../../runtime/commands';
import Chrome from './Chrome';
import DropdownMenu from './DropdownMenu';
import LeftRail from './LeftRail';
import BuildDock from './BuildDock';
import EventBusPopover from './EventBusPopover';
import BuildJournalDialog from './BuildJournalDialog';
import NewMeshDialog from './NewMeshDialog';
import PathArrayDialog from './PathArrayDialog';
import ScaleByDialog from './ScaleByDialog';
import ExportCharacterDialog from './ExportCharacterDialog';
import PaintToolbar, { PaintPopovers, type PaintPopover } from './PaintToolbar';
import PerformancePopover from './PerformancePopover';
import MemoryPopover from './MemoryPopover';
import PreferencesDialog from './PreferencesDialog';
import HotUpdateDialog from './HotUpdateDialog';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import LibraryPanel from '../library/LibraryPanel';
import Workspace from '../stage/Workspace';
import Inspector from '../inspector/Inspector';
import FileExplorerDialog from '../dialogs/FileExplorerDialog';
import AddChunkDialog from '../dialogs/AddChunkDialog';
import MapDocumentsDialog from '../dialogs/MapDocumentsDialog';
import ModelContextMenu from '../stage/ModelContextMenu';
import WorldContextMenu from '../stage/WorldContextMenu';
import RenderProbe from '../../../runtime/render_tracker';
import PlayRoute from '../PlayRoute';
import { useRoute } from '../../../runtime/router';
import { useContextMenu } from '../../../runtime/hooks/useContextMenu';
import { useDeej, subscribeDeej, type DeejMove } from '../../../runtime/hooks/useDeej';
import { getPointerDevice } from '../../../runtime/hooks/usePointerDevice';
import { busOn } from '../../../runtime/hooks/useIFTTT';
import type { EditorState, Command, Asset, Menu, WorldObject, ContentFolderId, ModelOverride, ModelPackage, ModelPlaceable, ModelPart, PrimitiveKind, ModelToolApi, ModelToolSnapshot, Rgb, WorldUndoSlices, CharacterRole } from '../data/types';
import type { ExplorerFolderId, ExplorerHistoryEntry } from '../data/fileExplorer';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import { pieceKindOf, PIECE_SPIN_RATE_DEG_PER_SEC } from '../world/pieces';
import { pieceSlotRoles } from '../world/pieceSlots';
import { setAuthoredPieces, authoredIdFor, preferredAuthoredPaletteId, type AuthoredBuildPiece, type PlaceableKind } from '../world/authoredRegistry';
import { cacheAuthoredMesh, authoredMeshData, authoredMeshBounds } from '../world/authoredMesh';
import { loadPersistedState, persistState } from '../data/persistView';
import { cancelWorldSave, emptyWorldSave, flushWorldSave, readWorldSave, saveWorldNow, scheduleWorldSave, type WorldSave } from '../data/worldStore';
import { generateCoastalCity } from '../data/coastalCity';
import { coastalCityWorldSave } from '../data/coastalCityDocument';
import {
  createMapDocument,
  deleteMapDocument,
  listMapDocuments,
  mapDocumentName,
  recordMapDocumentRenderStats,
  renameMapDocument,
  setActiveMapDocumentStem,
} from '../data/mapDocuments';
import { mapAuthoringSlicesFor } from '../data/mapDocumentState';
import { saveAuthoredPieces, authoredModelIdForPackage } from '../data/initialState';
import { propRigToSkeleton, skeletonToPropRig, describePropRig, partsToCharacterSkeleton, matchCharacterBones, type PropRig, type CharacterPartRow } from '../../../runtime/skeleton';
import {
  activateMapDocumentPainting,
  applyMapPaintEffects,
  flushMapDocumentPainting,
  defaultMapPaint,
  installGeneratedMapDocumentPainting,
  setMapDocumentAutosave,
  type GeneratedMapPaintingInstallation,
} from '../stage/mapPaint';
import { compileCoastalCityPainting } from '../stage/coastalCity';
import MapTexturePicker from '../stage/MapTexturePicker';
import { dispatchColorStudioActionOutcome, dispatchCommandOutcome, dispatchEdit, dispatchGlobalsSet, dispatchMapPaint, dispatchModelOutlinerActionOutcome, dispatchNativeMeshAction, dispatchPieceEditOutcome, dispatchPieceMaterialOutcome, dispatchPiecePlacementOutcome, type MapPaintPayload } from '../data/editorEvents';
import { commandById, isMeshToolCommand, PRIMITIVE_MESHES, blockingOverlay, publishColorStudioUndoDepths, publishUndoDepths, undoDepths, type BlockingOverlay } from '../data/commands';
import {
  COLOR_STUDIO_COLOR_SELECT_COMMAND_ID,
  COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID,
  COLOR_STUDIO_PALETTE_ADD_COMMAND_ID,
  COLOR_STUDIO_PALETTE_LOAD_COMMAND_ID,
  COLOR_STUDIO_QUALITY_SELECT_COMMAND_ID,
  COLOR_STUDIO_REDO_COMMAND_ID,
  COLOR_STUDIO_SEED_ROLL_COMMAND_ID,
  COLOR_STUDIO_SLOT_FILL_COMMAND_ID,
  COLOR_STUDIO_SLOT_SELECT_COMMAND_ID,
  COLOR_STUDIO_SLOTS_RESET_COMMAND_ID,
  COLOR_STUDIO_UNDO_COMMAND_ID,
  COLOR_STUDIO_VARIANT_SELECT_COMMAND_ID,
  COLOR_STUDIO_VIEW_SELECT_COMMAND_ID,
  commandSource,
  createEditorApplicationCommands,
  isColorStudioActionCommandId,
  isColorStudioChoiceCommandId,
  isModelOutlinerActionCommandId,
  isWorldPieceEditCommandId,
  isWorldPieceMaterialCommandId,
  isWorldToolCommandId,
  WORLD_FLOOR_STEP_COMMAND_ID,
  WORLD_PIECE_DELETE_COMMAND_ID,
  WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID,
  WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID,
  WORLD_PIECE_MOVE_COMMAND_ID,
  WORLD_PIECE_ROTATE_COMMAND_ID,
  WORLD_PIECE_SPIN_COMMAND_ID,
  WORLD_PIECES_PLACE_COMMAND_ID,
  WORLD_PLACEMENT_ROTATE_COMMAND_ID,
  WORLD_REDO_COMMAND_ID,
  WORLD_UNDO_COMMAND_ID,
  type WorldFloorStepResult,
  type WorldHistoryControlResult,
  type WorldPieceEditResult,
  type WorldPieceMaterialResult,
  type WorldPiecesPlaceResult,
  type WorldPlacementRotateResult,
  type WorldToolArmResult,
  type ColorStudioActionResult,
  type ColorStudioHistoryControlResult,
  type ModelOutlinerActionResult,
} from '../data/applicationCommands';
import { activeSurface } from '../data/surfaces';
import { propExportTargetForCommand } from '../data/propExports';
import { commandForKeyEvent, modifiersFromKeyEvent, syntheticKeyEdge } from '../data/keymap';
import { primitivePartMesh, primitiveMeshData, composeModelParts, fileModelPackage, importModelFilePackage, isViewerFile, modelPackageMeshData, packageMeshDoc, packageMeshDocParts, type PrimitiveParams } from '../data/assetCatalog';
import { meshDocPartRangesFromRows, partsMetaFromRows, meshDocRangeCenters, meshDocRangeGeometry } from '../data/meshDoc';
import { modelDocumentToken, nativeMeshActionDrain, withNativeMeshActionSource } from '../model/nativeMeshEvents';
import {
  groupPathById,
  nextDuplicateGroupName,
  nextDuplicatePartName,
  partGroupPath,
  partsInGroup,
  type ModelOutlinerDragItem,
  type ModelOutlinerDropTarget,
} from '../data/modelOutliner';
import {
  MODEL_GROUP_DISSOLVE_COMMAND_ID,
  MODEL_GROUP_RENAME_COMMAND_ID,
  MODEL_OUTLINER_MOVE_COMMAND_ID,
  MODEL_PART_RENAME_COMMAND_ID,
  MODEL_PARTS_GROUP_COMMAND_ID,
  MODEL_PARTS_UNGROUP_COMMAND_ID,
  modelOutlinerNote,
  modelPartRecords,
} from '../model/outlinerCommand';
import { materializePathArrayRows, sanitizePathArrayParams, type PathArrayParams } from '../data/pathArray';
import { cloneMesh, mirrorMesh, mergeMesh, type EditMesh } from '../model/editMesh';
import ImportPartDialog from '../dialogs/ImportPartDialog';
// Key edges come straight off the ffi bus (not useModifiers.onKeyDown): the active key
// bridge is useIFTTT's, whose events carry ctrlKey/shiftKey flags but NO `mods` object —
// useModifiers' fallback modifiers never update off those events, which is what killed
// every Ctrl chord (see modifiersFromKeyEvent in data/keymap.ts, req_2620 gap W).
import { subscribe } from '@reactjit/runtime/ffi';
// Live modifier state (no re-render) — the outliner's shift-click multi-select
// (req_2659) reads shift at press time instead of threading it through every row.
import { currentModifiers } from '@reactjit/runtime/hooks/useModifiers';
import { removeHotState } from '@reactjit/runtime/hooks/useHotState';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { ASSETS, applyAssetOverrides, assetById, resolveMaterialRef } from '../data/catalog';
import { selectedObject, panelModeFor, tabForContentFolder, assetMatchesContentFolder, rankAssets, folderForAsset, contentFolderLabel, visibleModelPackages, liveContentTree, primitiveModelPackage, buildStarterModelPackage, playerModelPackage, nextBuildStarterDocId, nextPlayerModelDocId, modelPackageById, effectiveModelPackage, nextPrimitiveDocId, registerSavedPackage, upsertSavedPackage, SNAP_MODES } from '../data/content';
import { playerStarterParts } from '../model/playerStarter';
import { buildPieceStarterParts } from '../model/buildPieceStarter';
import { buildPieceStarter, type BuildPieceStarterId } from '../data/buildStarters';
import { buildPieceExportTarget } from '../data/buildExports';
import { compileDoorMesh, resolveDoorLeafPart } from '../model/doorModel';
import { MODEL_PACKAGES } from '../data/catalog';
import { materializeModelPackage, writeModelArtifacts, isMaterialized, updateManifestIdentity, updateManifestPlaceable, readManifest, copyModelPackage } from '../data/modelPackageStore';
import { colorStudioSpec, paletteForSpecVariant } from '../data/colorStudio';
import { FILL_GRADES, FILL_SEED_MAX, registerImportedSpecs, shaderSpec } from '../textures/shaders';
import { image as imageOps, quantize as quantizeImage } from '../../../runtime/image';
import { encodeRows, parseQuantizeProbe } from '../textures/pixelTexture';
import { loadTexturePackages, textureSpec, savePixelTexture, saveExactImage } from '../data/texturePackage';
import { loadStickers, registerStickers, ensureStickerForTexture } from '../data/stickerStore';
import { FACADE_TEXELS_PER_METER, facadeFromSelection, facadeLayers, type Facade, type FacadeStroke, type FacadeStamp } from '../world/facades';
import { resizeFacadeRgba, setLiveFacades, saveFacadeBake } from '../world/facadeBake';
import ImportImageDialog, { type ImportImagePlan } from '../dialogs/ImportImageDialog';
import { readFileBase64, remove } from '../../../runtime/hooks/fs';
import { oklchName, pushRecentColor, SPINE_LIBRARY } from '../data/colorSpine';
import { scheduleColorLibrarySave } from '../data/colorLibraryStore';
import { hexToOklch, oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import type { ColorStudioHistoryEntry } from '../material/colorStudioCommand';
import { useBuildJournal } from '../data/journal';
import { explorerIndex, refreshExplorerIndex, explorerMatchesFolder, explorerFolderLabel, explorerFileById, explorerNowLabel } from '../data/fileExplorer';
import { WORLD_DOCUMENT_ID, PLAYTEST_DOCUMENT, ANIMATION_DOCUMENT, materialDocument, modelDocument, upsertDocument } from '../data/documents';
import { cancelGlobalsSave, saveGlobalsNow, scheduleGlobalsSave } from '../data/globalsStore';
import { editorPersistenceSettings, editorSettings } from '../data/editorSettings';
import { discardModelWorkingCopyState } from '../data/persistenceLifecycle';
import { applyDevReload, devReloadRevision, devReloadWaiting, installDevReloadCheckpoint, setDevReloadPolicy } from '../../../runtime/devReload';
import { DEFAULT_PHYSICS_GLOBALS, type PhysicsGlobals } from '../data/globals';
import { mapEventDrain, mapGetTileBindings, mapHostLive, mapRedo, mapUndo, type MapAuthoringEvent, type MapHistoryKind } from '../../../runtime/game/map';
import { buildCatalogIndex, validateBuildPlacement } from '../../../runtime/game/build';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS } from '../world/floraKinds';
import { floatsToBindings, GROUND_MATERIALS, tileBindingFor } from '../render3d/groundFormula';

const FACADE_PREVIEW_DETAILS = [128, FACADE_TEXELS_PER_METER, 512] as const;
const FACADE_PAINT_TOOLS = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'eyedropper', 'marquee', 'lasso'] as const;
const COLOR_STUDIO_UNDO_CAP = 32;

// FLOORCTL req_2485: floorIndex is the world viewport's REAL active storey
// (0 = Ground) — the action bar's ▼/▲ is the one control. 128 storeys
// (req_2677 — "literal burj khalifa levels of floors"); audited downstream:
// isoStage.setLevel clamps at ground only, the storey cutaway is an integer
// filter, and the host validator (build.zig validatePlacement) has no storey
// cap — floor 128 places at terrainY + 384m and validates clean.
const MAP_HISTORY_LABEL: Record<MapHistoryKind, string> = {
  paintStroke: 'paint stroke',
  pathCommit: 'transport path',
  pathDelete: 'transport path deletion',
  controlAdd: 'TC Stop',
  controlDelete: 'TC Stop deletion',
  tileBindings: 'tile material binding',
  zoneDrop: 'zone removal',
  chunkGrow: 'chunk growth',
};

function materialBindingLabel(fn: string, variant: number): string {
  const material = GROUND_MATERIALS.find((item) => item.fn === fn);
  const variantLabel = material?.variantLabels?.[variant];
  return [material?.name ?? fn, variantLabel && variantLabel !== 'Std' ? variantLabel : ''].filter(Boolean).join(' ');
}

function mapEventPayload(event: MapAuthoringEvent, mapPaint: EditorState['mapPaint'], materializedAtMs: number): MapPaintPayload {
  const tool = event.tool;
  const action = event.kind;
  const mode = tool.mode;
  const channel = tool.channel;
  const tileKind = TILE_KINDS[tool.kindIdx] ?? TILE_KINDS[mapPaint.tileKindIdx] ?? 'sidewalk';
  const tileDef = tileKindDefinition(tileKind);
  const binding = tool.bindIdx >= 0
    ? mapPaint.tileBindings[tool.bindIdx]
    : tileBindingFor(tileKind);
  const flora = FLORA_KIND_DEFINITIONS[tool.floraKindIdx] ?? FLORA_KIND_DEFINITIONS[mapPaint.floraKindIdx];
  const zone = mapPaint.zones[tool.zoneIdx];
  const strokeTarget = (() => {
    if (channel === 'terrain') return `terrain ${tool.terrainTool}`;
    if (channel === 'tile') return `tile ${tileDef.label}`;
    if (channel === 'water') return 'water';
    if (channel === 'flora') return `flora ${flora?.label ?? `#${tool.floraKindIdx}`}`;
    if (channel === 'zone') return `zone ${zone?.name ?? `#${tool.zoneIdx}`}`;
    if (channel === 'road') return 'road draft point';
    return channel;
  })();
  const label = (() => {
    if (action === 'stroke') return `${mode} ${strokeTarget}`;
    if (action === 'road.commit') return `commit road #${event.id}`;
    if (action === 'road.delete') return `delete road #${event.id}`;
    if (action === 'chunk.grow') return `grow chunk (${event.auxA}, ${event.auxB})`;
    if (action === 'zone.drop') return `drop zone ${mapPaint.zones[event.auxA]?.name ?? `#${event.auxA}`}`;
    if (action === 'tile.bindings') return `edit tile material bindings (${event.auxA})`;
    if (action === 'path.control.add') return `place TC Stop #${event.id}`;
    if (action === 'path.control.delete') return `delete TC Stop #${event.id}`;
    return action;
  })();
  const durationMs = Math.max(0, event.durationMs);
  return {
    action,
    label,
    channel: action === 'chunk.grow' ? 'map' : channel,
    mode,
    terrainTool: tool.terrainTool,
    shape: tool.shape,
    profile: tool.profile,
    radiusM: tool.radiusM,
    heightM: tool.centerZ,
    tileKind,
    tileLabel: tileDef.label,
    material: binding ? materialBindingLabel(binding.fn, binding.variant) : undefined,
    floraKind: flora?.kind,
    floraLabel: flora?.label,
    floraLane: tool.floraLane,
    zoneIdx: tool.zoneIdx,
    zoneLabel: zone?.name,
    start: action === 'stroke' ? event.start : undefined,
    end: action === 'stroke' ? event.end : undefined,
    samples: action === 'stroke' ? event.stats.samples : undefined,
    stamps: action === 'stroke' ? event.stats.stamps : undefined,
    touchedChunks: action === 'stroke' ? event.stats.touched : undefined,
    waterDry: action === 'stroke' ? event.stats.waterDry : undefined,
    roadId: event.id || undefined,
    chunk: action === 'chunk.grow' ? { cx: event.auxA, cz: event.auxB } : undefined,
    bindingCount: action === 'tile.bindings' ? event.auxA : undefined,
    droppedBefore: event.droppedBefore || undefined,
    durationMs,
    materializedAtMs,
    inputToMaterializedMs: durationMs,
    applyMs: durationMs,
    renderDeltaMs: 0,
  };
}

export default function AppFrame() {
  // The shell for BOTH routes. AppFrame stays mounted across the Editor/Play
  // switch (it's rendered directly under <Router>, not swapped by a <Route>), so
  // the top chrome — and its Editor/Play toggle — persists on /play and the
  // authoring state survives a round trip. The body is what swaps: editor panels
  // on /editor, the host-native WorldLoader on /play.
  const { path } = useRoute();
  const playing = path === '/play';
  const [state, setState] = useState<EditorState>(loadPersistedState);
  // Migrated application commands read and atomically replace this live
  // snapshot before publishing their outcome. React is a projection of that
  // commit; menu/toolbar/hotkey callers never receive setState.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => installDevReloadCheckpoint(() => persistState(stateRef.current)), []);
  // Per-device tool memory (req_3089): which physical device is driving the
  // cursor now, and the last tool runCommand dispatched per surface scope
  // (the dedupe that keeps a device flip from re-firing toggle-style tools).
  const pointerDeviceRef = useRef<'mouse' | 'pen'>(getPointerDevice());
  const lastToolByScopeRef = useRef<{ world: string | null; model: string | null }>({ world: null, model: null });
  const { snapshot: journal, actions: journalActions } = useBuildJournal();
  // The open paint-toolbar popover (ink / brush). Local, not persisted — the popovers render
  // LATE (below) so they sit over the body; the bar (early) only toggles this.
  const [paintPopover, setPaintPopover] = useState<PaintPopover>(null);
  // A pending image import awaiting the pixel-vs-exact decision. Transient.
  const [importPlan, setImportPlan] = useState<ImportImagePlan | null>(null);
  // The Add From Library picker (append a saved model into the OPEN model as parts).
  const [importPartOpen, setImportPartOpen] = useState(false);
  // Path Array's source is frozen when the dialog opens. Params remain dialog-local;
  // Apply revalidates these ids/ranges against the live outliner before touching mesh.
  const [pathArrayPrompt, setPathArrayPrompt] = useState<{ sourceIds: string[]; label: string; sourceSpanU: { xU: number; zU: number } } | null>(null);
  const [scaleByOpen, setScaleByOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [hotUpdatePromptOpen, setHotUpdatePromptOpen] = useState(false);
  const [unsavedDocumentName, setUnsavedDocumentName] = useState<string | null>(null);
  const unsavedDecisionRef = useRef<{ save: () => void; discard: () => void; cancel?: () => void } | null>(null);
  const requestUnsavedDecision = (documentName: string, save: () => void, discard: () => void, cancel?: () => void) => {
    unsavedDecisionRef.current = { save, discard, cancel };
    setUnsavedDocumentName(documentName);
  };
  const [settingsRevision, setSettingsRevision] = useState(0);
  useEffect(() => editorSettings.subscribe(() => setSettingsRevision((revision) => revision + 1)), []);
  const persistenceSettings = useMemo(editorPersistenceSettings, [settingsRevision]);
  const [manualWorldDirty, setManualWorldDirty] = useState(false);
  const [modelMutationRevision, setModelMutationRevision] = useState(0);
  // Destructive part-count changes require a one-shot capability tied to the exact
  // resulting row count. Hydration and autosave cannot mint it, so a fallback one-row
  // projection can never overwrite a multi-part document (req_3234).
  const authorizedPartShrinkTargetRef = useRef(new Map<string, number>());
  useEffect(() => {
    for (const [modelId, targetCount] of authorizedPartShrinkTargetRef.current) {
      if ((state.modelParts[modelId]?.length ?? -1) !== targetCount) {
        authorizedPartShrinkTargetRef.current.delete(modelId);
      }
    }
  }, [state.modelParts]);
  const partShrinkSaveOptions = (modelId: string, liveCount: number) => ({
    allowPartShrink: authorizedPartShrinkTargetRef.current.get(modelId) === liveCount,
  });
  const consumePartShrinkAuthorization = (modelId: string) => {
    authorizedPartShrinkTargetRef.current.delete(modelId);
  };
  const worldDurableRefs = useRef<{
    pieces: EditorState['worldPieces'];
    objects: EditorState['objects'];
    zones: EditorState['mapPaint']['zones'];
    globals: EditorState['worldGlobals'];
  } | null>(null);
  const skipNextWorldDirtyRef = useRef(false);
  useEffect(() => {
    const previous = worldDurableRefs.current;
    const next = { pieces: state.worldPieces, objects: state.objects, zones: state.mapPaint.zones, globals: state.worldGlobals };
    worldDurableRefs.current = next;
    if (persistenceSettings.autosave) {
      if (manualWorldDirty) setManualWorldDirty(false);
      return;
    }
    if (previous && (previous.pieces !== next.pieces || previous.objects !== next.objects || previous.zones !== next.zones || previous.globals !== next.globals)) {
      if (skipNextWorldDirtyRef.current) skipNextWorldDirtyRef.current = false;
      else setManualWorldDirty(true);
    }
  }, [state.worldPieces, state.objects, state.mapPaint.zones, state.worldGlobals, persistenceSettings.autosave]);
  const hotUpdateRevisionRef = useRef(0);
  useEffect(() => {
    setDevReloadPolicy(persistenceSettings.hotUpdate);
    if (persistenceSettings.hotUpdate !== 'ask') {
      hotUpdateRevisionRef.current = 0;
      setHotUpdatePromptOpen(false);
      return;
    }
    const poll = () => {
      const waiting = devReloadWaiting();
      const revision = devReloadRevision();
      if (waiting && revision !== hotUpdateRevisionRef.current) {
        hotUpdateRevisionRef.current = revision;
        setHotUpdatePromptOpen(true);
      }
    };
    poll();
    const timer = setInterval(poll, 250);
    return () => clearInterval(timer);
  }, [persistenceSettings.hotUpdate]);

  // Imported textures register as dynamic ShaderSpecs at boot (and after every
  // import), so they are first-class materials everywhere a catalog material is.
  const reloadImportedTextures = () => {
    const specs = loadTexturePackages()
      .map((pkg) => textureSpec(pkg, (b64) => imageOps(b64).raw()))
      .filter((s): s is NonNullable<typeof s> => s !== null);
    registerImportedSpecs(specs);
    registerStickers(loadStickers()); // stamps resolve through the same reload (req_3025)
    return specs.length;
  };
  useEffect(() => {
    const n = reloadImportedTextures();
    if (n > 0) setState((prev) => ({ ...prev, status: `${prev.status} · ${n} imported texture${n === 1 ? '' : 's'} registered` }));
  }, []);

  // The embedded model viewer hands its host-native tool handlers up here; the
  // toolbar + context menu remote-control the SAME tools through this ref, and
  // the viewer mirrors its live state back into state.modelTool for highlights.
  const modelToolApiRef = useRef<ModelToolApi | null>(null);

  // ── Modal discipline (req_2626 gap HH, USER LAW) ────────────────────────────
  // While ANY blocking session/dialog is unresolved — the viewer's loop-cut
  // session / atlas prompt / face guard (via state.modelTool.blocking), the
  // shell's newMeshPrompt / file explorer / build journal (via the shared
  // predicate in data/commands.ts), or the component-local import dialogs — every
  // other input surface is inert: runCommand refuses (with the reason in the
  // status line, never silently), the menus won't open, tools won't arm, and the
  // hotkey layer only lets Esc through to cancel. blockingNow() layers the
  // component-local dialogs over the state-visible predicate.
  const blockingNow = (s: EditorState): BlockingOverlay | null => {
    const block = blockingOverlay(s);
    if (block) return block;
    if (importPlan) return { id: 'import-image', label: 'Import Image' };
    if (importPartOpen) return { id: 'import-part', label: 'Add From Library' };
    if (pathArrayPrompt) return { id: 'path-array', label: 'Path Array' };
    if (scaleByOpen) return { id: 'scale-by', label: 'Scale By' };
    if (preferencesOpen) return { id: 'preferences', label: 'Preferences', closerCommandId: 'open-preferences' };
    if (hotUpdatePromptOpen) return { id: 'hot-update', label: 'Code Update' };
    if (unsavedDocumentName) return { id: 'unsaved-changes', label: 'Unsaved Changes' };
    return null;
  };
  // Live handle for the once-installed hotkey subscription (fresh closures per render).
  const blockingNowRef = useRef(blockingNow);
  blockingNowRef.current = blockingNow;
  // Studio history is controller state, not another pair of keys in the editor
  // state blob. It survives ordinary renders, resets with the application
  // session, and contains exact immutable before/after workspace snapshots.
  const colorStudioHistoryRef = useRef<{
    undo: ColorStudioHistoryEntry[];
    redo: ColorStudioHistoryEntry[];
  }>({ undo: [], redo: [] });

  const applicationCommandsRef = useRef<ReturnType<typeof createEditorApplicationCommands> | null>(null);
  if (applicationCommandsRef.current === null) {
    applicationCommandsRef.current = createEditorApplicationCommands({
      activeSurface: () => activeSurface(stateRef.current),
      blockedReason: () => blockingNowRef.current(stateRef.current)?.label ?? null,
      floorIndex: () => stateRef.current.floorIndex,
      commitFloor: (result) => {
        const previous = stateRef.current;
        const next: EditorState = {
          ...previous,
          openMenu: null,
          floorIndex: result.floorIndex,
          status: result.floorIndex === 0 ? 'floor: Ground' : `floor: Floor ${result.floorIndex}`,
        };
        stateRef.current = next;
        setState(next);
      },
      worldTool: () => ({
        activeCommandId: stateRef.current.activeCommandId,
        mapPaintActive: stateRef.current.mapPaint.active,
      }),
      commitWorldTool: (result) => {
        const previous = result.mapPaintDropped ? withMapPaintOff(stateRef.current) : stateRef.current;
        const tool = commandById(result.toolId);
        let status: string;
        switch (result.toolId) {
          case 'select-tool':
            status = 'Select armed';
            break;
          case 'place-piece':
            status = `Place Piece armed — click the world to place ${previous.armedPieceId ?? 'a build piece'}`;
            break;
          case 'move-selection':
            status = previous.selectedPieceId
              ? 'Move armed — drag the selected placed piece to reposition it'
              : 'Move armed — drag a placed piece to reposition it';
            break;
          case 'focus-selection':
            status = 'Focus armed — click a placed piece to frame it';
            break;
          case 'paint-faces': {
            const material = assetById(previous.activeAssetId, previous.assetOverrides);
            status = `Paint Faces armed — touch a piece face to apply ${material.name}; each face slot paints separately (drag to sweep)`;
            break;
          }
          case 'place-sticker':
            status = previous.stickerArm.textureId
              ? 'Place Sticker armed — click a piece face to stamp'
              : 'Place Sticker armed — pick a sticker in the action bar (import an image first if the rail is empty)';
            break;
        }
        if (result.mapPaintDropped) status += ' — map paint off (one mode at a time)';
        const next: EditorState = {
          ...previous,
          openMenu: null,
          actionMenu: tool.menu,
          activeCommandId: result.toolId,
          contextOpen: false,
          status,
        };
        stateRef.current = next;
        setState(next);
      },
      placementGhost: () => ({
        activeCommandId: stateRef.current.activeCommandId,
        armedPieceId: stateRef.current.armedPieceId,
        yawDegrees: stateRef.current.armedYawDegrees,
      }),
      commitPlacementGhostRotation: (result) => {
        const previous = stateRef.current;
        const next: EditorState = {
          ...previous,
          openMenu: null,
          armedYawDegrees: result.yawDegrees,
          status: `placement ghost rotated → ${result.yawDegrees}°`,
        };
        stateRef.current = next;
        setState(next);
      },
      placement: {
        read: () => ({
          documentId: stateRef.current.activeMapStem,
          pieces: stateRef.current.worldPieces,
          selectedPieceId: stateRef.current.selectedPieceId,
          nextPieceId: stateRef.current.seq,
        }),
        policy: {
          makePieceId: (sequence) => `bp_${sequence}`,
          validateCandidate: (candidate) => {
            if (!pieceKindOf(candidate.pieceId)) throw new Error(`unknown semantic piece '${candidate.pieceId}'`);
            const catalogIndex = buildCatalogIndex(candidate.pieceId);
            if (catalogIndex < 0) return;
            const validation = validateBuildPlacement(
              catalogIndex,
              candidate.x,
              candidate.y,
              candidate.z,
              candidate.yawDegrees,
            );
            if (!validation.valid) throw new Error(`host rejected placement '${candidate.pieceId}'`);
          },
        },
        now: Date.now,
        commit: (plan, actionId, gesture, applyStartedAtMs) => {
          const previous = stateRef.current;
          const transaction = plan.transaction;
          const first = transaction.placed[0]!;
          const replaced = transaction.removed.length;
          const count = transaction.placed.length;
          const what = count === 1 ? first.pieceId : `${count}× ${first.pieceId}`;
          const verb = replaced && count === 1 ? 'replaced' : 'placed';
          const appliedAtMs = Date.now();
          const applyMs = Math.max(0, appliedAtMs - applyStartedAtMs);
          const meta = [
            `mode=${gesture.mode}`,
            `kind=${pieceKindOf(first.pieceId) ?? 'unknown'}`,
            `floor=${first.floor ?? 0}`,
            `pos=(${first.x.toFixed(2)},${first.y.toFixed(2)},${first.z.toFixed(2)})`,
            `yaw=${Math.round(first.yawDegrees)}`,
            `count=${count}`,
            replaced ? `replaced=${replaced}` : '',
            `apply=${applyMs.toFixed(1)}ms`,
          ].filter(Boolean).join(' ');
          const nextBase: EditorState = {
            ...previous,
            seq: plan.next.nextPieceId,
            history: [
              {
                id: `h-${actionId}`,
                actionId,
                commandId: WORLD_PIECES_PLACE_COMMAND_ID,
                verb: transaction.action,
                target: what,
                meta,
                undoable: true,
                eventType: 'piece.place',
                atMs: appliedAtMs,
                editMs: Math.max(0, appliedAtMs - gesture.inputAtMs),
                emptyMs: applyMs,
                richMs: Math.max(0, appliedAtMs - gesture.inputAtMs),
              },
              ...previous.history,
            ].slice(0, 8),
            redo: [],
            worldPieces: [...plan.next.pieces],
            selectedPieceId: plan.next.selectedPieceId,
            selectedPieceIds: plan.next.selectedPieceId ? [plan.next.selectedPieceId] : [],
            status: `${verb} ${what}${replaced && count > 1 ? ` (replaced ${replaced})` : ''}`,
          };
          const next = recordWorldEdit(
            previous,
            nextBase,
            `${transaction.action} ${what}`,
            { actionId, commandId: WORLD_PIECES_PLACE_COMMAND_ID },
          );
          stateRef.current = next;
          setState(next);
          return appliedAtMs;
        },
      },
      pieceEdit: {
        read: () => ({
          documentId: stateRef.current.activeMapStem,
          pieces: stateRef.current.worldPieces,
          selectedPieceId: stateRef.current.selectedPieceId,
        }),
        now: Date.now,
        commit: (plan, actionId, applyStartedAtMs) => {
          const previous = stateRef.current;
          const transaction = plan.transaction;
          const before = transaction.before.piece;
          const after = transaction.after;
          const appliedAtMs = Date.now();
          const applyMs = Math.max(0, appliedAtMs - applyStartedAtMs);
          const meta = transaction.action === 'move' && after
            ? [
                `from=(${before.x.toFixed(2)},${before.y.toFixed(2)},${before.z.toFixed(2)})`,
                `to=(${after.x.toFixed(2)},${after.y.toFixed(2)},${after.z.toFixed(2)})`,
                `yaw=${Math.round(after.yawDegrees)}`,
                transaction.replaced.length ? `replaced=${transaction.replaced.length}` : '',
                `apply=${applyMs.toFixed(1)}ms`,
              ].filter(Boolean).join(' ')
            : transaction.action === 'rotate' && after
              ? [
                  `yaw=${Math.round(before.yawDegrees)}→${Math.round(after.yawDegrees)}`,
                  transaction.replaced.length ? `replaced=${transaction.replaced.length}` : '',
                  `apply=${applyMs.toFixed(1)}ms`,
                ].filter(Boolean).join(' ')
              : transaction.action === 'spin' && after
                ? `spin=${before.spinDegPerSec ?? 0}→${after.spinDegPerSec ?? 0}°/s apply=${applyMs.toFixed(1)}ms`
                : `at=(${before.x.toFixed(2)},${before.y.toFixed(2)},${before.z.toFixed(2)}) apply=${applyMs.toFixed(1)}ms`;
          const status = transaction.action === 'move'
            ? `moved ${before.pieceId}${transaction.replaced.length ? ` (replaced ${transaction.replaced.length})` : ''}`
            : transaction.action === 'rotate'
              ? `rotated ${before.pieceId} → ${after!.yawDegrees}°${transaction.replaced.length ? ` (replaced ${transaction.replaced.length})` : ''}`
              : transaction.action === 'spin'
                ? ((after!.spinDegPerSec ?? 0) !== 0 ? `spinning ${before.pieceId} at ${after!.spinDegPerSec}°/s` : `stopped ${before.pieceId} spinning`)
                : `deleted ${before.pieceId}`;
          const nextBase: EditorState = {
            ...previous,
            history: [{
              id: `h-${actionId}`,
              actionId,
              commandId: transaction.commandId,
              verb: transaction.action,
              target: before.pieceId,
              meta,
              undoable: true,
              eventType: 'piece.edit',
              atMs: appliedAtMs,
              editMs: applyMs,
              emptyMs: applyMs,
              richMs: applyMs,
            }, ...previous.history].slice(0, 8),
            redo: [],
            worldPieces: [...plan.next.pieces],
            selectedPieceId: plan.next.selectedPieceId,
            selectedPieceIds: previous.selectedPieceIds
              .filter((id) => plan.next.pieces.some((piece) => piece.id === id))
              .concat(plan.next.selectedPieceId && !previous.selectedPieceIds.includes(plan.next.selectedPieceId) ? [plan.next.selectedPieceId] : []),
            status,
          };
          const next = recordWorldEdit(
            previous,
            nextBase,
            `${transaction.action} ${before.pieceId}`,
            { actionId, commandId: transaction.commandId },
          );
          stateRef.current = next;
          setState(next);
          return appliedAtMs;
        },
      },
      pieceMaterial: {
        read: () => ({
          documentId: stateRef.current.activeMapStem,
          pieces: stateRef.current.worldPieces,
          selectedPieceId: stateRef.current.selectedPieceId,
        }),
        policy: {
          materialAssetExists: (assetId) => ASSETS.some((asset) => asset.id === assetId && asset.tab === 'Skins'),
          rolesForPiece: pieceSlotRoles,
        },
        now: Date.now,
        commit: (plan, actionId, applyStartedAtMs) => {
          const previous = stateRef.current;
          const transaction = plan.transaction;
          const appliedAtMs = Date.now();
          const applyMs = Math.max(0, appliedAtMs - applyStartedAtMs);
          const roleCount = transaction.assignments.reduce((count, assignment) => count + assignment.roles.length, 0);
          const pieceCount = transaction.assignments.length;
          const material = transaction.materialAssetId
            ? ASSETS.find((asset) => asset.id === transaction.materialAssetId)
            : undefined;
          const target = `${roleCount} face${roleCount === 1 ? '' : 's'} on ${pieceCount} piece${pieceCount === 1 ? '' : 's'}`;
          const status = transaction.action === 'material.assign'
            ? `painted ${target} with ${material?.name ?? transaction.materialAssetId}`
            : `cleared material from ${target}`;
          const meta = [
            `pieces=${pieceCount}`,
            `roles=${roleCount}`,
            transaction.materialAssetId ? `material=${transaction.materialAssetId}` : '',
            `apply=${applyMs.toFixed(1)}ms`,
          ].filter(Boolean).join(' ');
          const nextBase: EditorState = {
            ...previous,
            history: [{
              id: `h-${actionId}`,
              actionId,
              commandId: transaction.commandId,
              verb: transaction.action,
              target,
              meta,
              undoable: true,
              eventType: 'piece.material',
              atMs: appliedAtMs,
              editMs: applyMs,
              emptyMs: applyMs,
              richMs: applyMs,
            }, ...previous.history].slice(0, 8),
            redo: [],
            worldPieces: [...plan.next.pieces],
            selectedPieceId: plan.next.selectedPieceId,
            selectedPieceIds: previous.selectedPieceIds.filter((id) => plan.next.pieces.some((piece) => piece.id === id)),
            status,
            ...(transaction.materialAssetId ? {
              recentMaterialIds: [
                transaction.materialAssetId,
                ...previous.recentMaterialIds.filter((assetId) => assetId !== transaction.materialAssetId),
              ].slice(0, 10),
            } : {}),
          };
          const next = recordWorldEdit(
            previous,
            nextBase,
            `${transaction.action} ${target}`,
            { actionId, commandId: transaction.commandId },
          );
          stateRef.current = next;
          setState(next);
          return appliedAtMs;
        },
      },
      history: {
        peekUndo: () => stateRef.current.worldUndo[0] ?? null,
        peekRedo: () => stateRef.current.worldRedo[0] ?? null,
        commitUndo: () => {
          const previous = stateRef.current;
          const [entry, ...rest] = previous.worldUndo;
          // isEnabled established this immediately before the synchronous
          // handler. Keep the adapter total in case a future caller violates it.
          if (!entry) return { direction: 'undo', label: 'nothing', changedKeys: [] };
          const changedKeys = Object.keys(entry.before);
          const next: EditorState = {
            ...previous,
            ...entry.before,
            worldUndo: rest,
            worldRedo: [entry, ...previous.worldRedo].slice(0, WORLD_UNDO_CAP),
            status: `undid ${entry.label} — restored ${changedKeys.join(', ')}`,
          };
          stateRef.current = next;
          setState(next);
          return { direction: 'undo', label: entry.label, actionId: entry.actionId, commandId: entry.commandId, changedKeys };
        },
        commitRedo: () => {
          const previous = stateRef.current;
          const [entry, ...rest] = previous.worldRedo;
          if (!entry) return { direction: 'redo', label: 'nothing', changedKeys: [] };
          const changedKeys = Object.keys(entry.after);
          const next: EditorState = {
            ...previous,
            ...entry.after,
            worldRedo: rest,
            worldUndo: [entry, ...previous.worldUndo].slice(0, WORLD_UNDO_CAP),
            status: `redid ${entry.label} — reapplied ${changedKeys.join(', ')}`,
          };
          stateRef.current = next;
          setState(next);
          return { direction: 'redo', label: entry.label, actionId: entry.actionId, commandId: entry.commandId, changedKeys };
        },
      },
      modelOutliner: {
        read: () => {
          const current = stateRef.current;
          const doc = current.workspaceDocuments.find((candidate) => candidate.id === current.activeWorkspaceDocumentId);
          const modelId = doc?.kind === 'model' ? (doc.sourceId ?? '') : '';
          return {
            modelId,
            parts: modelPartRecords(modelId ? (current.modelParts[modelId] ?? []) : []),
            nextSequence: current.seq,
          };
        },
        now: Date.now,
        commit: (plan, actionId, applyStartedAtMs) => {
          const previous = stateRef.current;
          const transaction = plan.transaction;
          const currentParts = previous.modelParts[transaction.modelId] ?? [];
          const beforeNote = modelOutlinerNote(transaction.modelId, transaction.before);
          const afterNote = modelOutlinerNote(transaction.modelId, transaction.after);
          const checkpoint = (globalThis as any).__mesh_journal_checkpoint?.(
            transaction.action,
            beforeNote,
            afterNote,
          );
          if (checkpoint !== 1) {
            throw new Error('native model journal refused the outliner metadata checkpoint');
          }
          const meshById = new Map(currentParts.filter((part) => part.mesh).map((part) => [part.id, part.mesh!]));
          const parts: ModelPart[] = plan.next.parts.map((record) => {
            const mesh = meshById.get(record.id);
            return mesh ? { ...record, mesh } : { ...record };
          });
          const appliedAtMs = Date.now();
          const applyMs = Math.max(0, appliedAtMs - applyStartedAtMs);
          const next: EditorState = {
            ...previous,
            seq: Math.max(previous.seq, plan.next.nextSequence),
            modelParts: { ...previous.modelParts, [transaction.modelId]: parts },
            modelDirty: { ...previous.modelDirty, [transaction.modelId]: true },
            history: [{
              id: `h-${actionId}`,
              actionId,
              commandId: transaction.commandId,
              verb: transaction.action,
              target: plan.label,
              meta: `model=${transaction.modelId} parts=${transaction.partIds.length} apply=${applyMs.toFixed(1)}ms`,
              undoable: true,
              eventType: 'model.structure',
              atMs: appliedAtMs,
              editMs: applyMs,
              emptyMs: applyMs,
              richMs: applyMs,
            }, ...previous.history].slice(0, 8),
            redo: [],
            status: plan.status,
          };
          if (parts.length < currentParts.length) {
            authorizedPartShrinkTargetRef.current.set(transaction.modelId, parts.length);
          }
          stateRef.current = next;
          setState(next);
          return appliedAtMs;
        },
      },
      colorStudio: {
        read: () => ({
          materialId: stateRef.current.colorStudioMaterial,
          variant: stateRef.current.colorStudioVariant,
          seed: stateRef.current.colorStudioSeed,
          quality: stateRef.current.colorStudioQuality,
          activeSlot: stateRef.current.colorStudioActiveSlot,
          view: stateRef.current.colorStudioView,
          currentColor: stateRef.current.colorSpineCurrent,
          scenePick: stateRef.current.colorSpineScenePick,
          overrides: stateRef.current.colorStudioOverrides,
          palette: stateRef.current.colorSpinePalette,
        }),
        policy: {
          qualityCount: FILL_GRADES.length,
          seedMax: FILL_SEED_MAX,
          spec: (id) => {
            const spec = shaderSpec(id);
            if (!spec || !spec.variants.length) return null;
            return {
              id: spec.id,
              label: spec.label,
              variants: spec.variants.map((variant) => ({ label: variant.label })),
              slots: (spec.slots ?? []).map((slot) => ({
                name: slot.name,
                baked: [slot.rgb[0], slot.rgb[1], slot.rgb[2]] as Rgb,
              })),
            };
          },
        },
        now: Date.now,
        commitChoice: (result) => {
          const previous = stateRef.current;
          const patch = result.patch;
          const next: EditorState = {
            ...previous,
            colorStudioMaterial: patch.materialId ?? previous.colorStudioMaterial,
            colorStudioVariant: patch.variant ?? previous.colorStudioVariant,
            colorStudioSeed: patch.seed ?? previous.colorStudioSeed,
            colorStudioQuality: patch.quality ?? previous.colorStudioQuality,
            colorStudioActiveSlot: patch.activeSlot ?? previous.colorStudioActiveSlot,
            colorStudioView: patch.view ?? previous.colorStudioView,
            colorSpineCurrent: patch.currentColor ? { ...patch.currentColor } : previous.colorSpineCurrent,
            // The raw use-history (req_3097): every committed color select lands in
            // RECENT — pick a color anywhere, forget to save it, it's still here.
            colorSpineRecents: patch.currentColor
              ? pushRecentColor(previous.colorSpineRecents, patch.currentColor)
              : previous.colorSpineRecents,
            colorSpineScenePick: patch.scenePick !== undefined ? patch.scenePick : previous.colorSpineScenePick,
            status: result.label,
          };
          stateRef.current = next;
          setState(next);
        },
        commitAction: (plan, actionId, applyStartedAtMs) => {
          const previous = stateRef.current;
          const appliedAtMs = Date.now();
          const applyMs = Math.max(0, appliedAtMs - applyStartedAtMs);
          const commandId = plan.transaction.action === 'slot.fill'
            ? COLOR_STUDIO_SLOT_FILL_COMMAND_ID
            : plan.transaction.action === 'slots.reset'
              ? COLOR_STUDIO_SLOTS_RESET_COMMAND_ID
              : plan.transaction.action === 'palette.add'
                ? COLOR_STUDIO_PALETTE_ADD_COMMAND_ID
                : COLOR_STUDIO_PALETTE_LOAD_COMMAND_ID;
          const eventType = plan.transaction.action === 'slot.fill' || plan.transaction.action === 'slots.reset'
            ? 'material.edit'
            : 'palette.edit';
          const entry: ColorStudioHistoryEntry = {
            label: plan.label,
            actionId,
            commandId,
            transaction: plan.transaction,
            before: plan.before,
            after: plan.after,
          };
          colorStudioHistoryRef.current = {
            undo: [entry, ...colorStudioHistoryRef.current.undo].slice(0, COLOR_STUDIO_UNDO_CAP),
            redo: [],
          };
          const next: EditorState = {
            ...previous,
            colorStudioOverrides: { ...plan.after.overrides },
            colorSpinePalette: plan.after.palette.map((color) => ({ ...color })),
            colorSpineCurrent: { ...plan.after.currentColor },
            history: [{
              id: `h-${actionId}`,
              actionId,
              commandId,
              verb: plan.transaction.action,
              target: plan.label,
              meta: `Color Studio workspace action · apply=${applyMs.toFixed(1)}ms`,
              undoable: true,
              eventType,
              atMs: appliedAtMs,
              editMs: applyMs,
              emptyMs: applyMs,
              richMs: applyMs,
            }, ...previous.history].slice(0, 8),
            redo: [],
            status: plan.label,
          };
          stateRef.current = next;
          setState(next);
          return appliedAtMs;
        },
        history: {
          peekUndo: () => colorStudioHistoryRef.current.undo[0] ?? null,
          peekRedo: () => colorStudioHistoryRef.current.redo[0] ?? null,
          commitUndo: () => {
            const entry = colorStudioHistoryRef.current.undo[0]!;
            colorStudioHistoryRef.current = {
              undo: colorStudioHistoryRef.current.undo.slice(1),
              redo: [entry, ...colorStudioHistoryRef.current.redo].slice(0, COLOR_STUDIO_UNDO_CAP),
            };
            const previous = stateRef.current;
            const next: EditorState = {
              ...previous,
              colorStudioOverrides: { ...entry.before.overrides },
              colorSpinePalette: entry.before.palette.map((color) => ({ ...color })),
              colorSpineCurrent: { ...entry.before.currentColor },
              status: `undid ${entry.label}`,
            };
            stateRef.current = next;
            setState(next);
            return {
              direction: 'undo' as const,
              label: entry.label,
              actionId: entry.actionId,
              commandId: entry.commandId,
              transaction: entry.transaction,
            };
          },
          commitRedo: () => {
            const entry = colorStudioHistoryRef.current.redo[0]!;
            colorStudioHistoryRef.current = {
              undo: [entry, ...colorStudioHistoryRef.current.undo].slice(0, COLOR_STUDIO_UNDO_CAP),
              redo: colorStudioHistoryRef.current.redo.slice(1),
            };
            const previous = stateRef.current;
            const next: EditorState = {
              ...previous,
              colorStudioOverrides: { ...entry.after.overrides },
              colorSpinePalette: entry.after.palette.map((color) => ({ ...color })),
              colorSpineCurrent: { ...entry.after.currentColor },
              status: `redid ${entry.label}`,
            };
            stateRef.current = next;
            setState(next);
            return {
              direction: 'redo' as const,
              label: entry.label,
              actionId: entry.actionId,
              commandId: entry.commandId,
              transaction: entry.transaction,
            };
          },
        },
      },
    }, (outcome) => {
      if (outcome.status === 'applied' && outcome.commandId === WORLD_FLOOR_STEP_COMMAND_ID) {
        const result = outcome.result as WorldFloorStepResult;
        dispatchCommandOutcome(outcome, {
          label: result.floorIndex === 0 ? 'active floor → Ground' : `active floor → Floor ${result.floorIndex}`,
          targets: [{ kind: 'view-floor', id: String(result.floorIndex) }],
        });
        return;
      }
      if (outcome.status === 'applied' && isWorldToolCommandId(outcome.commandId)) {
        const result = outcome.result as WorldToolArmResult;
        // Re-arming the current tool while Map Paint is already off is genuinely inert. The command
        // result remains deterministic for automation, but there is no state
        // transition to append to the session outcome stream.
        if (!result.changed) return;
        const tool = commandById(result.toolId);
        dispatchCommandOutcome(outcome, {
          label: `active tool → ${tool.name}${result.mapPaintDropped ? ' · map paint off' : ''}`,
          targets: [{ kind: 'world-tool', id: result.toolId }],
        });
        return;
      }
      if (outcome.status === 'applied' && outcome.commandId === WORLD_PIECES_PLACE_COMMAND_ID) {
        dispatchPiecePlacementOutcome(outcome as CommandAppliedOutcome<WorldPiecesPlaceResult>);
        return;
      }
      if (outcome.status === 'applied' && isWorldPieceEditCommandId(outcome.commandId)) {
        dispatchPieceEditOutcome(outcome as CommandAppliedOutcome<WorldPieceEditResult>);
        return;
      }
      if (outcome.status === 'applied' && isWorldPieceMaterialCommandId(outcome.commandId)) {
        dispatchPieceMaterialOutcome(outcome as CommandAppliedOutcome<WorldPieceMaterialResult>);
        return;
      }
      if (outcome.status === 'applied' && isColorStudioChoiceCommandId(outcome.commandId)) {
        const result = outcome.result as import('../material/colorStudioCommand').ColorStudioChoiceResult;
        // Re-clicking an already-active segment is inert. A settled color drag
        // therefore appends at most one report, never one per pointer sample.
        if (!result.changed) return;
        const label = result.kind === 'color' && result.patch.currentColor
          ? `current color → ${oklchName(result.patch.currentColor)} (${result.source ?? 'picker'})`
          : result.label;
        dispatchCommandOutcome(outcome, {
          label,
          targets: [{ kind: `studio-${result.kind}`, id: result.targetId }],
        });
        return;
      }
      if (outcome.status === 'applied' && isColorStudioActionCommandId(outcome.commandId)) {
        dispatchColorStudioActionOutcome(outcome as CommandAppliedOutcome<ColorStudioActionResult>);
        return;
      }
      if (outcome.status === 'applied' && isModelOutlinerActionCommandId(outcome.commandId)) {
        dispatchModelOutlinerActionOutcome(outcome as CommandAppliedOutcome<ModelOutlinerActionResult>);
        return;
      }
      if (outcome.status === 'applied' &&
          (outcome.commandId === COLOR_STUDIO_UNDO_COMMAND_ID || outcome.commandId === COLOR_STUDIO_REDO_COMMAND_ID)) {
        const result = outcome.result as ColorStudioHistoryControlResult;
        dispatchCommandOutcome(outcome, {
          label: `${result.direction} ${result.label}`,
          targets: [{ kind: 'color-studio', id: 'workspace' }],
        });
        return;
      }
      if (outcome.status === 'applied' && outcome.commandId === WORLD_PLACEMENT_ROTATE_COMMAND_ID) {
        const result = outcome.result as WorldPlacementRotateResult;
        dispatchCommandOutcome(outcome, {
          label: `placement preview → ${result.yawDegrees}°`,
          targets: [{ kind: 'piece-kind', id: result.armedPieceId }],
        });
        return;
      }
      if (outcome.status === 'applied' &&
          (outcome.commandId === WORLD_UNDO_COMMAND_ID || outcome.commandId === WORLD_REDO_COMMAND_ID)) {
        const result = outcome.result as WorldHistoryControlResult;
        dispatchCommandOutcome(outcome, {
          label: `${result.direction === 'undo' ? 'undo' : 'redo'} ${result.label}`,
          targets: [{ kind: 'map', id: stateRef.current.activeMapStem }],
        });
        return;
      }
      dispatchCommandOutcome(outcome);
    });
  }
  const invokeApplicationCommand = (
    commandId: string,
    args: unknown,
    source: string,
    correlation: { actionId?: string; causedBy?: string } = {},
  ) => {
    const outcome = applicationCommandsRef.current!.invoke({
      commandId,
      args,
      source: commandSource(source),
      ...correlation,
    });
    if (outcome.status === 'rejected') {
      const previous = stateRef.current;
      const next = { ...previous, openMenu: null, status: outcome.reason };
      stateRef.current = next;
      setState(next);
    }
    return outcome;
  };
  const refuseBlocked = (block: BlockingOverlay) =>
    setState((prev) => ({ ...prev, status: `resolve ${block.label} first — finish or cancel it before doing anything else` }));
  /** Wrap a handler so it is inert (with the honest status) while a blocker is open. */
  const guarded = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    const block = blockingNow(state);
    if (block) { refuseBlocked(block); return; }
    fn(...a);
  };

  // The model surface's right-click menu. Lives at the app ROOT (rendered below,
  // as the last child of HW_App) so it lands at the cursor — an absolutely-placed
  // menu positions relative to its parent, and only the root sits at window origin
  // (the stage is offset right by the rail + content browser). The trigger spreads
  // onto the model surface deep in the tree.
  const modelMenu = useContextMenu();

  // The WORLD surface's right-click quick menu (req_2733) — same root treatment.
  // The viewport picks the piece under the cursor and reports it here with the
  // window coords; opening = select that piece + land the menu at the cursor.
  // guarded: modal discipline — no quick verbs over an unresolved dialog.
  const worldMenu = useContextMenu();

  // deej fader board (req_3085): physical faders nudge the live brush. The
  // handler is re-pointed every render (down where the active paint context
  // is known) so the one module-level subscription always sees fresh state;
  // no board = zero events and the UI sliders behave exactly as before.
  useDeej({ pollMs: 33 });
  const deejApplyRef = useRef<(move: DeejMove) => void>(() => {});
  useEffect(() => subscribeDeej((move) => deejApplyRef.current(move)), []);
  const facadeContextSideRef = useRef<'front' | 'back'>('front');
  const openPieceQuickMenu = guarded((id: string, x: number, y: number, role: string | null) => {
    facadeContextSideRef.current = role === 'back' ? 'back' : 'front';
    setState((prev) => ({
      ...prev,
      selectedPieceId: id,
      selectedPieceIds: prev.selectedPieceIds.includes(id) ? prev.selectedPieceIds : [id],
      status: `selected ${prev.worldPieces.find((piece) => piece.id === id)?.pieceId ?? id}`,
    }));
    worldMenu.triggerProps.onRightClick({ x, y });
  });

  // Mirror the active view into hot-state so a dev hot reload rehydrates exactly
  // what you were looking at instead of snapping back to defaults.
  useEffect(() => {
    // Hot-state is a reload checkpoint, not a per-input event sink. Collapse a
    // drag/typing burst to one snapshot so choosing a colour cannot serialize
    // the whole editor workspace once per pointer sample.
    const checkpoint = setTimeout(() => persistState(state), 60);
    return () => clearTimeout(checkpoint);
  }, [state]);

  // Micro-save the color library (req_3097): SAVED tray + RECENT use-history go
  // to their per-concern disk file on every change, so a saved color is a real
  // save — it survives the cold restart, not just the hot reload.
  useEffect(() => {
    scheduleColorLibrarySave(state.colorSpinePalette, state.colorSpineRecents);
  }, [state.colorSpinePalette, state.colorSpineRecents]);

  // Micro-save the world's authored edits to disk (SESSIONSAVE req_2765): every
  // worldPieces / semantic-object / zone-def change — placements, verbs,
  // undo/redo, all of it —
  // schedules a debounced write of the world save, so placed pieces survive a
  // cold restart without requiring Save. Explicit Save uses the same writers.
  // itself host-side (ensureMapSeeded registers its autosave file).
  useEffect(() => {
    scheduleWorldSave(state.activeMapStem, state.worldPieces, state.objects, state.mapPaint.zones, state.seq, {
      enabled: persistenceSettings.autosave,
      delayMs: persistenceSettings.autosaveDelayMs,
    }, state.worldFacades);
  }, [state.activeMapStem, state.worldPieces, state.objects, state.mapPaint.zones, state.worldFacades, persistenceSettings.autosave, persistenceSettings.autosaveDelayMs]);

  // Facade quads follow the active map into every world view (req_3057) —
  // livePush reads this registry when it re-pushes resident meshes/refs.
  useEffect(() => {
    setLiveFacades(state.activeMapStem, state.worldFacades);
  }, [state.activeMapStem, state.worldFacades]);

  // GLOBALS req_2770: tuned world globals micro-save on the same contract —
  // "find a value, lock it in" is a debounced write, never a Save button.
  useEffect(() => {
    scheduleGlobalsSave(state.worldGlobals, {
      enabled: persistenceSettings.autosave,
      delayMs: persistenceSettings.autosaveDelayMs,
    });
  }, [state.worldGlobals, persistenceSettings.autosave, persistenceSettings.autosaveDelayMs]);

  useEffect(() => {
    if (!persistenceSettings.autosave) {
      cancelWorldSave();
      cancelGlobalsSave();
    }
    setMapDocumentAutosave(persistenceSettings.autosave);
  }, [persistenceSettings.autosave]);

  // One field of the world globals changes: state (→ the playtest surface pushes
  // the live physics door), the bus event, and the micro-save all ride the same
  // click. Reset = set back to the game default, through the same path.
  const setWorldGlobal = (field: string, value: number) => {
    const previous = state.worldGlobals.physics[field as keyof PhysicsGlobals];
    if (previous === value || !Number.isFinite(value)) return;
    dispatchGlobalsSet({ field, value, previous });
    setState((prev) => ({
      ...prev,
      worldGlobals: { ...prev.worldGlobals, physics: { ...prev.worldGlobals.physics, [field]: value } },
      status: `globals: ${field} = ${value}`,
    }));
  };
  const resetWorldGlobal = (field: string) => {
    const base = DEFAULT_PHYSICS_GLOBALS[field as keyof PhysicsGlobals];
    if (base !== undefined) setWorldGlobal(field, base);
  };

  // MAPPAINT req_2492: a hot-restored ACTIVE paint tool must RE-ARM the host on
  // boot — applyMapPaintEffects otherwise only fires on patches, so a reload
  // that rehydrated active=true left the host with no ground look and a stale
  // tool (paint strokes silently did nothing).
  useEffect(() => {
    if (!state.mapPaint.active) return;
    const hostPatch = applyMapPaintEffects(defaultMapPaint(), state.mapPaint);
    // the loaded RMAP's binding table is the truth — mirror it into the chrome
    if (hostPatch) setState((prev) => ({ ...prev, mapPaint: { ...prev.mapPaint, ...hostPatch } }));
  }, []);

  // Board the bus: every recorded generic edit is dispatched onto the real
  // editorbus door as it happens. Typed events (piece.place, material.*, ...)
  // dispatch themselves with richer payloads; this effect deliberately ignores
  // them so a seq bump from placement cannot replay an older generic history row.
  const lastHistoryId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const latest = state.history[0];
    const latestId = latest?.id ?? null;
    if (lastHistoryId.current === undefined) { lastHistoryId.current = latestId; return; }
    if (!latest || latestId === lastHistoryId.current) return;
    lastHistoryId.current = latestId;
    if (!latest.eventType) dispatchEdit(latest);
  }, [state.history]);

  // Mirror the authored placeables into the module registry (req_2578) so the
  // pure placement/render helpers resolve them without prop threading. The
  // localstore write is a CACHE only (req_2718) — boot truth is the manifest
  // scan (bootAuthoredPieces).
  useEffect(() => {
    setAuthoredPieces(state.authoredBuildPieces);
    saveAuthoredPieces(state.authoredBuildPieces);
  }, [state.authoredBuildPieces]);

  // One-time legacy backfill (req_2718): any placeable that boot-merged from the
  // localstore cache but whose on-disk manifest lacks the export declaration
  // gets it written through now — from the next boot on, the disk scan carries
  // it and the cache entry is redundant. LOUD when a manifest refuses the write.
  useEffect(() => {
    for (const p of state.authoredBuildPieces) {
      const pkg = modelPackageById(p.pkgId);
      if (!pkg || !isMaterialized(pkg.kind, pkg.id)) continue;
      if (readManifest(pkg.kind, pkg.id)?.placeable) continue;
      const placeable: ModelPlaceable = p.kind === 'prop'
        ? { as: 'prop', role: p.propRole ?? 'scenery' }
        : { as: 'build-piece', kind: p.kind, ...(p.edit ? { edit: p.edit } : {}) };
      if (!updateManifestPlaceable(pkg.kind, pkg.id, { placeable })) {
        console.warn(`[export] placeable backfill FAILED for ${p.pkgId} — manifest not writable; this export stays localstore-only`);
      }
    }
  }, []);

  // Publish the LIVE undo/redo depths (model → the host mesh journal via __mesh_history;
  // Color Studio → its scoped command journal; world → worldUndo/worldRedo) so menu rows count-annotate and
  // gray honestly. Every render is an event edge, so the menus read fresh depths whenever
  // they can possibly be looked at (req_2620 gap W).
  publishColorStudioUndoDepths(
    colorStudioHistoryRef.current.undo.length,
    colorStudioHistoryRef.current.redo.length,
  );
  const liveUndoDepths = undoDepths(state);
  publishUndoDepths(liveUndoDepths);

  // ── Durable identity + visible save state (req_2620 gaps S/T/U) ──────────────
  // The model doc in view, resolved through the EFFECTIVE package (session rename
  // applied) — the same record every save writes, so what you see is what lands
  // in the manifest. onDisk gates the dirty semantics: an on-disk model autosaves
  // on doc switch; a never-saved doc stays loud until the user saves it first.
  const activeModelId = (() => {
    const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
    return doc?.kind === 'model' ? (doc.sourceId ?? null) : null;
  })();
  // Native journal outcomes are drained asynchronously. Stamp the resident mesh
  // with this document's compact identity so a tab switch cannot attribute an
  // already-queued transform to the newly active model. Keep prior mappings for
  // the session because a close can race the drain too; a hash collision becomes
  // an explicit unknown token rather than silently targeting either document.
  const modelIdByMeshTokenRef = useRef(new Map<number, string | null>());
  if (activeModelId) {
    const token = modelDocumentToken(activeModelId);
    const known = modelIdByMeshTokenRef.current.get(token);
    modelIdByMeshTokenRef.current.set(token, known && known !== activeModelId ? null : activeModelId);
  }
  useEffect(() => {
    (globalThis as any).__mesh_action_document?.(activeModelId ? modelDocumentToken(activeModelId) : 0);
  }, [activeModelId]);
  const activeModelPkg = activeModelId ? effectiveModelPackage(activeModelId, state.modelOverrides, state.modelDupes) : null;
  const activeModelOnDisk = activeModelPkg ? isMaterialized(activeModelPkg.kind, activeModelPkg.id) : false;
  // Mesh-journal baseline per model: the depth recorded at the last save (reset to
  // 0 on every doc activate — the host journal restarts with the remount). Depth
  // ABOVE the baseline = host-side edits since the last materialize (gizmo, paint,
  // topology and part ops all journal) → the doc is dirty. Rename marks explicitly
  // (names never journal); Save/autosave clear the flag and re-baseline.
  const savedMeshDepthRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (activeModelId) savedMeshDepthRef.current[activeModelId] = 0;
  }, [state.activeWorkspaceDocumentId]);
  const dirtyProbeDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeModelId || liveUndoDepths.source !== 'mesh') return;
    // The commit that switches docs still read the OLD viewer's journal (it only
    // unmounts with this same commit) — skip one edge per doc so a stale depth
    // can never dirty the incoming document.
    if (dirtyProbeDocRef.current !== state.activeWorkspaceDocumentId) {
      dirtyProbeDocRef.current = state.activeWorkspaceDocumentId;
      return;
    }
    if (liveUndoDepths.undo > (savedMeshDepthRef.current[activeModelId] ?? 0) && !state.modelDirty[activeModelId]) {
      setState((prev) => ({ ...prev, modelDirty: { ...prev.modelDirty, [activeModelId]: true } }));
    }
  }, [liveUndoDepths.undo, liveUndoDepths.source, activeModelId, state.activeWorkspaceDocumentId, state.modelDirty]);

  /** The single model commit path used by File → Save, first-atlas gating,
   * close/switch boundaries, and background autosave after first save. */
  const saveActiveModelNow = (reason = 'Save'): boolean => {
    const current = stateRef.current;
    const doc = current.workspaceDocuments.find((item) => item.id === current.activeWorkspaceDocumentId);
    const pkg = doc?.kind === 'model'
      ? effectiveModelPackage(doc.sourceId, current.modelOverrides, current.modelDupes)
      : null;
    if (!pkg) return false;

    const rigDraft = current.modelRigs[pkg.id];
    const rigModelId = authoredModelIdForPackage(pkg.id);
    const rigBounds = rigDraft ? authoredMeshBounds(rigModelId, pkg.id) : null;
    const pkgToSave: ModelPackage = rigDraft && rigBounds
      ? { ...pkg, skeleton: propRigToSkeleton(rigModelId, rigModelId, rigDraft, rigBounds) }
      : pkg;
    const alreadyOnDisk = isMaterialized(pkg.kind, pkg.id);
    const result = materializeModelPackage(pkgToSave);
    const liveRows = current.modelParts[pkg.id] ?? [];
    const artifactsOk = result.ok && writeModelArtifacts(
      pkg,
      partsMetaFromRows(liveRows),
      meshDocPartRangesFromRows(liveRows) ?? undefined,
      partShrinkSaveOptions(pkg.id, liveRows.length),
    );
    const ok = result.ok && artifactsOk;
    if (result.ok && !artifactsOk && !alreadyOnDisk) remove(result.dir);
    if (ok) {
      consumePartShrinkAuthorization(pkg.id);
      registerSavedPackage(pkgToSave);
      const depths = undoDepths(current);
      savedMeshDepthRef.current[pkg.id] = depths.source === 'mesh' ? depths.undo : 0;
    }
    setState((prev) => ({
      ...prev,
      openMenu: null,
      actionMenu: 'File',
      modelDirty: ok ? { ...prev.modelDirty, [pkg.id]: false } : prev.modelDirty,
      modelDupes: ok && !alreadyOnDisk && !prev.modelDupes.some((item) => item.id === pkg.id)
        ? [...prev.modelDupes, pkgToSave]
        : prev.modelDupes,
      status: ok
        ? `${reason}: "${pkg.name}" → ${result.dir}`
        : `${reason} failed: ${result.error ?? (artifactsOk ? 'unknown error' : 'model artifacts were not written')}`,
    }));
    return ok;
  };

  const markActiveModelDirty = () => {
    setModelMutationRevision((revision) => revision + 1);
    const current = stateRef.current;
    const doc = current.workspaceDocuments.find((item) => item.id === current.activeWorkspaceDocumentId);
    const id = doc?.kind === 'model' ? doc.sourceId : null;
    if (!id || current.modelDirty[id]) return;
    setState((prev) => ({ ...prev, modelDirty: { ...prev.modelDirty, [id]: true } }));
  };

  const saveWorldNowAll = (reason = 'Saved'): boolean => {
    const current = stateRef.current;
    const worldOk = flushWorldSave(current.activeMapStem, current.worldPieces, current.objects, current.mapPaint.zones, current.seq, current.worldFacades);
    const mapOk = flushMapDocumentPainting(current.activeMapStem);
    const globalsOk = saveGlobalsNow(current.worldGlobals);
    const ok = worldOk && mapOk && globalsOk;
    if (ok) setManualWorldDirty(false);
    setState((prev) => ({
      ...prev,
      openMenu: null,
      actionMenu: 'File',
      status: ok
        ? `${reason} map "${current.activeMapName}" and world globals`
        : `${reason} incomplete — world ${worldOk ? 'ok' : 'failed'}, painting ${mapOk ? 'ok' : 'failed'}, globals ${globalsOk ? 'ok' : 'failed'}`,
    }));
    return ok;
  };

  useEffect(() => {
    if (!persistenceSettings.autosave || !activeModelId || !activeModelOnDisk || !state.modelDirty[activeModelId]) return;
    const timer = setTimeout(
      () => saveActiveModelNow('Autosaved'),
      persistenceSettings.autosaveDelayMs,
    );
    return () => clearTimeout(timer);
  }, [
    persistenceSettings.autosave,
    persistenceSettings.autosaveDelayMs,
    activeModelId,
    activeModelOnDisk,
    state.modelDirty,
    liveUndoDepths.undo,
    modelMutationRevision,
  ]);

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
      .filter((asset) => {
        if (!needle) return true;
        const haystack = [
          asset.name,
          asset.recipe ?? '',
          asset.sourceKind ?? '',
          asset.sourceId ?? '',
          asset.semanticKind ?? '',
          ...(asset.stats ?? []),
        ].join(' ').toLowerCase();
        return haystack.includes(needle);
      })
      .sort(rankAssets);
  }, [catalogAssets, panelMode, state.contentFolder, state.search]);

  // editMs is the REAL measured apply time of this edit (Date.now around the
  // reducer). emptyMs/richMs mirror it — we don't yet measure the empty-vs-rich
  // distinction, so that delta is an honest 0 (never a fabricated number).
  const pushHistory = (prev: EditorState, command: Command, target: string, meta: string, editMs: number): Pick<EditorState, 'history' | 'redo' | 'seq'> => ({
    history: [
      { id: `h-${prev.seq}`, verb: command.name.split(' ')[0]!.toLowerCase(), target, meta, undoable: command.undoable, editMs, emptyMs: editMs, richMs: editMs },
      ...prev.history,
    ].slice(0, 8),
    redo: command.undoable ? [] : prev.redo,
    seq: prev.seq + 1,
  });

  // ── One mode at a time (req_2666 gap WW; modal-discipline law req_2626) ──────
  // Map Paint and the world click-tools are EXCLUSIVE viewport owners — the state
  // layer arbitrates, never presentation. This is the ONE paint-exit door every
  // tool-arming path shares: it routes the active flip through
  // applyMapPaintEffects exactly like the bar toggle (the host tool tracks the
  // transition; the pointer claim itself releases via the paintActive prop chain
  // into WorldViewport's __compiled_world_set_paint_mode effect). The dependent
  // texture-picker popover dies with the mode it belongs to.
  const withMapPaintOff = (prev: EditorState): EditorState => {
    if (!prev.mapPaint.active) return prev;
    const mapPaint = { ...prev.mapPaint, active: false, texturePickerOpen: false };
    applyMapPaintEffects(prev.mapPaint, mapPaint);
    return { ...prev, mapPaint };
  };

  // ── Named map-document lifecycle ───────────────────────────────────────────
  // A switch is a small transaction across the two persistence owners:
  // validate target world.json → synchronously flush BOTH outgoing concerns →
  // replace the native painting → persist/point at target → replace every
  // React-authored map slice. Any failure reloads the just-flushed outgoing
  // painting and leaves the active pointer/state untouched.
  const switchMapDocument = (
    stem: string,
    target: WorldSave,
    verb: 'opened' | 'created',
    name = mapDocumentName(stem),
    outgoingTriangles: number | null = null,
    bypassUnsavedPrompt = false,
    discardOutgoing = false,
    initializePainting: (() => GeneratedMapPaintingInstallation) | null = null,
  ) => {
    if (outgoingTriangles !== null) recordMapDocumentRenderStats(state.activeMapStem, outgoingTriangles);
    if (stem === state.activeMapStem) {
      setState((prev) => ({ ...prev, mapDocumentOpen: false, openMenu: null, status: `${name} is already the active map` }));
      return;
    }
    if (!mapHostLive()) {
      setState((prev) => ({ ...prev, status: 'map switch unavailable — rebuild/run the editor with the game-map host enabled' }));
      return;
    }

    if (!bypassUnsavedPrompt && !persistenceSettings.autosave && manualWorldDirty) {
      requestUnsavedDecision(
        state.activeMapName,
        () => { if (saveWorldNowAll()) switchMapDocument(stem, target, verb, name, outgoingTriangles, true, false, initializePainting); },
        () => switchMapDocument(stem, target, verb, name, outgoingTriangles, true, true, initializePainting),
        verb === 'created' ? () => { deleteMapDocument(stem, state.activeMapStem); } : undefined,
      );
      return;
    }

    const outgoingStem = state.activeMapStem;
    const outgoingZones = state.mapPaint.zones;
    if (!discardOutgoing && !flushWorldSave(outgoingStem, state.worldPieces, state.objects, outgoingZones, state.seq, state.worldFacades)) {
      setState((prev) => ({ ...prev, status: `map switch stopped — could not save ${outgoingStem}/world.json` }));
      return;
    }
    if (!discardOutgoing && !flushMapDocumentPainting(outgoingStem)) {
      setState((prev) => ({ ...prev, status: `map switch stopped — could not save ${outgoingStem}/painting.rmap` }));
      return;
    }

    // Old authoring events are audit-feed material only; drain them before the
    // target state lands so they cannot be mislabeled with the target's legend.
    mapEventDrain();
    const activation = activateMapDocumentPainting(stem, target.zones);
    if (!activation.ok) {
      const rollback = activateMapDocumentPainting(outgoingStem, outgoingZones);
      const cleanup = verb === 'created' && rollback.ok ? deleteMapDocument(stem, outgoingStem) : null;
      setState((prev) => ({
        ...prev,
        status: `map switch refused — ${activation.error}${rollback.ok ? '; current map restored' : `; WARNING: current map reload also failed (${rollback.error})`}${cleanup && !cleanup.ok ? `; incomplete map cleanup failed (${cleanup.error})` : ''}`,
      }));
      return;
    }

    const initialized = initializePainting?.() ?? null;
    if (initialized && !initialized.ok) {
      const rollback = activateMapDocumentPainting(outgoingStem, outgoingZones);
      const cleanup = verb === 'created' && rollback.ok ? deleteMapDocument(stem, outgoingStem) : null;
      setState((prev) => ({
        ...prev,
        status: `map generation stopped — ${initialized.error}${rollback.ok ? '; current map restored' : `; WARNING: current map reload also failed (${rollback.error})`}${cleanup && !cleanup.ok ? `; incomplete map cleanup failed (${cleanup.error})` : ''}`,
      }));
      return;
    }

    if (!saveWorldNow(target) || !setActiveMapDocumentStem(stem)) {
      const rollback = activateMapDocumentPainting(outgoingStem, outgoingZones);
      const cleanup = verb === 'created' && rollback.ok ? deleteMapDocument(stem, outgoingStem) : null;
      setState((prev) => ({
        ...prev,
        status: `map switch stopped — could not commit ${stem}'s world save/pointer${rollback.ok ? '; current map restored' : `; WARNING: current map reload failed (${rollback.error})`}${cleanup && !cleanup.ok ? `; incomplete map cleanup failed (${cleanup.error})` : ''}`,
      }));
      return;
    }

    const bindings = initialized?.bindings ?? activation.bindings;
    const contentSummary = initialized
      ? `${initialized.chunks} chunks, ${initialized.roads} roads, ${initialized.rails} rail lines, ${target.pieces.length} floor anchors`
      : activation.seeded
        ? 'clean seed chunk'
        : `${target.pieces.length} placed piece${target.pieces.length === 1 ? '' : 's'}`;
    skipNextWorldDirtyRef.current = true;
    setState((prev) => ({
      ...prev,
      ...mapAuthoringSlicesFor(prev, stem, target, bindings, name),
      openMenu: null,
      actionMenu: 'File',
      status: `${verb} map ${name} — ${contentSummary}; all map authoring switched together`,
    }));
    setManualWorldDirty(false);
  };

  const openMapDocument = (stem: string, currentTriangles: number | null = null) => {
    const result = readWorldSave(stem);
    if (result.status === 'invalid') {
      setState((prev) => ({ ...prev, status: `cannot open ${stem} — ${result.error}; current map left untouched` }));
      return;
    }
    const target = result.save ?? emptyWorldSave(stem, state.seq);
    switchMapDocument(stem, target, 'opened', mapDocumentName(stem), currentTriangles);
  };

  const createNewMap = (rawName = 'untitled', currentTriangles: number | null = null) => {
    let stem: string;
    try {
      stem = createMapDocument(rawName);
    } catch (error) {
      setState((prev) => ({ ...prev, status: `could not create map — ${(error as Error).message}; current map left untouched` }));
      return;
    }
    switchMapDocument(stem, emptyWorldSave(stem, state.seq), 'created', mapDocumentName(stem), currentTriangles);
  };

  const createCoastalMap = (rawName: string, seed: number, currentTriangles: number | null = null) => {
    if (!mapHostLive()) {
      setState((prev) => ({ ...prev, status: 'coastal generation unavailable — rebuild/run the editor with the game-map host enabled' }));
      return;
    }
    let plan: ReturnType<typeof generateCoastalCity>;
    let painting: ReturnType<typeof compileCoastalCityPainting>;
    try {
      plan = generateCoastalCity(seed);
      painting = compileCoastalCityPainting(plan);
    } catch (error) {
      setState((prev) => ({ ...prev, status: `coastal generation failed — ${(error as Error).message}; current map left untouched` }));
      return;
    }

    let stem: string;
    try {
      stem = createMapDocument(rawName);
    } catch (error) {
      setState((prev) => ({ ...prev, status: `could not create coastal map — ${(error as Error).message}; current map left untouched` }));
      return;
    }

    let target: WorldSave;
    try {
      target = coastalCityWorldSave(stem, state.seq, plan);
    } catch (error) {
      const cleanup = deleteMapDocument(stem, state.activeMapStem);
      setState((prev) => ({
        ...prev,
        status: `coastal document compile failed — ${(error as Error).message}; current map left untouched${cleanup.ok ? '' : `; incomplete map cleanup failed (${cleanup.error})`}`,
      }));
      return;
    }

    switchMapDocument(
      stem,
      target,
      'created',
      mapDocumentName(stem),
      currentTriangles,
      false,
      false,
      () => installGeneratedMapDocumentPainting(stem, target.zones, painting.chunks, painting.paths),
    );
  };

  const renameExistingMap = (stem: string, rawName: string, currentTriangles: number | null): boolean => {
    if (stem === state.activeMapStem && currentTriangles !== null) recordMapDocumentRenderStats(stem, currentTriangles);
    const result = renameMapDocument(stem, rawName);
    setState((prev) => ({
      ...prev,
      activeMapName: result.ok && stem === prev.activeMapStem ? result.name : prev.activeMapName,
      status: result.ok ? `renamed map to ${result.name}` : `map rename failed — ${result.error}`,
    }));
    return result.ok;
  };

  const deleteExistingMap = (stem: string): boolean => {
    const result = deleteMapDocument(stem, state.activeMapStem);
    setState((prev) => ({
      ...prev,
      status: result.ok ? `deleted map ${result.name} entirely` : `map delete refused — ${result.error}`,
    }));
    return result.ok;
  };

  const closeMapDocuments = (currentTriangles: number | null) => {
    if (currentTriangles !== null) recordMapDocumentRenderStats(state.activeMapStem, currentTriangles);
    setState((prev) => ({ ...prev, mapDocumentOpen: false, status: 'map workspaces closed' }));
  };

  const scaleBySourceRef = useRef('dock');
  const pathArraySourceRef = useRef('dock');
  const addPartSourceRef = useRef('dock');
  const applyScaleBy = (factor: number) => {
    const ok = withNativeMeshActionSource(scaleBySourceRef.current, () => modelToolApiRef.current?.scaleBy(factor) ?? false);
    setScaleByOpen(false);
    setState((prev) => ({
      ...prev,
      contextOpen: false,
      openMenu: null,
      status: ok
        ? `scaled selection ×${factor} around its pivot — one Undo; camera reframed unless locked`
        : 'scale by: select a part, face, edge, or vertices first',
    }));
  };

  const runMapHistory = (redo: boolean) => {
    const result = redo ? mapRedo() : mapUndo();
    const verb = redo ? 'redo' : 'undo';
    if (!result.ok) {
      setState((prev) => ({ ...prev, status: `nothing to ${verb} in Map Paint — its native gesture journal is empty` }));
      return;
    }
    // RMAP snapshots own their binding table too. Mirror it back into chrome
    // after a restore so a later tool patch cannot re-push stale material rows.
    const tileBindings = floatsToBindings(mapGetTileBindings());
    setState((prev) => ({
      ...prev,
      mapPaint: { ...prev.mapPaint, tileBindings },
      status: `${verb} ${MAP_HISTORY_LABEL[result.kind]} — ${result.undo} undo · ${result.redo} redo`,
    }));
  };

  const runCommand = (commandId: string, source: string) => {
    // Per-device tool memory (req_3089, GIMP semantics): activating a TOOL
    // command stamps the active device's slot for that tool's surface scope.
    // The device-flip subscription (below, next to runCommandRef) replays the
    // slot with source 'device' — which must not re-stamp, so replays skip.
    if (source !== 'device') {
      const cmd = commandById(commandId);
      if (cmd?.tool && (cmd.scope === 'world' || cmd.scope === 'model')) {
        const scope = cmd.scope;
        const dev = pointerDeviceRef.current;
        lastToolByScopeRef.current[scope] = commandId;
        setState((prev) => (prev.deviceTools[scope][dev] === commandId ? prev : {
          ...prev,
          deviceTools: { ...prev.deviceTools, [scope]: { ...prev.deviceTools[scope], [dev]: commandId } },
        }));
      }
    } else {
      const cmd = commandById(commandId);
      if (cmd?.tool && (cmd.scope === 'world' || cmd.scope === 'model')) lastToolByScopeRef.current[cmd.scope] = commandId;
    }
    if (commandId === 'paint-facade') {
      const pieceId = stateRef.current.selectedPieceId;
      if (pieceId) openFacadePainter(pieceId, source === 'world-context' ? facadeContextSideRef.current : 'front');
      else setState((prev) => ({ ...prev, status: 'Paint Facade — select or right-click a wall piece first', contextOpen: false }));
      return;
    }
    if (commandId === 'open-preferences') {
      setPreferencesOpen((open) => !open);
      setState((prev) => ({ ...prev, openMenu: null, status: preferencesOpen ? 'preferences closed' : 'preferences opened' }));
      return;
    }
    // Migrated report-only controls: every projection crosses the framework authority
    // before any cart-local dispatcher logic can select a second behavior.
    if (commandId === WORLD_FLOOR_STEP_COMMAND_ID) {
      invokeApplicationCommand(commandId, { delta: 1 }, source);
      return;
    }
    if (isWorldToolCommandId(commandId)) {
      invokeApplicationCommand(commandId, {}, source);
      return;
    }
    if ((commandId === 'undo-local' || commandId === 'redo-local') &&
        activeSurface(stateRef.current) === 'world' && !stateRef.current.mapPaint.active) {
      const undo = commandId === 'undo-local';
      const entry = undo ? stateRef.current.worldUndo[0] : stateRef.current.worldRedo[0];
      invokeApplicationCommand(
        undo ? WORLD_UNDO_COMMAND_ID : WORLD_REDO_COMMAND_ID,
        {},
        source,
        entry?.actionId ? { actionId: entry.actionId, causedBy: entry.actionId } : {},
      );
      return;
    }
    if ((commandId === 'undo-local' || commandId === 'redo-local') && activeSurface(stateRef.current) === 'material') {
      const undo = commandId === 'undo-local';
      const entry = undo ? colorStudioHistoryRef.current.undo[0] : colorStudioHistoryRef.current.redo[0];
      invokeApplicationCommand(
        undo ? COLOR_STUDIO_UNDO_COMMAND_ID : COLOR_STUDIO_REDO_COMMAND_ID,
        {},
        source,
        entry ? { actionId: entry.actionId, causedBy: entry.actionId } : {},
      );
      return;
    }
    const command = commandById(commandId);
    // Modal discipline (req_2626 HH): while a blocking session/dialog is unresolved every
    // command is inert except the one that CLOSES the blocker. The refusal is loud (status
    // line), never a silent swallow — and never a stacked op over a captured base mesh.
    {
      const block = blockingNow(state);
      if (block && commandId !== block.closerCommandId) { refuseBlocked(block); return; }
    }
    if (commandId === 'new-map') {
      createNewMap('untitled');
      return;
    }
    // Paint resolution (Edit → Mesh → Paint → Paint Resolution): set exact texels/triangle on the
    // viewer. The host clamps dense meshes to the atlas budget; the readout reflects what took.
    if (commandId.startsWith('mesh-paint-res-')) {
      const px = Number(commandId.slice('mesh-paint-res-'.length));
      const applied = modelToolApiRef.current?.changeDetail(px) ?? px;
      // Shout when the atlas budget clamped the pick — otherwise a plateau at high detail looks
      // like a brush bug when it's really "this mesh has too many faces for that many texels".
      const status = applied < px
        ? `Paint resolution ${px} clamped → ${applied}×${applied} (atlas budget — fewer faces or lower detail for finer than this)`
        : `Paint resolution → ${px}×${px} texels/triangle`;
      setState((prev) => ({ ...prev, openMenu: null, status }));
      return;
    }
    // Add Primitive (Edit → Mesh → Add Primitive → <kind>): the 'add' verb — append a part to the
    // model in view. Opens the size/resolution dialog in add mode; the outliner + shares this path.
    if (commandId.startsWith('add-mesh-')) {
      const kind = commandId.slice('add-mesh-'.length) as PrimitiveKind;
      addPartSourceRef.current = source;
      setState((prev) => ({ ...prev, openMenu: null, contextOpen: false, actionMenu: 'Edit', newMeshPrompt: { kind, mode: 'add' } }));
      return;
    }
    // Studio-parity mesh ops — these change PART structure (or journaled mesh state),
    // so they route through dedicated handlers that keep the outliner metadata true.
    // Must run BEFORE the generic model-tool router below (same 'model' surface).
    if (commandId === 'mesh-detach') { runDetachSelection(source); return; }
    if (commandId === 'mesh-flip-face') { runFaceOp('flip', source); return; }
    if (commandId === 'mesh-glass') { runFaceOp('glass', source); return; }
    if (commandId === 'mesh-solidify') { runFaceOp('solidify', source); return; }
    // Outliner multi-select is carried host-side as a face selection so the gizmo can
    // move the union. In that state M / the face command means structural PART merge,
    // never "turn every face in these parts into one face" (req_2870).
    if (commandId === 'mesh-merge-faces') {
      if (selectedPartCount >= 2) mergeSelectedParts(source);
      else runFaceOp('merge-faces', source);
      return;
    }
    if (commandId === 'mesh-duplicate-part') { duplicatePartById(state.modelActivePartId, -1, source); return; }
    if (commandId === 'mesh-path-array') { pathArraySourceRef.current = source; openPathArrayPrompt(); return; }
    if (commandId === 'mesh-mirror-x') { duplicatePartById(state.modelActivePartId, 0, source); return; }
    if (commandId === 'mesh-mirror-y') { duplicatePartById(state.modelActivePartId, 1, source); return; }
    if (commandId === 'mesh-mirror-z') { duplicatePartById(state.modelActivePartId, 2, source); return; }
    if (commandId === 'mesh-merge-down') { mergeSelectedParts(source); return; }
    if (commandId === 'mesh-import-part') {
      setImportPartOpen(true);
      setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: 'pick a library model to append as part(s)' }));
      return;
    }
    // Reference images (req_2758): the viewer owns the tracing backdrops + their panel.
    if (commandId === 'model-ref-images') {
      modelToolApiRef.current?.referenceImages();
      setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: 'reference images — add a blueprint/photo to trace over' }));
      return;
    }
    if (commandId === 'mesh-scale-by') {
      scaleBySourceRef.current = source;
      setScaleByOpen(true);
      setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: `Scale By opened — ${source}` }));
      return;
    }
    // Model-surface tools route to the viewer's host-native tool api; the viewer
    // owns the state and reports it back, so we don't mutate world state here.
    // Route to the viewer's mesh-tool API — but ONLY for actual mesh TOOLS (all
    // 'mesh-' prefixed). isMeshToolCommand is `scope === 'model'`, which also
    // matches non-tool model commands (save-snapshot, export-build-piece-*); the
    // prefix guard keeps this router from swallowing them before their handlers
    // (req_2585 — the export leaf hit this and silently no-op'd).
    if (commandId.startsWith('mesh-') && isMeshToolCommand(commandId)) {
      const api = modelToolApiRef.current;
      if (api) withNativeMeshActionSource(source, () => {
        if (commandId === 'mesh-vertex') api.selMode(1);
        else if (commandId === 'mesh-edge') api.selMode(2);
        else if (commandId === 'mesh-face') api.selMode(3);
        else if (commandId === 'mesh-move') api.gizmo(0);
        else if (commandId === 'mesh-scale') api.gizmo(1);
        else if (commandId === 'mesh-rotate') api.gizmo(2);
        else if (commandId === 'mesh-paint') api.paint();
        else if (commandId === 'mesh-focus') api.focus();
        else if (commandId === 'mesh-wire') api.wire();
        else if (commandId === 'mesh-cam-lock') api.camLock();
        else if (commandId === 'mesh-cam-store') api.camStore();
        else if (commandId === 'mesh-cam-recall') api.camRecall();
        else if (commandId === 'mesh-sym-x') api.toggleMirror(0);
        else if (commandId === 'mesh-sym-y') api.toggleMirror(1);
        else if (commandId === 'mesh-sym-z') api.toggleMirror(2);
        else if (commandId === 'mesh-extrude') (state.modelTool.selMode === 3 ? api.extrudeFace() : api.extrudeEdge());
        else if (commandId === 'mesh-extrude-face') api.extrudeFace();
        else if (commandId === 'mesh-create-face') api.createFace();
        else if (commandId === 'mesh-loopcut') api.loopCut();
        else if (commandId === 'mesh-cut') api.basicCut();
        else if (commandId === 'mesh-paint-fill') api.brushTool('fill');
        else if (commandId === 'mesh-paint-brush') api.brushTool('brush');
        else if (commandId === 'mesh-paint-safety') api.cycleSafety();
        else if (commandId === 'mesh-paint-detail') api.cycleDetail();
      });
      setState((prev) => ({ ...prev, status: `${command.name} - ${source}` }));
      return;
    }
    // World-piece quick verbs: legacy menu/key ids are only input routing now.
    // Authored Rotate/Delete and report-only placement-preview rotation cross
    // distinct command identities; no branch below owns their mutation.
    if (command.id === 'delete-selection' || command.id === WORLD_PIECE_DELETE_COMMAND_ID ||
        command.id === 'duplicate-selection' || command.id === WORLD_PIECE_ROTATE_COMMAND_ID) {
      const current = stateRef.current;
      const doc = current.workspaceDocuments.find((d) => d.id === current.activeWorkspaceDocumentId);
      if (doc?.kind === 'world') {
        if (command.id === 'duplicate-selection') {
          if (current.selectedPieceId) copyPiece(current.selectedPieceId);
          else setState((prev) => ({ ...prev, status: 'select a placed piece to copy' }));
          return;
        }
        if (command.id === 'delete-selection' || command.id === WORLD_PIECE_DELETE_COMMAND_ID) {
          invokeApplicationCommand(WORLD_PIECE_DELETE_COMMAND_ID, {
            documentId: current.activeMapStem,
            pieceId: current.selectedPieceId ?? '',
          }, source);
          return;
        }
        if (current.selectedPieceId) {
          invokeApplicationCommand(WORLD_PIECE_ROTATE_COMMAND_ID, {
            documentId: current.activeMapStem,
            pieceId: current.selectedPieceId,
            quarterTurns: 1,
          }, source);
          return;
        }
        if (current.activeCommandId === 'place-piece' && current.armedPieceId) {
          invokeApplicationCommand(WORLD_PLACEMENT_ROTATE_COMMAND_ID, {}, source);
          return;
        }
        invokeApplicationCommand(WORLD_PIECE_ROTATE_COMMAND_ID, {
          documentId: current.activeMapStem,
          pieceId: '',
          quarterTurns: 1,
        }, source);
        return;
      }
      if (command.id === WORLD_PIECE_ROTATE_COMMAND_ID) {
        setState((prev) => ({ ...prev, status: 'select a placed piece, or arm one in Place mode, to rotate' }));
        return;
      }
    }
    // Spin (SPINPROP req_3128): toggle the selected piece's continuous visual spin —
    // ON at the one shared sign rate, OFF back to static. The transaction owns undo.
    if (command.id === WORLD_PIECE_SPIN_COMMAND_ID) {
      const current = stateRef.current;
      const doc = current.workspaceDocuments.find((d) => d.id === current.activeWorkspaceDocumentId);
      if (doc?.kind !== 'world' || !current.selectedPieceId) {
        setState((prev) => ({ ...prev, status: 'select a placed prop to spin' }));
        return;
      }
      const piece = current.worldPieces.find((p) => p.id === current.selectedPieceId);
      invokeApplicationCommand(WORLD_PIECE_SPIN_COMMAND_ID, {
        documentId: current.activeMapStem,
        pieceId: current.selectedPieceId,
        spinDegPerSec: (piece?.spinDegPerSec ?? 0) !== 0 ? 0 : PIECE_SPIN_RATE_DEG_PER_SEC,
      }, source);
      return;
    }
    // Delete Selection on a model document deletes the mesh selection (not a world object).
    if (command.id === 'delete-selection') {
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      if (doc?.kind === 'model') {
        withNativeMeshActionSource(source, () => modelToolApiRef.current?.deleteSelection());
        setState((prev) => ({ ...prev, status: 'deleted mesh selection' }));
        return;
      }
    }
    if (command.id === 'undo-local') {
      // On a model document Ctrl+Z drives the HOST mesh journal (geometry, parts,
      // paint colours all restore); the world surface keeps its local history list.
      // While the PAINT SESSION is live the STROKE journal owns undo (req_2672) — an
      // empty stroke journal refuses honestly, it never falls through to the mesh
      // journal (mid-paint mesh mutations are gated anyway).
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      if (doc?.kind === 'model') {
        if (state.modelTool.paint) { paintUndoRedo(false); return; }
        meshUndoRedo(false, source);
        return;
      }
      if (doc?.kind === 'world' && state.mapPaint.active) {
        runMapHistory(false);
        return;
      }
      undoLocal();
      return;
    }
    if (command.id === 'redo-local') {
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      if (doc?.kind === 'model') {
        if (state.modelTool.paint) { paintUndoRedo(true); return; }
        meshUndoRedo(true, source);
        return;
      }
      if (doc?.kind === 'world' && state.mapPaint.active) {
        runMapHistory(true);
        return;
      }
      redoLocal();
      return;
    }
    if (command.id === 'save-snapshot') {
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      const pkg = doc?.kind === 'model' ? effectiveModelPackage(doc.sourceId, state.modelOverrides, state.modelDupes) : null;
      if (!pkg) {
        saveWorldNowAll();
        return;
      }
      saveActiveModelNow('Saved');
      return;
    }
    if (command.id.startsWith('export-build-piece-') || command.id.startsWith('export-prop')) {
      // Export → Build Piece → <kind> (req_2583) / Export → Prop (req_2712):
      // register the OPEN model as a placeable and arm it. THE MANIFEST IS THE
      // RECORD (USER RULING req_2718): the export writes `placeable` (+ the
      // compiled RIG skeleton for props) into the model's own package on disk,
      // and every boot re-derives the palette from that scan — localstore only
      // caches. The status ALWAYS reports — a silent no-op is what made this
      // feel dead before.
      const propTarget = propExportTargetForCommand(command.id);
      const exportTarget = propTarget
        ? null
        : buildPieceExportTarget(command.id.slice('export-build-piece-'.length));
      const kind: PlaceableKind | null = propTarget ? 'prop' : (exportTarget?.kind ?? null);
      if (!kind) {
        setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: `Unknown build-piece export target: ${command.id}` }));
        return;
      }
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      // Effective package: the exported piece's label carries the renamed name (req_2620 S).
      const pkg = doc?.kind === 'model' ? effectiveModelPackage(doc.sourceId, state.modelOverrides, state.modelDupes) : null;
      if (!pkg) {
        setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: 'Export needs a MODEL open — open one from Models, then File → Export.' }));
        return;
      }
      const modelId = authoredModelIdForPackage(pkg.id);
      // Export implies save (req_2753): journal the resident HOST mesh into the package
      // first (mesh/doc.blob + parts.json + base.blob), so the geometry captured below —
      // and every future boot — resolves the mesh YOU SEE, never the parts' primitive
      // seeds. The manifest lands right after (firstMaterialize / placeable patch).
      const liveParts = state.modelParts[pkg.id];
      // The declaration says this is a door; the named Outliner part says WHICH
      // geometry moves. Keep both sides mandatory, exactly like the old Studio
      // compiler, so a coincidental name never promotes a plain wall and an
      // explicit Door Wall never silently cooks as a solid slab.
      if (exportTarget?.edit === 'door' || exportTarget?.edit === 'garageDoor') {
        const leaf = resolveDoorLeafPart(liveParts ?? []);
        if (!leaf.ok) {
          setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: leaf.error }));
          return;
        }
      }
      const docWritten = writeModelArtifacts(
        pkg,
        partsMetaFromRows(liveParts ?? []),
        meshDocPartRangesFromRows(liveParts ?? []) ?? undefined,
        partShrinkSaveOptions(pkg.id, liveParts?.length ?? 0),
      );
      if (!docWritten) {
        setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: 'Export stopped: the model document could not be saved without losing part ranges.' }));
        return;
      }
      consumePartShrinkAuthorization(pkg.id);
      // Resolve the geometry through the ONE resolver the viewer uses — the package
      // meshdoc just written (host truth), else live seed parts, else the package
      // resolver. Cache it so the resident builder draws exactly what you see.
      const liveComposed = !docWritten && liveParts ? composeModelParts(liveParts).positions : null;
      const captured = (liveComposed && liveComposed.length >= 8 ? liveComposed : null) ?? modelPackageMeshData(pkg);
      if (exportTarget?.edit === 'door' || exportTarget?.edit === 'garageDoor') {
        const savedDoc = packageMeshDoc(pkg);
        const savedParts = packageMeshDocParts(pkg);
        const compiled = captured && savedDoc && savedParts
          ? compileDoorMesh(captured, savedDoc, savedParts)
          : { ok: false as const, error: 'Door Wall export could not read the saved mesh/Outliner document; save the model, then retry.' };
        if (!compiled.ok) {
          setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: compiled.error }));
          return;
        }
      }
      if (captured && captured.length >= 8) cacheAuthoredMesh(modelId, captured);
      const verts = authoredMeshData(modelId, pkg.id);
      const vcount = verts ? Math.floor(verts.length / 8) : 0;
      // The export declaration + rig. A prop compiles its rig draft (the
      // Inspector's Rig section; else the stored skeleton re-projected) into the
      // exported skeleton — contact positions measured off the REAL mesh bounds,
      // never hand-typed. A build piece keeps whatever skeleton it already has.
      const placeable: ModelPlaceable = kind === 'prop'
        ? { as: 'prop', role: propTarget?.role ?? 'scenery' }
        : { as: 'build-piece', kind, ...(exportTarget?.edit ? { edit: exportTarget.edit } : {}) };
      const bounds = authoredMeshBounds(modelId, pkg.id);
      const rig = state.modelRigs[pkg.id] ?? (pkg.skeleton ? skeletonToPropRig(pkg.skeleton) : {});
      const skeleton = kind === 'prop' && bounds ? propRigToSkeleton(modelId, modelId, rig, bounds) : pkg.skeleton;
      const pkgExported: ModelPackage = { ...pkg, placeable, skeleton };
      // DISK TRUTH: write the declaration into the package. A never-saved model
      // materializes first (export implies save — the mesh blob must be on disk
      // for any other machine to render this placeable at all).
      const firstMaterialize = !isMaterialized(pkg.kind, pkg.id);
      let disk: string;
      if (firstMaterialize) {
        // Artifacts (meshdoc/base.blob/atlas) already landed above; this writes the manifest.
        const res = materializeModelPackage(pkgExported);
        disk = res.ok ? `package materialized → ${res.dir}` : `PACKAGE WRITE FAILED (${res.error ?? 'unknown'}) — export is session-only`;
      } else {
        disk = updateManifestPlaceable(pkg.kind, pkg.id, { placeable, skeleton })
          ? 'manifest updated'
          : 'MANIFEST WRITE FAILED — export is session-only';
      }
      upsertSavedPackage(pkgExported); // the live roster carries the declaration this session
      const piece: AuthoredBuildPiece = {
        id: authoredIdFor(modelId, kind), modelId, pkgId: pkg.id, label: pkg.name, kind, hex: pkg.color,
        ...(exportTarget?.edit ? { edit: exportTarget.edit } : {}),
        ...(propTarget ? { propRole: propTarget.role } : {}),
      };
      // A painted export contributes one palette tile per STORED painting, with
      // no extra mutable base duplicate. Arm the newest visible skin (or the
      // base fallback when there are no saved skins) so Export never arms a
      // hidden/stale entry that the tray itself does not offer.
      const armedPieceId = preferredAuthoredPaletteId(piece);
      const kindLabel = kind === 'prop'
        ? `${propTarget?.label ?? 'Scenery Prop'} [${describePropRig(rig)}]`
        : `${exportTarget?.label ?? kind} build piece`;
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'Build',
        authoredBuildPieces: [...prev.authoredBuildPieces.filter((p) => p.id !== piece.id), piece],
        armedPieceId,
        armedYawDegrees: 0,
        // The gallery/tree memo keys off modelDupes: a first materialize joins it
        // (same move as Save); an existing dupe refreshes so it carries the
        // export declaration instead of shadowing the roster with a stale copy.
        modelDupes: prev.modelDupes.some((m) => m.id === pkg.id)
          ? prev.modelDupes.map((m) => (m.id === pkg.id ? pkgExported : m))
          : firstMaterialize ? [...prev.modelDupes, pkgExported] : prev.modelDupes,
        status: vcount > 0
          ? `Exported "${pkg.name}" as a ${kindLabel} (${vcount} verts) — ${disk}. Armed; enter Build (B) to place it.`
          : `Exported "${pkg.name}" as a ${kindLabel}, but its geometry isn't reachable (0 verts). Open it in the model editor, save, then re-export. (${modelId})`,
      }));
      return;
    }
    if (command.id.startsWith('new-mesh-')) {
      // New Mesh (File → New Mesh → <kind>): the 'new' verb — ALWAYS a fresh model document, even
      // with a model already open. Prompt for size + resolution first; createNewMeshDocument builds
      // it on confirm. (Appending a part to the model in view is the separate 'add' verb above.)
      const kind = command.id.slice('new-mesh-'.length) as PrimitiveKind;
      setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', newMeshPrompt: { kind, mode: 'new' } }));
      return;
    }
    if (command.id.startsWith('new-build-starter-')) {
      const starterId = command.id.slice('new-build-starter-'.length) as BuildPieceStarterId;
      createBuildPieceStarterDocument(starterId);
      return;
    }
    if (command.id === 'new-model-player') {
      // New Mesh → Player / NPC Model: the starter opens straight into the editor —
      // its dimensions are the stand-pose data table, so there is no size dialog.
      createPlayerModelDocument();
      return;
    }
    if (command.id === 'export-character') {
      // Export → Player / NPC Model (req_2771): the ROLE choice gates the write —
      // open the dialog; exportCharacterAs(role) runs the export on confirm.
      const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
      if (doc?.kind !== 'model' || !doc.sourceId) {
        setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: 'Export needs a MODEL open — open one from Models, then File → Export.' }));
        return;
      }
      setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', exportCharacterPrompt: true, status: 'export character — choose the role' }));
      return;
    }
    if (command.id === 'open-map') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'File',
        mapDocumentOpen: true,
        status: `map workspaces — ${prev.activeMapName} is active`,
      }));
      return;
    }
    if (command.id === 'open-file-explorer' || command.id === 'find-import-source') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'File',
        fileExplorerOpen: true,
        // Import search = jump straight to the Models import-class folder.
        fileExplorerFolder: command.id === 'find-import-source' ? 'virt:models' : prev.fileExplorerFolder,
        status: command.id === 'find-import-source'
          ? 'asset explorer opened on importable models'
          : 'asset explorer opened',
      }));
      return;
    }
    if (command.id === 'add-chunk') {
      // Map → Add Chunk… (req_2703): the 2D chunk-topology dialog; growth runs
      // through the host doors and the viewport mirrors the new ground live.
      setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'Map', addChunkOpen: true, status: 'add chunk — press a + at an open edge' }));
      return;
    }
    if (command.id === 'import-model-file') {
      setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File' }));
      void importModelFromDisk();
      return;
    }
    // Globals menu (GLOBALS req_2770): open (or re-focus) the PLAYTEST tab — the
    // editor world with the embodied player — and the focus panel becomes the
    // physics-globals editor (Inspector's playtest branch). Tune, jump, lock in.
    if (command.id === 'globals-physics') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'Globals',
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, PLAYTEST_DOCUMENT),
        activeWorkspaceDocumentId: PLAYTEST_DOCUMENT.id,
        status: 'playtest opened — WASD/Shift/Space drive the player; physics globals in the focus panel apply live',
      }));
      return;
    }
    // Globals → Animation (req_2786): the CAPTURE tab — webcam feed beside the
    // exported player model with live pose sync; record grows from here.
    if (command.id === 'globals-animation') {
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'Globals',
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, ANIMATION_DOCUMENT),
        activeWorkspaceDocumentId: ANIMATION_DOCUMENT.id,
        status: 'animation capture opened — stand in front of the webcam; the exported player model mirrors the tracked pose',
      }));
      return;
    }
    // Window menu — real toggles over the existing dock popovers/dialog (open one, close the
    // sibling popovers so only one owns the corner at a time).
    if (command.id === 'toggle-eventbus') {
      setState((prev) => ({ ...prev, openMenu: null, eventbusPopoverOpen: !prev.eventbusPopoverOpen, perfPopoverOpen: false, memoryPopoverOpen: false, status: prev.eventbusPopoverOpen ? 'event bus closed' : 'event bus opened' }));
      return;
    }
    if (command.id === 'toggle-performance') {
      setState((prev) => ({ ...prev, openMenu: null, perfPopoverOpen: !prev.perfPopoverOpen, eventbusPopoverOpen: false, memoryPopoverOpen: false, status: prev.perfPopoverOpen ? 'performance closed' : 'performance opened' }));
      return;
    }
    if (command.id === 'toggle-memory') {
      setState((prev) => ({ ...prev, openMenu: null, memoryPopoverOpen: !prev.memoryPopoverOpen, eventbusPopoverOpen: false, perfPopoverOpen: false, status: prev.memoryPopoverOpen ? 'memory closed' : 'memory opened' }));
      return;
    }
    if (command.id === 'toggle-build-journal') {
      setState((prev) => ({ ...prev, openMenu: null, buildDialogOpen: !prev.buildDialogOpen, status: prev.buildDialogOpen ? 'build journal closed' : 'build journal opened' }));
      return;
    }

    setState((prev0) => {
      const t0 = Date.now();
      // One mode at a time (req_2666 WW): arming ANY tool here EXITS Map Paint
      // through the shared withMapPaintOff door. 'B' mid-paint is a one-keypress
      // mode SWAP (paint down, Place Piece armed — never ignored, never stacked);
      // Esc keeps its meaning (paint down, back to the neutral Select tool).
      const prev = command.tool ? withMapPaintOff(prev0) : prev0;
      const paintDropped = prev !== prev0;
      const object = selectedObject(prev);
      const asset = assetById(prev.activeAssetId, prev.assetOverrides);
      let next: EditorState = {
        ...prev,
        openMenu: source === 'stage' ? prev.openMenu : null,
        actionMenu: command.menu,
        activeCommandId: command.tool ? command.id : prev.activeCommandId,
        status: `${command.name} - ${source}${paintDropped ? ' — map paint off (one mode at a time)' : ''}`,
        contextOpen: source === 'context' ? false : prev.contextOpen,
      };

      if (command.id === 'toggle-minimap') {
        next = { ...next, rightPane: prev.rightPane === 'grid' ? 'inspector' : 'grid' };
      } else if (command.id === 'open-color-studio') {
        const doc = materialDocument(asset);
        next = {
          ...next,
          materialFocused: true,
          workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
          activeWorkspaceDocumentId: doc.id,
          contextOpen: false,
          openMenu: null,
        };
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
      }

      const target = object.name;
      const editMs = Date.now() - t0;
      const event = pushHistory(prev, command, target, `${source} - ${command.native ? 'native-ready' : 'design-only'}`, editMs);
      // Any world slice this command touched becomes a REAL reversible entry
      // (recordWorldEdit self-no-ops for commands that changed none — req_2620 W).
      return recordWorldEdit(prev, { ...next, ...event }, command.name.toLowerCase());
    });
  };

  // ── Real world undo (req_2620 gap W) ─────────────────────────────────────────
  // Every world-surface mutation records the slices it changed (references — the
  // immutable-update chain makes an entry cost pointers, not copies) onto a bounded
  // stack. undoLocal/redoLocal REVERT/REAPPLY those slices. The old shape only
  // spliced entries out of the 8-deep history FEED — it reverted nothing (the
  // placebo); the feed is display-only now. NOT covered (host-side, never in
  // EditorState): map paint strokes and in-viewer mesh edits — mesh docs route to
  // the host mesh journal instead (meshUndoRedo below).
  const WORLD_UNDO_CAP = 32;
  const WORLD_UNDO_KEYS = ['worldPieces', 'objects', 'authoredBuildPieces', 'selectedPieceId', 'selectedPieceIds', 'selectedObjectId', 'armedPieceId'] as const;
  const recordWorldEdit = (
    prev: EditorState,
    next: EditorState,
    label: string,
    identity: { actionId: string; commandId: string } | null = null,
  ): EditorState => {
    const before: WorldUndoSlices = {};
    const after: WorldUndoSlices = {};
    let changed = false;
    for (const k of WORLD_UNDO_KEYS) {
      if (prev[k] !== next[k]) {
        (before as Record<string, unknown>)[k] = prev[k];
        (after as Record<string, unknown>)[k] = next[k];
        changed = true;
      }
    }
    if (!changed) return next;
    return {
      ...next,
      worldUndo: [{ label, before, after, ...(identity ?? {}) }, ...prev.worldUndo].slice(0, WORLD_UNDO_CAP),
      worldRedo: [],
    };
  };

  const undoLocal = () => {
    setState((prev) => {
      const [entry, ...rest] = prev.worldUndo;
      if (!entry) return { ...prev, status: 'nothing to undo on the world — piece/slot/object edits are covered; map paint strokes are host-side and not undoable yet' };
      return {
        ...prev,
        ...entry.before,
        worldUndo: rest,
        worldRedo: [entry, ...prev.worldRedo].slice(0, WORLD_UNDO_CAP),
        status: `undid ${entry.label} — restored ${Object.keys(entry.before).join(', ')}`,
      };
    });
  };

  const redoLocal = () => {
    setState((prev) => {
      const [entry, ...rest] = prev.worldRedo;
      if (!entry) return { ...prev, status: 'nothing to redo on the world' };
      return {
        ...prev,
        ...entry.after,
        worldRedo: rest,
        worldUndo: [entry, ...prev.worldUndo].slice(0, WORLD_UNDO_CAP),
        status: `redid ${entry.label} — reapplied ${Object.keys(entry.after).join(', ')}`,
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

  // ── World pieces (req_2563 Phase 1): the real placed-piece model lives in
  // EditorState now. WorldEditorSurface reports placements/picks up here; the
  // Inspector reads state.selectedPieceId. This retires the phantom `objects`
  // path as the world surface's selection source.
  const placePieces = (pieces: PlacedPiece[], gesture: PlacementGesture) => {
    if (!pieces.length) return;
    // The viewport resolves camera/pointer geometry only. Identity allocation,
    // copy stamping, footprint replacement, undo data, mutation, and reporting
    // all happen behind the one semantic command entrance.
    invokeApplicationCommand(WORLD_PIECES_PLACE_COMMAND_ID, {
      documentId: stateRef.current.activeMapStem,
      candidates: pieces,
      gesture,
      stamp: stateRef.current.armedStamp,
    }, 'viewport');
  };

  /** Commit one viewport drag after its local snapped preview has settled. This
   *  is deliberately one state transition on drop — WorldViewport owns the
   *  per-pointer preview so dragging cannot put React/the live overlay on the
   *  frame path. Destination collisions follow placement's existing slot policy:
   *  moving a wall onto another wall replaces the destination, never duplicates. */
  const movePiece = (id: string, destination: PlacedPiece) => {
    const current = stateRef.current;
    const piece = current.worldPieces.find((item) => item.id === id);
    if (!piece) {
      setState((prev) => ({ ...prev, status: 'move: that piece is gone' }));
      return;
    }
    const floor = destination.floor ?? piece.floor ?? 0;
    const unchanged = piece.x === destination.x
      && piece.y === destination.y
      && piece.z === destination.z
      && piece.yawDegrees === destination.yawDegrees
      && (piece.floor ?? 0) === floor;
    if (unchanged) {
      setState((prev) => ({ ...prev, status: `${piece.pieceId} stayed put` }));
      return;
    }
    invokeApplicationCommand(WORLD_PIECE_MOVE_COMMAND_ID, {
      documentId: current.activeMapStem,
      pieceId: id,
      transform: {
        x: destination.x,
        y: destination.y,
        z: destination.z,
        yawDegrees: destination.yawDegrees,
        floor,
      },
    }, 'viewport');
  };

  const selectPiece = (id: string | null, additive = false) => {
    setState((prev) => {
      // Shift without a drag is the additive-selection gesture. Missing empty
      // ground while holding it must not discard the set the author is building.
      if (!id && additive) return prev;
      return {
        ...prev,
        selectedPieceId: id,
        selectedPieceIds: id
          ? (additive ? [...prev.selectedPieceIds.filter((selectedId) => selectedId !== id), id] : [id])
          : [],
        status: id
          ? `${additive ? 'added' : 'selected'} ${prev.worldPieces.find((p) => p.id === id)?.pieceId ?? id}${additive ? ` · ${prev.selectedPieceIds.includes(id) ? prev.selectedPieceIds.length : prev.selectedPieceIds.length + 1} pieces` : ''}`
          : 'cleared world selection',
      };
    });
  };

  const armPiece = (pieceId: string) => {
    setState((prev) => ({
      ...prev,
      armedPieceId: pieceId,
      armedYawDegrees: 0,
      // A palette arm drops any copy stamp (req_2733) — you're placing the
      // DEFINITION again, not the copied instance's materials.
      armedStamp: null,
      // Arming a piece opens the focus panel on it (Build mode) and clears any
      // placed-piece selection so the panel shows the DEFINITION, not an instance.
      selectedPieceId: null,
      selectedPieceIds: [],
      status: `armed ${pieceId}`,
    }));
  };

  // RIG draft edits (req_2712/2713): the Inspector's Rig section patches the
  // whole draft per package id. Marks the model dirty — Save/Export both compile
  // the draft into the manifest skeleton, so the save chip tells the truth.
  const setModelRig = (pkgId: string, rig: PropRig) => {
    setState((prev) => ({
      ...prev,
      modelRigs: { ...prev.modelRigs, [pkgId]: rig },
      modelDirty: { ...prev.modelDirty, [pkgId]: true },
      status: `rig: ${describePropRig(rig)}`,
    }));
  };

  // One semantic material command serves the viewport stroke, Inspector slot,
  // and quick-menu projections. The viewport supplies a whole pointer gesture,
  // so a drag across many faces remains one undo/eventbus action.
  const assignPieceMaterials = (
    targets: readonly PieceMaterialTarget[],
    assetId: string,
    source: string,
  ) => invokeApplicationCommand(WORLD_PIECE_MATERIAL_ASSIGN_COMMAND_ID, {
    documentId: stateRef.current.activeMapStem,
    targets,
    materialAssetId: assetId,
  }, source);
  const paintPieceFaces = (targets: readonly PieceMaterialTarget[]) =>
    assignPieceMaterials(targets, stateRef.current.activeAssetId, 'viewport');
  const assignPieceSlotAsset = (id: string, role: string | null, assetId: string, source = 'context') =>
    assignPieceMaterials([{ pieceId: id, roles: role ? [role] : 'all' }], assetId, source);
  const assignPieceSlot = (id: string, role: string) =>
    assignPieceSlotAsset(id, role, stateRef.current.activeAssetId, 'focus-panel');

  // Paint Facade (req_3062): the explicit selection is authoritative scope,
  // including a one-piece selection.
  const openFacadePainter = (pieceId: string, side: 'front' | 'back' = 'front') => {
    setState((prev) => {
      if (!prev.worldPieces.some((piece) => piece.id === pieceId)) return prev;
      const selectedIds = prev.selectedPieceIds.includes(pieceId) ? prev.selectedPieceIds : [pieceId];
      const selected = selectedIds
        .map((id) => prev.worldPieces.find((piece) => piece.id === id))
        .filter((piece): piece is NonNullable<typeof piece> => !!piece);
      const created = facadeFromSelection(selected, `facade-${prev.seq}`, side);
      const existing = created ? prev.worldFacades.find((candidate) => candidate.pieceIds.length === created.pieceIds.length
        && candidate.pieceIds.every((id) => created.pieceIds.includes(id))
        && candidate.normal.x === created.normal.x && candidate.normal.z === created.normal.z) : undefined;
      const facade = existing
        ? { ...existing, layers: facadeLayers(existing), activeLayerId: existing.activeLayerId || facadeLayers(existing)[0]!.id, strokes: undefined }
        : created;
      if (!facade) {
        return {
          ...prev,
          contextOpen: false,
          status: selected.length > 1
            ? 'Paint Facade — every selected piece must be a wall / arch / fence / railing face on the same plane'
            : 'Paint Facade — that piece has no wall face (wall / arch / fence / railing kinds paint)',
        };
      }
      const doc = {
        id: `doc-facade-${facade.id}`,
        kind: 'facade' as const,
        title: 'Facade',
        subtitle: `${facade.widthMeters.toFixed(1)}×${facade.heightMeters.toFixed(1)}m`,
        sourceId: facade.id,
      };
      return {
        ...prev,
        seq: existing ? prev.seq : prev.seq + 1,
        worldFacades: existing ? prev.worldFacades.map((item) => item.id === facade.id ? facade : item) : [...prev.worldFacades, facade],
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        contextOpen: false,
        status: `Facade painter — ${facade.pieceIds.length} piece(s), ${facade.widthMeters.toFixed(1)}×${facade.heightMeters.toFixed(1)}m at 256 px/m`,
      };
    });
  };
  const recordFacadeStroke = (facadeId: string, stroke: FacadeStroke) => {
    setState((prev) => ({ ...prev, worldFacades: prev.worldFacades.map((f) => {
      if (f.id !== facadeId) return f;
      const source = facadeLayers(f);
      const active = f.activeLayerId || source[0]!.id;
      return { ...f, activeLayerId: active, layers: source.map((layer) => layer.id === active ? { ...layer, strokes: [...layer.strokes, stroke] } : layer), strokes: undefined };
    }) }));
  };
  const updateFacadeLayers = (facadeId: string, layers: import('../world/facades').FacadeLayer[], activeLayerId: string) => {
    if (!layers.length || !layers.some((layer) => layer.id === activeLayerId)) return;
    setState((prev) => ({ ...prev, worldFacades: prev.worldFacades.map((facade) => facade.id === facadeId
      ? { ...facade, layers, activeLayerId, strokes: undefined }
      : facade) }));
  };
  const recordFacadeStamp = (facadeId: string, stamp: FacadeStamp) => {
    setState((prev) => ({ ...prev, worldFacades: prev.worldFacades.map((f) => (f.id === facadeId ? { ...f, stamps: [...f.stamps, stamp] } : f)) }));
  };
  const clearFacadePaint = (facadeId: string) => {
    setState((prev) => ({ ...prev, worldFacades: prev.worldFacades.map((f) => (f.id === facadeId
      ? { ...f, layers: facadeLayers(f).map((layer) => ({ ...layer, strokes: [] })), strokes: undefined, stamps: [] }
      : f)) }));
  };
  // Bake: the painter's stroke readback + stamps → cached PNG → the world
  // re-pushes (identity-bump retriggers the viewport's mesh/ref effects).
  const saveFacadePainting = (facadeId: string, strokesRgba: Uint8Array, width: number, height: number) => {
    const facade = stateRef.current.worldFacades.find((f) => f.id === facadeId);
    if (!facade) return;
    const target = { w: Math.max(2, Math.round(facade.widthMeters * FACADE_TEXELS_PER_METER)), h: Math.max(2, Math.round(facade.heightMeters * FACADE_TEXELS_PER_METER)) };
    const ambientRgba = resizeFacadeRgba(strokesRgba, width, height, target.w, target.h);
    const ok = saveFacadeBake(stateRef.current.activeMapStem, facade, ambientRgba);
    setState((prev) => ({
      ...prev,
      worldPieces: [...prev.worldPieces],
      status: ok
        ? `facade baked — ${facade.widthMeters.toFixed(1)}×${facade.heightMeters.toFixed(1)}m live on the wall`
        : 'facade bake FAILED — see console',
    }));
  };

  // Place Sticker (req_3025): add the armed sticker to the clicked face at the
  // ray's exact hit point. The sticker asset materializes on first stamp of a
  // texture (ensureStickerForTexture — 4x6 label default); the placement is a
  // piece-local row, so it rides the piece through move/rotate/delete/undo.
  const stampSticker = (id: string, role: string, local: { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number }) => {
    const arm = stateRef.current.stickerArm;
    if (!arm.textureId) {
      setState((prev) => ({ ...prev, status: 'no sticker armed — pick one in the action bar (import an image first if the rail is empty)' }));
      return;
    }
    const spec = shaderSpec(arm.textureId);
    const sticker = spec ? ensureStickerForTexture(arm.textureId, spec.label) : null;
    if (!sticker) {
      setState((prev) => ({ ...prev, status: `sticker FAILED — could not write a sticker manifest for ${arm.textureId}` }));
      return;
    }
    setState((prev) => recordWorldEdit(prev, {
      ...prev,
      seq: prev.seq + 1,
      worldPieces: prev.worldPieces.map((p) => p.id === id
        ? {
            ...p,
            stickers: [...(p.stickers ?? []), {
              id: `stk-${prev.seq}`,
              stickerId: sticker.id,
              role,
              ...local,
              scale: prev.stickerArm.scale,
              rot: prev.stickerArm.rot,
            }],
          }
        : p),
      status: `${sticker.name} stamped on ${role}`,
    }, 'stamp sticker'));
  };

  // role null = clear EVERY slot back to the kind default (the quick menu's
  // untargeted "default" chip); a string clears just that face (req_2737).
  const clearPieceSlot = (id: string, role: string | null, source = 'focus-panel') =>
    invokeApplicationCommand(WORLD_PIECE_MATERIAL_CLEAR_COMMAND_ID, {
      documentId: stateRef.current.activeMapStem,
      targets: [{ pieceId: id, roles: role ? [role] : 'all' }],
    }, source);

  // Copy = pick the piece up into your hand (the Fortnite move): arm its definition
  // in Place mode and carry its slots/overrides as the stamp placePieces applies, so
  // every subsequent click drops a true clone. Not a world-undo entry — arming never
  // is; the placements it produces are. Map paint disarms like any other tool switch.
  const copyPiece = (id: string) => {
    setState((prev0) => {
      const prev = withMapPaintOff(prev0);
      const piece = prev.worldPieces.find((p) => p.id === id);
      if (!piece) return { ...prev, status: 'copy: that piece is gone' };
      return {
        ...prev,
        armedPieceId: piece.pieceId,
        armedYawDegrees: 0,
        armedStamp: piece.slots || piece.overrides ? { slots: piece.slots, overrides: piece.overrides } : null,
        selectedPieceId: null,
        selectedPieceIds: [],
        activeCommandId: 'place-piece',
        actionMenu: 'Build',
        status: `copied ${piece.pieceId} — click to stamp copies, Esc to put it down`,
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
      const t0 = Date.now();
      const asset = assetById(assetId, prev.assetOverrides);
      const nextFavorite = !asset.favorite;
      const editMs = Date.now() - t0;
      return {
        ...prev,
        assetOverrides: {
          ...prev.assetOverrides,
          [assetId]: { ...prev.assetOverrides[assetId], favorite: nextFavorite },
        },
        history: [
          { id: `h-${prev.seq}`, verb: nextFavorite ? 'favorite' : 'unfavorite', target: asset.name, meta: 'catalog metadata override', undoable: true, editMs, emptyMs: editMs, richMs: editMs },
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
      const firstFile = explorerIndex().files.find((file) => explorerMatchesFolder(file, fileExplorerFolder));
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
            at: explorerNowLabel(),
          },
          ...prev.fileExplorerDirectoryHistory.filter((entry) => entry.folderId !== fileExplorerFolder),
        ].slice(0, 4),
        seq: prev.seq + 1,
        status: `asset explorer folder: ${explorerFolderLabel(fileExplorerFolder)}`,
      };
    });
  };

  const toggleExplorerFolder = (folder: ExplorerFolderId) => {
    setState((prev) => ({
      ...prev,
      fileExplorerExpanded: { ...prev.fileExplorerExpanded, [folder]: !prev.fileExplorerExpanded[folder] },
      status: `${prev.fileExplorerExpanded[folder] ? 'collapsed' : 'expanded'} asset folder ${explorerFolderLabel(folder)}`,
    }));
  };

  // Open a .glb/.obj through the REAL import path: a `file:<path>` model document whose
  // viewer loads the file via the native host mesh importer (__mesh_load_file). The import
  // is seeded as ONE outliner part in the SAME state update the doc opens in, so the
  // surface mounts straight into parts mode (outliner live, part ops working) — never as
  // a view-only model. Its [lo, hi) range is stamped after the host parses the file.
  const openModelFileDocument = (path: string) => {
    // Import for keeps: copy the file into its own Model Package (content browser +
    // every future launch). A failed copy still opens the model, but session-only —
    // and the status says so LOUDLY instead of pretending it was saved.
    const imported = importModelFilePackage(path);
    const pkg = imported ?? fileModelPackage(path);
    const doc = modelDocument(pkg);
    const partPath = pkg.viewerPath ?? path;
    setState((prev) => {
      const seeded = prev.modelParts[pkg.id] ?? [filePartSeed(partPath, pkg.name)];
      return {
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        materialFocused: false,
        contextOpen: false,
        fileExplorerOpen: false,
        modelParts: { ...prev.modelParts, [pkg.id]: seeded },
        modelActivePartId: prev.modelParts[pkg.id] ? prev.modelActivePartId : (seeded[0]?.id ?? prev.modelActivePartId),
        status: imported
          ? `imported ${pkg.name} — saved to the model library (${imported.path})`
          : `opened ${pkg.name} — NOT saved to the library (file copy failed)`,
      };
    });
  };

  const openExplorerFile = (fileId: string, action: string) => {
    const file = explorerFileById(fileId);
    if (!file) {
      setState((prev) => ({ ...prev, status: `${fileId} is no longer on disk — rescan the index` }));
      return;
    }
    setState((prev) => {
      const historyEntry: ExplorerHistoryEntry = {
        id: `fh-${prev.seq}`,
        fileId,
        action,
        query: prev.fileExplorerQuery.trim() || file.name,
        at: explorerNowLabel(),
      };
      return {
        ...prev,
        fileExplorerSelectedId: fileId,
        fileExplorerHistory: [
          historyEntry,
          ...prev.fileExplorerHistory.filter((entry) => entry.fileId !== fileId),
        ].slice(0, 5),
        seq: prev.seq + 1,
        status: `${action} ${file.path}`,
      };
    });
    // Model files actually OPEN: into a model document on the stage via the native
    // importer. Image files run through the same image-import decision flow as the
    // OS picker. Everything else just records (pin/history).
    if (file.importable && action === 'opened') openModelFileDocument(file.path);
    if (file.category === 'texture' && action === 'imported') {
      setState((prev) => ({ ...prev, fileExplorerOpen: false, status: `import image: ${file.name}` }));
      probeImageImport(file.path);
    }
  };

  // File → Import Model: the OS picker (zenity) for a .glb/.obj anywhere on disk,
  // routed through the same native import path as in-project explorer rows.
  // The ONE import door: models open as documents; images run the quantize
  // probe and land in the dual-preview decision dialog (pixel texture vs
  // exact image — see ImportImageDialog).
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
  const importModelFromDisk = async () => {
    const path = await pickFile({
      title: 'Import a model or image',
      filters: [
        { name: '3D models', patterns: ['*.glb', '*.obj'] },
        { name: 'Images', patterns: ['*.png', '*.jpg', '*.jpeg', '*.webp'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (!path) return;
    if (IMAGE_EXT_RE.test(path)) {
      probeImageImport(path);
      return;
    }
    if (!isViewerFile(path)) {
      setState((prev) => ({ ...prev, status: `cannot import ${path.split('/').pop()} — pick a .glb/.obj model or a .png/.jpg/.webp image` }));
      return;
    }
    openModelFileDocument(path);
  };

  const probeImageImport = (path: string) => {
    const name = path.split('/').pop() ?? path;
    const base64 = readFileBase64(path);
    if (!base64) {
      setState((prev) => ({ ...prev, status: `cannot read ${name}` }));
      return;
    }
    const meta = imageOps(base64).metadata();
    const probe = parseQuantizeProbe(quantizeImage(base64, 64, 128));
    if (!meta || !probe) {
      setState((prev) => ({ ...prev, status: `cannot decode ${name} — not a supported image` }));
      return;
    }
    // Serialized pixel payload size — the decision-facing number; computed for
    // real (probe → RLE JSON) rather than guessed.
    const pixelJson = JSON.stringify(encodeRows(probe.indices, probe.width, probe.height));
    setImportPlan({
      sourcePath: path,
      name,
      probe,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      sourceKb: Math.max(1, Math.round((base64.length * 0.75) / 1024)),
      pixelKb: Math.max(1, Math.round(pixelJson.length / 1024)),
    });
  };

  const commitImageImport = (form: 'pixel' | 'exact') => {
    const plan = importPlan;
    if (!plan) return;
    setImportPlan(null);
    const manifest = form === 'pixel'
      ? savePixelTexture(plan.name, plan.name, plan.probe)
      : saveExactImage(plan.name, plan.sourcePath, plan.sourceWidth, plan.sourceHeight);
    if (!manifest) {
      setState((prev) => ({ ...prev, status: `import FAILED for ${plan.name} — could not write the texture package` }));
      return;
    }
    reloadImportedTextures();
    refreshExplorerIndex();
    setState((prev) => ({
      ...prev,
      status: `imported ${manifest.name} as ${form === 'pixel' ? `pixel texture (${manifest.colors} colors)` : 'exact image'} → ${manifest.id}`,
    }));
  };

  const rescanExplorerIndex = () => {
    const index = refreshExplorerIndex();
    setState((prev) => ({
      ...prev,
      status: `asset index rescanned: ${index.files.length} assets${index.truncated ? ' (CAPPED — deeper files not listed)' : ''}`,
    }));
  };

  const selectColorStudioMaterial = (specId: string) => {
    invokeApplicationCommand(COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID, { specId, variant: 0 }, 'stage');
  };

  const setColorStudioVariant = (variant: number) => {
    invokeApplicationCommand(COLOR_STUDIO_VARIANT_SELECT_COMMAND_ID, { variant }, 'stage');
  };

  const rollColorStudioSeed = () => {
    invokeApplicationCommand(COLOR_STUDIO_SEED_ROLL_COMMAND_ID, {}, 'stage');
  };

  const setColorStudioQuality = (quality: number) => {
    invokeApplicationCommand(COLOR_STUDIO_QUALITY_SELECT_COMMAND_ID, { quality }, 'stage');
  };

  const activateColorStudioSlot = (slot: number) => {
    invokeApplicationCommand(COLOR_STUDIO_SLOT_SELECT_COMMAND_ID, { slot }, 'stage');
  };

  const fillColorStudioSlot = (rgb: Rgb, source: string) => {
    const current = stateRef.current;
    const spec = colorStudioSpec(current);
    const slot = Math.min(current.colorStudioActiveSlot, Math.max(0, (spec.slots?.length ?? 1) - 1));
    invokeApplicationCommand(COLOR_STUDIO_SLOT_FILL_COMMAND_ID, {
      specId: spec.id,
      variant: current.colorStudioVariant,
      slot,
      rgb,
      source,
    }, 'stage');
  };

  const resetColorStudioSlots = () => {
    const current = stateRef.current;
    const spec = colorStudioSpec(current);
    invokeApplicationCommand(COLOR_STUDIO_SLOTS_RESET_COMMAND_ID, {
      specId: spec.id,
      variant: current.colorStudioVariant,
    }, 'stage');
  };

  const setColorStudioView = (view: EditorState['colorStudioView']) => {
    invokeApplicationCommand(COLOR_STUDIO_VIEW_SELECT_COMMAND_ID, { view }, 'stage');
  };

  const setColorSpineCurrent = (color: OklchColor, invocationSource = 'stage') => {
    invokeApplicationCommand(COLOR_STUDIO_COLOR_SELECT_COMMAND_ID, { color, source: 'color picker' }, invocationSource);
  };

  const addColorSpineToTray = (invocationSource = 'stage') => {
    invokeApplicationCommand(COLOR_STUDIO_PALETTE_ADD_COMMAND_ID, {
      color: stateRef.current.colorSpineCurrent,
      source: 'current color',
    }, invocationSource);
  };

  const pickColorSpineTray = (color: OklchColor, invocationSource = 'stage') => {
    invokeApplicationCommand(COLOR_STUDIO_COLOR_SELECT_COMMAND_ID, { color, source: 'tray' }, invocationSource);
  };

  const pickColorSpineScene = (color: OklchColor, css: string, invocationSource = 'stage') => {
    invokeApplicationCommand(COLOR_STUDIO_COLOR_SELECT_COMMAND_ID, { color, source: 'scene', scenePick: css }, invocationSource);
  };

  const loadColorSpineLibrarySet = (colors: OklchColor[], invocationSource = 'stage') => {
    const setName = SPINE_LIBRARY.find((set) => set.colors === colors)?.name ?? 'library set';
    invokeApplicationCommand(COLOR_STUDIO_PALETTE_LOAD_COMMAND_ID, { colors, setName }, invocationSource);
  };

  const focusMaterialDocument = (variant?: number) => {
    const previous = stateRef.current;
    const asset = assetById(previous.activeAssetId, previous.assetOverrides);
    const doc = materialDocument(asset);
    const spec = asset.recipe ? shaderSpec(asset.recipe) : undefined;
    const next: EditorState = {
      ...previous,
      materialFocused: true,
      workspaceDocuments: upsertDocument(previous.workspaceDocuments, doc),
      activeWorkspaceDocumentId: doc.id,
      colorStudioView: spec ? 'materialPalette' : previous.colorStudioView,
      status: spec ? `opened Color Studio: ${asset.name}` : `opened material document: ${asset.name}`,
    };
    stateRef.current = next;
    setState(next);
    if (spec) {
      const nextVariant = Math.min(variant ?? previous.colorStudioVariant, Math.max(0, spec.variants.length - 1));
      invokeApplicationCommand(COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID, { specId: spec.id, variant: nextVariant }, 'stage');
    }
  };

  // The ink popover's "open in Color Studio" — jump from a dipped shader ink to
  // its editing page (selecting the matching library asset when there is one).
  const openColorStudioForSpec = (specId: string) => {
    const spec = shaderSpec(specId);
    if (!spec) return;
    const previous = stateRef.current;
    const match = catalogAssets.find((a) => a.recipe === specId);
    const asset = match ?? assetById(previous.activeAssetId, previous.assetOverrides);
    const doc = materialDocument(asset);
    const next: EditorState = {
      ...previous,
      materialFocused: true,
      activeAssetId: match ? match.id : previous.activeAssetId,
      workspaceDocuments: upsertDocument(previous.workspaceDocuments, doc),
      activeWorkspaceDocumentId: doc.id,
      colorStudioView: 'materialPalette',
      status: `opened Color Studio: ${spec.label}`,
    };
    stateRef.current = next;
    setState(next);
    invokeApplicationCommand(COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID, { specId: spec.id, variant: 0 }, 'toolbar');
    setPaintPopover(null);
  };

  // ── Model outliner (multi-part authoring) ───────────────────────────────────
  // A model in view is a list of PARTS (each its own mesh). These handlers own the parts
  // state; the surface composes them into the host mesh and reloads on change.
  const PART_TINTS = ['#c9b48f', '#8fb6c9', '#c98f9b', '#9cc98f', '#b49bc9', '#c9c08f', '#8fc9bb'];
  const activePartsModelId = (s: EditorState): string | null => {
    const doc = s.workspaceDocuments.find((d) => d.id === s.activeWorkspaceDocumentId);
    return doc?.kind === 'model' && doc.sourceId && s.modelParts[doc.sourceId] ? doc.sourceId : null;
  };
  const makePart = (kind: PrimitiveKind, existing: ModelPart[], seq: number, params?: PrimitiveParams): ModelPart => {
    const meta = PRIMITIVE_MESHES.find((p) => p.kind === kind)!;
    const n = existing.filter((p) => p.kind === kind).length + 1;
    return { id: `part:${kind}:${seq}`, name: `${meta.name} ${n}`, kind, mesh: primitivePartMesh(kind, params), visible: true, color: PART_TINTS[existing.length % PART_TINTS.length]! };
  };
  // The single seed for an imported file's base part — used by both the open handler (atomic
  // with the doc open) and the activate effect (restored/persisted docs missing their parts).
  const filePartSeed = (path: string, name: string): ModelPart =>
    ({ id: 'part:file:1', name, sourcePath: path, visible: true, color: PART_TINTS[0]! });
  // Adding a mesh (menu or outliner) opens the size/resolution dialog instead of dropping a
  // fixed unit primitive — you author the dimensions upfront, like the old studio mesh editor.
  // The outliner + adds a part to the model in view → the 'add' verb (append), never a new document.
  const addPart = (kind: PrimitiveKind) => {
    addPartSourceRef.current = 'dock';
    setState((prev) => ({ ...prev, newMeshPrompt: { kind, mode: 'add' } }));
  };
  // Range of a part in the host mesh: its stored [lo, hi) (set on seed/append). The host mesh
  // is authoritative — these ids are stable across deletes and appends within a session.
  const partRange = (part: ModelPart): { lo: number; hi: number } | null =>
    part.lo != null && part.hi != null ? { lo: part.lo, hi: part.hi } : null;

  // 'add' verb — APPEND the primitive as a new PART to the model in view (preserving every prior
  // edit; no JS recompose). Reached from Edit → Mesh → Add Primitive and the outliner +.
  const addPrimitivePart = (kind: PrimitiveKind, params: PrimitiveParams, source = 'dock') => {
    const activeModel = activePartsModelId(state);
    if (!activeModel) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'Open a model first — Add Primitive appends a part to the model in view.' }));
      return;
    }
    const parts = state.modelParts[activeModel] ?? [];
    const part = makePart(kind, parts, state.seq, params);
    // An EMPTIED model has no live viewer to append into (the workspace shows NO
    // VISIBLE PARTS and ModelView is unmounted, host mesh gone with it) — seed the
    // part as the new base instead; the viewer remounts composing it, the same way
    // a fresh document mounts (req_2560).
    if (composeModelParts(parts).positions.length === 0) {
      const seedRange = composeModelParts([{ ...part, visible: true }]).ranges[0];
      const placed: ModelPart = { ...part, lo: seedRange?.lo ?? 0, hi: seedRange?.hi ?? 0 };
      // There is no resident host mesh to scope until ModelView remounts, but the
      // outliner selection still changes transactionally with its new base row.
      selectedPartIdsRef.current = [placed.id];
      setSelectedPartIds([placed.id]);
      setState((prev) => ({ ...prev, seq: prev.seq + 1, modelParts: { ...prev.modelParts, [activeModel]: [...(prev.modelParts[activeModel] ?? []), placed] }, modelActivePartId: placed.id, newMeshPrompt: null, status: `added ${placed.name} to the empty model` }));
      return;
    }
    const api = modelToolApiRef.current;
    if (!api) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'Open a model first — Add Primitive appends a part to the model in view.' }));
      return;
    }
    const geo = composeModelParts([{ ...part, visible: true }]);
    const range = geo.positions.length > 0
      ? withNativeMeshActionSource(source, () => api.appendPart(geo.positions, geo.faceGroups, part.color))
      : null;
    if (!range) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'could not add mesh' }));
      return;
    }
    const placed: ModelPart = { ...part, lo: range.lo, hi: range.hi };
    const nextParts = [...parts, placed];
    // Adding a row hands the edit transaction to that new geometry, exactly like
    // Duplicate already does. modelActivePartId alone only highlights the React row;
    // the native gizmo/topology scope must receive the appended range synchronously.
    selectedPartIdsRef.current = [placed.id];
    setSelectedPartIds([placed.id]);
    pushPartSetToHost(state, nextParts, [placed.id], placed.id);
    setState((prev) => ({ ...prev, seq: prev.seq + 1, modelParts: { ...prev.modelParts, [activeModel]: [...(prev.modelParts[activeModel] ?? []), placed] }, modelActivePartId: placed.id, newMeshPrompt: null, status: `added ${placed.name}` }));
    const bridge = (globalThis as any).__modelFocusBridge;
    if (bridge?.paintLive) bridge.refreshUv?.();
  };

  // 'new' verb — ALWAYS a fresh model document seeded with this one part (mount composes it), even
  // when a model is already open. This is what makes New ≠ Add: File → New Mesh never appends to
  // whatever's in view; it spawns its own document (req_2542).
  const createNewMeshDocument = (kind: PrimitiveKind, params: PrimitiveParams) => {
    setState((prev) => {
      // Collision-free id: skips open docs AND saved library packages — once
      // primitive:cube:1 is materialized on disk it is a model forever, and the
      // old open-doc count would have reused its id after a restart (req_2620 S).
      const mid = nextPrimitiveDocId(kind, prev.workspaceDocuments);
      const doc = modelDocument(primitiveModelPackage(mid));
      const base = makePart(kind, [], prev.seq, params);
      const range = composeModelParts([base]).ranges[0];
      const part: ModelPart = { ...base, lo: range?.lo ?? 0, hi: range?.hi ?? 0 };
      return {
        ...prev, seq: prev.seq + 1,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        modelParts: { ...prev.modelParts, [mid]: [part] },
        modelActivePartId: part.id,
        materialFocused: false, contextOpen: false, newMeshPrompt: null,
        status: `new ${kind} mesh`,
      };
    });
  };

  // The size/resolution dialog's confirm routes to the verb it was opened for.
  const submitMeshPrompt = (prompt: { kind: PrimitiveKind; mode: 'new' | 'add' }, params: PrimitiveParams) => {
    if (prompt.mode === 'add') addPrimitivePart(prompt.kind, params, addPartSourceRef.current);
    else createNewMeshDocument(prompt.kind, params);
  };

  // File → New Mesh → Build Pieces → <kind>: the catalog's canonical semantic
  // piece opened as one ordinary editable model part. No dimensions prompt: the
  // whole point is to start at the game's real module shape and build outward.
  const createBuildPieceStarterDocument = (starterId: BuildPieceStarterId) => {
    const starter = buildPieceStarter(starterId);
    if (!starter) {
      setState((prev) => ({ ...prev, openMenu: null, status: `unknown build-piece starter: ${starterId}` }));
      return;
    }
    setState((prev) => {
      const mid = nextBuildStarterDocId(starterId, prev.workspaceDocuments);
      const doc = modelDocument(buildStarterModelPackage(mid));
      const seeded = buildPieceStarterParts(starterId);
      if (seeded.length === 0) {
        return { ...prev, openMenu: null, status: `${starter.name} has no catalog geometry` };
      }
      const rangeById = new Map(composeModelParts(seeded).ranges.map((range) => [range.id, range]));
      const parts = seeded.map((part) => {
        const range = rangeById.get(part.id);
        return { ...part, lo: range?.lo ?? 0, hi: range?.hi ?? 0 };
      });
      return {
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        modelParts: { ...prev.modelParts, [mid]: parts },
        modelActivePartId: parts[0]?.id ?? prev.modelActivePartId,
        materialFocused: false,
        contextOpen: false,
        newMeshPrompt: null,
        openMenu: null,
        actionMenu: 'File',
        status: `new ${starter.name.toLowerCase()} — catalog-sized and ready to edit`,
      };
    });
  };

  // File → New Mesh → Player / NPC Model (req_2761): a fresh CHARACTER document
  // seeded with the whole humanoid starter — one part per body bone (the outliner
  // reads as the skeleton), the body formation riding the package as rig truth.
  // No size dialog: the starter's stand-pose table IS its dimensions.
  const createPlayerModelDocument = () => {
    setState((prev) => {
      const mid = nextPlayerModelDocId(prev.workspaceDocuments);
      const doc = modelDocument(playerModelPackage(mid));
      const seeded = playerStarterParts();
      const rangeById = new Map(composeModelParts(seeded).ranges.map((r) => [r.id, r]));
      const parts = seeded.map((p) => {
        const range = rangeById.get(p.id);
        return { ...p, lo: range?.lo ?? 0, hi: range?.hi ?? 0 };
      });
      return {
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
        activeWorkspaceDocumentId: doc.id,
        modelParts: { ...prev.modelParts, [mid]: parts },
        modelActivePartId: parts[0]?.id ?? prev.modelActivePartId,
        materialFocused: false, contextOpen: false, newMeshPrompt: null,
        openMenu: null, actionMenu: 'File',
        status: `new player/NPC model — ${parts.length} body parts`,
      };
    });
  };

  // The package currently declared as THE played model, if any — the character
  // export dialog names it, and a player-role export replaces it (req_2771).
  // Session dupes carry the freshest declarations; the disk-loaded roster backs.
  const currentPlayerCharacter = (): ModelPackage | null => {
    const isPlayer = (m: ModelPackage) => m.placeable?.as === 'character' && m.placeable.role === 'player';
    return state.modelDupes.find(isPlayer) ?? MODEL_PACKAGES.find(isPlayer) ?? null;
  };

  // Export → Player / NPC Model, confirmed (req_2771/req_2777). Tags along the
  // prop/build export shape exactly: export implies save (artifacts land first),
  // the declaration writes into the manifest (req_2718 disk truth), the roster
  // mirrors it. The SKELETON is compiled FROM THE LIVE OUTLINER at export — the
  // prop rig's measured-at-export law: part name → bone id is the binding, rest
  // transforms stamp from the just-written meshdoc's measured range centers, a
  // deleted part simply binds nothing, and strays report LOUDLY. Player role is
  // EXCLUSIVE: any other package declared player demotes to NPC in the same move.
  const exportCharacterAs = (role: CharacterRole) => {
    const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
    const pkg = doc?.kind === 'model' ? effectiveModelPackage(doc.sourceId, state.modelOverrides, state.modelDupes) : null;
    if (!pkg) {
      setState((prev) => ({ ...prev, exportCharacterPrompt: null, status: 'Export needs a MODEL open — open one from Models, then File → Export.' }));
      return;
    }
    const liveRows = state.modelParts[pkg.id] ?? [];
    if (!writeModelArtifacts(
      pkg,
      partsMetaFromRows(liveRows),
      meshDocPartRangesFromRows(liveRows) ?? undefined,
      partShrinkSaveOptions(pkg.id, liveRows.length),
    )) {
      setState((prev) => ({ ...prev, exportCharacterPrompt: null, status: 'Character export stopped: the model document could not be saved without losing part ranges.' }));
      return;
    }
    consumePartShrinkAuthorization(pkg.id);
    // Measured part centers off the meshdoc just written (host truth). Ranges
    // pair with rows by RANK (both ascend by lo — the parts.json contract); a
    // failed write degrades to name-only rows (binding holds, transforms identity).
    const freshDoc = packageMeshDoc(pkg);
    const centers = freshDoc ? meshDocRangeCenters(freshDoc) : [];
    const rowsByLo = liveRows.slice().sort((a, b) => ((a.lo ?? Number.MAX_SAFE_INTEGER) - (b.lo ?? Number.MAX_SAFE_INTEGER)));
    const partRows: CharacterPartRow[] = rowsByLo.map((row, rank) => ({ name: row.name, center: centers[rank] ?? undefined }));
    const compiled = partsToCharacterSkeleton(authoredModelIdForPackage(pkg.id), partRows);
    const placeable: ModelPlaceable = { as: 'character', role };
    // The package keeps its own kind (its category dir on disk); the CHARACTER
    // declaration is the placeable role, not a kind rewrite — rewriting kind on
    // an already-materialized package would split it across two category dirs.
    const pkgExported: ModelPackage = { ...pkg, placeable, skeleton: compiled.skeleton };
    const firstMaterialize = !isMaterialized(pkg.kind, pkg.id);
    let disk: string;
    if (firstMaterialize) {
      const res = materializeModelPackage(pkgExported);
      disk = res.ok ? `package materialized → ${res.dir}` : `PACKAGE WRITE FAILED (${res.error ?? 'unknown'}) — export is session-only`;
    } else {
      disk = updateManifestPlaceable(pkg.kind, pkg.id, { placeable, skeleton: compiled.skeleton })
        ? 'manifest updated'
        : 'MANIFEST WRITE FAILED — export is session-only';
    }
    upsertSavedPackage(pkgExported);
    // ONE played model: demote the previous holder to NPC, on disk and in the roster.
    const previous = role === 'player' ? currentPlayerCharacter() : null;
    const demoted: ModelPackage | null = previous && previous.id !== pkg.id
      ? { ...previous, placeable: { as: 'character', role: 'npc' } }
      : null;
    if (demoted) {
      updateManifestPlaceable(demoted.kind, demoted.id, { placeable: demoted.placeable, skeleton: demoted.skeleton });
      upsertSavedPackage(demoted);
    }
    const roleLabel = role === 'player' ? 'THE PLAYER model' : 'an NPC model';
    // The binding readout is part of the export's own report — silent truncation
    // is the disease; "26/28 bind" + the stray names is the cure.
    const bindReport = `${compiled.bound.length}/${liveRows.length} parts bind`
      + (compiled.unbound.length ? ` · unbound: ${compiled.unbound.join(', ')}` : '')
      + (compiled.duplicates.length ? ` · DUPLICATE bone claims: ${compiled.duplicates.join(', ')}` : '');
    setState((prev) => ({
      ...prev,
      exportCharacterPrompt: null,
      modelDirty: { ...prev.modelDirty, [pkg.id]: false },
      modelDupes: [pkgExported, ...(demoted ? [demoted] : [])].reduce(
        (dupes, changed) => dupes.some((m) => m.id === changed.id)
          ? dupes.map((m) => (m.id === changed.id ? changed : m))
          : [...dupes, changed],
        prev.modelDupes,
      ),
      status: `Exported "${pkg.name}" as ${roleLabel} — ${bindReport} — ${disk}${demoted ? ` · "${demoted.name}" demoted to NPC` : ''}`,
    }));
  };

  // RJIT_MODELDOC=<primitive kind>|build:<piece kind> boots straight into a fresh
  // model document — the headless gesture-repro path (`rjit shot editor` +
  // RJIT_MESHOPS in ModelView drives real select gestures and captures the result).
  // Unset or unknown = no-op; the harness never feeds an invalid kind to a generator.
  useEffect(() => {
    const kind = (globalThis as any).__env_get?.('RJIT_MODELDOC') as string | null | undefined;
    if (!kind) return;
    // A hot reload re-runs this effect, but the view atom already restored the doc
    // the first eval created — minting ANOTHER fresh doc would switch documents and
    // defeat the host-session resume (req_2913's reload proof rides this harness).
    if (stateRef.current.workspaceDocuments.some((d) => d.kind === 'model')) return;
    if (kind === 'player') createPlayerModelDocument();
    else if (kind === 'player-export') {
      // Headless repro of the character-export dialog (req_2771): boot the player
      // starter doc with the role choice open.
      createPlayerModelDocument();
      setState((prev) => ({ ...prev, exportCharacterPrompt: true }));
    } else if (kind === 'playtest') {
      // Headless repro of the playtest tab (req_2780): the embodied world with
      // the exported player model (or the stand-in when none is declared).
      setState((prev) => ({
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, PLAYTEST_DOCUMENT),
        activeWorkspaceDocumentId: PLAYTEST_DOCUMENT.id,
      }));
    } else if (kind === 'animation') {
      // Headless repro of the capture tab (req_2786) — no cam in headless, so
      // the tracker chip reports honestly while the layout verifies.
      setState((prev) => ({
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, ANIMATION_DOCUMENT),
        activeWorkspaceDocumentId: ANIMATION_DOCUMENT.id,
      }));
    } else if (kind?.startsWith('build:')) {
      const starterId = kind.slice('build:'.length) as BuildPieceStarterId;
      if (buildPieceStarter(starterId)) createBuildPieceStarterDocument(starterId);
    } else if (kind && PRIMITIVE_MESHES.some((primitive) => primitive.kind === kind)) {
      createNewMeshDocument(kind as PrimitiveKind, { size: 1, height: 1, resolution: 1 });
    }
  }, []);
  // ── Outliner multi-select (req_2659) ──────────────────────────────────────────
  // Shift-click accumulates parts into ONE selected set with a PRIMARY part (the last
  // clicked — state.modelActivePartId; it drives the UV/SHAPE headers). Plain click
  // replaces the set. The set can never go empty (the no-zero-focus law, req_2644).
  // Shell-local state: EditorState (data/types.ts) stays untouched.
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const selectedPartIdsRef = useRef<string[]>([]);
  selectedPartIdsRef.current = selectedPartIds;
  /** The live selected set, pruned to parts that still exist; falls back to the active part. */
  const effectiveSelectedIds = (s: EditorState, parts: ModelPart[], sel: string[]): string[] => {
    const valid = sel.filter((sid) => parts.some((p) => p.id === sid));
    if (valid.length > 0) return valid;
    return s.modelActivePartId && parts.some((p) => p.id === s.modelActivePartId) ? [s.modelActivePartId] : [];
  };
  const selectedPartsModelId = activePartsModelId(state);
  const selectedPartCount = effectiveSelectedIds(
    state,
    selectedPartsModelId ? (state.modelParts[selectedPartsModelId] ?? []) : [],
    selectedPartIds,
  ).length;
  /** Row verbs act on the WHOLE selected set when the pressed row is in it (req_2659),
   *  else on just that row. */
  const verbTargets = (id: string, parts: ModelPart[]): string[] => {
    const set = effectiveSelectedIds(state, parts, selectedPartIds);
    return set.includes(id) && set.length > 1 ? set : [id];
  };
  /** Push the selected set to the host: scope = the UNION of every member's range (the
   *  gizmo/nudge/pick/marquee machinery then operates on all of them; the selection
   *  pivot is the union centroid because the pivot averages selected elements). Face
   *  selection follows in object/face mode — and NEVER during paint (req_2662: the
   *  mode row is exclusive; an outliner click mid-paint scopes without selecting). */
  const pushPartSetToHost = (s: EditorState, parts: ModelPart[], ids: string[], primaryId: string) => {
    const host = globalThis as any;
    const selectedRanges = ids
      .map((sid) => { const p = parts.find((pp) => pp.id === sid); return p ? partRange(p) : null; })
      .filter((r): r is { lo: number; hi: number } => r !== null);
    const prim = parts.find((p) => p.id === primaryId);
    host.__modelActivePartRange = prim ? partRange(prim) : null; // the UV filter's truth (req_2619 P)
    // Paint is intentionally single-outliner even when a modeling multi-set is
    // highlighted. A union scope would make one stroke legally cross part
    // boundaries; the focused primary is the complete paint target contract.
    const primaryRange = prim ? partRange(prim) : null;
    const ranges = s.modelTool.paint && primaryRange ? [primaryRange] : selectedRanges;
    if (ranges.length === 0) return;
    if (ranges.length === 1) {
      host.__mesh_edit_scope?.(ranges[0]!.lo, ranges[0]!.hi);
    } else {
      const pairs = new Uint32Array(ranges.length * 2);
      ranges.forEach((r, i) => { pairs[i * 2] = r.lo; pairs[i * 2 + 1] = r.hi; });
      host.__mesh_edit_scope_ranges?.(pairs);
    }
    if (s.modelTool.paint) return; // paint owns the surface — primary scope only
    // Selecting the parts' faces is a FACE-mode gesture — the host door flips its pick
    // mode to face. In vertex/edge mode focus only scopes (dots/edges restrict to the
    // set), so the toolbar's mode and the host's pick mode never diverge (req_2645 SS).
    const m = s.modelTool.selMode;
    if (m === 0 || m === 3) ranges.forEach((r, i) => host.__mesh_edit_select_group_range?.(r.lo, r.hi, i === 0 ? 0 : 1));
    else host.__mesh_edit_clear?.();
    // This selection is shell-driven, not an engine pointer event, so the native
    // callback will not fire on its own. Ping the viewer to mirror host mode/counts.
    host.__meshEditSelChanged?.();
  };
  const selectPart = (id: string) => {
    // Focus = SCOPE editing to the selected set. EXACTLY ONE primary is always focused
    // (req_2644): a plain click replaces the set with [id] (clicking the focused row
    // RE-ASSERTS it — never a toggle-off into scope(0,0)); shift-click toggles set
    // membership (req_2659) but the set never empties.
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const cur = effectiveSelectedIds(state, parts, selectedPartIds);
    let nextIds = [id];
    let primary = id;
    if (currentModifiers().shift && parts.some((p) => p.id === id)) {
      if (cur.includes(id)) {
        if (cur.length <= 1) nextIds = cur; // the set can never go empty (no zero-focus)
        else {
          nextIds = cur.filter((x) => x !== id);
          primary = nextIds[nextIds.length - 1]!;
        }
      } else nextIds = [...cur, id];
    }
    setSelectedPartIds(nextIds);
    pushPartSetToHost(state, parts, nextIds, primary);
    setState((prev) => ({
      ...prev,
      modelActivePartId: primary,
      status: nextIds.length > 1 ? `selected ${nextIds.length} parts — primary ${parts.find((p) => p.id === primary)?.name ?? primary}` : prev.status,
    }));
    // Track the pick in the live UV preview (its filter keys off the primary's range).
    const bridge = (globalThis as any).__modelFocusBridge;
    if (bridge?.paintLive) bridge.refreshUv?.();
  };
  const selectPartRef = useRef(selectPart);
  selectPartRef.current = selectPart;
  useEffect(() => {
    // Host part indices are RANGE rank, not current outliner display order.  A
    // drag-reordered list therefore maps through lo before handing focus to the
    // ordinary row-selection path (which synchronously installs the new scope).
    (globalThis as any).__meshEditFocusPart = (partIndex: number) => {
      const current = stateRef.current;
      const modelId = activePartsModelId(current);
      const ranked = modelId ? (current.modelParts[modelId] ?? []).slice().sort((a, b) => (a.lo ?? Infinity) - (b.lo ?? Infinity)) : [];
      const part = ranked[partIndex | 0];
      if (part?.visible) selectPartRef.current(part.id);
    };
    return () => { delete (globalThis as any).__meshEditFocusPart; };
  }, []);
  // A structural flow (add/dup/delete/import/undo) re-points the active part OUTSIDE
  // selectPart — collapse the multi-set to the new active so a stale set can't keep
  // group verbs firing on rows the user no longer sees selected.
  useEffect(() => {
    if (state.modelActivePartId && !selectedPartIds.includes(state.modelActivePartId)) {
      setSelectedPartIds([state.modelActivePartId]);
    }
  }, [state.modelActivePartId]);
  // Keep the UV filter's active-range global fresh for every flow that moves focus or
  // re-stamps ranges (selectPart writes it synchronously; this covers the rest).
  useEffect(() => {
    const mid = activePartsModelId(state);
    const part = mid ? (state.modelParts[mid] ?? []).find((p) => p.id === state.modelActivePartId) : null;
    (globalThis as any).__modelActivePartRange = part ? partRange(part) : null;
  }, [state.modelActivePartId, state.modelParts, state.activeWorkspaceDocumentId]);
  useEffect(() => {
    if (!state.modelTool.paint) return;
    const mid = activePartsModelId(state);
    const part = mid ? (state.modelParts[mid] ?? []).find((row) => row.id === state.modelActivePartId) : null;
    const range = part ? partRange(part) : null;
    if (range) (globalThis as any).__mesh_edit_scope?.(range.lo, range.hi);
  }, [state.modelTool.paint, state.modelActivePartId, state.activeWorkspaceDocumentId]);
  const renamePart = (id: string, rawName: string) => {
    const mid = activePartsModelId(state);
    invokeApplicationCommand(MODEL_PART_RENAME_COMMAND_ID, { modelId: mid ?? '', partId: id, name: rawName }, 'focus-panel');
  };

  // ── Organizational part groups (req_2911) ───────────────────────────────────
  // A group is ONLY repeated metadata on its member rows. Host ranges, geometry,
  // authored groups, and individual part ids stay untouched, so expanding/dissolving
  // the folder always returns the exact independently-editable parts.
  const selectPartGroup = (groupId: string) => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const members = partsInGroup(parts, groupId);
    const groupName = groupPathById(parts, groupId)?.at(-1)?.name ?? 'group';
    const visibleIds = members.filter((part) => part.visible).map((part) => part.id);
    if (!mid || members.length === 0) {
      setState((prev) => ({ ...prev, status: 'part group not found' }));
      return;
    }
    if (visibleIds.length === 0) {
      setState((prev) => ({ ...prev, status: `${groupName} is hidden — show it before editing` }));
      return;
    }
    const primary = visibleIds.includes(state.modelActivePartId ?? '') ? state.modelActivePartId! : visibleIds[visibleIds.length - 1]!;
    setSelectedPartIds(visibleIds);
    pushPartSetToHost(state, parts, visibleIds, primary);
    setState((prev) => ({
      ...prev,
      modelActivePartId: primary,
      status: `selected ${visibleIds.length} part${visibleIds.length === 1 ? '' : 's'} in ${groupName}${visibleIds.length < members.length ? ' — hidden members excluded' : ''}`,
    }));
  };

  const groupSelectedParts = () => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const ids = effectiveSelectedIds(state, parts, selectedPartIdsRef.current);
    invokeApplicationCommand(MODEL_PARTS_GROUP_COMMAND_ID, { modelId: mid ?? '', partIds: ids }, 'focus-panel');
  };

  const ungroupSelectedParts = () => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const ids = effectiveSelectedIds(state, parts, selectedPartIdsRef.current);
    invokeApplicationCommand(MODEL_PARTS_UNGROUP_COMMAND_ID, { modelId: mid ?? '', partIds: ids }, 'focus-panel');
  };

  const renamePartGroup = (groupId: string, rawName: string) => {
    const mid = activePartsModelId(state);
    invokeApplicationCommand(MODEL_GROUP_RENAME_COMMAND_ID, { modelId: mid ?? '', groupId, name: rawName }, 'focus-panel');
  };

  const dissolvePartGroup = (groupId: string) => {
    const mid = activePartsModelId(state);
    invokeApplicationCommand(MODEL_GROUP_DISSOLVE_COMMAND_ID, { modelId: mid ?? '', groupId }, 'focus-panel');
  };

  const moveOutlinerItem = (item: ModelOutlinerDragItem, target: ModelOutlinerDropTarget) => {
    const mid = activePartsModelId(state);
    invokeApplicationCommand(MODEL_OUTLINER_MOVE_COMMAND_ID, { modelId: mid ?? '', item, target }, 'focus-panel');
  };

  const applyPartVisibility = (mid: string, parts: ModelPart[], targetIds: string[], hide: boolean, label: string, source = 'dock') => {
    const targetSet = new Set(targetIds);
    const targets = parts.filter((part) => targetSet.has(part.id) && part.visible === hide);
    const flipped = new Set<string>();
    const lines: string[] = [];
    for (const part of targets) {
      const range = partRange(part);
      if (!range) {
        lines.push(`cannot ${hide ? 'hide' : 'show'} ${part.name} — its host range is not stamped yet`);
        continue;
      }
      // Write the synchronous mirror BEFORE the host changes displayed triangle count.
      if (hide) hiddenPartIdsRef.current.add(part.id);
      else hiddenPartIdsRef.current.delete(part.id);
      const result = withNativeMeshActionSource(source, () => modelToolApiRef.current?.setPartHidden(range.lo, range.hi, hide));
      if (result?.ok) {
        flipped.add(part.id);
        lines.push(`${hide ? 'hid' : 'showed'} ${part.name} [${range.lo},${range.hi}) — ${result.count} tris remain`);
      } else {
        if (hide) hiddenPartIdsRef.current.delete(part.id);
        else hiddenPartIdsRef.current.add(part.id);
        lines.push(`could not ${hide ? 'hide' : 'show'} ${part.name} [${range.lo},${range.hi}) — host op failed`);
      }
    }
    const status = lines.length > 0 ? lines.join(' · ') : `${label} is already ${hide ? 'hidden' : 'shown'}`;
    setState((prev) => ({ ...prev, status, modelParts: { ...prev.modelParts, [mid]: (prev.modelParts[mid] ?? []).map((part) => (flipped.has(part.id) ? { ...part, visible: !hide } : part)) } }));
  };

  const toggleVisiblePart = (id: string) => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const pressed = parts.find((p) => p.id === id);
    if (!mid || !pressed) {
      setState((prev) => ({ ...prev, status: 'part not found' }));
      return;
    }
    // The pressed row picks the DIRECTION for the whole set (req_2659): hiding a visible
    // row hides every visible member; showing a hidden row shows every hidden member.
    const hide = pressed.visible;
    applyPartVisibility(mid, parts, verbTargets(id, parts), hide, pressed.name);
  };

  const toggleVisiblePartGroup = (groupId: string) => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const members = partsInGroup(parts, groupId);
    if (!mid || members.length === 0) {
      setState((prev) => ({ ...prev, status: 'part group not found' }));
      return;
    }
    const hide = members.some((part) => part.visible);
    applyPartVisibility(mid, parts, members.map((part) => part.id), hide, groupPathById(parts, groupId)?.at(-1)?.name ?? 'group');
  };
  const deletePart = (id: string, source = 'dock') => {
    const mid = activePartsModelId(state);
    const allParts = mid ? (state.modelParts[mid] ?? []) : [];
    if (!mid || allParts.length === 0) {
      setState((prev) => ({ ...prev, status: 'part not found' }));
      return;
    }
    const targets = verbTargets(id, allParts);
    // Deleting the last visible geometry goes through the SAME host op as any other
    // delete — the host empties honestly now (req_2806: the refuse-to-empty guard is
    // gone; it made this path skip the op and leave a ghost mesh behind, req_2805).
    const lines: string[] = [];
    // A row only leaves the outliner when its geometry actually left the host — a failed
    // host op keeps the row, or the list and the stage diverge (the ghost cube, req_2981).
    const removed: string[] = [];
    for (const tid of targets) {
      const part = allParts.find((p) => p.id === tid);
      if (!part) continue;
      const range = partRange(part);
      // Each visible part is its own host op and its own journal entry — the status
      // reads one line per part (honest N entries, no faked atomicity; req_2659e).
      const r = range && part.visible
        ? withNativeMeshActionSource(source, () => modelToolApiRef.current?.deletePartRange(range.lo, range.hi))
        : null;
      if (!part.visible || !range || r?.ok) removed.push(tid);
      lines.push(part.visible && range
        ? r?.ok
          ? `deleted ${part.name} [${range.lo},${range.hi}) — ${r.count} tris remain`
          : `could not delete ${part.name} [${range.lo},${range.hi}) — host op failed`
        : `removed ${part.name} from the outliner`);
      if (removed.includes(tid)) hiddenPartIdsRef.current.delete(tid);
    }
    const status = lines.join(' · ');
    if (removed.length > 0) {
      authorizedPartShrinkTargetRef.current.set(mid, allParts.length - removed.length);
    }
    setState((prev) => {
      const parts = (prev.modelParts[mid] ?? []).filter((p) => !removed.includes(p.id));
      return { ...prev, status, modelParts: { ...prev.modelParts, [mid]: parts }, modelActivePartId: removed.includes(prev.modelActivePartId ?? '') ? (parts[0]?.id ?? null) : prev.modelActivePartId };
    });
    setSelectedPartIds((prev) => prev.filter((sid) => !removed.includes(sid)));
  };
  // The host mesh is authoritative, so a delete just changes it — parts are metadata. After a
  // delete, drop any part whose group range now has ZERO surviving faces (metadata only; no
  // geometry crosses the bridge, no recompose). Visible parts only (a hidden part is stashed in
  // the host, not deleted). Runs off the full-quality triangle drop below.
  //
  // hiddenPartIdsRef is the SYNCHRONOUS twin of each part's `visible` flag: hiding a part
  // drops the tri count and fires this reconcile BEFORE the visible:false state flip lands,
  // so the flag alone reads stale (visible:true, 0 surviving faces) and the just-hidden
  // part would be pruned like a delete. toggleVisiblePart writes the ref before the host op.
  const hiddenPartIdsRef = useRef(new Set<string>());
  const reconcileEmptyParts = () => {
    const mid = activePartsModelId(state);
    if (!mid) return;
    const hostFns = globalThis as any;
    const empty = new Set<string>();
    for (const p of state.modelParts[mid] ?? []) {
      const r = partRange(p);
      if (!p.visible || hiddenPartIdsRef.current.has(p.id) || !r) continue;
      if ((hostFns.__mesh_group_face_count?.(r.lo, r.hi) ?? -1) === 0) empty.add(p.id);
    }
    if (empty.size === 0) return;
    authorizedPartShrinkTargetRef.current.set(mid, (state.modelParts[mid] ?? []).length - empty.size);
    setState((prev) => {
      const list = (prev.modelParts[mid] ?? []).filter((p) => !empty.has(p.id));
      return {
        ...prev,
        modelParts: { ...prev.modelParts, [mid]: list },
        modelActivePartId: prev.modelActivePartId && empty.has(prev.modelActivePartId) ? (list[0]?.id ?? null) : prev.modelActivePartId,
        status: `removed ${empty.size} emptied part(s)`,
      };
    });
  };
  // The model's live triangle count is mirrored up via onToolState. A DROP at FULL quality means
  // faces were deleted (loop cut only grows; gizmo moves don't change the count) → drop any part
  // left empty. The full-quality gate matters: decimation drops the DISPLAYED count without
  // touching source faces, so a group's count could read 0 mid-decimation and falsely prune.
  const prevTrisRef = useRef(0);
  useEffect(() => {
    const tris = state.modelTool.tris;
    if (tris < prevTrisRef.current && state.modelTool.quality >= 0.999) reconcileEmptyParts();
    prevTrisRef.current = tris;
  }, [state.modelTool.tris]);

  // ── Studio-parity part ops (req_2520) ────────────────────────────────────────
  // Duplicate explicit part rows (mirrorAxis 0/1/2 = mirrored twin across that
  // origin plane; -1 = plain copy). Each row is its own host op / journal entry —
  // honest N entries, never a faked atomic one. `groupCopy` assigns the results to
  // a NEW organizational folder without fusing their topology.
  const duplicatePartRows = (
    rows: ModelPart[],
    mirrorAxis: number,
    groupCopy?: { id: string; name: string; sourceName: string; pathByPartId: Map<string, { id: string; name: string }[]> },
    source = 'dock',
  ) => {
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    if (!mid || !api || rows.length === 0) {
      setState((prev) => ({ ...prev, status: 'duplicate needs a focused part with a stamped range' }));
      return;
    }
    const placedRows: ModelPart[] = [];
    const lines: string[] = [];
    const usedNames = parts.map((part) => part.name);
    let seq = state.seq;
    for (const part of rows) {
      const range = partRange(part);
      if (!range) {
        lines.push(`${part.name} has no stamped range`);
        continue;
      }
      if (!part.visible) {
        lines.push(`cannot duplicate ${part.name} while it is hidden — show it first`);
        continue;
      }
      const r = withNativeMeshActionSource(source, () => api.duplicatePart(range.lo, range.hi, mirrorAxis));
      if (!r) {
        lines.push(`could not duplicate ${part.name} [${range.lo},${range.hi}) — host op failed`);
        continue;
      }
      const qualifier = mirrorAxis >= 0 ? `mirror ${'XYZ'[mirrorAxis]}` : undefined;
      const duplicateName = nextDuplicatePartName(part.name, usedNames, qualifier);
      usedNames.push(duplicateName);
      const seed = part.mesh ? (mirrorAxis >= 0 ? mirrorMesh(part.mesh, mirrorAxis as 0 | 1 | 2) : cloneMesh(part.mesh)) : undefined;
      const copiedPath = groupCopy?.pathByPartId.get(part.id) ?? partGroupPath(part);
      const copiedLeaf = copiedPath[copiedPath.length - 1];
      placedRows.push({
        id: `part:dup:${seq++}`,
        name: duplicateName,
        kind: part.kind,
        ...(seed ? { mesh: seed } : {}),
        visible: true,
        color: part.color,
        lift: part.lift,
        groupId: copiedLeaf?.id,
        groupName: copiedLeaf?.name,
        groupPath: copiedPath.length ? copiedPath : undefined,
        outlinerOrder: parts.length + placedRows.length,
        lo: r.lo,
        hi: r.hi,
      });
      lines.push(`${mirrorAxis >= 0 ? 'mirrored' : 'duplicated'} ${part.name} → [${r.lo},${r.hi})`);
    }
    if (placedRows.length === 0) {
      setState((prev) => ({ ...prev, status: lines.join(' · ') || 'duplicate needs a focused part with a stamped range' }));
      return;
    }
    const nextParts = [...parts, ...placedRows];
    const focusedIds = placedRows.map((part) => part.id);
    const primaryId = placedRows[placedRows.length - 1]!.id;

    // Duplication hands the edit transaction to its result. Updating only the
    // highlighted row + selected-id set leaves the HOST scoped to the source,
    // so the next gizmo/topology action edits the old part until the duplicate
    // is clicked manually. Reuse the same complete focus push as an outliner
    // click: active range, edit scope, face selection, and viewer counts.
    selectedPartIdsRef.current = focusedIds;
    setSelectedPartIds(focusedIds);
    pushPartSetToHost(state, nextParts, focusedIds, primaryId);
    const partialGroupReport = groupCopy && placedRows.length < rows.length ? ` · ${lines.join(' · ')}` : '';
    const status = groupCopy
      ? `duplicated group "${groupCopy.sourceName}" → "${groupCopy.name}" — ${placedRows.length}/${rows.length} parts focused${partialGroupReport}`
      : lines.join(' · ');
    setState((prev) => ({
      ...prev,
      seq: seq + 1,
      modelParts: { ...prev.modelParts, [mid]: [...(prev.modelParts[mid] ?? []), ...placedRows] },
      modelActivePartId: primaryId,
      status,
    }));
    // Track the new primary immediately in the live UV preview too.
    const bridge = (globalThis as any).__modelFocusBridge;
    if (bridge?.paintLive) bridge.refreshUv?.();
  };

  // A row duplicate acts on the WHOLE selected set when the pressed row belongs
  // to it (req_2659). The copied rows keep their existing folder membership.
  const duplicatePartById = (id: string | null, mirrorAxis: number, source = 'dock') => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const rows = id
      ? verbTargets(id, parts).map((tid) => parts.find((part) => part.id === tid)).filter((part): part is ModelPart => Boolean(part))
      : [];
    duplicatePartRows(rows, mirrorAxis, undefined, source);
  };

  // Folder duplicate = copy EVERY member, put the copies into a fresh folder,
  // then focus that complete copied set. Predictable local blockers are rejected
  // before the first host op so a hidden/unstamped member cannot create a partial
  // folder. A host failure mid-batch still reports its honest partial result.
  const duplicatePartGroup = (groupId: string) => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const members = partsInGroup(parts, groupId);
    if (!mid || members.length === 0) {
      setState((prev) => ({ ...prev, status: 'part group not found' }));
      return;
    }
    const blocked = members.find((part) => !part.visible || !partRange(part));
    const groupLabel = groupPathById(parts, groupId)?.at(-1)?.name ?? 'group';
    if (blocked) {
      setState((prev) => ({
        ...prev,
        status: !blocked.visible
          ? `cannot duplicate ${groupLabel} while ${blocked.name} is hidden — show the whole group first`
          : `cannot duplicate ${groupLabel} — ${blocked.name} has no stamped range`,
      }));
      return;
    }
    const sourceName = groupPathById(parts, groupId)?.at(-1)?.name ?? 'Group';
    const copiedGroupId = `part-group:${state.seq}`;
    const copiedGroupName = nextDuplicateGroupName(sourceName, parts);
    const descendantIds = new Map<string, string>();
    const pathByPartId = new Map<string, { id: string; name: string }[]>();
    let descendantSequence = 0;
    for (const member of members) {
      const path = partGroupPath(member);
      const at = path.findIndex((group) => group.id === groupId);
      if (at < 0) continue;
      const copied = [
        ...path.slice(0, at),
        { id: copiedGroupId, name: copiedGroupName },
        ...path.slice(at + 1).map((group) => {
          let id = descendantIds.get(group.id);
          if (!id) {
            id = `part-group:dup:${state.seq}:${descendantSequence++}`;
            descendantIds.set(group.id, id);
          }
          return { id, name: group.name };
        }),
      ];
      pathByPartId.set(member.id, copied);
    }
    duplicatePartRows(members, -1, {
      id: copiedGroupId,
      name: copiedGroupName,
      sourceName,
      pathByPartId,
    });
  };

  const openPathArrayPrompt = () => {
    const mid = activePartsModelId(state);
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const sourceIds = effectiveSelectedIds(state, parts, selectedPartIdsRef.current);
    const sources = sourceIds.map((id) => parts.find((part) => part.id === id)).filter((part): part is ModelPart => Boolean(part));
    if (!mid || sources.length === 0) {
      setState((prev) => ({ ...prev, status: 'path array: select a source part or outliner group first' }));
      return;
    }
    const blocked = sources.find((part) => !part.visible || !partRange(part));
    if (blocked) {
      setState((prev) => ({
        ...prev,
        status: !blocked.visible
          ? `path array: show ${blocked.name} first — every source member must be live`
          : `path array: ${blocked.name} has no stamped host range`,
      }));
      return;
    }
    const commonGroup = sources[0]!.groupId && sources.every((part) => part.groupId === sources[0]!.groupId)
      ? sources[0]!.groupName
      : null;
    const label = commonGroup
      ? `${commonGroup} (${sources.length} independent part${sources.length === 1 ? '' : 's'})`
      : sources.length === 1 ? sources[0]!.name : `${sources.length} selected parts`;
    const ranges = sources.map((part) => partRange(part)!) as { lo: number; hi: number }[];
    const sourceSpanU = modelToolApiRef.current?.pathArraySpans(ranges) ?? { xU: 1, zU: 1 };
    modelMenu.close();
    setPathArrayPrompt({ sourceIds, label, sourceSpanU });
    setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: `path array source: ${label}` }));
  };

  const applyPathArray = (rawParams: PathArrayParams, source = pathArraySourceRef.current) => {
    const prompt = pathArrayPrompt;
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const sources = prompt?.sourceIds.map((id) => parts.find((part) => part.id === id)).filter((part): part is ModelPart => Boolean(part)) ?? [];
    if (!prompt || !mid || !api || sources.length !== prompt.sourceIds.length) {
      setPathArrayPrompt(null);
      setState((prev) => ({ ...prev, status: 'path array cancelled — its source parts changed while the dialog was open' }));
      return;
    }
    const ranges = sources.map(partRange);
    if (sources.some((part) => !part.visible) || ranges.some((range) => range === null)) {
      setPathArrayPrompt(null);
      setState((prev) => ({ ...prev, status: 'path array cancelled — show and reselect the complete source bay' }));
      return;
    }
    const params = sanitizePathArrayParams(rawParams);
    const hostResult = withNativeMeshActionSource(source, () => api.pathArray(ranges as { lo: number; hi: number }[], params));
    const expectedRanges = (params.bays - 1) * sources.length;
    if (!hostResult || hostResult.ranges.length !== expectedRanges) {
      // A malformed post-success answer must never strand geometry without rows.
      // The host operation is one journal unit, so this is an exact rollback.
      if (hostResult) withNativeMeshActionSource(source, () => api.undoMesh());
      setState((prev) => ({ ...prev, status: 'path array failed — source length/axis or host ranges were invalid; no partial array was kept' }));
      return;
    }
    const materialized = materializePathArrayRows(parts, prompt.sourceIds, hostResult.ranges, state.seq);
    if (!materialized || materialized.created.length !== expectedRanges) {
      withNativeMeshActionSource(source, () => api.undoMesh());
      setState((prev) => ({ ...prev, status: 'path array metadata failed validation — host append rolled back exactly' }));
      return;
    }
    const focusedIds = materialized.created.map((part) => part.id);
    const primaryId = focusedIds[focusedIds.length - 1]!;
    const pointEnd = params.points?.[params.points.length - 1];
    const pathSummary = pointEnd
      ? `${params.points!.length} XYZ boundaries ending at (${pointEnd.xU}, ${pointEnd.yU}, ${pointEnd.zU}) u`
      : `${params.turnDegrees >= 0 ? '+' : ''}${params.turnDegrees}° turn, ${params.riseU >= 0 ? '+' : ''}${params.riseU} u rise`;
    selectedPartIdsRef.current = focusedIds;
    setSelectedPartIds(focusedIds);
    pushPartSetToHost(state, materialized.parts, focusedIds, primaryId);
    setPathArrayPrompt(null);
    setState((prev) => ({
      ...prev,
      seq: materialized.nextSeq,
      modelParts: { ...prev.modelParts, [mid]: materialized.parts },
      modelActivePartId: primaryId,
      modelDirty: { ...prev.modelDirty, [mid]: true },
      status: `built ${params.bays}-bay path in ${materialized.groupName} — ${materialized.created.length} new independent part${materialized.created.length === 1 ? '' : 's'}, ${pathSummary} · one undo`,
    }));
  };

  // Detach the face-mode selection into a NEW part (host group remap — geometry and
  // paint stay put). The panel becomes the focused part, ready to grab with the gizmo.
  const runDetachSelection = (source = 'dock') => {
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    if (!mid || !api) {
      setState((prev) => ({ ...prev, status: 'detach needs an open multi-part model document' }));
      return;
    }
    const r = withNativeMeshActionSource(source, () => api.detachSelection());
    if (!r) {
      setState((prev) => ({ ...prev, status: 'detach: select faces first (face mode) — and the whole mesh cannot detach from itself' }));
      return;
    }
    const parts = state.modelParts[mid] ?? [];
    const n = parts.filter((p) => p.id.startsWith('part:detach:')).length + 1;
    const placed: ModelPart = { id: `part:detach:${state.seq}`, name: `Detached ${n}`, visible: true, color: PART_TINTS[parts.length % PART_TINTS.length]!, lo: r.lo, hi: r.hi };
    setState((prev) => ({
      ...prev,
      seq: prev.seq + 1,
      modelParts: { ...prev.modelParts, [mid]: [...(prev.modelParts[mid] ?? []), placed] },
      modelActivePartId: placed.id,
      status: `detached selection → ${placed.name} [${r.lo},${r.hi})`,
    }));
  };

  // Merge exactly the shift-selected outliner set into its PRIMARY (last-clicked) row.
  // List order is irrelevant (req_2811): the explicit set is the whole target contract.
  // The host op remaps every old authored group one-to-one into the fused part range, so
  // a cube's six faces remain six faces instead of becoming one giant face (req_2870).
  const mergeSelectedParts = (source = 'dock') => {
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    const parts = mid ? (state.modelParts[mid] ?? []) : [];
    const selectedIds = effectiveSelectedIds(state, parts, selectedPartIdsRef.current);
    const selected = selectedIds.map((id) => parts.find((p) => p.id === id)).filter((p): p is ModelPart => Boolean(p));
    if (!mid || !api || selected.length < 2) {
      setState((prev) => ({ ...prev, status: 'merge parts: shift-select at least two outliner rows first' }));
      return;
    }
    const hidden = selected.filter((p) => !p.visible);
    if (hidden.length > 0) {
      setState((prev) => ({ ...prev, status: `merge parts: show ${hidden.map((p) => p.name).join(', ')} first` }));
      return;
    }
    const unstamped = selected.filter((p) => !partRange(p));
    if (unstamped.length > 0) {
      setState((prev) => ({ ...prev, status: `merge parts: ${unstamped.map((p) => p.name).join(', ')} need stamped host ranges` }));
      return;
    }

    let survivor = selected.find((p) => p.id === state.modelActivePartId) ?? selected[selected.length - 1]!;
    let survivorRange = partRange(survivor)!;
    let survivorSeed = survivor.mesh;
    let workingParts = parts.slice();
    const consumed = new Set<string>();
    const mergedNames: string[] = [];
    let failedName: string | null = null;

    for (const source of selected) {
      if (source.id === survivor.id) continue;
      const sourceRange = partRange(source)!;
      const r = withNativeMeshActionSource(source, () => api.mergeParts(survivorRange.lo, survivorRange.hi, sourceRange.lo, sourceRange.hi));
      if (!r) {
        failedName = source.name;
        break;
      }
      survivorSeed = survivorSeed && source.mesh
        ? mergeMesh(survivorSeed, source.mesh, [0, (source.lift ?? 0) - (survivor.lift ?? 0), 0])
        : undefined;
      survivorRange = r;
      survivor = {
        ...survivor,
        ...(survivorSeed ? { mesh: survivorSeed } : { mesh: undefined, kind: undefined }),
        lo: r.lo,
        hi: r.hi,
      };
      consumed.add(source.id);
      mergedNames.push(source.name);
      workingParts = workingParts
        .filter((p) => p.id !== source.id)
        .map((p) => (p.id === survivor.id ? survivor : p));

      // A 3+ selection is intentionally one honest host journal entry per consumed
      // part. Stamp the intermediate rows before the next op so undoing one step
      // restores metadata matching that intermediate mesh, not the original N rows.
      const lite = workingParts.map(({ mesh: _mesh, ...rest }) => rest);
      (globalThis as any).__mesh_journal_note?.(JSON.stringify({ modelId: mid, parts: lite }));
    }
    if (consumed.size === 0) {
      setState((prev) => ({ ...prev, status: `could not merge ${failedName ?? 'the selected parts'} — host op failed` }));
      return;
    }

    authorizedPartShrinkTargetRef.current.set(mid, workingParts.length);
    selectedPartIdsRef.current = [survivor.id];
    setSelectedPartIds([survivor.id]);
    // The structural host op clears its old face selection. Re-scope AND re-select the
    // fused row immediately so no highlighted-but-empty outliner residue survives.
    pushPartSetToHost(state, workingParts, [survivor.id], survivor.id);
    const status = failedName
      ? `merged ${mergedNames.join(', ')} into ${survivor.name}; stopped before ${failedName} (host op failed)`
      : `merged ${selected.length} selected parts into ${survivor.name} — authored faces preserved`;
    setState((prev) => {
      const list = (prev.modelParts[mid] ?? [])
        .filter((p) => !consumed.has(p.id))
        .map((p) => (p.id === survivor.id ? survivor : p));
      return {
        ...prev,
        modelParts: { ...prev.modelParts, [mid]: list },
        modelActivePartId: survivor.id,
        status,
      };
    });
  };

  // Face-selection ops that don't change part structure: winding / glass / solidify /
  // merge-faces. Each is a host-owned journaled mutation; the shell only reports it.
  const runFaceOp = (kind: 'flip' | 'glass' | 'solidify' | 'merge-faces', source = 'dock') => {
    const api = modelToolApiRef.current;
    let ok = false;
    let okMsg = '';
    let failMsg = '';
    if (kind === 'flip') {
      ok = withNativeMeshActionSource(source, () => api?.flipSelection() ?? false);
      okMsg = 'flipped the selected face(s) to the opposite side';
      failMsg = 'flip face: select face(s) first (face mode)';
    } else if (kind === 'glass') {
      ok = withNativeMeshActionSource(source, () => api?.glassSelection() ?? false);
      okMsg = 'toggled glass on the selected faces';
      failMsg = 'glass: select faces first (face mode)';
    } else if (kind === 'solidify') {
      ok = withNativeMeshActionSource(source, () => api?.solidifySelection() ?? false);
      okMsg = 'solidified the selected faces (inner skin + rim walls)';
      failMsg = 'solidify: select faces first (face mode)';
    } else {
      ok = withNativeMeshActionSource(source, () => api?.mergeFaces() ?? false);
      okMsg = 'merged the selection into one face';
      failMsg = 'merge faces: select 2+ faces (face mode) first';
    }
    setState((prev) => ({ ...prev, status: ok ? okMsg : failMsg }));
  };

  // Cross-model reuse: append a saved package document into the OPEN model,
  // preserving its authored part ranges. File-backed packages host-parse their
  // copied .glb/.obj. Pick the same model again to reuse it any number of times.
  const importModelAsParts = (pkg: ModelPackage, source = 'dock') => {
    setImportPartOpen(false);
    const mid = activePartsModelId(state);
    const api = modelToolApiRef.current;
    if (!mid || !api) {
      setState((prev) => ({ ...prev, status: 'open a model document first — library imports land as parts of the open model' }));
      return;
    }
    const existing = state.modelParts[mid] ?? [];
    let tint = existing.length;
    const nextColor = () => PART_TINTS[tint++ % PART_TINTS.length]!;
    const added: ModelPart[] = [];
    const doc = packageMeshDoc(pkg);
    const meta = packageMeshDocParts(pkg) ?? [];
    if (doc && doc.vertices.length >= 24) {
      for (let index = 0; index < doc.ranges.length; index += 1) {
        const geo = meshDocRangeGeometry(doc, index);
        if (geo.vertices.length === 0) continue;
        const row = meta[index];
        const color = row?.color ?? nextColor();
        const r = withNativeMeshActionSource(source, () => api.appendPart(geo.positions, geo.faceGroups, color));
        if (!r) continue;
        added.push({
          id: `part:imp:${state.seq}:${added.length}`,
          name: doc.ranges.length === 1 ? pkg.name : `${pkg.name} · ${row?.name ?? `part ${index + 1}`}`,
          kind: row?.kind as PrimitiveKind | undefined,
          visible: true,
          color,
          lo: r.lo,
          hi: r.hi,
        });
      }
    } else if (pkg.primitive) {
      const built = primitiveMeshData(pkg.primitive);
      const color = nextColor();
      const r = built.positions.length > 0
        ? withNativeMeshActionSource(source, () => api.appendPart(built.positions, built.faceGroups, color))
        : null;
      if (r) added.push({ id: `part:imp:${state.seq}:0`, name: pkg.name, kind: pkg.primitive, mesh: primitivePartMesh(pkg.primitive), visible: true, color, lo: r.lo, hi: r.hi });
    } else if (pkg.viewerPath && isViewerFile(pkg.viewerPath)) {
      const color = nextColor();
      const r = withNativeMeshActionSource(source, () => api.appendModelFile(pkg.viewerPath, color));
      if (r) added.push({ id: `part:imp:${state.seq}:0`, name: pkg.name, visible: true, color, lo: r.lo, hi: r.hi });
    }
    if (added.length === 0) {
      setState((prev) => ({ ...prev, status: `could not import ${pkg.name} — its package has no usable mesh document or .glb/.obj` }));
      return;
    }
    setState((prev) => ({
      ...prev,
      seq: prev.seq + 1,
      modelParts: { ...prev.modelParts, [mid]: [...(prev.modelParts[mid] ?? []), ...added] },
      modelActivePartId: added[added.length - 1]!.id,
      status: `imported ${pkg.name} as ${added.length} part(s) — pick it again to reuse it`,
    }));
  };

  // ── Host part-range truth → outliner rows (req_2644) ─────────────────────────
  // The host maintains each part's authored-group range through every topology op
  // (a loop cut renumbers group ids; append/detach/merge grow or fuse ranges).
  // __mesh_part_ranges is the ONE read-back; rows re-stamp from it by RANK (rows
  // ordered by their current lo ↔ host ranges ascending — renumbering preserves
  // part order), so lo/hi in the outliner is a mirror, never cart arithmetic.
  const readHostPartRanges = (): { lo: number; hi: number }[] | null => {
    try {
      const j = (globalThis as any).__mesh_part_ranges?.();
      if (typeof j !== 'string' || !j) return null;
      const o = JSON.parse(j);
      if (!o?.ok || !Array.isArray(o.ranges)) return null;
      return (o.ranges as [number, number][]).map((p) => ({ lo: p[0] | 0, hi: p[1] | 0 }));
    } catch {
      return null;
    }
  };
  const stampRowsByRank = (rows: ModelPart[], ranges: { lo: number; hi: number }[]): ModelPart[] => {
    const byLo = rows.map((p, i) => ({ p, i })).sort((x, y) => ((x.p.lo ?? Number.MAX_SAFE_INTEGER) - (y.p.lo ?? Number.MAX_SAFE_INTEGER)) || (x.i - y.i));
    const sorted = ranges.slice().sort((x, y) => x.lo - y.lo);
    const stamped = rows.slice();
    byLo.forEach((e, rank) => {
      const rg = sorted[rank];
      if (rg) stamped[e.i] = { ...e.p, lo: rg.lo, hi: rg.hi };
    });
    return stamped;
  };
  // ModelView announces moved ranges through this global (same pattern as
  // __meshEditSelChanged) right after any adopt whose resync saw new values.
  useEffect(() => {
    (globalThis as any).__modelPartRangesChanged = (ranges: { lo: number; hi: number }[]) => {
      const s = stateRef.current;
      const mid = activePartsModelId(s);
      if (!mid) return;
      setState((prev) => {
        const rows = prev.modelParts[mid] ?? [];
        // A count mismatch means a STRUCTURAL change is mid-flight (append/detach/
        // delete) — its own handler adds/removes the row with the op's range.
        if (rows.length === 0 || rows.length !== ranges.length) return prev;
        const stamped = stampRowsByRank(rows, ranges);
        // The focused SET re-scopes to its refreshed ranges: the move gizmo must
        // always drive the selected parts' true faces, never a stale span. Multi-
        // select (req_2659) re-pushes the whole union; the UV filter's active-range
        // global follows the primary.
        const active = stamped.find((p) => p.id === prev.modelActivePartId);
        if (active && active.lo != null && active.hi != null) {
          (globalThis as any).__modelActivePartRange = { lo: active.lo, hi: active.hi };
          const sel = selectedPartIdsRef.current.filter((sid) => stamped.some((p) => p.id === sid));
          if (!prev.modelTool.paint && sel.length > 1) {
            const pairs: number[] = [];
            for (const sid of sel) {
              const p = stamped.find((pp) => pp.id === sid);
              if (p && p.lo != null && p.hi != null) pairs.push(p.lo, p.hi);
            }
            (globalThis as any).__mesh_edit_scope_ranges?.(new Uint32Array(pairs));
          } else {
            (globalThis as any).__mesh_edit_scope?.(active.lo, active.hi);
          }
        }
        return { ...prev, modelParts: { ...prev.modelParts, [mid]: stamped } };
      });
    };
    return () => { (globalThis as any).__modelPartRangesChanged = undefined; };
  }, []);

  // ── Mesh undo/redo (host journal; req_2520) ──────────────────────────────────
  // Seed meshes by part id, kept for the session so a restored part row regains its
  // seed (the journal note carries part METADATA only — meshes never ride the note).
  const partMeshSeedsRef = useRef<Record<string, EditMesh>>({});
  const meshUndoRedo = (redo: boolean, source = 'native') => {
    const api = modelToolApiRef.current;
    const mid = activePartsModelId(state);
    const r = withNativeMeshActionSource(source, () => (redo ? api?.redoMesh() : api?.undoMesh()));
    const verb = redo ? 'redo' : 'undo';
    if (!r?.ok) {
      setState((prev) => ({ ...prev, status: `nothing to ${verb} on this model` }));
      return;
    }
    let restored: ModelPart[] | null = null;
    if (r.note && mid) {
      try {
        const o = JSON.parse(r.note);
        if (o?.modelId === mid && Array.isArray(o.parts)) {
          restored = (o.parts as ModelPart[]).map((p) => {
            const seed = partMeshSeedsRef.current[p.id];
            return seed ? { ...p, mesh: seed } : p;
          });
        }
      } catch { /* stale/foreign note — the geometry restored; part rows stay as-is */ }
    }
    if (restored && mid) {
      // UNDO SAFETY (req_2644): the journal restored the HOST's part ranges along with
      // the geometry — re-stamp the restored rows' lo/hi from that read-back instead of
      // trusting only the note (a stale note must never outvote the mesh).
      const hostRanges = readHostPartRanges();
      if (hostRanges && hostRanges.length === restored.length) {
        restored = stampRowsByRank(restored, hostRanges);
      }
      api!.setPartRangesMirror((hostRanges ?? restored.filter((p) => p.lo != null && p.hi != null).map((p) => ({ lo: p.lo!, hi: p.hi! }))));
      const currentPartCount = state.modelParts[mid]?.length ?? 0;
      if (restored.length < currentPartCount) authorizedPartShrinkTargetRef.current.set(mid, restored.length);
      else authorizedPartShrinkTargetRef.current.delete(mid);
      setState((prev) => {
        const keep = restored!;
        const nextActive = keep.some((p) => p.id === prev.modelActivePartId) ? prev.modelActivePartId : (keep[0]?.id ?? null);
        // Keep the gizmo scoped to the focused part's TRUE range across the undo.
        const activeRow = keep.find((p) => p.id === nextActive);
        if (activeRow && activeRow.lo != null && activeRow.hi != null) (globalThis as any).__mesh_edit_scope?.(activeRow.lo, activeRow.hi);
        return {
          ...prev,
          modelParts: { ...prev.modelParts, [mid]: keep },
          modelActivePartId: nextActive,
          status: `${verb} ${r.label}`,
        };
      });
      markActiveModelDirty();
    } else {
      setState((prev) => ({ ...prev, status: `${verb} ${r.label}` }));
      markActiveModelDirty();
    }
  };

  // ── Paint stroke undo/redo (host stroke journal; req_2672) ────────────────────
  // Live only while the paint session is on: one unit = one stroke (pointer-down→up,
  // fills included) or one structural layer op. The host drops/re-appends the unit and
  // RE-RUNS the stroke program onto the atlas — geometry never changes, so no mesh
  // adopt/outliner resync rides this path.
  const paintUndoRedo = (redo: boolean) => {
    const verb = redo ? 'redo' : 'undo';
    try {
      const j = (globalThis as any)[redo ? '__mesh_paint_redo' : '__mesh_paint_undo']?.();
      if (typeof j === 'string' && j) {
        const o = JSON.parse(j);
        if (o?.ok === 1) {
          setState((prev) => ({ ...prev, status: `${verb} ${o.label || 'stroke'} — ${o.undo | 0} strokes left to undo` }));
          markActiveModelDirty();
          return;
        }
      }
    } catch { /* malformed door answer reads as empty below */ }
    setState((prev) => ({ ...prev, status: `nothing to ${verb} in paint — the stroke journal is empty` }));
  };

  // Mirror the outliner's parts metadata into the host journal note after EVERY parts
  // change, so the snapshot taken by the NEXT op carries the pre-op outliner state.
  // Meshes stay out of the note (session seed cache above); only metadata crosses.
  useEffect(() => {
    const mid = activePartsModelId(state);
    if (!mid) return;
    const parts = state.modelParts[mid] ?? [];
    for (const p of parts) {
      if (p.mesh) partMeshSeedsRef.current[p.id] = p.mesh;
    }
    const lite = parts.map(({ mesh: _mesh, ...rest }) => rest);
    (globalThis as any).__mesh_journal_note?.(JSON.stringify({ modelId: mid, parts: lite }));
  }, [state.modelParts, state.activeWorkspaceDocumentId]);

  // One central, surface-aware hotkey layer (req_2540). Every key edge resolves through the keymap
  // against the surface in view — so the key a menu advertises is the key that fires. World tools
  // (B/V/P/…), the model mesh tools (routed to the host api / face-op handlers), global chords
  // (Ctrl+Z/S/O/…) and undo/redo all dispatch through the same runCommand path as the menus.
  // ModelView keeps only viewport-native Esc/Delete. Refs keep the once-installed subscription
  // reading live state + the current runCommand. (The engine routes keys to focused text inputs
  // first, so typing in a field never triggers a command.)
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;

  // ── Per-device tool memory (req_3089) ─────────────────────────────────────────
  // The host flips system:pointerDevice on the mouse ⇄ pen change edge (pen
  // proximity counts, so hovering the stylus over the tablet pre-switches before
  // it touches). Restore the incoming device's remembered tool for the surface
  // in view. lastToolByScopeRef dedupes: re-dispatching an already-active tool
  // would EXIT toggle-style mesh tools, so an unchanged tool never re-fires.
  useEffect(() => busOn('system:pointerDevice', (p: any) => {
    const dev: 'mouse' | 'pen' = p?.device === 'pen' ? 'pen' : 'mouse';
    if (pointerDeviceRef.current === dev) return;
    pointerDeviceRef.current = dev;
    const s = stateRef.current;
    const surface = activeSurface(s);
    if (surface !== 'world' && surface !== 'model') return;
    const remembered = s.deviceTools[surface]?.[dev];
    if (!remembered || remembered === lastToolByScopeRef.current[surface]) return;
    // A slot persisted across a code update may name a removed command.
    if (!commandById(remembered)) return;
    if (surface === 'world' && s.activeCommandId === remembered) return;
    runCommandRef.current(remembered, 'device');
  }), []);

  // Native map painting bypasses React hit-testing while the WorldLoader owns
  // the pointer stream. Drain completed host-side authoring events at UI rate
  // and board them onto the same editor bus as piece placements.
  useEffect(() => {
    const drain = () => {
      const events = mapEventDrain();
      if (!events.length) return;
      if (!editorPersistenceSettings().autosave) setManualWorldDirty(true);
      const materializedAtMs = Date.now();
      const mapPaint = stateRef.current.mapPaint;
      for (const event of events) dispatchMapPaint(mapEventPayload(event, mapPaint, materializedAtMs));
    };
    drain();
    const t = setInterval(drain, 250);
    return () => clearInterval(t);
  }, []);

  // Geometry mutations converge on the resident mesh journal whether they came
  // from a toolbar projection, an outliner verb, or the native viewport gizmo.
  // Drain that authority at UI rate; this effect observes outcomes only and does
  // not mirror mesh state through React.
  useEffect(() => {
    const drain = () => {
      for (const report of nativeMeshActionDrain()) {
        const mapped = modelIdByMeshTokenRef.current.get(report.documentToken);
        const modelId = mapped || `native-model-token:${report.documentToken}`;
        dispatchNativeMeshAction(report, modelId);
      }
    };
    drain();
    const timer = setInterval(drain, 250);
    return () => clearInterval(timer);
  }, []);

  // ── RJIT_PARTOPS: headless outliner harness (req_2659) ────────────────────────
  // Drives the REAL outliner handlers by row index — the shell-side twin of
  // RJIT_MESHOPS (which drives host doors). ';'-separated ops:
  //   sel:i · shiftsel:i (the shift-click accumulate path, shift asserted on the live
  //   modifier record for the call) · add:kind · eye:i · dup:i · del:i · merge · undo · redo · wait:frames ·
  //   report (rows + selected set + primary) · audit (adds face counts + host selection).
  // Handlers are per-render closures — the ref keeps the once-installed timer calling
  // the CURRENT ones (the same mount-frozen-closure trap as the meshops harness).
  const partOpsRef = useRef({ selectPart, addPrimitivePart, toggleVisiblePart, duplicatePartById, deletePart, mergeSelectedParts, meshUndoRedo });
  partOpsRef.current = { selectPart, addPrimitivePart, toggleVisiblePart, duplicatePartById, deletePart, mergeSelectedParts, meshUndoRedo };
  useEffect(() => {
    const opsText = (globalThis as any).__env_get?.('RJIT_PARTOPS') as string | null | undefined;
    if (!opsText) return;
    const ops = opsText.split(';').map((t) => t.trim()).filter(Boolean);
    let step = 0;
    const runOp = (op: string) => {
      const [name, arg] = op.split(':');
      const s = stateRef.current;
      const mid = activePartsModelId(s);
      const parts = mid ? (s.modelParts[mid] ?? []) : [];
      const idx = Number(arg ?? -1);
      const id = parts[idx]?.id ?? null;
      const h = partOpsRef.current;
      if (name === 'sel' && id) h.selectPart(id);
      else if (name === 'shiftsel' && id) {
        const m = currentModifiers() as { shift: boolean };
        m.shift = true; // assert the live modifier record for this one call — the REAL shift branch runs
        try { h.selectPart(id); } finally { m.shift = false; }
      } else if (name === 'add' && PRIMITIVE_MESHES.some((primitive) => primitive.kind === arg)) {
        h.addPrimitivePart(arg as PrimitiveKind, { size: 1, height: 1, resolution: 1 });
      } else if (name === 'eye' && id) h.toggleVisiblePart(id);
      else if (name === 'dup' && id) h.duplicatePartById(id, -1);
      else if (name === 'del' && id) h.deletePart(id);
      else if (name === 'merge') h.mergeSelectedParts();
      else if (name === 'undo') h.meshUndoRedo(false);
      else if (name === 'redo') h.meshUndoRedo(true);
      else if (name === 'report') {
        const sel = effectiveSelectedIds(s, parts, selectedPartIdsRef.current);
        const rows = parts.map((p) => ({ name: p.name, lo: p.lo ?? null, hi: p.hi ?? null, visible: p.visible, selected: sel.includes(p.id), primary: p.id === s.modelActivePartId }));
        console.error(`[partops] report → ${JSON.stringify(rows)}`);
      } else if (name === 'audit') {
        const host = globalThis as any;
        const sel = effectiveSelectedIds(s, parts, selectedPartIdsRef.current);
        const rows = parts.map((p) => {
          const range = partRange(p);
          return { name: p.name, lo: p.lo ?? null, hi: p.hi ?? null, faces: range ? Number(host.__mesh_group_face_count?.(range.lo, range.hi) ?? -1) : -1, selected: sel.includes(p.id), primary: p.id === s.modelActivePartId };
        });
        let selection = null;
        try { selection = JSON.parse(host.__mesh_edit_counts?.() ?? 'null'); } catch { /* malformed host read stays null */ }
        console.error(`[partops] audit → ${JSON.stringify({ rows, selection })}`);
      } else if (name !== 'wait') console.error(`[partops] unknown/invalid op: ${op}`);
    };
    const runNext = () => {
      if (step >= ops.length) { console.error('[partops] DONE'); return; }
      const op = ops[step++]!;
      console.error(`[partops] ${op}`);
      try { runOp(op); } catch (e) { console.error(`[partops] ${op} threw: ${e}`); }
      setTimeout(runNext, op.startsWith('wait') ? (Number(op.slice(5)) || 0) * 16 : 150);
    };
    setTimeout(runNext, 1200); // after RJIT_MODELDOC's document mount + first frames
    return undefined;
  }, []);
  const outlinerClipboardRef = useRef<{ modelId: string; partIds: string[] } | null>(null);
  const duplicateOutlinerRowsRef = useRef((rows: ModelPart[]) => duplicatePartRows(rows, -1, undefined, 'hotkey'));
  duplicateOutlinerRowsRef.current = (rows) => duplicatePartRows(rows, -1, undefined, 'hotkey');
  // Subscribed DIRECTLY to the __keydown bus and normalized through modifiersFromKeyEvent:
  // the winning key bridge (useIFTTT's) emits ctrlKey/shiftKey flags with no `mods` object,
  // so useModifiers.onKeyDown handed every chord all-false modifiers — Ctrl+Z arrived as
  // bare 'z' and the whole keyboard undo path was dead (req_2620 gap W root cause).
  useEffect(() => subscribe('__keydown', (e: any) => {
    const s = stateRef.current;
    const key = typeof e?.key === 'string' ? e.key : '';
    if (!key) return;
    const mods = modifiersFromKeyEvent(e);
    // An open menu owns input — don't leak a hotkey to a command behind it (same reason
    // overlays block clicks, req_2167).
    if (s.openMenu) return;
    // Modal discipline (req_2626 HH): while a blocker is unresolved, Esc CANCELS the
    // shell-owned dialogs (the viewer-owned sessions handle their own Esc inside
    // ModelView), and any other command-shaped key gets the honest refusal — not silence.
    const block = blockingNowRef.current(s);
    if (block) {
      if (key === 'escape') {
        if (block.id === 'new-mesh') setState((prev) => ({ ...prev, newMeshPrompt: null, status: `${prev.newMeshPrompt?.mode === 'add' ? 'add' : 'new'} mesh cancelled` }));
        else if (block.id === 'file-explorer') setState((prev) => ({ ...prev, fileExplorerOpen: false, status: 'asset explorer closed' }));
        else if (block.id === 'map-documents') closeMapDocuments(null);
        else if (block.id === 'build-journal') setState((prev) => ({ ...prev, buildDialogOpen: false, status: 'build journal closed' }));
        else if (block.id === 'add-chunk') setState((prev) => ({ ...prev, addChunkOpen: false, status: 'add chunk closed' }));
        else if (block.id === 'import-image') setImportPlan(null);
        else if (block.id === 'import-part') setImportPartOpen(false);
        else if (block.id === 'path-array') setPathArrayPrompt(null);
        else if (block.id === 'scale-by') setScaleByOpen(false);
        return;
      }
      if (key.length === 1 || ['enter', 'delete', 'backspace', 'tab', 'space'].includes(key)) {
        setState((prev) => ({ ...prev, status: `resolve ${block.label} first — finish or cancel it before doing anything else` }));
      }
      return;
    }
    // Outliner-native clipboard. Geometry remains host-resident: copy records
    // stable part ids and paste invokes the same paint-carrying host duplicate
    // operation as the row button. Ctrl+D is the direct, one-keystroke twin.
    if (activeSurface(s) === 'model' && mods.ctrl && !mods.alt && (key === 'c' || key === 'v' || key === 'd')) {
      const modelId = activePartsModelId(s);
      const parts = modelId ? (s.modelParts[modelId] ?? []) : [];
      if (!modelId || parts.length === 0) return;
      if (key === 'c') {
        const partIds = effectiveSelectedIds(s, parts, selectedPartIdsRef.current);
        outlinerClipboardRef.current = { modelId, partIds };
        setState((prev) => ({ ...prev, status: `copied ${partIds.length} outliner part${partIds.length === 1 ? '' : 's'} — Ctrl+V to paste` }));
        return;
      }
      const clip = key === 'd'
        ? { modelId, partIds: effectiveSelectedIds(s, parts, selectedPartIdsRef.current) }
        : outlinerClipboardRef.current;
      if (!clip || clip.modelId !== modelId) {
        setState((prev) => ({ ...prev, status: 'paste needs copied outliner parts from this model' }));
        return;
      }
      const rows = clip.partIds.map((id) => parts.find((part) => part.id === id)).filter((part): part is ModelPart => Boolean(part));
      if (rows.length) duplicateOutlinerRowsRef.current(rows);
      return;
    }
    const id = commandForKeyEvent(s, key, mods);
    if (id) runCommandRef.current(id, 'hotkey');
  }), []);

  // RJIT_EDKEYS: ';'-separated synthetic key edges driven through the LIVE bridge
  // (syntheticKeyEdge → __ifttt_onKeyDown), 300ms apart — the headless proof of the
  // WORLD-surface undo path (`rjit shot editor` + RJIT_EDKEYS="b;ctrl,z"): the world
  // has no RJIT_MESHOPS host, so this is its gesture harness. Each step logs the
  // post-dispatch state a beat later (setState flushes between steps). Unset = no-op.
  useEffect(() => {
    const script = (globalThis as any).__env_get?.('RJIT_EDKEYS') as string | null | undefined;
    if (!script) return;
    const steps = script.split(';').map((sp) => sp.trim()).filter(Boolean);
    steps.forEach((step, i) => {
      setTimeout(() => {
        const parts = step.split(',').map((p) => p.trim()).filter(Boolean);
        const { sym, mod } = syntheticKeyEdge(parts);
        console.error(`[edkeys] ${parts.join('+')} (sym=${sym} mod=${mod})`);
        setTimeout(() => {
          const s = stateRef.current;
          console.error(`[edkeys] after ${parts.join('+')} → status="${s.status}" worldUndo=${s.worldUndo.length} worldRedo=${s.worldRedo.length} objects=${s.objects.filter((o) => !o.hidden).length} pieces=${s.worldPieces.length}`);
        }, 150);
      }, 800 + i * 300);
    });
  }, []);

  // RJIT_EDNAME: rename the ACTIVE model doc — the tiny headless hook proving the
  // rename path end to end. ';'-separated names apply 800ms apart, so one run with
  // RJIT_MODELDOC=<kind> + RJIT_EDKEYS="ctrl,s" (save fires between the two) covers
  // BOTH legs: pending name → the first save's manifest, then live manifest
  // write-through on the now-materialized model. Unset = no-op.
  useEffect(() => {
    const script = (globalThis as any).__env_get?.('RJIT_EDNAME') as string | null | undefined;
    if (!script) return;
    script.split(';').filter(Boolean).forEach((name, i) => {
      setTimeout(() => {
        const s = stateRef.current;
        const doc = s.workspaceDocuments.find((d) => d.id === s.activeWorkspaceDocumentId);
        if (doc?.kind === 'model' && doc.sourceId) {
          renameModel(doc.sourceId, name);
          console.error(`[edname] renamed ${doc.sourceId} -> "${name}"`);
        } else {
          console.error('[edname] no model doc active — rename skipped');
        }
      }, 600 + i * 800);
    });
  }, []);

  // Eyedropper (req_3097): ModelView samples the painted atlas under the cursor
  // (__model_paint_sample) and announces the hex here — same announce-global
  // pattern as __modelPartRangesChanged. The pick funnels through the spine's
  // color-select command, so RECENT records it and the ink sync below deposits it.
  useEffect(() => {
    (globalThis as any).__modelColorSampled = (hex: string) => {
      setColorSpineCurrent(hexToOklch(hex), 'eyedropper');
    };
    return () => { delete (globalThis as any).__modelColorSampled; };
  }, []);

  // Studio colour → brush ink. The viewer owns the live brush; this is the ONE
  // sync point pouring the spine's current colour into a colour-kind ink.
  // It reconciles on EITHER side changing (req_2538): keying only on spine picks
  // left the mount gap — a fresh ModelView starts on its default coral ink while
  // the swatch shows the spine's colour (its default is orange, colorSpine.ts),
  // so the toolbar displayed one colour and the brush deposited another until the
  // first pick. Converges then no-ops (equal hexes bail), so no feedback loop.
  useEffect(() => {
    const brush = state.modelTool.brush;
    if (!brush || brush.ink.kind !== 'color') return;
    const hex = oklchToHex(state.colorSpineCurrent);
    if (brush.ink.hex.toLowerCase() === hex.toLowerCase()) return;
    modelToolApiRef.current?.setBrush({ ...brush, ink: { kind: 'color', hex } });
  }, [state.colorSpineCurrent, state.modelTool.brush]);
  useEffect(() => {
    const brush = state.facadePaint.brush;
    if (brush.ink.kind !== 'color') return;
    const hex = oklchToHex(state.colorSpineCurrent);
    if (brush.ink.hex.toLowerCase() === hex.toLowerCase()) return;
    setState((prev) => ({ ...prev, facadePaint: { ...prev.facadePaint, brush: { ...prev.facadePaint.brush, ink: { kind: 'color', hex } } } }));
  }, [state.colorSpineCurrent, state.facadePaint.brush]);

  // Color Studio slot overrides for the PAINT path: the shader-ink pickers ask
  // for (specId, variant) and fold the user's palette into the ink data[].
  const paintPaletteFor = (specId: string, variant: number): Rgb[] | null => {
    const spec = shaderSpec(specId);
    return spec ? paletteForSpecVariant(state.colorStudioOverrides, spec, variant) : null;
  };

  const openModelDocument = (model: ModelPackage) => {
    const doc = modelDocument(model);
    // Focus moves across the screen into the center/inspector document — the
    // content browser stays on its list so you can pick the next model without
    // re-navigating back into the folder. (Do NOT touch contentFolder here.)
    // Parts are seeded by the effect below (covers both click-open and reload-of-open).
    setState((prev) => ({
      ...prev,
      workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
      activeWorkspaceDocumentId: doc.id,
      materialFocused: false,
      contextOpen: false,
      status: `opened model document: ${model.name}`,
    }));
  };

  // On a model doc activating: seed its parts (Studio models bring stored parts; primitive
  // models seed themselves on create; an imported file doc seeds ONE file-backed part) AND
  // stamp each part's [lo, hi] group range from the compose that the viewer loads on THIS
  // mount. Refreshing on every activate keeps the ranges matched to the freshly-composed
  // host mesh after a doc switch (the host is authoritative only within a session; a
  // remount rebuilds the seed). Fires once per activate.
  useEffect(() => {
    const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
    const mid = doc?.kind === 'model' ? doc.sourceId : undefined;
    if (!mid) return;
    const existing = state.modelParts[mid];
    const pkg = modelPackageById(mid);
    const meshDoc = pkg ? packageMeshDoc(pkg) : null;
    const savedMeta = pkg ? (packageMeshDocParts(pkg) ?? []) : [];
    // A zero-range RJMD used to hydrate one fallback row and hot-state could then
    // preserve that collapsed row forever. When meshDoc recovered an exact range/run
    // match, replace only that count-mismatched fallback with all saved metadata rows.
    const recoverCollapsedParts = Boolean(
      meshDoc?.recoveredPartRanges &&
      savedMeta.length === meshDoc.ranges.length &&
      existing && existing.length !== meshDoc.ranges.length,
    );
    let parts = recoverCollapsedParts ? undefined : existing;
    if (!parts) {
      if (meshDoc && meshDoc.ranges.length > 0) {
        // A materialized package hydrates from its OWN meshdoc (req_2753): rows are
        // metadata + the SAVED [lo,hi) ranges; the surface mounts the same doc.blob, so
        // the outliner and the mesh agree by construction — this is what brings the
        // outliner (and the edits) back after a cold restart. parts.json rows pair with
        // ranges by rank; a legacy package (base.blob only) recovers as one part.
        const meta = savedMeta;
        parts = meshDoc.ranges.map((r, i) => ({
          id: `part:doc:${mid}:${i}`,
          name: meta[i]?.name ?? (meshDoc.ranges.length === 1 ? (pkg?.name ?? 'part 1') : `part ${i + 1}`),
          kind: meta[i]?.kind as PrimitiveKind | undefined,
          visible: true, // the doc mounts every part; visibility is a live host op, not mount state
          color: meta[i]?.color ?? PART_TINTS[i % PART_TINTS.length],
          groupId: meta[i]?.groupId,
          groupName: meta[i]?.groupName,
          groupPath: meta[i]?.groupPath,
          outlinerOrder: meta[i]?.outlinerOrder ?? i,
          lo: r.lo,
          hi: r.hi,
        })).sort((a, b) => a.outlinerOrder - b.outlinerOrder);
      } else {
        // Any package whose viewer source is a raw .glb/.obj file (import: packages,
        // file: opens, content-browser loose files, imported props) is a model OF ONE
        // PART (the whole file) — outliner-first, like everything else. Its range is
        // stamped by the viewer after the host parses it.
        const filePath = pkg?.viewerPath;
        if (filePath && isViewerFile(filePath)) {
          parts = [filePartSeed(filePath, pkg!.name)];
        }
      }
      if (!parts) return;
    }
    if (parts.some((p) => p.sourcePath)) {
      // File-backed docs get their TRUE ranges from the viewer's onStampRanges after the
      // host load — a JS compose can't know where the file's triangles land. Seed only.
      if (!existing) {
        const seeded = parts;
        setState((prev) => ({
          ...prev,
          modelParts: { ...prev.modelParts, [mid]: seeded },
          modelActivePartId: seeded[0]?.id ?? prev.modelActivePartId,
        }));
      }
      return;
    }
    // Range stamping. A meshdoc-backed doc mounts the SAVED geometry, so rows stamp from
    // the saved ranges by rank — a seed recompose can disagree with the saved topology
    // (loop cuts renumber groups). Only a row-count match stamps; a drifted count leaves
    // the rows to the host's own re-stamp machinery (req_2644). Seed docs recompose.
    let withRanges: ModelPart[];
    if (meshDoc && meshDoc.ranges.length === parts.length) {
      const ranked = parts.map((p, i) => ({ p, i })).sort((x, y) => ((x.p.lo ?? Number.MAX_SAFE_INTEGER) - (y.p.lo ?? Number.MAX_SAFE_INTEGER)) || (x.i - y.i));
      const stamped = parts.slice();
      meshDoc.ranges.forEach((r, rank) => { const row = ranked[rank]!; stamped[row.i] = { ...row.p, lo: r.lo, hi: r.hi }; });
      withRanges = stamped;
    } else if (meshDoc) {
      withRanges = parts;
    } else {
      const rangeById = new Map(composeModelParts(parts).ranges.map((r) => [r.id, r]));
      withRanges = parts.map((p) => { const r = rangeById.get(p.id); return { ...p, lo: r?.lo, hi: r?.hi }; });
    }
    if (recoverCollapsedParts && meshDoc) {
      // A hot reload may resume the already-resident one-range host session instead
      // of remounting the recovered seed. Repair its mirror at the same boundary as
      // the outliner so face scope and the next Save immediately agree.
      modelToolApiRef.current?.setPartRangesMirror(meshDoc.ranges);
    }
    setState((prev) => ({
      ...prev,
      modelParts: { ...prev.modelParts, [mid]: withRanges },
      modelActivePartId: existing && !recoverCollapsedParts ? prev.modelActivePartId : (withRanges[0]?.id ?? prev.modelActivePartId),
      status: recoverCollapsedParts ? `recovered ${withRanges.length} saved parts from the mesh document's exact connectivity ranges` : prev.status,
    }));
  }, [state.activeWorkspaceDocumentId]);

  // A file-backed mount reports where each part landed in the host mesh (base import =
  // [0, tris); replayed appends get host-assigned ranges) — stamp them onto the outliner.
  const stampModelPartRanges = (modelId: string, ranges: { partId: string; lo: number; hi: number }[]) => {
    setState((prev) => ({
      ...prev,
      modelParts: {
        ...prev.modelParts,
        [modelId]: (prev.modelParts[modelId] ?? []).map((p) => {
          const r = ranges.find((x) => x.partId === p.id);
          return r ? { ...p, lo: r.lo, hi: r.hi } : p;
        }),
      },
    }));
  };

  // Leaving a model doc writes it only when autosave is enabled, it is dirty,
  // and a valid manifest already exists. A new unsaved model never acquires a
  // disk identity from background policy. The custom close control uses this
  // same synchronous artifact boundary before the viewer unmounts.
  const autosaveActiveModelDoc = (s: EditorState): { id: string; name: string } | null => {
    if (!persistenceSettings.autosave) return null;
    const doc = s.workspaceDocuments.find((d) => d.id === s.activeWorkspaceDocumentId);
    if (doc?.kind !== 'model' || !doc.sourceId) return null;
    const pkg = effectiveModelPackage(doc.sourceId, s.modelOverrides, s.modelDupes);
    if (!pkg || !s.modelDirty[pkg.id] || !isMaterialized(pkg.kind, pkg.id)) return null;
    if (!materializeModelPackage(pkg).ok) return null;
    // The meshdoc rides the autosave (req_2753): the doc switch unmounts the viewer and
    // the NEXT mount seeds from the package, so this write is what edits survive by.
    const liveRows = s.modelParts[pkg.id] ?? [];
    if (!writeModelArtifacts(
      pkg,
      partsMetaFromRows(liveRows),
      meshDocPartRangesFromRows(liveRows) ?? undefined,
      partShrinkSaveOptions(pkg.id, liveRows.length),
    )) return null;
    consumePartShrinkAuthorization(pkg.id);
    savedMeshDepthRef.current[pkg.id] = liveUndoDepths.source === 'mesh' ? liveUndoDepths.undo : 0;
    return { id: pkg.id, name: pkg.name };
  };

  /** Discard is a real rollback, not a dirty-chip reset. Drop the host-resume
   * claim and the React working copy so reopening hydrates the saved package.
   * A never-materialized model has no durable identity, so its pending override
   * and session catalog row leave with the working copy too. */
  const discardModelWorkingCopy = (modelId: string) => {
    removeHotState('editor:meshdoc:v1');
    const current = stateRef.current;
    const pkg = effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes);
    const materialized = Boolean(pkg && isMaterialized(pkg.kind, pkg.id));
    const next = discardModelWorkingCopyState(current, modelId, materialized);
    stateRef.current = next;
    persistState(next);
    setState(next);
  };

  const selectWorkspaceDocument = (activeWorkspaceDocumentId: string, bypassUnsavedPrompt = false) => {
    if (!bypassUnsavedPrompt && !persistenceSettings.autosave && state.activeWorkspaceDocumentId !== activeWorkspaceDocumentId) {
      const currentDoc = state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId);
      const currentModelId = currentDoc?.kind === 'model' ? currentDoc.sourceId : null;
      if (currentModelId && state.modelDirty[currentModelId]) {
        requestUnsavedDecision(
          currentDoc?.title ?? 'Model',
          () => { if (saveActiveModelNow()) selectWorkspaceDocument(activeWorkspaceDocumentId, true); },
          () => {
            discardModelWorkingCopy(currentModelId);
            selectWorkspaceDocument(activeWorkspaceDocumentId, true);
          },
        );
        return;
      }
    }
    const autosaved = state.activeWorkspaceDocumentId === activeWorkspaceDocumentId ? null : autosaveActiveModelDoc(state);
    setState((prev) => {
      const doc = prev.workspaceDocuments.find((item) => item.id === activeWorkspaceDocumentId);
      if (!doc) return prev;
      return {
        ...prev,
        activeWorkspaceDocumentId,
        materialFocused: doc.kind === 'material',
        activeAssetId: doc.kind === 'material' && doc.sourceId ? doc.sourceId : prev.activeAssetId,
        contextOpen: false,
        modelDirty: autosaved ? { ...prev.modelDirty, [autosaved.id]: false } : prev.modelDirty,
        status: autosaved ? `autosaved "${autosaved.name}" · workspace document: ${doc.title}` : `workspace document: ${doc.title}`,
      };
    });
  };

  // MAPPAINT req_2484: one patch door for the Map Paint bar. The controller
  // (stage/mapPaint.ts) mirrors every change into the host tool — arming loads
  // the saved painting + pushes the ground look; a zone-list change re-pushes
  // the zone palette; the armed tool always re-pushes.
  const patchMapPaint = (patch: Partial<EditorState['mapPaint']>) => {
    setState((prev) => {
      let mapPaint = { ...prev.mapPaint, ...patch };
      const hostPatch = applyMapPaintEffects(prev.mapPaint, mapPaint);
      // arming mirrors the loaded map's binding table out of the host
      if (hostPatch) mapPaint = { ...mapPaint, ...hostPatch };
      // One mode at a time (req_2666 WW): arming Map Paint puts the build tool
      // DOWN — back to the neutral Select tool with no armed piece. worldToolFor
      // derives the Build tray from the command id, so neutralizing it closes the
      // tray and the armed-piece focus panel together; paint alone owns the click.
      const arming = mapPaint.active && !prev.mapPaint.active;
      const hadBuild = prev.activeCommandId !== 'select-tool' || prev.armedPieceId !== null;
      return {
        ...prev,
        mapPaint,
        activeCommandId: arming ? 'select-tool' : prev.activeCommandId,
        armedPieceId: arming ? null : prev.armedPieceId,
        status: arming
          ? (hadBuild ? 'map paint armed — build tool put down (one mode at a time)' : 'map paint armed')
          : prev.status,
      };
    });
  };

  const closeWorkspaceDocument = (documentId: string, bypassUnsavedPrompt = false) => {
    if (documentId === WORLD_DOCUMENT_ID) return;
    if (!bypassUnsavedPrompt && !persistenceSettings.autosave && state.activeWorkspaceDocumentId === documentId) {
      const currentDoc = state.workspaceDocuments.find((doc) => doc.id === documentId);
      const currentModelId = currentDoc?.kind === 'model' ? currentDoc.sourceId : null;
      if (currentModelId && state.modelDirty[currentModelId]) {
        requestUnsavedDecision(
          currentDoc?.title ?? 'Model',
          () => { if (saveActiveModelNow()) closeWorkspaceDocument(documentId, true); },
          () => {
            discardModelWorkingCopy(currentModelId);
            closeWorkspaceDocument(documentId, true);
          },
        );
        return;
      }
    }
    // Closing the ACTIVE model doc is a doc-switch too — same bounded autosave
    // (dirty + already-on-disk only), before the viewer unmounts (req_2620 T).
    const autosaved = state.activeWorkspaceDocumentId === documentId ? autosaveActiveModelDoc(state) : null;
    setState((prev) => {
      const remaining = prev.workspaceDocuments.filter((doc) => doc.id !== documentId);
      const nextActive = prev.activeWorkspaceDocumentId === documentId
        ? WORLD_DOCUMENT_ID
        : prev.activeWorkspaceDocumentId;
      const activeDoc = remaining.find((doc) => doc.id === nextActive);
      return {
        ...prev,
        workspaceDocuments: remaining,
        activeWorkspaceDocumentId: activeDoc?.id ?? WORLD_DOCUMENT_ID,
        materialFocused: activeDoc?.kind === 'material',
        contextOpen: false,
        modelDirty: autosaved ? { ...prev.modelDirty, [autosaved.id]: false } : prev.modelDirty,
        status: autosaved ? `autosaved "${autosaved.name}" · workspace document closed` : 'workspace document closed',
      };
    });
  };

  // Live model list + tree. Right-click actions (rename/favorite/duplicate/
  // delete) are UI overrides applied on read, so the gallery, the tree, and the
  // counts all read one resolved list and stay consistent.
  const visibleModels = useMemo(
    () => visibleModelPackages(state.modelOverrides, state.modelDupes),
    [state.modelOverrides, state.modelDupes],
  );
  const contentTreeNodes = useMemo(() => liveContentTree(visibleModels), [visibleModels]);

  // MANIFEST IS DISK TRUTH (req_2620 S/U): favorite/delete/rename write through to
  // the model's on-disk manifest when the package is materialized, so they survive
  // a cold restart. The session override stays as the live mirror either way; for
  // a not-yet-saved model the override is the PENDING value the first save writes
  // (save-snapshot resolves through effectiveModelPackage).
  const favoriteModel = (id: string) =>
    setState((prev) => {
      const pkg = effectiveModelPackage(id, prev.modelOverrides, prev.modelDupes);
      const next = !(prev.modelOverrides[id]?.favorite ?? pkg?.favorite ?? false);
      const durable = pkg ? updateManifestIdentity(pkg.kind, id, { favorite: next }) : false;
      return {
        ...prev,
        modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], favorite: next } },
        status: `${next ? 'favorited' : 'unfavorited'} model${durable ? '' : ' (in session — saves with the model)'}`,
      };
    });

  const deleteModel = (id: string) =>
    setState((prev) => {
      const pkg = effectiveModelPackage(id, prev.modelOverrides, prev.modelDupes);
      const durable = pkg ? updateManifestIdentity(pkg.kind, id, { hidden: true }) : false;
      return {
        ...prev,
        modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], hidden: true } },
        status: durable ? 'deleted model (hidden from browser — recorded in its manifest)' : 'deleted model (hidden from browser)',
      };
    });

  const startRenameModel = (id: string) => setState((prev) => ({ ...prev, modelRenamingId: id, status: 'renaming model' }));
  // Rename writes through to the manifest AS YOU TYPE for a materialized model
  // (tiny JSON, human keystroke rate) so the name on disk is never behind the name
  // on screen; an unmaterialized doc keeps the name pending (dirty chip) until its
  // first save applies it. The open doc tab retitles in the same update.
  const renameModel = (id: string, name: string) =>
    setState((prev) => {
      const pkg = effectiveModelPackage(id, prev.modelOverrides, prev.modelDupes);
      const durable = pkg ? updateManifestIdentity(pkg.kind, id, { name }) : false;
      return {
        ...prev,
        modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], name } },
        workspaceDocuments: prev.workspaceDocuments.map((doc) => (doc.kind === 'model' && doc.sourceId === id ? { ...doc, title: name } : doc)),
        modelDirty: durable ? prev.modelDirty : { ...prev.modelDirty, [id]: true },
      };
    });
  const finishRenameModel = () => setState((prev) => ({ ...prev, modelRenamingId: null, status: 'renamed model' }));

  // Duplicate = copy the whole package DIRECTORY when the source is materialized
  // (req_2620 U: dupes are real on disk, own manifest, own name — the req_2168
  // "copy the folder, have all my basis covered" promise). A source not on disk
  // yet falls back to the session-only clone, and the status says so honestly.
  const duplicateModel = (model: ModelPackage) =>
    setState((prev) => {
      const copied = copyModelPackage(model, `${model.id}::dup-${prev.seq}`, `${model.name} copy`);
      const dupe: ModelPackage = copied ?? {
        ...model,
        id: `${model.id}::dup-${prev.seq}`,
        folderId: `model-dup-${prev.seq}` as ContentFolderId,
        name: `${model.name} copy`,
        favorite: false,
      };
      if (copied) registerSavedPackage(copied); // in the live roster now; next boot reads it from disk
      return {
        ...prev,
        modelDupes: [...prev.modelDupes, dupe],
        seq: prev.seq + 1,
        status: copied
          ? `duplicated ${model.name} → ${dupe.path}`
          : `duplicated ${model.name} (in session only — open it and save to keep it)`,
      };
    });

  // The ONE outliner handler set (Workspace + Inspector mount the same object). Part
  // mutations are guarded: they must not fire over an unresolved blocking session
  // (req_2626 HH — e.g. adding/deleting parts mid loop-cut stacks state on a captured
  // base mesh). onStampRanges stays unguarded — it's the viewer REPORTING ranges, not input.
  const outlinerHandlers = {
    onSelectPart: guarded(selectPart),
    onRenamePart: guarded(renamePart),
    onToggleVisiblePart: guarded(toggleVisiblePart),
    onDeletePart: guarded(deletePart),
    onSelectPartGroup: guarded(selectPartGroup),
    onRenamePartGroup: guarded(renamePartGroup),
    onToggleVisiblePartGroup: guarded(toggleVisiblePartGroup),
    onDuplicatePartGroup: guarded(duplicatePartGroup),
    onDissolvePartGroup: guarded(dissolvePartGroup),
    onGroupSelectedParts: guarded(groupSelectedParts),
    onUngroupSelectedParts: guarded(ungroupSelectedParts),
    onMoveOutlinerItem: guarded(moveOutlinerItem),
    onAddPart: guarded(addPart),
    onDuplicatePart: guarded((id: string) => duplicatePartById(id, -1)),
    onImportModel: guarded(() => setImportPartOpen(true)),
    onStampRanges: stampModelPartRanges,
  };

  // ── Overlays vs the host pointer claim (req_2666 gap ZZ, req_2707) ───────────
  // While paint is armed the HOST claims every pointer event inside the loader
  // pane (WorldViewport's __compiled_world_set_paint_mode effect, fed from
  // mapPaint.active via Stage) BEFORE JS hit-testing — so clicks aimed at any
  // overlay above the viewport stroked the map instead (hover tooltips still
  // worked; only the press was claimed). A DERIVED state at this pass-down site
  // (never a real mapPaint patch): the workspace sees paint as inactive while
  // the texture-picker popover OR any BLOCKING dialog (Add Chunk, file
  // explorer, …) is unresolved, so the host releases the claim; the overlays
  // render off REAL state below and stay mounted, and applyMapPaintEffects
  // sees no fake active flips. Resolving the overlay restores the claim next
  // render. Modal discipline says a blocker gates EVERYTHING — that includes
  // the host's pointer claim, not just JS input.
  const workspaceState = state.mapPaint.active && (state.mapPaint.texturePickerOpen || blockingOverlay(state) !== null)
    ? { ...state, mapPaint: { ...state.mapPaint, active: false } }
    : state;
  const activePaintDocument = state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId);
  const facadePaintActive = activePaintDocument?.kind === 'facade';
  const modelPaintActive = activePaintDocument?.kind === 'model' && state.modelTool.paint;
  const paintUiActive = facadePaintActive || modelPaintActive;
  const activePaintBrush = facadePaintActive ? state.facadePaint.brush : state.modelTool.brush;
  const setActivePaintBrush = (brush: typeof activePaintBrush) => {
    if (facadePaintActive) setState((prev) => ({ ...prev, facadePaint: { ...prev.facadePaint, brush } }));
    else modelToolApiRef.current?.setBrush(brush);
  };
  // deej mapping: fader 1 = brush size (same 1..128 range as the toolbar
  // slider), fader 2 = flow. Only fires on physical movement, and only while
  // a paint surface is up — everywhere else the board is inert.
  deejApplyRef.current = (move: DeejMove) => {
    if (!paintUiActive) return;
    if (move.slider === 0) {
      setActivePaintBrush({ ...activePaintBrush, size: Math.round(1 + move.value * 127) });
    } else if (move.slider === 1) {
      setActivePaintBrush({ ...activePaintBrush, flow: Math.min(1, Math.max(0.02, 0.02 + move.value * 0.98)) });
    }
  };
  const cycleFacadeDetail = () => setState((prev) => {
    const at = FACADE_PREVIEW_DETAILS.indexOf(prev.facadePaint.detail as typeof FACADE_PREVIEW_DETAILS[number]);
    const detail = FACADE_PREVIEW_DETAILS[(at + 1 + FACADE_PREVIEW_DETAILS.length) % FACADE_PREVIEW_DETAILS.length]!;
    return { ...prev, facadePaint: { ...prev.facadePaint, detail }, status: `facade paint preview: ${detail} px/m · bake remains ${FACADE_TEXELS_PER_METER} px/m` };
  });
  const activePaintBar = paintUiActive ? (
    <PaintToolbar
      brush={activePaintBrush}
      brushTool={facadePaintActive ? state.facadePaint.tool : state.modelTool.brushTool}
      detail={facadePaintActive ? state.facadePaint.detail : state.modelTool.detail}
      tools={facadePaintActive ? [...FACADE_PAINT_TOOLS] : undefined}
      onBrush={setActivePaintBrush}
      onBrushTool={(tool) => facadePaintActive
        ? setState((prev) => ({ ...prev, facadePaint: { ...prev.facadePaint, tool } }))
        : modelToolApiRef.current?.brushTool(tool)}
      onCycleDetail={facadePaintActive ? cycleFacadeDetail : () => modelToolApiRef.current?.cycleDetail()}
      popover={paintPopover}
      onToggle={guarded((which: PaintPopover) => setPaintPopover((open) => (open === which ? null : which)))}
      current={state.colorSpineCurrent}
      palette={state.colorSpinePalette}
      recents={state.colorSpineRecents}
      scenePick={state.colorSpineScenePick}
      paletteFor={paintPaletteFor}
      spine={{
        onSetCurrent: (color) => setColorSpineCurrent(color, 'toolbar'),
        onAddToTray: () => addColorSpineToTray('toolbar'),
        onPickTray: (color) => pickColorSpineTray(color, 'toolbar'),
        onScenePick: (color, css) => pickColorSpineScene(color, css, 'toolbar'),
        onLoadLibrarySet: (colors) => loadColorSpineLibrarySet(colors, 'toolbar'),
      }}
    />
  ) : null;

  // World quick-menu payload (req_2733/req_2737): the LIVE selected piece (yaw/slots
  // track edits while the menu stays open — Rotate keeps it open) + the RANKED
  // material catalog its picker searches (favorites/recents/used first, the content
  // browser's own ordering). Only materialized while the menu is open; Delete
  // closes it by construction (the piece leaves state, the gate below goes null).
  const worldQuickPiece = worldMenu.isOpen ? state.worldPieces.find((p) => p.id === state.selectedPieceId) : undefined;
  const worldQuickMaterials = worldQuickPiece
    ? applyAssetOverrides(ASSETS, state.assetOverrides).filter((asset) => asset.tab === 'Skins').sort(rankAssets)
    : [];

  const closeHostWindow = () => (globalThis as any).__window_close?.();
  const saveDirtyWorkspaceForClose = (): boolean => {
    const current = stateRef.current;
    const doc = current.workspaceDocuments.find((item) => item.id === current.activeWorkspaceDocumentId);
    const modelId = doc?.kind === 'model' ? doc.sourceId : null;
    const pkg = modelId ? effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes) : null;
    if (pkg && current.modelDirty[pkg.id] && !saveActiveModelNow('Saved before exit')) return false;
    if (manualWorldDirty && !saveWorldNowAll('Saved before exit')) return false;
    return true;
  };
  const closeEditor = () => {
    const current = stateRef.current;
    const doc = current.workspaceDocuments.find((item) => item.id === current.activeWorkspaceDocumentId);
    const modelId = doc?.kind === 'model' ? doc.sourceId : null;
    const pkg = modelId ? effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes) : null;
    const modelDirty = Boolean(pkg && current.modelDirty[pkg.id]);
    if (!persistenceSettings.autosave && (modelDirty || manualWorldDirty)) {
      requestUnsavedDecision(
        modelDirty && manualWorldDirty ? 'Current model and world' : (modelDirty ? (doc?.title ?? 'Model') : current.activeMapName),
        () => { if (saveDirtyWorkspaceForClose()) closeHostWindow(); },
        closeHostWindow,
      );
      return;
    }
    if (persistenceSettings.autosave) {
      // A never-saved model deliberately has no autosave target and is discarded
      // on process exit. Once a manifest exists, the latest edit is flushed.
      if (pkg && modelDirty && isMaterialized(pkg.kind, pkg.id) && !saveActiveModelNow('Autosaved before exit')) return;
      if (!saveWorldNowAll('Autosaved before exit')) return;
    }
    closeHostWindow();
  };

  return (
    <C.HW_App>
      <RenderProbe id="Chrome">
        <Chrome
          state={state}
          activeCommand={activeCommand}
          onMenu={guarded((menu: Menu) => setState((prev) => ({ ...prev, actionMenu: menu, openMenu: prev.openMenu === menu ? null : menu })))}
          onCommand={runCommand}
          onClose={closeEditor}
        />
      </RenderProbe>
      {playing ? (
        <C.HW_PlayBody>
          <PlayRoute />
        </C.HW_PlayBody>
      ) : (
      <>
      <C.HW_Body>
        <RenderProbe id="Left Rail">
          <LeftRail state={state} onDomain={(activeDomain) => setState((prev) => ({ ...prev, activeDomain, status: `workspace context: ${activeDomain}` }))} />
        </RenderProbe>
        <RenderProbe id="Content Browser">
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
            onToggleExpanded={() => setState((prev) => ({
              ...prev,
              libraryExpanded: !prev.libraryExpanded,
              assetPage: 0,
              status: prev.libraryExpanded ? 'content browser tucked' : 'content browser expanded — grid attached',
            }))}
            onFavorite={toggleFavorite}
            onRename={renameAsset}
            // The dock owns paging geometry (req_3137): its measured grid area
            // computes the page size, so it hands the clamp ceiling over.
            onPage={(delta, maxPage) => setState((prev) => ({
              ...prev,
              assetPage: Math.max(0, Math.min(maxPage, prev.assetPage + delta)),
            }))}
            onFocusMaterial={focusMaterialDocument}
            onModel={openModelDocument}
            contentTree={contentTreeNodes}
            models={visibleModels}
            modelRenamingId={state.modelRenamingId}
            onModelStartRename={startRenameModel}
            onModelRename={renameModel}
            onModelFinishRename={finishRenameModel}
            onModelFavorite={favoriteModel}
            onModelDuplicate={duplicateModel}
            onModelDelete={deleteModel}
          />
        </RenderProbe>
        <RenderProbe id="Workspace">
          <Workspace
            state={workspaceState}
            activeAsset={activeAsset}
            selectedPartCount={selectedPartCount}
            onCommand={runCommand}
            onModelToolApi={(api: ModelToolApi) => { modelToolApiRef.current = api; }}
            onModelToolState={(modelTool: ModelToolSnapshot) => setState((prev) => ({ ...prev, modelTool }))}
            modelContextTrigger={modelMenu.triggerProps}
            outlinerHandlers={outlinerHandlers}
            modelOnDisk={activeModelOnDisk}
            onRequireFirstModelSave={() => saveActiveModelNow('Saved before creating paint atlas')}
            onModelDocumentMutated={markActiveModelDirty}
            onSnap={guarded(() => setState((prev) => ({ ...prev, snapIndex: (prev.snapIndex + 1) % SNAP_MODES.length, status: `snap: ${SNAP_MODES[(prev.snapIndex + 1) % SNAP_MODES.length]}` })))}
            onFloor={(delta: number) => invokeApplicationCommand(WORLD_FLOOR_STEP_COMMAND_ID, { delta }, 'action bar')}
            onWallsDown={guarded(() => setState((prev) => ({ ...prev, wallsDown: !prev.wallsDown, status: prev.wallsDown ? 'walls up — this floor\'s walls show again' : 'walls down — this floor\'s walls hidden for interior editing' })))}
            onMapPaint={patchMapPaint}
            paintBar={activePaintBar}
            // Doc switching mid-blocking-session would unmount the surface that owns the
            // session (loop cut's captured base mesh dies with it) — guarded (req_2626 HH).
            onWorkspaceDocument={guarded(selectWorkspaceDocument)}
            onCloseWorkspaceDocument={guarded(closeWorkspaceDocument)}
            onStage={() => runCommand(state.activeCommandId, 'stage')}
            onContext={guarded(() => setState((prev) => ({ ...prev, contextOpen: !prev.contextOpen, openMenu: null, status: prev.contextOpen ? 'context menu closed' : 'context menu opened' })))}
            onObject={selectObject}
            onPlacePiece={placePieces}
            onMovePiece={movePiece}
            onSelectPiece={selectPiece}
            onPieceContext={openPieceQuickMenu}
            onPaintFaces={paintPieceFaces}
            onStampSticker={stampSticker}
            onStickerArm={(patch) => setState((prev) => ({ ...prev, stickerArm: { ...prev.stickerArm, ...patch } }))}
            onFacadeStroke={recordFacadeStroke}
            onFacadeLayers={updateFacadeLayers}
            onFacadePaint={(patch) => setState((prev) => ({ ...prev, facadePaint: { ...prev.facadePaint, ...patch } }))}
            onFacadeStamp={recordFacadeStamp}
            onFacadeClear={clearFacadePaint}
            onFacadeSave={saveFacadePainting}
            onArmPiece={armPiece}
            onExitMaterialFocus={() => setState((prev) => ({ ...prev, materialFocused: false, activeWorkspaceDocumentId: WORLD_DOCUMENT_ID, status: `returned to world with ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }))}
            onSelectColorStudioMaterial={selectColorStudioMaterial}
            onColorStudioVariant={setColorStudioVariant}
            onColorStudioSeed={rollColorStudioSeed}
            onColorStudioQuality={setColorStudioQuality}
            onColorStudioSlot={activateColorStudioSlot}
            onColorStudioFill={fillColorStudioSlot}
            onColorStudioReset={resetColorStudioSlots}
            onColorStudioView={setColorStudioView}
            onColorSpineCurrent={setColorSpineCurrent}
            onColorSpineAddToTray={addColorSpineToTray}
            onColorSpineTrayPick={pickColorSpineTray}
            onColorSpineScenePick={pickColorSpineScene}
            onColorSpineLoadLibrarySet={loadColorSpineLibrarySet}
          />
        </RenderProbe>
        <RenderProbe id="Inspector">
          <Inspector
            state={state}
            activeObject={activeObject}
            activeAsset={assetById(activeObject.assetId, state.assetOverrides)}
            onPane={(rightPane) => setState((prev) => ({ ...prev, rightPane, status: `inspector pane: ${rightPane}` }))}
            onPreset={() => setState((prev) => ({ ...prev, presetMenuOpen: !prev.presetMenuOpen, status: prev.presetMenuOpen ? 'surface preset menu closed' : 'surface preset menu opened' }))}
            onPresetOption={(surfacePreset) => setState((prev) => ({ ...prev, surfacePreset, presetMenuOpen: false, status: `surface preset: ${surfacePreset}` }))}
            onModelBrush={(brush) => modelToolApiRef.current?.setBrush(brush)}
            // Durable identity (req_2620 S/T): the model card's name field renames
            // through the SAME write-through path as the library right-click; the
            // Save verb runs the SAME 'save-snapshot' command as File → Save.
            onRenameModel={renameModel}
            onSaveModel={() => runCommand('save-snapshot', 'focus-panel')}
            onModelDocumentMutated={markActiveModelDirty}
            modelOnDisk={activeModelOnDisk}
            onSetModelRig={setModelRig}
            onAssignSlot={assignPieceSlot}
            onClearSlot={clearPieceSlot}
            // World-globals tuning (GLOBALS req_2770): the playtest tab's panel.
            onSetGlobal={guarded(setWorldGlobal)}
            onResetGlobal={guarded(resetWorldGlobal)}
            outlinerHandlers={outlinerHandlers}
            // Multi-select set (req_2659): row highlights + the UV header's '+N'.
            selectedPartIds={selectedPartIds}
            colorSpine={{
              onSetCurrent: setColorSpineCurrent,
              onAddToTray: addColorSpineToTray,
              onPickTray: pickColorSpineTray,
              onScenePick: pickColorSpineScene,
              onLoadLibrarySet: loadColorSpineLibrarySet,
            }}
          />
        </RenderProbe>
      </C.HW_Body>
      <RenderProbe id="Bottom Dock">
        <BuildDock
          state={state}
          journal={journal}
          onBuild={guarded(() => setState((prev) => ({ ...prev, buildDialogOpen: true, eventbusPopoverOpen: false, perfPopoverOpen: false, memoryPopoverOpen: false, status: `opened build journal ${journal.activeBuild}` })))}
          onEventbus={guarded(() => setState((prev) => ({ ...prev, eventbusPopoverOpen: !prev.eventbusPopoverOpen, perfPopoverOpen: false, memoryPopoverOpen: false, status: prev.eventbusPopoverOpen ? 'eventbus review closed' : 'eventbus review opened' })))}
          // Toolbar undo/redo route EXACTLY like Ctrl+Z — through runCommand, which
          // sends a model doc to the host mesh journal and the world to the real
          // world undo stacks (req_2620 W). Never the old feed-splice placebo.
          onUndo={() => runCommand('undo-local', 'dock')}
          onRedo={() => runCommand('redo-local', 'dock')}
          onPerf={guarded(() => setState((prev) => ({ ...prev, perfPopoverOpen: !prev.perfPopoverOpen, memoryPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.perfPopoverOpen ? 'performance churn closed' : 'performance churn opened' })))}
          onMemory={guarded(() => setState((prev) => ({ ...prev, memoryPopoverOpen: !prev.memoryPopoverOpen, perfPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.memoryPopoverOpen ? 'memory accumulation closed' : 'memory accumulation opened' })))}
        />
      </RenderProbe>
      {state.eventbusPopoverOpen ? (
        <RenderProbe id="Eventbus Popover">
          <EventBusPopover
            state={state}
            onClose={() => setState((prev) => ({ ...prev, eventbusPopoverOpen: false, status: 'eventbus review closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.perfPopoverOpen ? (
        <RenderProbe id="Performance Popover">
          <PerformancePopover
            onClose={() => setState((prev) => ({ ...prev, perfPopoverOpen: false, status: 'performance churn closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.memoryPopoverOpen ? (
        <RenderProbe id="Memory Popover">
          <MemoryPopover
            onClose={() => setState((prev) => ({ ...prev, memoryPopoverOpen: false, status: 'memory accumulation closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.buildDialogOpen ? (
        <RenderProbe id="Build Journal Dialog">
          <BuildJournalDialog journal={journal} actions={journalActions} onClose={() => setState((prev) => ({ ...prev, buildDialogOpen: false, eventbusPopoverOpen: false, perfPopoverOpen: false, memoryPopoverOpen: false, status: 'build journal closed' }))} />
        </RenderProbe>
      ) : null}
      {preferencesOpen ? (
        <RenderProbe id="Preferences Dialog">
          <PreferencesDialog onClose={() => { setPreferencesOpen(false); setState((prev) => ({ ...prev, status: 'preferences closed' })); }} />
        </RenderProbe>
      ) : null}
      {hotUpdatePromptOpen ? (
        <RenderProbe id="Code Update Dialog">
          <HotUpdateDialog
            onLater={() => setHotUpdatePromptOpen(false)}
            onApply={() => { setHotUpdatePromptOpen(false); applyDevReload(); }}
          />
        </RenderProbe>
      ) : null}
      {unsavedDocumentName ? (
        <RenderProbe id="Unsaved Changes Dialog">
          <UnsavedChangesDialog
            documentName={unsavedDocumentName}
            onCancel={() => {
              const decision = unsavedDecisionRef.current;
              unsavedDecisionRef.current = null;
              setUnsavedDocumentName(null);
              decision?.cancel?.();
            }}
            onSave={() => {
              const decision = unsavedDecisionRef.current;
              unsavedDecisionRef.current = null;
              setUnsavedDocumentName(null);
              decision?.save();
            }}
            onDiscard={() => {
              const decision = unsavedDecisionRef.current;
              unsavedDecisionRef.current = null;
              setUnsavedDocumentName(null);
              decision?.discard();
            }}
          />
        </RenderProbe>
      ) : null}
      {state.newMeshPrompt ? (
        <NewMeshDialog
          kind={state.newMeshPrompt.kind}
          mode={state.newMeshPrompt.mode}
          onCancel={() => setState((prev) => ({ ...prev, newMeshPrompt: null, status: `${prev.newMeshPrompt?.mode === 'add' ? 'add' : 'new'} mesh cancelled` }))}
          onAdd={(params) => submitMeshPrompt(state.newMeshPrompt!, params)}
        />
      ) : null}
      {pathArrayPrompt ? (
        <RenderProbe id="Path Array Dialog">
          <PathArrayDialog
            sourceLabel={pathArrayPrompt.label}
            sourcePartCount={pathArrayPrompt.sourceIds.length}
            sourceSpanU={pathArrayPrompt.sourceSpanU}
            onCancel={() => { setPathArrayPrompt(null); setState((prev) => ({ ...prev, status: 'path array cancelled' })); }}
            onApply={applyPathArray}
          />
        </RenderProbe>
      ) : null}
      {scaleByOpen ? (
        <RenderProbe id="Scale By Dialog">
          <ScaleByDialog
            onCancel={() => { setScaleByOpen(false); setState((prev) => ({ ...prev, status: 'scale by cancelled' })); }}
            onApply={applyScaleBy}
          />
        </RenderProbe>
      ) : null}
      {state.exportCharacterPrompt ? (
        <ExportCharacterDialog
          modelName={activeModelPkg?.name ?? 'model'}
          currentPlayerName={currentPlayerCharacter()?.name ?? null}
          binding={(() => {
            // Binding preview is NAME-only (centers only matter at write time),
            // so the dialog readout costs nothing and always matches the compiler.
            const rows = activeModelPkg ? (state.modelParts[activeModelPkg.id] ?? []) : [];
            const match = matchCharacterBones(rows.map((r) => r.name));
            return { total: rows.length, bound: match.bound.length, unbound: match.unbound, duplicates: match.duplicates };
          })()}
          onCancel={() => setState((prev) => ({ ...prev, exportCharacterPrompt: null, status: 'character export cancelled' }))}
          onExport={exportCharacterAs}
        />
      ) : null}
      {state.mapDocumentOpen ? (
        <RenderProbe id="Map Workspaces Dialog">
          <MapDocumentsDialog
            current={state.activeMapStem}
            documents={listMapDocuments()}
            measureCurrentTriangles={state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId)?.kind === 'world'}
            onOpen={openMapDocument}
            onNew={createNewMap}
            onGenerateCoastal={createCoastalMap}
            onRename={renameExistingMap}
            onDelete={deleteExistingMap}
            onClose={closeMapDocuments}
          />
        </RenderProbe>
      ) : null}
      {state.addChunkOpen ? (
        <RenderProbe id="Add Chunk Dialog">
          <AddChunkDialog onClose={() => setState((prev) => ({ ...prev, addChunkOpen: false, status: 'add chunk closed' }))} />
        </RenderProbe>
      ) : null}
      {state.fileExplorerOpen ? (
        <RenderProbe id="Asset Explorer Dialog">
          <FileExplorerDialog
            query={state.fileExplorerQuery}
            selectedFolder={state.fileExplorerFolder}
            expandedFolders={state.fileExplorerExpanded}
            selectedFileId={state.fileExplorerSelectedId}
            history={state.fileExplorerHistory}
            folderHistory={state.fileExplorerDirectoryHistory}
            onQuery={(fileExplorerQuery) => setState((prev) => ({ ...prev, fileExplorerQuery, status: `asset search: ${fileExplorerQuery || 'all indexed assets'}` }))}
            onFolder={selectExplorerFolder}
            onToggleFolder={toggleExplorerFolder}
            onSelectFile={(fileExplorerSelectedId) => setState((prev) => ({ ...prev, fileExplorerSelectedId, status: `selected file ${explorerFileById(fileExplorerSelectedId)?.path ?? fileExplorerSelectedId}` }))}
            onOpenFile={openExplorerFile}
            onImportFromDisk={() => { void importModelFromDisk(); }}
            onRescan={rescanExplorerIndex}
            onClose={() => setState((prev) => ({ ...prev, fileExplorerOpen: false, status: 'asset explorer closed' }))}
          />
        </RenderProbe>
      ) : null}
      {state.openMenu ? (
        <RenderProbe id="Menu Dropdown">
          <DropdownMenu state={state} onCommand={runCommand} onToggleLight={(which) => modelToolApiRef.current?.toggleLight(which)} />
        </RenderProbe>
      ) : null}
      {!playing && paintUiActive && paintPopover ? (
        <RenderProbe id="Paint Popovers">
          <PaintPopovers
            popover={paintPopover}
            onClose={() => setPaintPopover(null)}
            brush={activePaintBrush}
            onBrush={setActivePaintBrush}
            current={state.colorSpineCurrent}
            palette={state.colorSpinePalette}
            recents={state.colorSpineRecents}
            scenePick={state.colorSpineScenePick}
            paletteFor={paintPaletteFor}
            onEditMaterial={openColorStudioForSpec}
            spine={{
              onSetCurrent: (color) => setColorSpineCurrent(color, 'toolbar'),
              onAddToTray: () => addColorSpineToTray('toolbar'),
              onPickTray: (color) => pickColorSpineTray(color, 'toolbar'),
              onScenePick: (color, css) => pickColorSpineScene(color, css, 'toolbar'),
              onLoadLibrarySet: (colors) => loadColorSpineLibrarySet(colors, 'toolbar'),
            }}
          />
        </RenderProbe>
      ) : null}
      {importPlan ? (
        <RenderProbe id="Import Image Dialog">
          <ImportImageDialog plan={importPlan} onPick={commitImageImport} onCancel={() => setImportPlan(null)} />
        </RenderProbe>
      ) : null}
      {importPartOpen ? (
        <RenderProbe id="Import Part Dialog">
          <ImportPartDialog
            models={visibleModels}
            onPick={importModelAsParts}
            onCancel={() => setImportPartOpen(false)}
          />
        </RenderProbe>
      ) : null}
      {!playing && state.mapPaint.active && state.mapPaint.channel === 'tile' && state.mapPaint.texturePickerOpen ? (
        <RenderProbe id="Map Texture Picker">
          <MapTexturePicker state={state.mapPaint} onPatch={patchMapPaint} />
        </RenderProbe>
      ) : null}
      {/* Model context menu — rendered LAST at the root so it lands at the cursor
          (window origin) and hit-tests above everything (paint order). Self-gates
          on right-click; the kind check keeps it out of non-model surfaces. */}
      {state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId)?.kind === 'model' ? (
        <modelMenu.ContextMenu>
          <ModelContextMenu
            modelTool={state.modelTool}
            hasActivePart={Boolean(activePartsModelId(state) && state.modelActivePartId && (state.modelParts[activePartsModelId(state)!] ?? []).some((p) => p.id === state.modelActivePartId))}
            selectedPartCount={selectedPartCount}
            onCommand={runCommand}
            onQuality={(quality: number) => modelToolApiRef.current?.setQuality(quality)}
            onToggleLight={(which) => modelToolApiRef.current?.toggleLight(which)}
            onClose={modelMenu.close}
          />
        </modelMenu.ContextMenu>
      ) : null}
      {/* World-piece quick menu (req_2733) — same late-root mount as the model menu
          above. Gated on the live selected piece: gone piece → no menu. */}
      {worldQuickPiece ? (
        <worldMenu.ContextMenu>
          <WorldContextMenu
            piece={worldQuickPiece}
            materials={worldQuickMaterials}
            recentIds={state.recentMaterialIds}
            resolveMaterial={(ref) => resolveMaterialRef(ref, state.assetOverrides)}
            onAssignSlot={(id, role, assetId) => assignPieceSlotAsset(id, role, assetId, 'context')}
            onClearSlot={(id, role) => clearPieceSlot(id, role, 'context')}
            onCommand={runCommand}
            onClose={worldMenu.close}
          />
        </worldMenu.ContextMenu>
      ) : null}
      </>
      )}
    </C.HW_App>
  );
}
