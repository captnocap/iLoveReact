// AppFrame — the editor workspace composition root. Owns the (mock) authoring
// state and slots every region component in. Extracted verbatim from the mock
// god-file; only the imports changed (one component per file, shared data/cls).
// State will migrate onto the real foundation systems (editorbus / hot index /
// commands / tunables) incrementally; this is the faithful layout first.
import { useState, useMemo, useEffect, useRef } from 'react';
import { C } from '../workspace.cls';
import { Box } from '../../../runtime/primitives';
import type { CommandAppliedOutcome, CommandOutcome } from '../../../runtime/commands';
import Chrome from './Chrome';
import DropdownMenu from './DropdownMenu';
import LeftRail from './LeftRail';
import BuildDock from './BuildDock';
import EventBusPopover from './EventBusPopover';
import BuildJournalDialog from './BuildJournalDialog';
import NewMeshDialog from './NewMeshDialog';
import PathArrayDialog from './PathArrayDialog';
import ScaleByDialog from './ScaleByDialog';
import NameSelectionDialog from './NameSelectionDialog';
import ExportCharacterDialog from './ExportCharacterDialog';
import { characterPreparedSaveExportReady, characterSnapshotExportReady } from './characterExportReadiness';
import { hasCharacterRigCapability } from '../skeleton/characterRigCapability';
import { establishCharacterRigCapability } from '../skeleton/characterRigAttachTransaction';
import { characterRigBodyPartRow, characterRigPartMetadata } from '../skeleton/characterRigPartMetadata';
import { characterRigPackagePath } from '../skeleton/characterRigPackagePath';
import { playerCharacterPackage as boundPlayerCharacterPackage } from '../world/playerCharacterLoader';
import { PaintPanel } from './PaintSidePanel';
import PerformancePopover from './PerformancePopover';
import MemoryPopover from './MemoryPopover';
import PreferencesDialog from './PreferencesDialog';
import HotUpdateDialog from './HotUpdateDialog';
import NativeUpdateNotice, { nativeUpdateApprovalJson, nativeUpdateNoticeFromPayload, type NativeUpdateNoticeState } from './NativeUpdateNotice';
import OrphanHostsNotice, { orphanCleanupApprovalJson, orphanHostsNoticeFromPayload, type OrphanHostsNoticeState } from './OrphanHostsNotice';
import UnsavedChangesDialog from './UnsavedChangesDialog';
import LibraryPanel from '../library/LibraryPanel';
import ModelActionMenu from '../library/ModelActionMenu';
import WorldBibleIndexPanel from '../worldBible/WorldBibleIndexPanel';
import { requestWorldBibleReview, worldBibleController, worldBibleHasDrafts } from '../worldBible/controller';
import Workspace from '../stage/Workspace';
import Inspector from '../inspector/Inspector';
import {
  faceAddressKey,
  recoveryRestoreConfirmationAction,
  type BlobExplorerFacePage,
  type BlobExplorerFaceQuery,
  type BlobExplorerFaceSelection,
  type BlobExplorerBuildIssueSelection,
  type BlobExplorerHistoryStateV1,
  type BlobExplorerServerStatusV1,
  type BlobExplorerStableRowActionV1,
  type BlobExplorerSurfaceProps,
  type BlobExplorerWidthPreset,
} from '../stage/BlobExplorerSurface';
import { FacadePaintLayersSection, ModelPaintLayersSection } from '../inspector/PaintLayerSections';
import FileExplorerDialog from '../dialogs/FileExplorerDialog';
import StlConversionDialog from '../dialogs/StlConversionDialog';
import AddChunkDialog from '../dialogs/AddChunkDialog';
import MapDocumentsDialog from '../dialogs/MapDocumentsDialog';
import ModelContextMenu from '../stage/ModelContextMenu';
import WorldContextMenu from '../stage/WorldContextMenu';
import RenderProbe from '../../../runtime/render_tracker';
import PlayRoute from '../PlayRoute';
import { useNavigate, useRoute } from '../../../runtime/router';
import { useContextMenu } from '../../../runtime/hooks/useContextMenu';
import { useDeej, subscribeDeej, type DeejMove } from '../../../runtime/hooks/useDeej';
import { getPointerDevice } from '../../../runtime/hooks/usePointerDevice';
import { busOn } from '../../../runtime/hooks/useIFTTT';
import { subscribe } from '../../../runtime/ffi';
import type { EditorState, Command, Asset, Menu, WorldObject, ContentFolderId, ContentNode, ModelOverride, ModelPackage, ModelPlaceable, ModelPart, PrimitiveKind, ModelToolApi, ModelToolSnapshot, Rgb, WorldUndoSlices, CharacterRole, ModelTextureSlot, WorkspaceDocument } from '../data/types';
import { NO_SEMANTIC_ID, parseMeshSemanticTable, type MeshEdgeSemanticRole } from '../model/meshSemantics';
import type { ExplorerFolderId, ExplorerHistoryEntry } from '../data/fileExplorer';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import { pieceKindOf, PIECE_MODULE_METERS, PIECE_SPIN_RATE_DEG_PER_SEC } from '../world/pieces';
import { stepPieceField } from '../world/pieceFieldStep';
import { pieceSlotRoles } from '../world/pieceSlots';
import { setAuthoredPieces, authoredIdFor, authoredPieceFor, paintSkinIdOf, preferredAuthoredPaletteId, skinnedPieceId, type AuthoredBuildPiece, type PlaceableKind } from '../world/authoredRegistry';
import { basePaintingSkinId, listPaintSkins } from '../data/paintVariants';
import { cacheAuthoredMesh, authoredMeshData, authoredMeshBounds } from '../world/authoredMesh';
import { loadPersistedState, persistState } from '../data/persistView';
import { cancelWorldSave, emptyWorldSave, flushWorldSave, readWorldSave, saveWorldNow, scheduleWorldSave, type WorldSave } from '../data/worldStore';
import {
  activeWorldView,
  removeWorldView,
  renameWorldView,
  storeWorldView,
  worldViewPoseFrom,
  WORLD_VIEW_LIMITS,
} from '../world/worldViews';
import { liveIsoPose } from '../world/WorldViewport';
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
import { propRigToSkeleton, skeletonToPropRig, describePropRig, type CharacterRigBoundaryAudit, type CharacterRigSnapshot, type HumanoidSemanticMembership, type PropRig, type SkinBindingRef } from '../../../runtime/skeleton';
import { createCharacterRigApi, type NativeCharacterRigApi } from '../skeleton/characterRigSession';
import { humanoidSemanticMembershipFromKey, stampHumanoidSemanticsFromParts } from '../skeleton/humanoidSemanticAssignment';
import {
  EXTERNAL_AUTO_RIG_PREVIEW_OVERLAY,
  IDLE_EXTERNAL_AUTO_RIG,
  requestSkinTokensRig,
  type ExternalAutoRigUiState,
} from '../skeleton/externalAutoRig';
import {
  parseCharacterRigSeatAction,
  rigStatusFromSnapshot,
  type CharacterRigSeatAction,
} from '../agent/characterRigSeat';
import {
  activateMapDocumentPaintingAsync,
  applyMapPaintEffects,
  flushMapDocumentPainting,
  defaultMapPaint,
  installGeneratedMapDocumentPainting,
  setMapDocumentAutosave,
  type GeneratedMapPaintingInstallation,
} from '../stage/mapPaint';
import { compileCoastalCityPainting } from '../stage/coastalCity';
import MapTexturePicker from '../stage/MapTexturePicker';
import MaterialPickerPopover from './MaterialPickerPopover';
import { REGION_MATERIALS } from '../render3d/regionFormula';
import { dispatchColorStudioActionOutcome, dispatchCommandOutcome, dispatchEdit, dispatchGlobalsSet, dispatchMapPaint, dispatchModelOutlinerActionOutcome, dispatchNativeMeshAction, dispatchPieceEditOutcome, dispatchPieceMaterialOutcome, dispatchPiecePlacementOutcome, type MapPaintPayload } from '../data/editorEvents';
import { commandById, deviceToolReplayable, isMeshToolCommand, PRIMITIVE_MESHES, blockingOverlay, publishCharacterRigUndoDepths, publishColorStudioUndoDepths, publishUndoDepths, undoDepths, type BlockingOverlay } from '../data/commands';
import { characterRigHistoryShouldOwnInput } from '../stage/characterRigViewport';
import { readSeatCorpusDoc } from '../agent/seatCorpus';
import { readSeatNotes, seatCorpusAdapter, writeSeatNotes } from '../agent/seatCorpusStore';
import { backgroundSeatRefusal, compactSeatReply, createAgentSeat, executeSeatRequestAtShell, readSeatPercept, seatBatchGenerationReason, seatRequestTarget, type AgentSeat, type SeatPartPercept, type SeatPercept, type SeatPrimitiveSpec, type SeatReply, type SeatRequest, type SeatShellReceipt } from '../agent/seatApi';
import { claimHolder, setClaimActiveModel, subscribeClaims } from '../agent/claims';
import {
  countUvTextureFootprints,
  flattenUvFaceCorners,
  planProgressiveRepeatedUvStacks,
  planRepeatedUvStacks,
  planTwoSheetUvLayout,
  stitchUvIslands,
  uvRepeatSemanticFamily,
  UV_LAYOUT_TUNING,
  type UvIslandRect,
  type UvTwoSheetZone,
} from '../model/uvLayout';
import {
  paintLayoutConflictAckHotKey,
  paintLayoutConflictRevision,
  paintLayoutConflictRevisionIsAcknowledged,
  modelRevisionPartConflict,
  readPaintLayoutDiskFacts,
  type PaintLayoutKeepLiveOptions,
} from '../model/paintLayoutConflict';
import {
  commitOrdinaryModelSave,
  modelSaveAuthority,
  saveLiveModelBeforeExport,
  type ModelSaveIntent,
} from '../model/modelSaveAuthority';
import {
  loreSnapshotObjectIds,
  modelPackageGeometryPath,
  snapshotNormalModelSave,
} from '../model/modelLoreSnapshots';
import {
  captureRecoverySnapshotV1,
  recoveryHistoryV1,
  recoveryPinV1,
  recoveryRestoreCandidateV1,
  recoveryStatusV1,
  restoreModelTransactionV1,
  RECOVERY_STATUS_CHANNEL_V1,
} from '../../../runtime/vcs/lore';
import {
  historicalPreviewMutationRefusalV1,
  historicalPreviewMustCloseBeforeModelTargetV1,
  openHistoricalPreviewPairV1,
  releaseHistoricalPreviewPairV1,
  type ActiveHistoricalPreviewV1,
  type HistoricalPreviewUiActionV1,
} from '../model/historicalPreviewLifecycle';
import {
  captureVerifiedNormalSnapshotV1,
  issueVerifiedSaveReceiptV1,
} from '../../../runtime/vcs/loreSaveCoordinator';
import {
  cursorForFaceAddress,
  faceTable as inspectFaceTable,
  meshSessionIdentity,
  publishSessionObjectIds,
  selectFaceAddress,
  subscribeMeshAnalysisReady,
  type FaceAddressV1,
  type FaceDiffRequestV1,
  type FaceTableErrorV1,
  type FaceTableRequestV1,
} from '../../../runtime/model/faceTable';
import {
  applyModelFaceFieldEditV1,
  hasModelFaceFieldEditCoordinatorV1,
} from '../../../runtime/model/faceFieldEdit';
import { joinFaceTableDisplayNames } from '../model/faceTableDisplay';
import { blobAnalysisReadyMatches, blobPageContainsAddress, type PendingBlobAnalysisV1 } from '../model/blobExplorerState';
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
  WORLD_PIECE_SKIN_COMMAND_ID,
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
import { commandForKeyEvent, modifiersFromKeyEvent, syntheticKeyEdge, worldViewSlotForKey } from '../data/keymap';
import { primitivePartMesh, primitiveMeshData, composeModelParts, fileModelPackage, importModelFilePackage, importStlModelFilePackage, isViewerFile, modelPackageMeshData, packageMeshDoc, packageMeshDocParts, type PrimitiveParams } from '../data/assetCatalog';
import { convertStlToGlb, isStlFile } from '../data/stlImport';
import { MESHDOC_VERTEX_STRIDE, compareMeshDocs, invalidateMeshDoc, meshDocBounds, meshDocRangeStats, meshDocTriangle, meshDocIsUnreadable, meshDocLastWriteFailure, meshDocPartRangesFromRows, partsMetaFromRows, meshDocUnreadableDiagnostic } from '../data/meshDoc';
import { modelDocumentToken, nativeMeshActionDrain, reconcileNativeModelSession, withNativeMeshActionSource } from '../model/nativeMeshEvents';
import { hydrateModelDocumentPartsAfterMount, modelDocumentMetadataByRange } from '../model/modelDocumentColdMount';
import { parseModelHistory } from '../model/uvHistory';
import {
  choosePartAppendRoute,
} from '../model/partResidency';
import { parseModelSelectionSnapshot, type ModelSelectionSnapshot } from '../model/modelSelectionFocus';
import {
  planSelectionOwnerSurgery,
  selectionOwnerElementLabel,
  type SelectionOwnerPlan,
} from '../model/selectionOwnerSurgery';
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
  planDetachedPartHandoff,
  recoverAppendedPartUndoRows,
} from '../model/outlinerCommand';
import { materializePathArrayRows, sanitizePathArrayParams, type PathArrayParams } from '../data/pathArray';
import { cloneMesh, mirrorMesh, mergeMesh, type EditMesh, type LightRig } from '../model/editMesh';
import { modelPartImportPayload } from '../model/modelPartImport';
import { normalizeModelLights } from '../model/modelLights';
import { createTextureSlotFromSelection, normalizeModelTextureSlots } from '../model/modelTextureSlotAuthoring';
import { connectedPieceIds, pieceSelectionVolume, rotatePieceSelection, type PieceSelectionIntent } from '../world/selection';
import ImportPartDialog from '../dialogs/ImportPartDialog';
import PrefabDialog from './PrefabDialog';
import { mintWorldPrefabId, prefabFromPieces } from '../world/prefabs';
// Key edges come straight off the ffi bus (not useModifiers.onKeyDown): the active key
// bridge is useIFTTT's, whose events carry ctrlKey/shiftKey flags but NO `mods` object —
// useModifiers' fallback modifiers never update off those events, which is what killed
// every Ctrl chord (see modifiersFromKeyEvent in data/keymap.ts, req_2620 gap W).
import { subscribe } from '@reactjit/runtime/ffi';
// Live modifier state (no re-render) — the outliner's shift-click multi-select
// (req_2659) reads shift at press time instead of threading it through every row.
import { currentModifiers } from '@reactjit/runtime/hooks/useModifiers';
import { getHotState, setHotState, useHotState } from '@reactjit/runtime/hooks/useHotState';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { modelDocSessionId, releaseModelDocSession, rememberMintedModelId } from '../model/docSession';
import { ASSETS, DEFAULT_CONTENT_FOLDER, applyAssetOverrides, assetById, resolveMaterialRef } from '../data/catalog';
import { selectedObject, panelModeFor, tabForContentFolder, assetMatchesContentFolder, rankAssets, folderForAsset, contentFolderLabel, visibleModelPackages, liveContentTree, primitiveModelPackage, buildStarterModelPackage, nextBuildStarterDocId, modelPackageById, modelPackageByName, effectiveModelPackage, nextPrimitiveDocId, registerSavedPackage, upsertSavedPackage, SNAP_MODES } from '../data/content';
import { assetMatchesLibrarySearch } from '../data/librarySearch';
import { isLibraryCollectionFolder, navigateLibraryCollection, rememberRecentLibraryItem } from '../data/libraryCollections';
import {
  leftPanelForFolder,
  leftPanelsFor,
  pressPanelButton,
  resolvedPanelId,
  resolvedPanelIdOrNull,
  rightPanelsFor,
  type LeftPanelId,
  type RightPanelId,
} from '../data/panelSystem';
import { buildPieceStarterParts } from '../model/buildPieceStarter';
import { buildPieceStarter, type BuildPieceStarterId } from '../data/buildStarters';
import { buildPieceExportTarget } from '../data/buildExports';
import { compileDoorMesh, resolveDoorLeafPart } from '../model/doorModel';
import { MODEL_PACKAGES } from '../data/catalog';
import { acceptInstalledOrdinaryModelSaveStage, copyModelPackage, discardOrdinaryModelSaveStage, hasStoredModelPaint, installOrdinaryModelSaveStage, isMaterialized, loadMaterializedPackages, materializeCharacterSaveSnapshot, materializeModelPackage, materializeModelPackageAtDirectory, modelPaintLayoutIsStale, prepareOrdinaryModelSaveStage, readManifest, removeModelPackage, resolvePackageDir, rollbackOrdinaryModelSaveStage, settleRenamedPackageDir, stageModelThumbnail, updateManifestIdentity, updateManifestPlaceable, validateInstalledOrdinaryModelSaveStage, writeModelArtifactsAtDirectory, type ThumbnailStageResult } from '../data/modelPackageStore';
import { roleNamerPlan, type RoleContractId } from '../data/roleNamer';
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
import { scheduleLibraryHistorySave } from '../data/libraryHistoryStore';
import { hexToOklch, oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import type { ColorStudioHistoryEntry } from '../material/colorStudioCommand';
import { useBuildJournal } from '../data/journal';
import { explorerIndex, refreshExplorerIndex, explorerMatchesFolder, explorerFolderLabel, explorerFileById, explorerNowLabel } from '../data/fileExplorer';
import { WORLD_DOCUMENT_ID, WORLD_BIBLE_DOCUMENT, WORLD_BIBLE_DOCUMENT_ID, PLAYTEST_DOCUMENT, ANIMATION_DOCUMENT, materialDocument, modelDocument, upsertDocument } from '../data/documents';
import { cancelGlobalsSave, saveGlobalsNow, scheduleGlobalsSave } from '../data/globalsStore';
import { editorPersistenceSettings, editorSettings } from '../data/editorSettings';
import { discardModelWorkingCopyState, upsertModelPackageProjection } from '../data/persistenceLifecycle';
import { projectModelIntoRecentLibrary } from '../data/recentModelLifecycle';
import { applyDevReload, devReloadRevision, devReloadWaiting, installDevReloadCheckpoint, setDevReloadPolicy } from '../../../runtime/devReload';
import { DEFAULT_PHYSICS_GLOBALS, type PhysicsGlobals } from '../data/globals';
import { mapEventDrain, mapGetTileBindings, mapHostLive, mapRedo, mapUndo, type MapAuthoringEvent, type MapHistoryKind } from '../../../runtime/game/map';
import { buildCatalogIndex, validateBuildPlacement } from '../../../runtime/game/build';
import { TILE_KINDS, tileKindDefinition } from '../world/tileKinds';
import { FLORA_KIND_DEFINITIONS, type FloraLane } from '../world/floraKinds';
import { authoredFloraIdFor, type AuthoredFloraSpecies } from '../world/floraSpecies';
import { applyFloraPaintSamples, type FloraPaintSample, type WorldFloraBrush } from '../world/surfaceFlora';
import { floatsToBindings, GROUND_MATERIALS, tileBindingFor } from '../render3d/groundFormula';

const FACADE_PREVIEW_DETAILS = [128, FACADE_TEXELS_PER_METER, 512] as const;
const MODEL_PAINT_TOOLS = ['fill', 'brush', 'pen', 'eyedropper'] as const;
const FACADE_PAINT_TOOLS = ['brush', 'eraser', 'line', 'rect', 'ellipse', 'pen', 'eyedropper', 'marquee', 'lasso'] as const;
const COLOR_STUDIO_UNDO_CAP = 32;
const SEAT_SESSION_WEDGED_REASON = "the editor's native session could not be restored — switch tabs to recover; the Agent Seat is refusing every request until then";

function savedCharacterBinding(pkg: ModelPackage): SkinBindingRef | null {
  const meshes = pkg.skeleton?.meshes;
  return meshes?.kind === 'skinned' ? meshes.binding ?? null : null;
}

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

const INITIAL_BLOB_FACE_QUERY: BlobExplorerFaceQuery = {
  source: 'resident',
  sort: { column: 'area', direction: 'asc' },
  filters: [],
  cursor: null,
  limit: 200,
};

const EMPTY_BLOB_HISTORY: BlobExplorerHistoryStateV1 = {
  loading: false,
  error: null,
  rows: [],
  cursor: null,
  nextCursor: null,
  indexedRepair: 'not_needed',
};

const CHECKING_BLOB_SERVICE: BlobExplorerServerStatusV1 = {
  state: 'checking',
  library: { available: false, version: null },
  repository: { ready: false, path: 'checking', revision: null },
  service: {
    healthy: false,
    healthUrl: 'http://127.0.0.1:41339/health_check',
    httpCode: null,
    unitName: 'loreserver.service',
    active: false,
    enabled: false,
    journalTail: [],
    restoreCommands: [],
  },
  stores: { snapshotRoot: 'checking', localBytes: 0, serverBytes: null },
  retention: {
    days: 60,
    nowMs: 0,
    lastPruneMs: null,
    nextPruneMs: null,
    immediatelyExpired: 0,
    localTombstones: 0,
    remotePendingTombstones: 0,
    logicallyRemovedEntries: 0,
    logicallyRemovedBytes: 0,
    physicallyReclaimedBytes: 0,
    remoteWatermark: null,
    legacyUnexpiredPending: 0,
    legacyCorruptPending: 0,
    legacyLayoutCutover: false,
    lastError: null,
  },
  history: { pushed: 0, local: 0, unknown: 0 },
  probe: { lastCompletedMs: null, lastTransitionMs: null },
};

function blobFaceError(detail: string): FaceTableErrorV1 {
  return { ok: false, version: 1, code: 'internal_error', detail };
}

export default function AppFrame() {
  // The shell for BOTH routes. AppFrame stays mounted across the Editor/Play
  // switch (it's rendered directly under <Router>, not swapped by a <Route>), so
  // the top chrome — and its Editor/Play toggle — persists on /play and the
  // authoring state survives a round trip. The body is what swaps: editor panels
  // on /editor, the host-native WorldLoader on /play.
  const { path } = useRoute();
  const navigate = useNavigate();
  const playing = path === '/play';
  const [state, setState] = useState<EditorState>(loadPersistedState);
  const characterRigApiRef = useRef<NativeCharacterRigApi | null>(null);
  if (characterRigApiRef.current === null) characterRigApiRef.current = createCharacterRigApi();
  const [characterRigSnapshot, setCharacterRigSnapshot] = useState<CharacterRigSnapshot | null>(null);
  const characterRigSnapshotRef = useRef<CharacterRigSnapshot | null>(characterRigSnapshot);
  characterRigSnapshotRef.current = characterRigSnapshot;
  const [externalAutoRigState, setExternalAutoRigState] = useState<ExternalAutoRigUiState>(IDLE_EXTERNAL_AUTO_RIG);
  const externalAutoRigStateRef = useRef<ExternalAutoRigUiState>(externalAutoRigState);
  externalAutoRigStateRef.current = externalAutoRigState;
  // Migrated application commands read and atomically replace this live
  // snapshot before publishing their outcome. React is a projection of that
  // commit; menu/toolbar/hotkey callers never receive setState.
  const stateRef = useRef(state);
  stateRef.current = state;
  const seatShellActionRef = useRef<(action: string, args: Record<string, unknown>, targetModelId?: string) => SeatShellReceipt>(
    () => ({ ok: false, reason: 'Agent Seat shell actions are not ready' }),
  );
  const [blobFaceQuery, setBlobFaceQuery] = useState<BlobExplorerFaceQuery>(INITIAL_BLOB_FACE_QUERY);
  const [blobFacePage, setBlobFacePage] = useState<BlobExplorerFacePage | null>(null);
  const [blobFaceErrorState, setBlobFaceErrorState] = useState<FaceTableErrorV1 | null>(null);
  const [blobFaceLoading, setBlobFaceLoading] = useState(false);
  const [blobSelectedAddress, setBlobSelectedAddress] = useState<FaceAddressV1 | null>(null);
  const [blobSelectedTriangles, setBlobSelectedTriangles] = useState<number | null>(null);
  const [blobHistory, setBlobHistory] = useState<BlobExplorerHistoryStateV1>(EMPTY_BLOB_HISTORY);
  const [blobService, setBlobService] = useState<BlobExplorerServerStatusV1>(CHECKING_BLOB_SERVICE);
  const [blobSnapshotInFlight, setBlobSnapshotInFlight] = useState(false);
  const [blobSnapshotStatus, setBlobSnapshotStatus] = useState<string | null>(null);
  const [blobFieldEditInFlight, setBlobFieldEditInFlight] = useState(false);
  const [blobFieldEditStatus, setBlobFieldEditStatus] = useState<string | null>(null);
  const blobFieldEditInFlightRef = useRef(false);
  const [blobRestoreInFlight, setBlobRestoreInFlight] = useState(false);
  const [blobRestoreConfirmSnapshotId, setBlobRestoreConfirmSnapshotId] = useState<string | null>(null);
  const blobRestoreInFlightRef = useRef(false);
  const blobRestoreProjectionBlockedRef = useRef<string | null>(null);
  const savedMeshDepthRef = useRef<Record<string, number>>({});
  const [blobActivePreview, setBlobActivePreview] = useState<ActiveHistoricalPreviewV1 | null>(null);
  const blobActivePreviewRef = useRef<ActiveHistoricalPreviewV1 | null>(null);
  const blobPreviewTransitionErrorRef = useRef<string | null>(null);
  const blobPreviewReleasedDuringTransitionRef = useRef(false);
  blobActivePreviewRef.current = blobPreviewReleasedDuringTransitionRef.current ? null : blobActivePreview;
  const [blobWidthPreset, setBlobWidthPreset] = useState<BlobExplorerWidthPreset>('compact');
  const [blobAnalysisRevision, setBlobAnalysisRevision] = useState(0);
  const blobFaceCursorBackRef = useRef<(string | null)[]>([]);
  const blobHistoryCursorBackRef = useRef<(string | null)[]>([]);
  const blobRequestGenerationRef = useRef(0);
  const blobPendingAnalysisRef = useRef<PendingBlobAnalysisV1 | null>(null);
  const stageThumbnailRef = useRef<() => ThumbnailStageResult>(
    () => ({ ok: false, reason: 'the thumbnail verb is not ready' }),
  );
  const activeSessionTokenRef = useRef(0);
  const activeSessionModelIdRef = useRef<string | null>(null);
  const residentModelForRigAttachRef = useRef<{
    documentId: string;
    modelId: string;
    modelSourceKey: string;
    lifecycleId: string;
  } | null>(null);
  const seatSessionWedgedRef = useRef(false);
  const backgroundSeatByModelRef = useRef(new Map<string, AgentSeat>());
  // Agent UV plans are bounded, mutation-free proposals. Only the latest plan is
  // retained, and apply requires the same live UV revision so a human edit cannot
  // be overwritten by a stale agent review.
  const seatUvPlanRef = useRef<{
    token: string;
    kind: 'prestack' | 'stitch' | 'two-sheet';
    uvKey: string;
    uvRevision: number;
    rects: UvIslandRect[];
    historyAction: 'stack' | 'stitch';
    summary: Record<string, unknown>;
    zones?: {
      hero: { zone: UvTwoSheetZone; islands: number[] };
      uniform: { zone: UvTwoSheetZone; islands: number[] };
    };
  } | null>(null);
  const seatAppliedTwoSheetRef = useRef<{
    token: string;
    rects: UvIslandRect[];
    zones: {
      hero: { zone: UvTwoSheetZone; islands: number[] };
      uniform: { zone: UvTwoSheetZone; islands: number[] };
    };
  } | null>(null);
  const seatUvPlanSerialRef = useRef(0);
  useEffect(() => installDevReloadCheckpoint(() => persistState(stateRef.current)), []);
  // Per-device tool memory (req_3089): which physical device is driving the
  // cursor now, and the last tool runCommand dispatched per surface scope
  // (the dedupe that keeps a device flip from re-firing toggle-style tools).
  const pointerDeviceRef = useRef<'mouse' | 'pen'>(getPointerDevice());
  const lastToolByScopeRef = useRef<{ world: string | null; model: string | null }>({ world: null, model: null });
  const { snapshot: journal, actions: journalActions } = useBuildJournal();
  // A pending image import awaiting the pixel-vs-exact decision. Transient.
  const [importPlan, setImportPlan] = useState<ImportImagePlan | null>(null);
  // The Add From Library picker (append a saved model into the OPEN model as parts).
  const [importPartOpen, setImportPartOpen] = useState(false);
  // Live-material picker (req_3401): which model+slot the app-root thumbnail
  // popover is currently binding. Materials are picked BY LOOK — the Rig row's
  // `pick` verb opens this; a pick patches the slot's liveMaterial and the
  // popover stays up so looks can be compared live on the mesh.
  const [liveMaterialPicker, setLiveMaterialPicker] = useState<{ modelId: string; slotIndex: number } | null>(null);
  // STL conversion is intentionally a blocking operation: a local Blender job can
  // run long enough that a status-bar update looks like a click that did nothing.
  const [stlConversionName, setStlConversionName] = useState<string | null>(null);
  // Path Array's source is frozen when the dialog opens. Params remain dialog-local;
  // Apply revalidates these ids/ranges against the live outliner before touching mesh.
  const [pathArrayPrompt, setPathArrayPrompt] = useState<{ sourceIds: string[]; label: string; sourceSpanU: { xU: number; zU: number } } | null>(null);
  // Guided role naming (req_3263): the ask queue over one rig contract, pinned to
  // the model it started on. Session-only — the renames it makes are the record.
  // The ref mirrors the session for handlers: Pressable registrations only refresh
  // when clean props diff, so callbacks must read .current, never the closure.
  const [roleNamerSession, setRoleNamerSession] = useState<{ contractId: RoleContractId; modelId: string; queue: string[]; at: number } | null>(null);
  const roleNamerRef = useRef(roleNamerSession);
  roleNamerRef.current = roleNamerSession;
  const [scaleByOpen, setScaleByOpen] = useState(false);
  const [nameSelectionOpen, setNameSelectionOpen] = useState(false);
  const [prefabCaptureOpen, setPrefabCaptureOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [hotUpdatePromptOpen, setHotUpdatePromptOpen] = useState(false);
  const [nativeUpdateNotice, setNativeUpdateNotice] = useHotState<NativeUpdateNoticeState | null>('editor.native-update-notice.v1', null);
  const [orphanHostsNotice, setOrphanHostsNotice] = useHotState<OrphanHostsNoticeState | null>('editor.orphan-hosts-notice.v1', null);
  const [unsavedDocumentName, setUnsavedDocumentName] = useState<string | null>(null);
  const [unsavedActionLabels, setUnsavedActionLabels] = useState<{ save?: string; discard?: string; cancel?: string }>({});
  const unsavedDecisionRef = useRef<{ save: () => void; discard: () => void; cancel?: () => void } | null>(null);
  const requestUnsavedDecision = (
    documentName: string,
    save: () => void,
    discard: () => void,
    cancel?: () => void,
    labels: { save?: string; discard?: string; cancel?: string } = {},
  ) => {
    unsavedDecisionRef.current = { save, discard, cancel };
    setUnsavedActionLabels(labels);
    setUnsavedDocumentName(documentName);
  };
  const [settingsRevision, setSettingsRevision] = useState(0);
  useEffect(() => editorSettings.subscribe(() => setSettingsRevision((revision) => revision + 1)), []);
  const persistenceSettings = useMemo(editorPersistenceSettings, [settingsRevision]);
  const [manualWorldDirty, setManualWorldDirty] = useState(false);
  const [mapSwitchPending, setMapSwitchPending] = useState(false);
  const mapSwitchSerialRef = useRef(0);
  const [modelMutationRevision, setModelMutationRevision] = useState(0);
  const [modelReloadRevision, setModelReloadRevision] = useState(0);
  const retopoGhostVisibleRef = useRef(state.modelTool.retopoGhostVisible);
  retopoGhostVisibleRef.current = state.modelTool.retopoGhostVisible;
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
  // Emptying the semantic table needs the same shape of one-shot capability
  // (req_3898): removing the LAST region legitimately reaches zero named faces, but
  // the save guard cannot tell that apart from a mesh that silently LOST its names,
  // so without this a deliberate clear left the document unsaveable. Only a real
  // Remove in the NAMES pane mints it; hydration and autosave never do.
  const authorizedSemanticClearRef = useRef(new Set<string>());
  const partShrinkSaveOptions = (modelId: string, liveCount: number) => ({
    allowPartShrink: authorizedPartShrinkTargetRef.current.get(modelId) === liveCount,
    allowSemanticClear: authorizedSemanticClearRef.current.has(modelId),
  });
  const consumeModelSaveAuthorizations = (modelId: string) => {
    authorizedPartShrinkTargetRef.current.delete(modelId);
    authorizedSemanticClearRef.current.delete(modelId);
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

  // Native compiles are candidates, never commands. The supervisor emits this
  // notice only after compilation completes and watches a one-shot token file;
  // keeping/collapsing the notice performs no host or model-session mutation.
  useEffect(() => subscribe('system:notification', (payload: any) => {
    const ready = nativeUpdateNoticeFromPayload(payload);
    if (ready) {
      setNativeUpdateNotice(ready);
      setState((prev) => ({ ...prev, status: 'Native update compiled — waiting for your approval' }));
      return;
    }
    const orphans = orphanHostsNoticeFromPayload(payload);
    if (orphans) {
      setOrphanHostsNotice(orphans);
      setState((prev) => ({ ...prev, status: `${orphans.pids.length} orphaned dev host(s) found — nothing is attached to them` }));
      return;
    }
    if (payload?.kind === 'orphan-hosts-result') {
      setOrphanHostsNotice(null);
      setState((prev) => ({
        ...prev,
        status: typeof payload.message === 'string' ? payload.message : 'Orphan cleanup finished',
      }));
      return;
    }
    if (payload?.kind === 'native-update-result') {
      setNativeUpdateNotice(null);
      setState((prev) => ({
        ...prev,
        status: typeof payload.message === 'string'
          ? payload.message
          : payload.ok === true ? 'Native update applied' : 'Native update was not applied',
      }));
    }
  }), []);

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
  // Next UV mask zone id to hand out. Shift+M allocates in order so repeated presses
  // build up separate charts instead of piling every selection into zone 0 (req_4152).
  const nextUvZoneRef = useRef(0);

  // ── Modal discipline (req_2626 gap HH, USER LAW) ────────────────────────────
  // While ANY blocking session/dialog is unresolved — the viewer's bevel/loop-cut
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
    if (stlConversionName) return { id: 'stl-conversion', label: 'STL Conversion' };
    if (pathArrayPrompt) return { id: 'path-array', label: 'Path Array' };
    if (scaleByOpen) return { id: 'scale-by', label: 'Scale By' };
    if (nameSelectionOpen) return { id: 'name-selection', label: 'Name Selection' };
    if (prefabCaptureOpen) return { id: 'prefab-capture', label: 'Create Prefab' };
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
            selectedPieceIds: transaction.placed.map((piece) => piece.id),
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
        // Paint-skin swap resolution (req_3443): a placed authored piece may wear
        // any of its model's STORED paintings. The base id strips the current
        // skin suffix; the requested skin must exist in the package's placeable
        // skin list (png + blob on disk, current-topology gate applied).
        skinPolicy: {
          skinnedPieceIdFor: (currentPieceId: string, skinId: string | null) => {
            const ap = authoredPieceFor(currentPieceId);
            if (!ap) return null;
            if (skinId === null) return ap.id;
            const pkg = modelPackageById(ap.pkgId);
            if (!pkg || !listPaintSkins(pkg).some((skin) => skin.id === skinId)) return null;
            return skinnedPieceId(ap.id, skinId);
          },
        },
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
                : transaction.action === 'skin' && after
                  ? `look=${paintSkinIdOf(before.pieceId) ?? 'base'}→${paintSkinIdOf(after.pieceId) ?? 'base'} apply=${applyMs.toFixed(1)}ms`
                  : `at=(${before.x.toFixed(2)},${before.y.toFixed(2)},${before.z.toFixed(2)}) apply=${applyMs.toFixed(1)}ms`;
          const status = transaction.action === 'move'
            ? `moved ${before.pieceId}${transaction.replaced.length ? ` (replaced ${transaction.replaced.length})` : ''}`
            : transaction.action === 'rotate'
              ? `rotated ${before.pieceId} → ${after!.yawDegrees}°${transaction.replaced.length ? ` (replaced ${transaction.replaced.length})` : ''}`
              : transaction.action === 'spin'
                ? ((after!.spinDegPerSec ?? 0) !== 0 ? `spinning ${before.pieceId} at ${after!.spinDegPerSec}°/s` : `stopped ${before.pieceId} spinning`)
                : transaction.action === 'skin'
                  ? (paintSkinIdOf(after!.pieceId) ? `dressed ${authoredPieceFor(after!.pieceId)?.label ?? after!.pieceId} in a stored painting` : `returned ${authoredPieceFor(after!.pieceId)?.label ?? after!.pieceId} to its base look`)
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
              recentLibraryKeys: rememberRecentLibraryItem(
                previous.recentLibraryKeys ?? [],
                `asset:${transaction.materialAssetId}`,
              ),
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
        read: (requestedModelId?: string) => {
          const current = stateRef.current;
          const activeDoc = current.workspaceDocuments.find((candidate) => candidate.id === current.activeWorkspaceDocumentId);
          const requestedDoc = requestedModelId
            ? current.workspaceDocuments.find((candidate) => candidate.kind === 'model' && candidate.sourceId === requestedModelId)
            : null;
          const doc = requestedDoc ?? activeDoc;
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
  const refuseHistoricalPreviewMutation = (action: HistoricalPreviewUiActionV1): string | null => {
    const transaction = blobRestoreInFlightRef.current
      ? 'Historical Restore owns the exact resident/package transaction; wait for its verified receipt.'
      : blobFieldEditInFlightRef.current
        ? 'Guarded field edit owns the exact resident/package transaction; wait for its verified receipt.'
        : blobRestoreProjectionBlockedRef.current
          ? 'The restored package projection could not be re-read exactly. Close and reopen this model before any mutation, save, or export.'
        : null;
    const refusal = transaction ?? historicalPreviewMutationRefusalV1(blobActivePreviewRef.current, action);
    if (!refusal) return null;
    const previous = stateRef.current;
    const next = { ...previous, openMenu: null, status: refusal };
    stateRef.current = next;
    setState(next);
    return refusal;
  };

  const invokeApplicationCommand = (
    commandId: string,
    args: unknown,
    source: string,
    correlation: { actionId?: string; causedBy?: string } = {},
  ): CommandOutcome => {
    if (isModelOutlinerActionCommandId(commandId)) {
      const reason = refuseHistoricalPreviewMutation('model_mutation');
      if (reason) return {
        invocationId: 'historical-preview-read-only',
        commandId,
        source: commandSource(source),
        origin: source,
        causedBy: correlation.causedBy,
        status: 'rejected',
        phase: 'rejected',
        code: 'disabled',
        reason,
      };
    }
    const outcome = applicationCommandsRef.current!.invoke({
      commandId,
      args,
      source: commandSource(source),
      // The raw source rides as origin so the authority's capability hook can
      // tell the password-verified seat lane from user-lane edits (req_3850).
      origin: source,
      ...correlation,
    });
    if (outcome.status === 'rejected') {
      // 'unauthorized' on a claimed model deserves the claim's own words, not
      // the generic missing-capability line.
      const claim = outcome.code === 'unauthorized' ? claimHolder(activeModelId) : null;
      const previous = stateRef.current;
      const next = { ...previous, openMenu: null, status: claim ? `locked — ${claim.agent} has this model claimed` : outcome.reason };
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
  const guardedModelMutation = <A extends unknown[]>(fn: (...a: A) => void) => guarded((...a: A) => {
    if (refuseHistoricalPreviewMutation('model_mutation')) return;
    fn(...a);
  });

  // The model surface's right-click menu. Lives at the app ROOT (rendered below,
  // as the last child of HW_App) so it lands at the cursor — an absolutely-placed
  // menu positions relative to its parent, and only the root sits at window origin
  // (the stage is offset right by the rail + content browser). The trigger spreads
  // onto the model surface deep in the tree.
  const modelMenu = useContextMenu();

  // Content-browser menus must mount here too. Mounting this inside the left
  // panel clipped it at the panel/stage boundary even with a high z-index,
  // because z-order cannot change an absolute node's containing block.
  const libraryModelMenu = useContextMenu();
  const [libraryMenuModelId, setLibraryMenuModelId] = useState<string | null>(null);

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

  // Asset Explorer Recent is durable user history, not session-only view
  // state. Every mixed asset/model history change micro-saves independently.
  useEffect(() => {
    scheduleLibraryHistorySave(state.recentLibraryKeys);
  }, [state.recentLibraryKeys]);

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
    }, state.worldFacades, state.worldPrefabs, state.worldFlora, state.worldViews);
  }, [state.activeMapStem, state.worldPieces, state.worldFlora, state.worldPrefabs, state.objects, state.mapPaint.zones, state.worldFacades, state.worldViews, persistenceSettings.autosave, persistenceSettings.autosaveDelayMs]);

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

  // ── Durable identity + visible save state (req_2620 gaps S/T/U) ──────────────
  // The model doc in view, resolved through the EFFECTIVE package (session rename
  // applied) — the same record every save writes, so what you see is what lands
  // in the manifest. onDisk gates the dirty semantics: an on-disk model autosaves
  // on doc switch; a never-saved doc stays loud until the user saves it first.
  const activeModelId = (() => {
    const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
    return doc?.kind === 'model' ? (doc.sourceId ?? null) : null;
  })();
  // Park the outgoing model's native session and restore the incoming one
  // (req_3850 slice 2). MUST run synchronously in the state-changing handler,
  // BEFORE setState: the incoming ModelView's mount effect fires before any
  // parent effect, so an effect-based select would arrive too late. Non-model
  // documents select token 0 (the primordial no-document session).
  const selectNativeModelSession = (doc: WorkspaceDocument | null) => {
    const targetModelId = doc?.kind === 'model' ? (doc.sourceId ?? null) : null;
    const preview = blobActivePreviewRef.current;
    if (historicalPreviewMustCloseBeforeModelTargetV1(preview, targetModelId)) {
      if (!closeBlobPreview('Historical preview closed before switching documents.', false)) return;
    }
    const reconciled = reconcileNativeModelSession(
      { token: activeSessionTokenRef.current, modelId: activeSessionModelIdRef.current },
      doc,
      (token) => Number((globalThis as any).__mesh_session_select?.(token) ?? 0),
    );
    if (reconciled.status === 'refused') return;
    activeSessionTokenRef.current = reconciled.binding.token;
    activeSessionModelIdRef.current = reconciled.binding.modelId;
    seatSessionWedgedRef.current = false;
  };
  // AppFrame refs restart on a JS hot reload while the native model session and
  // the persisted workspace document survive it. Re-bind them synchronously,
  // before ModelView mounts, for the same reason tab switches select here rather
  // than in an effect: Save and the first post-reload edit must address the
  // resident model that is already on screen instead of silently receiving null.
  if (activeSessionModelIdRef.current !== activeModelId) {
    selectNativeModelSession(
      state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId) ?? null,
    );
  }
  // An adoption key belongs to one exact visible document lifetime. Clear it
  // synchronously during render when navigation, native-session selection, or
  // an explicit reload changes that lifetime; a fast close/reopen can therefore
  // never attach against the previous ModelView's dead source key.
  const rigAttachResidentLifecycleId = [
    state.activeWorkspaceDocumentId,
    activeSessionModelIdRef.current ?? '',
    String(modelReloadRevision),
  ].join('|');
  if (residentModelForRigAttachRef.current?.lifecycleId !== rigAttachResidentLifecycleId) {
    residentModelForRigAttachRef.current = null;
  }
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
  const withBackgroundModelSession = <T,>(
    modelId: string,
    run: () => T,
    refuse: (reason: string) => T,
  ): T => {
    const host = globalThis as any;
    const restoreToken = activeSessionTokenRef.current;
    const token = modelDocumentToken(modelId);
    if (token === restoreToken) return run();
    if (host.__mesh_session_select?.(token) !== 1) {
      return refuse(`the native session table refused target model ${modelId} — a drag gesture, historical preview, or retained write lease briefly owns the resident session; retry shortly (tools/seat retries this automatically)`);
    }
    host.__mesh_action_document?.(token);
    const known = modelIdByMeshTokenRef.current.get(token);
    modelIdByMeshTokenRef.current.set(token, known && known !== modelId ? null : modelId);
    const restore = () => {
      const restored = host.__mesh_session_select?.(restoreToken) === 1
        || host.__mesh_session_select?.(restoreToken) === 1;
      host.__mesh_action_document?.(restoreToken);
      if (restored) return;
      seatSessionWedgedRef.current = true;
      setState((prev) => ({ ...prev, status: `⚠ ${SEAT_SESSION_WEDGED_REASON}` }));
    };
    if (host.__mesh_session_resident?.() !== 1) {
      restore();
      return refuse(`model ${modelId} has no resident native session — open its tab once so the editor loads it, then retry`);
    }
    try {
      return run();
    } finally {
      restore();
    }
  };
  useEffect(() => {
    (globalThis as any).__mesh_action_document?.(activeModelId ? modelDocumentToken(activeModelId) : 0);
    setClaimActiveModel(activeModelId);
  }, [activeModelId]);
  // Agent claims (req_3850): re-render on claim/dismiss so the tab badges
  // track the table; the table itself lives in agent/claims.ts.
  const [, setClaimsPulse] = useState(0);
  useEffect(() => subscribeClaims(() => setClaimsPulse((n) => n + 1)), []);
  const activeModelPkg = activeModelId ? effectiveModelPackage(activeModelId, state.modelOverrides, state.modelDupes) : null;
  const residentRigSnapshot = characterRigApiRef.current?.currentSnapshot?.() ?? null;
  const activeRigTarget = characterRigApiRef.current?.currentOpenTarget?.() ?? null;
  const activeRigDocumentId = state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId)?.id ?? null;
  const characterRigHistoryActive = characterRigHistoryShouldOwnInput(
    activeModelPkg,
    activeRigDocumentId,
    state.rightPane,
    state.rightPanelCollapsed,
    state.modelTool,
    characterRigSnapshot,
    residentRigSnapshot,
    activeRigTarget,
  );
  // Publish the LIVE undo/redo owner. Character rig history wins only while its
  // pane owns viewport input; mesh/paint/world/material histories retain their
  // existing authority everywhere else.
  publishCharacterRigUndoDepths(
    characterRigSnapshot?.history.undoDepth ?? 0,
    characterRigSnapshot?.history.redoDepth ?? 0,
    characterRigHistoryActive,
  );
  publishColorStudioUndoDepths(
    colorStudioHistoryRef.current.undo.length,
    colorStudioHistoryRef.current.redo.length,
  );
  const liveUndoDepths = undoDepths(state);
  publishUndoDepths(liveUndoDepths);
  const activeModelOnDisk = activeModelPkg ? isMaterialized(activeModelPkg.kind, activeModelPkg.id) : false;
  const blobExplorerOpen = !playing && !!activeModelId && state.rightPane === 'recovery' && !state.rightPanelCollapsed;

  const refreshBlobHistory = (modelId: string, cursor: string | null = null) => {
    setBlobRestoreConfirmSnapshotId(null);
    setBlobHistory((current) => ({ ...current, loading: true, error: null }));
    const response = recoveryHistoryV1({
      version: 1,
      modelId,
      ...(cursor ? { cursor } : {}),
      limit: 100,
    });
    if (!response.ok) {
      setBlobHistory((current) => ({ ...current, loading: false, error: response.detail }));
      return;
    }
    setBlobHistory({
      loading: false,
      error: null,
      rows: response.rows,
      cursor: response.cursor,
      nextCursor: response.nextCursor,
      indexedRepair: response.indexedRepair,
    });
  };

  const refreshBlobServiceStatus = () => {
    const status = recoveryStatusV1({ version: 1 });
    setBlobService(status.ok ? status.status : {
      ...CHECKING_BLOB_SERVICE,
      state: 'blocked',
      repository: { ...CHECKING_BLOB_SERVICE.repository, path: 'unavailable' },
      service: {
        ...CHECKING_BLOB_SERVICE.service,
        journalTail: [status.detail],
      },
      retention: { ...CHECKING_BLOB_SERVICE.retention, lastError: status.detail },
    });
  };

  const publishBlobObjectNamespace = (modelId: string) => {
    const identity = meshSessionIdentity({ version: 1, modelId });
    if (!identity.ok) return identity;
    const objectIds = loreSnapshotObjectIds(stateRef.current.modelParts[modelId] ?? []);
    if (!objectIds) {
      return { ok: false as const, version: 1 as const, code: 'object_ids_unpublished' as const, detail: 'one stable object id is required for every resident part range' };
    }
    const publication = publishSessionObjectIds({
      version: 1,
      modelId,
      sessionToken: identity.sessionToken,
      expectedGeneration: identity.generation,
      ranges: objectIds.map((objectId, rank) => ({ rank, objectId })),
    });
    return publication.ok ? meshSessionIdentity({ version: 1, modelId }) : publication;
  };

  useEffect(() => {
    blobRequestGenerationRef.current += 1;
    blobFaceCursorBackRef.current = [];
    blobHistoryCursorBackRef.current = [];
    setBlobFaceQuery(INITIAL_BLOB_FACE_QUERY);
    setBlobFacePage(null);
    setBlobFaceErrorState(null);
    setBlobFaceLoading(false);
    blobPendingAnalysisRef.current = null;
    setBlobSelectedAddress(null);
    setBlobSelectedTriangles(null);
    setBlobHistory(EMPTY_BLOB_HISTORY);
    setBlobService(CHECKING_BLOB_SERVICE);
    setBlobSnapshotInFlight(false);
    setBlobSnapshotStatus(null);
    blobFieldEditInFlightRef.current = false;
    setBlobFieldEditInFlight(false);
    setBlobFieldEditStatus(null);
    blobRestoreInFlightRef.current = false;
    blobRestoreProjectionBlockedRef.current = null;
    setBlobRestoreInFlight(false);
    setBlobRestoreConfirmSnapshotId(null);
    if (blobActivePreviewRef.current === null) setBlobActivePreview(null);
  }, [activeModelId]);

  useEffect(() => subscribeMeshAnalysisReady((event) => {
    const pending = blobPendingAnalysisRef.current;
    if (!blobAnalysisReadyMatches(pending, blobRequestGenerationRef.current, event)) return;
    blobPendingAnalysisRef.current = null;
    if (event.status === 'failed') {
      setBlobFaceLoading(false);
      setBlobFacePage(null);
      setBlobFaceErrorState(blobFaceError(event.detail ?? event.code ?? 'native face analysis failed'));
      return;
    }
    setBlobAnalysisRevision((revision) => revision + 1);
  }), []);

  useEffect(() => {
    if (!blobExplorerOpen || !activeModelId) return;
    const preview = blobActivePreviewRef.current;
    if (blobFaceQuery.source === 'preview' && (!preview || preview.modelId !== activeModelId)) {
      setBlobFaceLoading(false);
      setBlobFacePage(null);
      setBlobFaceErrorState(blobFaceError('open one historical preview for this model before inspecting the PREVIEW plane'));
      return;
    }
    const requestGeneration = ++blobRequestGenerationRef.current;
    setBlobFaceLoading(true);
    setBlobFaceErrorState(null);
    const receipt = seatShellActionRef.current('face-table', {
      source: blobFaceQuery.source,
      sort: blobFaceQuery.sort,
      filters: blobFaceQuery.filters,
      ...(blobFaceQuery.cursor ? { cursor: blobFaceQuery.cursor } : {}),
      ...(blobFaceQuery.source === 'preview' && preview ? {
        previewToken: preview.previewToken,
        expectedSha256: preview.sha256,
      } : {}),
      limit: blobFaceQuery.limit,
    }, activeModelId);
    if (requestGeneration !== blobRequestGenerationRef.current) return;
    setBlobFaceLoading(false);
    if (!receipt.ok) {
      const result = receipt.result as FaceTableErrorV1 | undefined;
      setBlobFacePage(null);
      const error = result?.ok === false ? result : blobFaceError(receipt.reason ?? 'face analysis failed');
      setBlobFaceErrorState(error);
      if (error.code === 'analysis_pending') {
        blobPendingAnalysisRef.current = {
          requestGeneration,
          modelId: activeModelId,
          source: blobFaceQuery.source,
          analysisId: error.analysisId,
          planeIdentityHash: error.planeIdentityHash,
        };
      } else {
        blobPendingAnalysisRef.current = null;
      }
      return;
    }
    blobPendingAnalysisRef.current = null;
    setBlobFacePage(receipt.result as BlobExplorerFacePage);
    setBlobFaceErrorState(null);
  }, [
    blobExplorerOpen,
    activeModelId,
    blobFaceQuery.source,
    blobFaceQuery.sort.column,
    blobFaceQuery.sort.direction,
    blobFaceQuery.filters,
    blobFaceQuery.cursor,
    blobFaceQuery.limit,
    blobActivePreview?.previewToken,
    blobActivePreview?.sha256,
    liveUndoDepths.undo,
    blobAnalysisRevision,
  ]);

  useEffect(() => {
    const timer = setTimeout(refreshBlobServiceStatus, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => subscribe(RECOVERY_STATUS_CHANNEL_V1, () => {
    // Native already performed the blocking probe on its worker. This door is
    // an immutable cached read, so a service transition never stalls a frame.
    refreshBlobServiceStatus();
  }), []);

  useEffect(() => {
    if (!blobExplorerOpen || !activeModelId) return;
    refreshBlobServiceStatus();
    refreshBlobHistory(activeModelId);
  }, [blobExplorerOpen, activeModelId]);

  const changeBlobFaceQuery = (next: BlobExplorerFaceQuery) => {
    setBlobFaceQuery((current) => {
      const sameQuery = current.source === next.source &&
        current.sort.column === next.sort.column &&
        current.sort.direction === next.sort.direction &&
        JSON.stringify(current.filters) === JSON.stringify(next.filters) &&
        current.limit === next.limit;
      if (sameQuery && next.cursor !== current.cursor) blobFaceCursorBackRef.current.push(current.cursor);
      else if (!sameQuery) blobFaceCursorBackRef.current = [];
      return next;
    });
  };

  const previousBlobFacePage = () => {
    const cursor = blobFaceCursorBackRef.current.pop();
    if (cursor === undefined) return;
    setBlobFaceQuery((current) => ({ ...current, cursor }));
  };

  const residentBlobPlane = () => {
    if (!blobFacePage) return null;
    if (blobFacePage.source === 'resident') {
      return { source: 'resident' as const, sessionToken: blobFacePage.sessionToken, expectedGeneration: blobFacePage.generation };
    }
    if (blobFacePage.source === 'diff' && blobFacePage.resident.source === 'resident') {
      return {
        source: 'resident' as const,
        sessionToken: blobFacePage.resident.sessionToken,
        expectedGeneration: blobFacePage.resident.generation,
      };
    }
    return null;
  };

  const residentBlobObjectNamespaceHash = () => {
    if (!blobFacePage) return null;
    if (blobFacePage.source === 'resident') return blobFacePage.objectNamespaceHash;
    if (blobFacePage.source === 'diff' && blobFacePage.resident.source === 'resident') {
      return blobFacePage.resident.objectNamespaceHash;
    }
    return null;
  };

  const selectBlobFace = (selection: BlobExplorerFaceSelection) => {
    if (!activeModelId || selection.plane === 'saved_preview') {
      setBlobSnapshotStatus('Saved rows are inspectable but cannot replace the live viewport without an explicit preview capability.');
      return;
    }
    const preview = blobActivePreviewRef.current;
    const plane = selection.plane === 'preview'
      ? preview && preview.modelId === activeModelId
        ? { source: 'preview' as const, previewToken: preview.previewToken, expectedSha256: preview.sha256 }
        : null
      : residentBlobPlane();
    if (!plane) {
      setBlobFaceErrorState(blobFaceError(`${selection.plane} face identity is unavailable; refresh that plane`));
      return;
    }
    const response = selectFaceAddress({
      version: 1,
      modelId: activeModelId,
      plane,
      target: { kind: 'face', address: selection.address },
      additive: selection.additive,
      frame: selection.frame,
    });
    if (!response.ok) {
      setBlobFaceErrorState(response);
      return;
    }
    setBlobSelectedAddress(selection.address);
    setBlobSelectedTriangles(response.selectedTriangles);
  };

  const selectBlobBuildIssue = (selection: BlobExplorerBuildIssueSelection) => {
    if (!activeModelId || selection.source === 'saved') {
      setBlobSnapshotStatus('Saved build issues cannot select the live viewport.');
      return;
    }
    const preview = blobActivePreviewRef.current;
    const plane = selection.source === 'preview'
      ? preview && preview.modelId === activeModelId
        ? { source: 'preview' as const, previewToken: preview.previewToken, expectedSha256: preview.sha256 }
        : null
      : residentBlobPlane();
    if (!plane) return;
    const response = selectFaceAddress({
      version: 1,
      modelId: activeModelId,
      plane,
      target: {
        kind: 'build_issue',
        objectId: selection.issue.objectId,
        sourceGroup: selection.issue.sourceGroup,
      },
      additive: selection.additive,
      frame: selection.frame,
    });
    if (!response.ok) {
      setBlobFaceErrorState(response);
      return;
    }
    setBlobSelectedAddress(null);
    setBlobSelectedTriangles(response.selectedTriangles);
  };

  const captureBlobRecoverySnapshot: BlobExplorerSurfaceProps['onRecoverySnapshot'] = (draft) => {
    if (!activeModelId || blobSnapshotInFlight) return;
    setBlobSnapshotInFlight(true);
    setBlobSnapshotStatus('Capturing the native-resident mesh…');
    setState((current) => ({ ...current, status: 'capturing native-resident recovery snapshot…' }));
    const identity = meshSessionIdentity({ version: 1, modelId: activeModelId });
    if (!identity.ok) {
      setBlobSnapshotInFlight(false);
      setBlobSnapshotStatus(identity.detail);
      setState((current) => ({ ...current, status: `recovery snapshot refused: ${identity.detail}` }));
      return;
    }
    // Exact stable IDs improve the snapshot when available, but panic capture
    // must survive precisely the broken metadata state it exists to rescue.
    // Native capture persists deterministic recovery IDs and typed degradation
    // when this best-effort publication is absent or refused.
    const objectIds = loreSnapshotObjectIds(stateRef.current.modelParts[activeModelId] ?? []);
    if (objectIds) publishSessionObjectIds({
      version: 1,
      modelId: activeModelId,
      sessionToken: identity.sessionToken,
      expectedGeneration: identity.generation,
      ranges: objectIds.map((objectId, rank) => ({ rank, objectId })),
    });
    const response = captureRecoverySnapshotV1({
      version: 1,
      modelId: activeModelId,
      sessionToken: identity.sessionToken,
      expectedGeneration: identity.generation,
      kind: 'panic',
      label: draft.label,
      ...(draft.note ? { note: draft.note } : {}),
      push: false,
    });
    setBlobSnapshotInFlight(false);
    if (!response.ok) {
      setBlobSnapshotStatus(`${response.code}: ${response.detail}`);
      setState((current) => ({ ...current, status: `recovery snapshot failed: ${response.code} — ${response.detail}` }));
      return;
    }
    setBlobSnapshotStatus(`Captured ${response.triangles} tris / ${response.authoredFaces} faces as ${response.snapshotId}.`);
    setState((current) => ({
      ...current,
      status: `recovery snapshot ${response.snapshotId} captured from memory · ${response.triangles} tris · ${response.pushState}`,
    }));
    blobHistoryCursorBackRef.current = [];
    refreshBlobHistory(activeModelId);
  };

  const pageBlobHistory = (cursor: string | null) => {
    if (!activeModelId) return;
    blobHistoryCursorBackRef.current.push(blobHistory.cursor);
    refreshBlobHistory(activeModelId, cursor);
  };

  const previousBlobHistoryPage = () => {
    if (!activeModelId) return;
    const cursor = blobHistoryCursorBackRef.current.pop();
    if (cursor === undefined) return;
    refreshBlobHistory(activeModelId, cursor);
  };

  const pinBlobSnapshot = (row: BlobExplorerStableRowActionV1, pinned: boolean) => {
    if (!activeModelId) return;
    const response = recoveryPinV1({
      version: 1,
      modelId: activeModelId,
      snapshotId: row.snapshotId,
      expectedRevision: row.expectedRevision,
      expectedSha256: row.expectedSha256,
      pinned,
      push: false,
    });
    setBlobSnapshotStatus(response.ok
      ? `${response.pinned ? 'Pinned' : 'Unpinned'} ${response.snapshotId}. Retention remains capped at 60 days.`
      : `${response.code}: ${response.detail}`);
    if (response.ok) refreshBlobHistory(activeModelId, blobHistory.cursor);
  };

  function closeBlobPreview(reason = 'Historical preview closed.', publishUi = true) {
    const active = blobActivePreviewRef.current;
    if (!active) return true;
    const response = releaseHistoricalPreviewPairV1(active);
    if (!response.ok) {
      const detail = `${response.code}: ${response.detail}`;
      if (publishUi) {
        blobPreviewTransitionErrorRef.current = null;
        setBlobSnapshotStatus(detail);
      } else blobPreviewTransitionErrorRef.current = detail;
      return false;
    }
    blobPreviewTransitionErrorRef.current = null;
    blobActivePreviewRef.current = null;
    blobPreviewReleasedDuringTransitionRef.current = !publishUi;
    if (publishUi) {
      setBlobActivePreview(null);
      setBlobFaceQuery((current) => current.source === 'preview'
        ? { ...current, source: 'resident', cursor: null }
        : current);
      setBlobFacePage(null);
      setBlobSelectedAddress(null);
      setBlobSelectedTriangles(null);
      setBlobSnapshotStatus(reason);
    }
    return true;
  }

  const previewBlobSnapshot = (row: BlobExplorerStableRowActionV1) => {
    if (!activeModelId) return;
    if (blobActivePreviewRef.current && !closeBlobPreview('Replacing the prior historical preview…')) return;
    const response = openHistoricalPreviewPairV1({
      version: 1,
      modelId: activeModelId,
      snapshotId: row.snapshotId,
      expectedRevision: row.expectedRevision,
      expectedSha256: row.expectedSha256,
    });
    if (!response.ok) {
      setBlobSnapshotStatus(`${response.code}: ${response.detail}`);
      return;
    }
    const active = response.active;
    blobPreviewReleasedDuringTransitionRef.current = false;
    blobActivePreviewRef.current = active;
    setBlobActivePreview(active);
    setBlobFaceQuery((current) => ({ ...current, source: 'preview', cursor: null }));
    setBlobFacePage(null);
    setBlobSelectedAddress(null);
    setBlobSelectedTriangles(null);
    setBlobSnapshotStatus(`Previewing ${active.snapshotId} read-only · ${active.triangleCount} tris.`);
  };

  const followBlobViewportSelection: NonNullable<BlobExplorerSurfaceProps['onViewportFaceSelection']> = (selection) => {
    if (!selection) {
      setBlobSelectedAddress(null);
      setBlobSelectedTriangles(null);
      return;
    }
    setBlobSelectedAddress((current) => current && faceAddressKey(current) === faceAddressKey(selection.address)
      ? current
      : selection.address);
    setBlobSelectedTriangles(selection.selectedTriangles);
    if (!activeModelId || !blobFacePage || blobFaceQuery.source === 'saved') return;
    if (blobPageContainsAddress(blobFacePage, selection.address)) return;
    const preview = blobActivePreviewRef.current;
    const plane = blobFaceQuery.source === 'preview'
      ? preview && preview.modelId === activeModelId
        ? { source: 'preview' as const, previewToken: preview.previewToken, expectedSha256: preview.sha256 }
        : null
      : residentBlobPlane();
    if (!plane) return;
    const seek = cursorForFaceAddress({
      version: 1,
      modelId: activeModelId,
      plane,
      address: selection.address,
      sort: blobFaceQuery.sort,
      filters: blobFaceQuery.filters,
      limit: blobFaceQuery.limit,
    });
    if (!seek.ok) {
      if (seek.code !== 'address_not_in_query') setBlobFaceErrorState(seek);
      return;
    }
    if (seek.cursor === blobFaceQuery.cursor) return;
    blobFaceCursorBackRef.current.push(blobFaceQuery.cursor);
    setBlobFaceQuery((current) => ({ ...current, cursor: seek.cursor }));
  };

  // One restore authority for both the Recovery pane and Agent Seat. The seat used
  // to expose Lore history but not the transaction that consumes an exact row,
  // forcing recovery automation toward direct package edits. Keep every caller on
  // the same immutable-candidate + resident/package lease path (req_4282).
  const commitBlobSnapshotRestore = (
    modelId: string,
    row: BlobExplorerStableRowActionV1,
  ): SeatShellReceipt => {
    const refused = (reason: string, result?: unknown): SeatShellReceipt => ({
      ok: false,
      reason,
      ...(result === undefined ? {} : { result }),
    });
    if (blobRestoreInFlightRef.current) return refused('another Lore restore is already in flight');

    let cursor: string | undefined;
    let exactHistoryRow = false;
    for (let page = 0; page < 256; page += 1) {
      const history = recoveryHistoryV1({
        version: 1,
        modelId,
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      if (!history.ok) return refused(`${history.code}: ${history.detail}`, history);
      const match = history.rows.find((entry) =>
        !('state' in entry) && entry.snapshotId === row.snapshotId &&
        entry.revision === row.expectedRevision && entry.sha256 === row.expectedSha256);
      if (match && !('state' in match)) {
        if (match.identityQuality !== 'exact' || match.recoveryDegradations.length !== 0 ||
          match.objectNamespaceHash !== row.expectedObjectNamespaceHash)
        {
          return refused('exact Lore history identity differs from the requested restore row');
        }
        exactHistoryRow = true;
        break;
      }
      if (!history.nextCursor) break;
      cursor = history.nextCursor;
    }
    if (!exactHistoryRow) return refused('the requested exact Lore history row is not present');

    const live = stateRef.current;
    const pkg = effectiveModelPackage(modelId, live.modelOverrides, live.modelDupes);
    const service = recoveryStatusV1({ version: 1 });
    const host = globalThis as any;
    if (!pkg || !isMaterialized(pkg.kind, pkg.id) || !service.ok || service.status.state === 'blocked' ||
      activeSessionModelIdRef.current !== modelId || blobActivePreviewRef.current ||
      blobFieldEditInFlightRef.current || typeof host.__lore_restore !== 'function' ||
      typeof host.__model_recovery_transaction !== 'function')
    {
      return refused('exact history identity, on-disk package, idle resident session, and native transaction coordinator are all required');
    }

    const published = publishBlobObjectNamespace(modelId);
    if (!published.ok || published.identityQuality !== 'exact' ||
      published.recoveryDegradations.length !== 0 || published.modelId !== modelId ||
      String(activeSessionTokenRef.current) !== published.sessionToken)
    {
      return refused(published.ok ? 'resident identity is not exact' : published.detail, published);
    }

    blobRestoreInFlightRef.current = true;
    setBlobRestoreInFlight(true);
    let candidateToken: string | null = null;
    try {
      const candidate = recoveryRestoreCandidateV1({
        version: 1,
        operation: 'open_candidate',
        modelId,
        snapshotId: row.snapshotId,
        expectedRevision: row.expectedRevision,
        expectedSha256: row.expectedSha256,
      });
      if (!candidate.ok || !('candidateToken' in candidate)) {
        return refused(candidate.ok ? 'restore candidate receipt was incomplete' : `${candidate.code}: ${candidate.detail}`, candidate);
      }
      candidateToken = candidate.candidateToken;
      if (candidate.identityQuality !== 'exact' || candidate.recoveryDegradations.length !== 0 ||
        candidate.objectNamespaceHash !== row.expectedObjectNamespaceHash ||
        candidate.sha256 !== row.expectedSha256 || candidate.resolvedRevision !== row.expectedRevision)
      {
        return refused('immutable candidate provenance differs from the requested exact history row', candidate);
      }

      const result = restoreModelTransactionV1({
        version: 1,
        operation: 'restore',
        modelId,
        sessionToken: published.sessionToken,
        expectedGeneration: published.generation,
        snapshotId: row.snapshotId,
        resolvedRevision: candidate.resolvedRevision,
        expectedSha256: candidate.sha256,
        expectedObjectNamespaceHash: candidate.objectNamespaceHash,
        candidateToken,
        push: false,
      });
      if (!result.ok) return refused(`${result.code}: ${result.detail}`, result);

      const history = parseModelHistory(host.__mesh_history?.());
      savedMeshDepthRef.current[modelId] = history.undo;
      const committed = loadMaterializedPackages().find((modelPackage) => modelPackage.id === modelId) ?? null;
      blobRestoreProjectionBlockedRef.current = committed ? null : modelId;
      if (committed) upsertSavedPackage(committed);
      if (result.characterBindingInvalidated) {
        try { characterRigApiRef.current?.close(); } catch { /* durable manifest is already needs_bind */ }
        residentModelForRigAttachRef.current = null;
        setCharacterRigSnapshot(null);
      }
      setState((previous) => {
        const next = {
          ...previous,
          modelDirty: { ...previous.modelDirty, [modelId]: false },
          modelDupes: committed
            ? upsertModelPackageProjection(previous.modelDupes, committed)
            : previous.modelDupes,
          status: committed
            ? `Restored ${row.snapshotId} · resident = target = saved ${result.sha256.slice(0, 12)} · Ctrl-Z action ${result.journalActionId}${result.characterBindingInvalidated ? ' · character bind invalidated' : ''}`
            : '⚠ Restore committed exactly, but the editor could not re-read its package projection. Close and reopen this model before further save/export.',
        };
        stateRef.current = next;
        return next;
      });
      setBlobSelectedAddress(null);
      setBlobSelectedTriangles(null);
      setBlobFacePage(null);
      setBlobAnalysisRevision((revision) => revision + 1);
      refreshBlobHistory(modelId);

      const released = recoveryRestoreCandidateV1({
        version: 1,
        operation: 'release_candidate',
        candidateToken,
      });
      candidateToken = null;
      return {
        ok: true,
        result: {
          ...result,
          packageProjectionLoaded: Boolean(committed),
          candidateReleased: released.ok,
          ...(released.ok ? {} : { cleanupWarning: `${released.code}: ${released.detail}` }),
        },
      };
    } finally {
      if (candidateToken) recoveryRestoreCandidateV1({
        version: 1,
        operation: 'release_candidate',
        candidateToken,
      });
      blobRestoreInFlightRef.current = false;
      setBlobRestoreInFlight(false);
    }
  };

  const restoreBlobSnapshot: BlobExplorerSurfaceProps['onRestore'] = (row) => {
    const modelId = activeModelId;
    if (!modelId || blobRestoreInFlightRef.current) return;
    if (recoveryRestoreConfirmationAction(blobRestoreConfirmSnapshotId, row.snapshotId) === 'arm') {
      setBlobRestoreConfirmSnapshotId(row.snapshotId);
      setBlobSnapshotStatus('Restore replaces the resident mesh and saved geometry in one native transaction. It creates exactly one Ctrl-Z action; character skin binding becomes NEEDS BIND. Press CONFIRM RESTORE to continue.');
      return;
    }
    setBlobRestoreConfirmSnapshotId(null);
    setBlobSnapshotStatus('Opening immutable Lore candidate and acquiring the native resident/package write lease…');
    const receipt = commitBlobSnapshotRestore(modelId, row);
    if (!receipt.ok) {
      setBlobSnapshotStatus(`Restore refused: ${receipt.reason ?? 'native restore transaction failed'}.`);
      return;
    }
    const result = receipt.result as any;
    setBlobSnapshotStatus(result.packageProjectionLoaded
      ? `Restore verified: resident, target, and saved SHA ${String(result.sha256).slice(0, 12)} match; all ${result.diff.changedFieldCounts.length} native diff channels are zero. Ctrl-Z restores the prior resident mesh.${result.candidateReleased ? '' : ` Candidate cleanup warning: ${result.cleanupWarning}`}`
      : 'Restore committed, but package projection re-read failed. Close and reopen this model before any save or export; no fallback projection was synthesized.');
  };

  const applyBlobGuardedField: NonNullable<BlobExplorerSurfaceProps['onGuardedFieldApply']> = (edit) => {
    const modelId = activeModelId;
    if (!modelId || blobFieldEditInFlightRef.current) return;
    const refusal = refuseHistoricalPreviewMutation('model_mutation');
    if (refusal) {
      setBlobFieldEditStatus(refusal);
      return;
    }
    const resident = residentBlobPlane();
    const objectNamespaceHash = residentBlobObjectNamespaceHash();
    if (!hasModelFaceFieldEditCoordinatorV1() || !resident || !objectNamespaceHash ||
      activeSessionModelIdRef.current !== modelId || edit.address.stability !== 'stable') {
      setBlobFieldEditStatus('Guarded edit refused: the exact resident model/session/face identity or native coordinator is unavailable.');
      return;
    }

    blobFieldEditInFlightRef.current = true;
    setBlobFieldEditInFlight(true);
    setBlobFieldEditStatus('Validating resident identity, package transaction, and Lore recovery bookends…');
    try {
      const result = applyModelFaceFieldEditV1({
        version: 1,
        operation: 'apply',
        modelId,
        sessionToken: resident.sessionToken,
        expectedGeneration: resident.expectedGeneration,
        expectedObjectNamespaceHash: objectNamespaceHash,
        address: edit.address,
        field: edit.field,
        value: edit.value,
        push: false,
      });
      if (!result.ok) {
        setBlobFieldEditStatus(`${result.code}: ${result.detail}`);
        return;
      }

      const history = parseModelHistory((globalThis as any).__mesh_history?.());
      savedMeshDepthRef.current[modelId] = history.undo;
      const committed = loadMaterializedPackages().find((pkg) => pkg.id === modelId) ?? null;
      if (committed) upsertSavedPackage(committed);
      if (result.characterBindingInvalidated) {
        try { characterRigApiRef.current?.close(); } catch { /* transaction is already durable; reopen will read needs_bind */ }
        setCharacterRigSnapshot(null);
      }
      setState((previous) => {
        const next = {
          ...previous,
          modelDirty: { ...previous.modelDirty, [modelId]: false },
          modelDupes: committed
            ? upsertModelPackageProjection(previous.modelDupes, committed)
            : previous.modelDupes,
          status: `Guarded ${result.field.replace('_', ' ')} edit committed · ${result.triangleCount} tris · undo action ${result.journalActionId}${result.characterBindingInvalidated ? ' · character bind now needs rebuild' : ''}`,
        };
        stateRef.current = next;
        return next;
      });
      setBlobSelectedAddress(null);
      setBlobSelectedTriangles(null);
      setBlobFacePage(null);
      setBlobAnalysisRevision((revision) => revision + 1);
      refreshBlobHistory(modelId);
      setBlobFieldEditStatus(
        `Committed ${result.field.replace('_', ' ')} ${result.before} → ${result.after}; resident and saved SHA ${result.sha256.slice(0, 12)} match.${committed ? '' : ' Package projection refresh failed; reopen the recovery pane before export.'}`,
      );
    } finally {
      blobFieldEditInFlightRef.current = false;
      setBlobFieldEditInFlight(false);
    }
  };

  useEffect(() => {
    const active = blobActivePreviewRef.current;
    if (!active) {
      if (blobPreviewReleasedDuringTransitionRef.current) {
        blobPreviewReleasedDuringTransitionRef.current = false;
        setBlobActivePreview(null);
        setBlobFaceQuery((current) => current.source === 'preview'
          ? { ...current, source: 'resident', cursor: null }
          : current);
        setBlobFacePage(null);
        setBlobSelectedAddress(null);
        setBlobSelectedTriangles(null);
      }
      const transitionError = blobPreviewTransitionErrorRef.current;
      if (transitionError) {
        blobPreviewTransitionErrorRef.current = null;
        setBlobSnapshotStatus(transitionError);
      }
      return;
    }
    if (!blobExplorerOpen || !activeModelId || active.modelId !== activeModelId)
      closeBlobPreview('Historical preview closed before leaving its model recovery pane.');
  }, [blobExplorerOpen, activeModelId]);

  useEffect(() => () => {
    const active = blobActivePreviewRef.current;
    if (!active) return;
    // Component teardown cannot publish React state, but native ownership must
    // still be paired before the host/session disappears.
    releaseHistoricalPreviewPairV1(active);
    blobActivePreviewRef.current = null;
  }, []);

  const blobExplorerProps: BlobExplorerSurfaceProps | undefined = activeModelId ? {
    modelId: activeModelId,
    widthPreset: blobWidthPreset,
    onWidthPreset: setBlobWidthPreset,
    faceQuery: blobFaceQuery,
    facePage: blobFacePage,
    faceError: blobFaceErrorState,
    faceLoading: blobFaceLoading,
    selectedAddress: blobSelectedAddress,
    selectedTriangles: blobSelectedTriangles,
    canPageFacesBackward: blobFaceCursorBackRef.current.length > 0,
    onFaceQueryChange: changeBlobFaceQuery,
    onPreviousFacePage: previousBlobFacePage,
    onSelectFace: selectBlobFace,
    onSelectBuildIssue: selectBlobBuildIssue,
    onViewportFaceSelection: followBlobViewportSelection,
    guardedFieldEditEnabled: hasModelFaceFieldEditCoordinatorV1() && !blobFieldEditInFlight &&
      activeSessionModelIdRef.current === activeModelId && residentBlobPlane() !== null &&
      residentBlobObjectNamespaceHash() !== null,
    guardedFieldEditStatus: blobFieldEditStatus,
    onGuardedFieldApply: applyBlobGuardedField,
    history: blobHistory,
    recoverySnapshotEnabled: blobService.state !== 'blocked' && activeSessionModelIdRef.current === activeModelId,
    recoverySnapshotInFlight: blobSnapshotInFlight,
    recoverySnapshotStatus: blobSnapshotStatus,
    onRecoverySnapshot: captureBlobRecoverySnapshot,
    onHistoryPage: pageBlobHistory,
    canPageHistoryBackward: blobHistoryCursorBackRef.current.length > 0,
    onPreviousHistoryPage: previousBlobHistoryPage,
    onPin: pinBlobSnapshot,
    onPreview: previewBlobSnapshot,
    activePreview: blobActivePreview,
    onClosePreview: () => { closeBlobPreview(); },
    restoreEnabled: activeModelOnDisk && blobService.state !== 'blocked' &&
      !blobRestoreInFlight && !blobFieldEditInFlight && !blobSnapshotInFlight &&
      !blobRestoreProjectionBlockedRef.current &&
      !blobActivePreview && activeSessionModelIdRef.current === activeModelId &&
      residentBlobPlane() !== null && residentBlobObjectNamespaceHash() !== null &&
      typeof (globalThis as any).__lore_restore === 'function' &&
      typeof (globalThis as any).__model_recovery_transaction === 'function',
    restoreConfirmSnapshotId: blobRestoreConfirmSnapshotId,
    onRestore: restoreBlobSnapshot,
    onCopySnapshotId: (snapshotId) => {
      (globalThis as any).__clipboard_set?.(snapshotId);
      setBlobSnapshotStatus(`Copied ${snapshotId}.`);
    },
    service: blobService,
  } : undefined;
  useEffect(() => {
    if (!playing && hasCharacterRigCapability(activeModelPkg)) return;
    try { characterRigApiRef.current?.close(); } catch { /* host teardown is best-effort */ }
    setCharacterRigSnapshot(null);
  }, [playing, activeModelPkg?.id, activeModelPkg?.kind]);
  // Mesh-journal baseline per model: the depth recorded at the last save (reset to
  // 0 on every doc activate — the host journal restarts with the remount). Depth
  // ABOVE the baseline = host-side edits since the last materialize (gizmo, paint,
  // topology and part ops all journal) → the doc is dirty. Rename marks explicitly
  // (names never journal); Save/autosave clear the flag and re-baseline.
  useEffect(() => {
    if (activeModelId) savedMeshDepthRef.current[activeModelId] = 0;
  }, [state.activeWorkspaceDocumentId]);
  const dirtyProbeDocRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeModelId || liveUndoDepths.source !== 'mesh') return;
    // The commit that switches docs still read the OLD viewer's journal (it only
    // unmounts with this same commit). Defer one native read so the incoming
    // session is selected before deciding. Merely skipping this edge stranded a
    // hot-reloaded document clean forever when its next published depth happened
    // to equal the old scalar value.
    if (dirtyProbeDocRef.current !== state.activeWorkspaceDocumentId) {
      const documentId = state.activeWorkspaceDocumentId;
      const modelId = activeModelId;
      dirtyProbeDocRef.current = documentId;
      const timer = setTimeout(() => {
        const current = stateRef.current;
        if (current.activeWorkspaceDocumentId !== documentId || current.modelDirty[modelId]) return;
        const history = parseModelHistory((globalThis as any).__mesh_history?.());
        if (history.undo <= (savedMeshDepthRef.current[modelId] ?? 0)) return;
        setState((prev) => prev.activeWorkspaceDocumentId === documentId && !prev.modelDirty[modelId]
          ? { ...prev, modelDirty: { ...prev.modelDirty, [modelId]: true } }
          : prev);
      }, 0);
      return () => clearTimeout(timer);
    }
    if (liveUndoDepths.undo > (savedMeshDepthRef.current[activeModelId] ?? 0) && !state.modelDirty[activeModelId]) {
      setState((prev) => ({ ...prev, modelDirty: { ...prev.modelDirty, [activeModelId]: true } }));
    }
  }, [liveUndoDepths.undo, liveUndoDepths.source, activeModelId, state.activeWorkspaceDocumentId, state.modelDirty]);

  const archiveCommittedModelSave = (
    pkg: ModelPackage,
    packageDir: string,
    label: string,
  ) => {
    const packageGeometryPath = modelPackageGeometryPath(packageDir, pkg.skeleton);
    const packageGeometrySha256 = String(
      (globalThis as any).__file_sha256?.(packageGeometryPath) ?? '',
    ).trim().toLowerCase();
    return snapshotNormalModelSave({
      saveSucceeded: true,
      modelId: pkg.id,
      activeResidentModelId: activeSessionModelIdRef.current,
      packageGeometryPath,
      packageGeometrySha256,
      label,
      note: 'validated package Save',
    }, issueVerifiedSaveReceiptV1, captureVerifiedNormalSnapshotV1);
  };

  /** The oh-shit route (req_4344): a refused Save cancels navigation and keeps
   * the dirty document mounted, so open the Lore recovery pane beside it — its
   * restore button replaces the resident mesh from the last good backup in one
   * native transaction. Only the visible model owns the pane; a background
   * refusal keeps its own status text instead of hijacking the active view. */
  const saveRefusalRecoveryRoute = (modelId: string): { patch: Partial<EditorState>; suffix: string } =>
    modelId === activeSessionModelIdRef.current
      ? {
        patch: { rightPane: 'recovery', rightPanelCollapsed: false },
        suffix: ' — Lore recovery opened: restore the last good save if the document will not commit',
      }
      : { patch: {}, suffix: '' };

  /** The single model commit path used by File → Save, first-atlas gating,
   * and the close/switch/exit boundary autosaves (req_4344: those boundaries
   * are the ONLY background saves — edits never autosave mid-session). */
  const saveModelDocumentNow = (
    modelId: string | null,
    reason = 'Save',
    intent: ModelSaveIntent = 'explicit',
    allowStalePaintLayout = false,
    keepLiveOptions: PaintLayoutKeepLiveOptions = {},
  ): boolean => {
    if (refuseHistoricalPreviewMutation('save')) return false;
    const current = stateRef.current;
    const pkg = modelId
      ? effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes)
      : null;
    if (!pkg) return false;

    const alreadyOnDisk = isMaterialized(pkg.kind, pkg.id);
    const stalePaintLayout = (globalThis as any).__model_paint_layout_stale?.() === 1;
    const hasRecoverablePaint = alreadyOnDisk
      && (hasStoredModelPaint(pkg) || modelPaintLayoutIsStale(pkg));
    const paintConflictDisk = alreadyOnDisk ? readPaintLayoutDiskFacts(pkg) : null;
    const liveRows = current.modelParts[pkg.id] ?? [];
    const saveAuthority = modelSaveAuthority(intent);
    const structuralSaveOptions = partShrinkSaveOptions(pkg.id, liveRows.length);
    const diskPartCount = paintConflictDisk?.doc?.parts ?? null;
    const partCountConflict = modelRevisionPartConflict(
      liveRows.length,
      diskPartCount,
      saveAuthority.allowLiveDiskPartCountMismatch || structuralSaveOptions.allowPartShrink,
    );
    const paintConflictAckKey = paintLayoutConflictAckHotKey(modelDocSessionId(pkg.kind, pkg.id));
    const paintConflictAcknowledged = paintLayoutConflictRevisionIsAcknowledged(
      getHotState<string | null>(paintConflictAckKey, null),
      paintConflictDisk,
    );
    const paintLayoutConflict = stalePaintLayout && hasRecoverablePaint && !paintConflictAcknowledged;
    const revisionConflictRequiresChoice =
      partCountConflict !== null || (paintLayoutConflict && !saveAuthority.allowStalePaintLayout);
    if (!allowStalePaintLayout && revisionConflictRequiresChoice) {
      if (modelId !== activeSessionModelIdRef.current) {
        setState((prev) => ({
          ...prev,
          status: `Save refused for background model "${pkg.name}" — LIVE/DISK disagree and the choice dialog belongs to the visible document; open its tab to resolve`,
        }));
        return false;
      }
      const opened = modelToolApiRef.current?.openPaintLayoutConflict({
        origin: 'save',
        unsaved: Boolean(current.modelDirty[pkg.id]),
        reason: partCountConflict
          ? partCountConflict
          : { kind: 'paint-layout' },
        remakePaintAfterKeepLive: stalePaintLayout && hasRecoverablePaint,
        keepLive: (options) => saveActiveModelNow(reason, 'explicit', true, options),
        keepDisk: () => discardModelWorkingCopy(pkg.id, `Kept DISK for "${pkg.name}" — live edits and Ctrl+Z history were discarded`),
      }) === true;
      if (opened) {
        setState((prev) => ({
          ...prev,
          openMenu: null,
          actionMenu: 'File',
          status: partCountConflict
            ? `${reason} paused: LIVE has ${liveRows.length} parts and DISK has ${diskPartCount} — choose Keep LIVE or Keep DISK`
            : `${reason} paused: live geometry and saved paint disagree — choose Keep LIVE or Keep DISK`,
        }));
        return false;
      }
    }

    // Characters commit one native revision snapshot: its dense logical remap
    // feeds both immutable RJMD and RJSK, both artifacts are read back, and the
    // manifest lands last. The generic meshdoc writer is deliberately bypassed.
    if (hasCharacterRigCapability(pkg)) {
      let result: ReturnType<typeof materializeCharacterSaveSnapshot>;
      try {
        const prepared = characterRigApiRef.current?.prepareSave();
        if (!prepared) throw new Error('character rig session is not open');
        result = materializeCharacterSaveSnapshot(pkg, prepared, characterRigPartMetadata(
          prepared.descriptor.objectBindings,
          liveRows,
          packageMeshDocParts(pkg) ?? [],
          { name: pkg.name, color: pkg.color },
        ));
      } catch (error) {
        result = {
          ok: false,
          id: pkg.id,
          dir: pkg.path,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const committed = result.package;
      let acknowledgementWarning: string | null = null;
      let recoveryStatus = '';
      if (result.ok && committed) {
        consumeModelSaveAuthorizations(pkg.id);
        upsertSavedPackage(committed);
        const depths = undoDepths(current);
        savedMeshDepthRef.current[pkg.id] = depths.source === 'mesh' ? depths.undo : 0;
        try {
          const refreshed = characterRigApiRef.current?.commitSave(savedCharacterBinding(committed));
          if (refreshed) setCharacterRigSnapshot(refreshed);
        } catch (error) {
          acknowledgementWarning = error instanceof Error ? error.message : String(error);
        }
        recoveryStatus = archiveCommittedModelSave(
          committed,
          result.dir,
          reason,
        ).statusSuffix;
      }
      setState((prev) => {
        const projected = result.ok && committed
          ? projectModelIntoRecentLibrary(prev.modelDupes, prev.recentLibraryKeys ?? [], committed)
          : null;
        const refusal = result.ok ? null : saveRefusalRecoveryRoute(pkg.id);
        return {
          ...prev,
          ...(refusal?.patch ?? {}),
          openMenu: null,
          actionMenu: 'File',
          modelDirty: result.ok ? { ...prev.modelDirty, [pkg.id]: false } : prev.modelDirty,
          modelDupes: projected?.models ?? prev.modelDupes,
          recentLibraryKeys: projected?.recentKeys ?? prev.recentLibraryKeys,
          status: result.ok
            ? `${reason}: character revision committed → ${result.dir}${acknowledgementWarning ? `; resident save percept needs refresh (${acknowledgementWarning})` : ''}${recoveryStatus}`
            : `${reason} failed: ${result.error ?? 'character snapshot was not committed'}${refusal?.suffix ?? ''}`,
        };
      });
      return result.ok;
    }

    const rigDraft = current.modelRigs[pkg.id];
    const textureSlots = current.modelTextureSlots[pkg.id] ?? pkg.textureSlots ?? [];
    const lights = normalizeModelLights(current.modelLights[pkg.id] ?? pkg.lights ?? []);
    const rigModelId = authoredModelIdForPackage(pkg.id);
    const rigBounds = rigDraft ? authoredMeshBounds(rigModelId, pkg.id) : null;
    const pkgToSave: ModelPackage = {
      ...pkg,
      ...(rigDraft && rigBounds ? { skeleton: propRigToSkeleton(rigModelId, rigModelId, rigDraft, rigBounds) } : {}),
      textureSlots,
      lights,
    };
    const preparedSave = prepareOrdinaryModelSaveStage(pkg);
    if (!preparedSave.ok) {
      const refusal = saveRefusalRecoveryRoute(pkg.id);
      setState((prev) => ({
        ...prev,
        ...refusal.patch,
        openMenu: null,
        actionMenu: 'File',
        status: `${reason} failed: ${preparedSave.error}${refusal.suffix}`,
      }));
      return false;
    }
    const saveStage = preparedSave.stage;
    const saveParts = partsMetaFromRows(liveRows);
    const transaction = commitOrdinaryModelSave({
      writeArtifacts: () => writeModelArtifactsAtDirectory(
        saveStage.stagingDir,
        saveParts,
        meshDocPartRangesFromRows(liveRows) ?? undefined,
        {
          ...structuralSaveOptions,
          allowPartShrink: saveAuthority.allowLiveDiskPartCountMismatch
            || keepLiveOptions.allowPartShrink === true
            || structuralSaveOptions.allowPartShrink,
          allowSemanticClear: saveAuthority.allowSemanticClear
            || keepLiveOptions.allowSemanticClear === true
            || structuralSaveOptions.allowSemanticClear,
        },
      ),
      writeManifest: () => materializeModelPackageAtDirectory(pkgToSave, saveStage.stagingDir),
      manifestSucceeded: (manifestResult) => manifestResult.ok,
      installPrepared: () => installOrdinaryModelSaveStage(saveStage, saveParts),
      validateInstalled: () => validateInstalledOrdinaryModelSaveStage(saveStage, saveParts),
      rollbackInstalled: () => rollbackOrdinaryModelSaveStage(saveStage),
      discardPrepared: () => discardOrdinaryModelSaveStage(saveStage),
      acceptInstalled: () => acceptInstalledOrdinaryModelSaveStage(saveStage),
    });
    const artifactsOk = transaction.artifactsCommitted;
    const manifestResult = transaction.manifestResult ?? {
      ok: false,
      id: pkg.id,
      dir: saveStage.targetDir,
      error: meshDocLastWriteFailure() ?? 'model artifacts were not written',
    };
    const ok = transaction.ok;
    const transactionError = !artifactsOk
      ? (meshDocLastWriteFailure() ?? 'model artifacts were not written')
      : !manifestResult.ok
        ? (manifestResult.error ?? 'atomic staged manifest write failed')
        : !transaction.installed
          ? transaction.recoveryRetained
            ? `atomic package install encountered an I/O failure; complete recovery trees were retained at ${saveStage.targetDir} and ${saveStage.stagingDir}`
            : 'atomic package install refused because the target changed'
          : transaction.rolledBack
            ? 'installed package failed read-back validation; the exact prior revision was restored'
            : transaction.recoveryRetained
              ? `installed package failed read-back and rollback; complete recovery trees were retained at ${saveStage.targetDir} and ${saveStage.stagingDir}`
              : 'installed package failed read-back validation';
    let recoveryStatus = '';
    if (ok) {
      consumeModelSaveAuthorizations(pkg.id);
      // Keep LIVE resolves ownership for this in-process editing lineage, not
      // just for one write. Roll the acknowledged disk revision forward after
      // every descendant save; otherwise the newly written checkpoint is offered
      // back as a competing DISK state on the very next edit (req_3901).
      if (saveAuthority.commitsLiveResident || allowStalePaintLayout || paintConflictAcknowledged) {
        setHotState(
          paintConflictAckKey,
          paintLayoutConflictRevision(readPaintLayoutDiskFacts(pkg)),
        );
      }
      // Existing package rows must be replaced too: world/livePush resolves
      // emitted lights and face rigs through MODEL_PACKAGES, so a successful
      // Save has to become live truth immediately, not only after a restart.
      upsertSavedPackage(pkgToSave);
      const depths = undoDepths(current);
      savedMeshDepthRef.current[pkg.id] = depths.source === 'mesh' ? depths.undo : 0;
      recoveryStatus = archiveCommittedModelSave(
        pkgToSave,
        saveStage.targetDir,
        reason,
      ).statusSuffix;
    }
    setState((prev) => {
      const projected = ok
        ? projectModelIntoRecentLibrary(prev.modelDupes, prev.recentLibraryKeys ?? [], pkgToSave)
        : null;
      const refusal = ok ? null : saveRefusalRecoveryRoute(pkg.id);
      return {
        ...prev,
        ...(refusal?.patch ?? {}),
        openMenu: null,
        actionMenu: 'File',
        modelDirty: ok ? { ...prev.modelDirty, [pkg.id]: false } : prev.modelDirty,
        modelDupes: projected?.models ?? prev.modelDupes,
        recentLibraryKeys: projected?.recentKeys ?? prev.recentLibraryKeys,
        status: ok
          ? `${reason}: "${pkg.name}" → ${saveStage.targetDir}${recoveryStatus}`
          : `${reason} failed: ${transactionError}${refusal?.suffix ?? ''}`,
      };
    });
    return ok;
  };

  const saveActiveModelNow = (
    reason?: string,
    intent: ModelSaveIntent = 'explicit',
    allowStalePaintLayout?: boolean,
    keepLiveOptions?: PaintLayoutKeepLiveOptions,
  ): boolean => saveModelDocumentNow(activeSessionModelIdRef.current, reason, intent, allowStalePaintLayout, keepLiveOptions);

  const markModelDirty = (modelId: string) => {
    setModelMutationRevision((revision) => revision + 1);
    const current = stateRef.current;
    if (current.modelDirty[modelId]) return;
    const next = { ...current, modelDirty: { ...current.modelDirty, [modelId]: true } };
    stateRef.current = next;
    setState(next);
  };
  const markActiveModelDirty = () => {
    const modelId = activeSessionModelIdRef.current;
    if (!modelId) return;
    markModelDirty(modelId);

    // Mesh edits happen in the resident native document. Ask the native rig
    // owner to compare its live topology, semantics, object membership, and
    // fitted-shape baseline immediately after each completed mutation. This
    // keeps the inspector and export dialog from holding a stale green result
    // without copying geometry arrays into React state.
    const current = stateRef.current;
    const pkg = effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes);
    const api = characterRigApiRef.current;
    if (!hasCharacterRigCapability(pkg) || !api?.currentSnapshot()) return;
    try {
      setCharacterRigSnapshot(api.snapshot());
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: `Character readiness refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  };

  const assignHumanoidSemantic = (membership: HumanoidSemanticMembership) => {
    const receipt = withNativeMeshActionSource('dock', () =>
      modelToolApiRef.current?.assignHumanoidSemantic(membership) ?? null);
    if (!receipt) {
      setState((prev) => ({ ...prev, status: 'humanoid anatomy assignment is unavailable — restart into the rebuilt editor' }));
      return;
    }
    if (!receipt.applied) {
      setState((prev) => ({ ...prev, status: receipt.reason ?? `no faces changed for ${receipt.roleKey}` }));
      return;
    }
    markActiveModelDirty();
    setState((prev) => ({
      ...prev,
      status: receipt.changed > 0
        ? `assigned ${receipt.changed} selected face${receipt.changed === 1 ? '' : 's'} to ${receipt.roleKey} — display name remains "${receipt.displayName}"`
        : `assigned stable role ${receipt.roleKey} to display region "${receipt.displayName}"`,
    }));
  };

  const publishExternalAutoRigState = (next: ExternalAutoRigUiState) => {
    externalAutoRigStateRef.current = next;
    setExternalAutoRigState(next);
  };

  const runExternalAutoRig = async () => {
    const current = stateRef.current;
    const modelId = activeSessionModelIdRef.current;
    const pkg = modelId ? effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes) : null;
    const api = characterRigApiRef.current;
    const prior = externalAutoRigStateRef.current;
    if (prior.phase === 'running') return;
    if (!modelId || !pkg || !hasCharacterRigCapability(pkg) || !api?.currentSnapshot() ||
        api.currentOpenTarget?.()?.modelId !== modelId) {
      setState((prev) => ({ ...prev, status: 'Auto-Rig needs the visible model to have an open humanoid rig session' }));
      return;
    }
    const roll = prior.modelId === modelId ? prior.roll + 1 : 1;
    publishExternalAutoRigState({ phase: 'running', modelId, roll });
    try {
      // The first roll exports an explicit saved revision. A reroll reuses that
      // immutable geometry and must not accidentally persist the preview it is
      // about to replace.
      if (!(prior.phase === 'preview' && prior.modelId === modelId) &&
          !saveActiveModelNow('Saved before Auto-Rig', 'explicit')) {
        throw new Error('Auto-Rig stopped because the character could not be saved');
      }
      const packageDir = resolvePackageDir(pkg.kind, pkg.id);
      if (!packageDir) throw new Error('Auto-Rig could not resolve the saved character package');
      const liveRows = (stateRef.current.modelParts[modelId] ?? [])
        .slice()
        .sort((left, right) => (left.lo ?? Number.MAX_SAFE_INTEGER) - (right.lo ?? Number.MAX_SAFE_INTEGER));
      if (liveRows.some((part) => part.visible === false)) {
        throw new Error('Auto-Rig needs every character part visible so anatomy stamping is complete');
      }
      const snapshot = api.currentSnapshot();
      if (!snapshot) throw new Error('Auto-Rig lost the native character session');
      const metadata = characterRigPartMetadata(
        snapshot.objectBindings,
        liveRows,
        packageMeshDocParts(pkg) ?? [],
        { name: pkg.name, color: pkg.color },
      );
      const rangeJson = (globalThis as any).__mesh_part_ranges?.();
      const rangeReply = typeof rangeJson === 'string' && rangeJson ? JSON.parse(rangeJson) : null;
      const ranges = Array.isArray(rangeReply?.ranges) ? rangeReply.ranges as [number, number][] : [];
      if (ranges.length !== metadata.length) {
        throw new Error(`Auto-Rig found ${ranges.length} resident part ranges for ${metadata.length} stable character objects`);
      }
      const parts = ranges.map((range, index) => ({
        name: metadata[index]!.name,
        lo: Number(range[0]),
        hi: Number(range[1]),
      }));
      const rig = await requestSkinTokensRig({
        geometryPath: modelPackageGeometryPath(packageDir, pkg.skeleton),
        packageDir,
        roll,
      });
      if (activeSessionModelIdRef.current !== modelId || api.currentOpenTarget?.()?.modelId !== modelId) {
        throw new Error('Auto-Rig finished after the visible model changed; reopen the character and reroll');
      }
      const semanticReceipt = withNativeMeshActionSource('dock', () =>
        stampHumanoidSemanticsFromParts(globalThis as any, parts));
      if (!semanticReceipt) {
        throw new Error('Auto-Rig anatomy stamping is unavailable — restart into the rebuilt editor');
      }
      api.command({
        kind: 'adoptExternalRig',
        partNames: metadata.map((part) => part.name),
        rig,
      });
      const previewSnapshot = api.command({
        kind: 'setOverlay',
        overlay: EXTERNAL_AUTO_RIG_PREVIEW_OVERLAY,
      });
      characterRigSnapshotRef.current = previewSnapshot;
      setCharacterRigSnapshot(previewSnapshot);
      markModelDirty(modelId);
      const preview: ExternalAutoRigUiState = {
        phase: 'preview',
        modelId,
        roll,
        seconds: typeof rig.seconds === 'number' ? rig.seconds : null,
        joints: rig.joints.length,
      };
      publishExternalAutoRigState(preview);
      setState((prev) => ({
        ...prev,
        rightPane: 'rig',
        rightPanelCollapsed: false,
        status: `Auto-Rig roll ${roll}: ${rig.joints.length} joints previewing${semanticReceipt.recognizedParts > 0 ? `; ${semanticReceipt.recognizedParts} named parts stamped into model semantics` : ''} — adjust, Reroll, or Accept`,
      }));
    } catch (error) {
      if (externalAutoRigStateRef.current.phase === 'running' &&
          externalAutoRigStateRef.current.modelId === modelId) publishExternalAutoRigState(IDLE_EXTERNAL_AUTO_RIG);
      setState((prev) => ({ ...prev, status: `Auto-Rig failed: ${error instanceof Error ? error.message : String(error)}` }));
    }
  };

  const acceptExternalAutoRig = () => {
    const preview = externalAutoRigStateRef.current;
    if (preview.phase !== 'preview' || preview.modelId !== activeSessionModelIdRef.current) return;
    if (!saveActiveModelNow('Accepted Auto-Rig', 'explicit')) return;
    publishExternalAutoRigState(IDLE_EXTERNAL_AUTO_RIG);
    setState((prev) => ({
      ...prev,
      status: `Accepted Auto-Rig roll ${preview.roll}: RJSK, rig descriptor, and model semantics committed`,
    }));
  };

  const saveWorldNowAll = (reason = 'Saved'): boolean => {
    const current = stateRef.current;
    const worldOk = flushWorldSave(current.activeMapStem, current.worldPieces, current.objects, current.mapPaint.zones, current.seq, current.worldFacades, current.worldPrefabs, current.worldFlora, current.worldViews);
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

  // Model documents deliberately have NO per-edit autosave (req_4344). A dirty
  // model commits only at real document boundaries: File → Save, doc switch,
  // doc close, and editor exit. Every one of those commits archives a Lore
  // recovery revision, so backups track saves — not the edit stream. The
  // corruption net is the save guard plus Lore restore, not write frequency.

  const activeCommand = commandById(state.activeCommandId);
  const activeObject = selectedObject(state);
  const activeWorkspaceDocument = state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId)
    ?? state.workspaceDocuments[0]!;
  const activeDocumentKind = activeWorkspaceDocument.kind;
  const paintUiActive = activeDocumentKind === 'facade'
    || (activeDocumentKind === 'model' && state.modelTool.paint);
  const contextualLeftPanels = leftPanelsFor(activeDocumentKind, paintUiActive);
  const activeLeftPanel = resolvedPanelId(contextualLeftPanels, state.activeDomain);
  const activeLeftPanelDefinition = contextualLeftPanels.find((pane) => pane.id === activeLeftPanel)!;
  // The Asset Explorer is one pane, so document/tool context changes never
  // project category-specific roots over its remembered tree navigation.
  const effectiveContentFolder = state.contentFolder;
  const catalogAssets = useMemo(() => applyAssetOverrides(ASSETS, state.assetOverrides), [state.assetOverrides]);
  const activeAsset = assetById(state.activeAssetId, state.assetOverrides);
  const contextPanelMode = panelModeFor(state, activeObject);
  const panelMode = tabForContentFolder(effectiveContentFolder) ?? contextPanelMode;

  const filteredAssets = useMemo(() => {
    const needle = state.search.trim().toLowerCase();
    return catalogAssets
      .filter((asset) => assetMatchesContentFolder(asset, effectiveContentFolder))
      .filter((asset) => !needle || assetMatchesLibrarySearch(asset, needle))
      .sort(rankAssets);
  }, [catalogAssets, effectiveContentFolder, state.search]);

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
  // A switch is a transaction across the two persistence owners. The large
  // target painting prepares off-thread while the outgoing world stays visible
  // and read-only; publication is one native ownership handoff.
  const switchMapDocument = async (
    stem: string,
    target: WorldSave,
    verb: 'opened' | 'created',
    name = mapDocumentName(stem),
    outgoingTriangles: number | null = null,
    bypassUnsavedPrompt = false,
    discardOutgoing = false,
    initializePainting: (() => GeneratedMapPaintingInstallation) | null = null,
  ): Promise<void> => {
    if (outgoingTriangles !== null) recordMapDocumentRenderStats(state.activeMapStem, outgoingTriangles);
    if (stem === state.activeMapStem) {
      setState((prev) => ({ ...prev, mapDocumentOpen: false, openMenu: null, status: `${name} is already the active map` }));
      return;
    }
    if (!mapHostLive()) {
      setState((prev) => ({ ...prev, status: 'map switch unavailable — rebuild/run the editor with the game-map host enabled' }));
      return;
    }
    if (mapSwitchPending) {
      setState((prev) => ({ ...prev, status: 'a map switch is already preparing — the current world remains live' }));
      return;
    }

    if (!bypassUnsavedPrompt && !persistenceSettings.autosave && manualWorldDirty) {
      requestUnsavedDecision(
        state.activeMapName,
        () => { if (saveWorldNowAll()) void switchMapDocument(stem, target, verb, name, outgoingTriangles, true, false, initializePainting); },
        () => { void switchMapDocument(stem, target, verb, name, outgoingTriangles, true, true, initializePainting); },
        verb === 'created' ? () => { deleteMapDocument(stem, state.activeMapStem); } : undefined,
      );
      return;
    }

    const outgoingStem = state.activeMapStem;
    const outgoingZones = state.mapPaint.zones;
    if (!discardOutgoing && !flushWorldSave(outgoingStem, state.worldPieces, state.objects, outgoingZones, state.seq, state.worldFacades, state.worldPrefabs, state.worldFlora, state.worldViews)) {
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
    const serial = ++mapSwitchSerialRef.current;
    setMapSwitchPending(true);
    setState((prev) => {
      const mapPaint = prev.mapPaint.active
        ? { ...prev.mapPaint, active: false, texturePickerOpen: false }
        : prev.mapPaint;
      if (mapPaint !== prev.mapPaint) applyMapPaintEffects(prev.mapPaint, mapPaint);
      return {
        ...prev,
        mapPaint,
        mapDocumentOpen: false,
        openMenu: null,
        status: `opening ${name} — current map is read-only while terrain prepares`,
      };
    });

    try {
      const activation = await activateMapDocumentPaintingAsync(stem, target.zones);
      if (!activation.ok) {
        const rollback = activation.replaced
          ? await activateMapDocumentPaintingAsync(outgoingStem, outgoingZones)
          : null;
        if (!activation.replaced) setMapDocumentAutosave(persistenceSettings.autosave);
        const restored = rollback === null || rollback.ok;
        const cleanup = verb === 'created' && restored ? deleteMapDocument(stem, outgoingStem) : null;
        setState((prev) => ({
          ...prev,
          status: `map switch refused — ${activation.error}${restored ? '; current map retained' : `; WARNING: current map reload also failed (${rollback && !rollback.ok ? rollback.error : 'unknown error'})`}${cleanup && !cleanup.ok ? `; incomplete map cleanup failed (${cleanup.error})` : ''}`,
        }));
        return;
      }

      const initialized = initializePainting?.() ?? null;
      if (initialized && !initialized.ok) {
        const rollback = await activateMapDocumentPaintingAsync(outgoingStem, outgoingZones);
        const cleanup = verb === 'created' && rollback.ok ? deleteMapDocument(stem, outgoingStem) : null;
        setState((prev) => ({
          ...prev,
          status: `map generation stopped — ${initialized.error}${rollback.ok ? '; current map restored' : `; WARNING: current map reload also failed (${rollback.error})`}${cleanup && !cleanup.ok ? `; incomplete map cleanup failed (${cleanup.error})` : ''}`,
        }));
        return;
      }

      if (!saveWorldNow(target) || !setActiveMapDocumentStem(stem)) {
        const rollback = await activateMapDocumentPaintingAsync(outgoingStem, outgoingZones);
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
          : `${activation.chunks} chunks, ${target.pieces.length} placed piece${target.pieces.length === 1 ? '' : 's'}`;
      skipNextWorldDirtyRef.current = true;
      setState((prev) => ({
        ...prev,
        ...mapAuthoringSlicesFor(prev, stem, target, bindings, name),
        openMenu: null,
        actionMenu: 'File',
        status: `${verb} map ${name} — ${contentSummary}; all map authoring switched together`,
      }));
      setManualWorldDirty(false);
    } catch (error) {
      setMapDocumentAutosave(persistenceSettings.autosave);
      setState((prev) => ({ ...prev, status: `map switch failed — ${(error as Error).message}; current map retained` }));
    } finally {
      if (mapSwitchSerialRef.current === serial) setMapSwitchPending(false);
    }
  };

  const openMapDocument = (stem: string, currentTriangles: number | null = null) => {
    const result = readWorldSave(stem);
    if (result.status === 'invalid') {
      setState((prev) => ({ ...prev, status: `cannot open ${stem} — ${result.error}; current map left untouched` }));
      return;
    }
    const target = result.save ?? emptyWorldSave(stem, state.seq);
    void switchMapDocument(stem, target, 'opened', mapDocumentName(stem), currentTriangles);
  };

  const createNewMap = (rawName = 'untitled', currentTriangles: number | null = null) => {
    let stem: string;
    try {
      stem = createMapDocument(rawName);
    } catch (error) {
      setState((prev) => ({ ...prev, status: `could not create map — ${(error as Error).message}; current map left untouched` }));
      return;
    }
    void switchMapDocument(stem, emptyWorldSave(stem, state.seq), 'created', mapDocumentName(stem), currentTriangles);
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

    void switchMapDocument(
      stem,
      target,
      'created',
      mapDocumentName(stem),
      currentTriangles,
      false,
      false,
      () => installGeneratedMapDocumentPainting(stem, target.zones, painting),
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
  const nameSelectionSourceRef = useRef('dock');
  const pathArraySourceRef = useRef('dock');
  const addPartSourceRef = useRef('dock');
  // The live semantic table's names — the dialog's reuse chips. Read straight off
  // the resident door; an unreadable/absent table is just "no chips yet".
  const residentRegionNames = (): string[] => {
    try {
      const state = JSON.parse(String((globalThis as any).__mesh_semantic_state?.() ?? 'null'));
      const table = parseMeshSemanticTable(state?.table);
      if (!table) return [];
      return [...table.regions, ...(table.edgeRegions ?? [])]
        .map((region) => String(region?.name ?? ''))
        .filter((name) => name.length > 0)
        .sort();
    } catch { return []; }
  };
  const applyNameSelection = (name: string, role: MeshEdgeSemanticRole) => {
    const edge = state.modelTool.selMode === 2;
    const objectId = state.modelActivePartId;
    if (edge && !objectId) {
      setState((prev) => ({ ...prev, status: 'edge naming needs one active Outliner owner' }));
      return;
    }
    const request = edge
      ? { kind: 'edge' as const, name, role, objectId: objectId! }
      : { kind: 'face' as const, name };
    const result = withNativeMeshActionSource(nameSelectionSourceRef.current, () => modelToolApiRef.current?.nameSelection(request));
    setNameSelectionOpen(false);
    setState((prev) => ({
      ...prev,
      contextOpen: false,
      openMenu: null,
      status: result == null
        ? edge
          ? 'edge naming refused — select one connected, non-branching edge chain or loop in one Outliner part'
          : 'semantic naming is unavailable — restart into the rebuilt editor'
        : result.changed > 0
          ? result.kind === 'edge'
            ? `named ${result.changed}-edge ${result.closed ? 'loop' : 'chain'} "${name}" (${result.role}) — save to make it durable`
            : `named ${result.changed} faces "${name}" — save to make it durable`
          : `select one or more ${edge ? 'edges' : 'faces'} before naming`,
    }));
    if ((result?.changed ?? 0) > 0) markActiveModelDirty();
  };
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

  const rigUndoRedo = (redo: boolean) => {
    const verb = redo ? 'redo' : 'undo';
    const api = characterRigApiRef.current;
    if (!characterRigHistoryActive || !api) {
      setState((prev) => ({ ...prev, status: `nothing to ${verb} in character rig history` }));
      return;
    }
    try {
      const restored = redo ? api.redo() : api.undo();
      setCharacterRigSnapshot(restored);
      const modelId = api.currentOpenTarget?.()?.modelId ?? activeModelId;
      if (modelId) markModelDirty(modelId);
      setState((prev) => ({
        ...prev,
        openMenu: null,
        status: `${verb} character rig edit — ${redo ? restored.history.redoDepth : restored.history.undoDepth} ${verb} step${(redo ? restored.history.redoDepth : restored.history.undoDepth) === 1 ? '' : 's'} remain`,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: `character rig ${verb} failed: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  };

  const runCommand = (commandId: string, source: string) => {
    const previewCommand = commandById(commandId);
    const previewAction: HistoricalPreviewUiActionV1 | null = commandId === 'save-snapshot'
      ? 'save'
      : commandId.startsWith('export-')
        ? 'export'
        : previewCommand?.scope === 'model' && commandId !== 'select-tool'
          ? 'model_mutation'
          : null;
    if (previewAction && refuseHistoricalPreviewMutation(previewAction)) return;
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
    // Knowledge is intentionally outside the editor's generic save/undo
    // machinery. Ctrl+S opens its exact patch review; it can never inherit the
    // world snapshot writer just because Save is a global command.
    if (activeSurface(stateRef.current) === 'knowledge') {
      if (commandId === 'save-snapshot') {
        const reviewing = worldBibleController.reviewSelected();
        setState((prev) => ({ ...prev, openMenu: null, status: reviewing ? 'Ready for review' : 'No changes to review' }));
        return;
      }
      if (commandId === 'undo-local' || commandId === 'redo-local') {
        setState((prev) => ({ ...prev, openMenu: null, status: 'Undo and redo are unavailable here' }));
        return;
      }
    }
    if (commandId === 'new-map') {
      createNewMap('untitled');
      return;
    }
    if (commandId === 'create-prefab') {
      const current = stateRef.current;
      const selected = current.selectedPieceIds.filter((id) => current.worldPieces.some((piece) => piece.id === id));
      if (selected.length === 0) {
        setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: 'select one or more world pieces before creating a prefab' }));
      } else {
        setPrefabCaptureOpen(true);
        setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: `name this ${selected.length}-piece prefab` }));
      }
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
      addPart(kind, source);
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
    // Shift+M — assign the face selection to a UV mask zone. Zones are allocated in
    // order; this is the mask alternative to merging faces for a clean UV (req_4152).
    if (commandId === 'mesh-uv-zone') {
      const assigned = withNativeMeshActionSource(source, () => modelToolApiRef.current?.assignUvZone(nextUvZoneRef.current) ?? false);
      const zone = nextUvZoneRef.current;
      if (assigned) nextUvZoneRef.current += 1;
      setState((prev) => ({
        ...prev,
        contextOpen: false,
        openMenu: null,
        status: assigned
          ? `UV mask zone ${zone} — those faces now unfold as ONE chart; the mesh is untouched`
          : 'UV mask zone needs a face selection in Face mode',
      }));
      return;
    }
    if (commandId === 'mesh-tris-to-quads') { runFaceOp('tris-to-quads', source); return; }
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
    if (commandId === 'mesh-align-loop') {
      const axis = withNativeMeshActionSource(source, () => modelToolApiRef.current?.alignLoop() ?? -1);
      setState((prev) => ({
        ...prev,
        contextOpen: false,
        openMenu: null,
        status: axis >= 0 && axis <= 2
          ? `aligned selected loop on ${'XYZ'[axis]} at its center — one Undo${state.modelTool.mirror ? ', mirrored' : ''}`
          : 'align loop: select a skewed vertex row or at least two connected loop edges',
      }));
      return;
    }
    if (commandId === 'mesh-name-selection') {
      if (state.modelTool.selMode !== 2 && state.modelTool.selMode !== 3) {
        setState((prev) => ({ ...prev, status: 'Name Selection works in Edge or Face mode' }));
        return;
      }
      nameSelectionSourceRef.current = source;
      setNameSelectionOpen(true);
      setState((prev) => ({ ...prev, contextOpen: false, openMenu: null, status: `Name Faces opened — ${source}` }));
      return;
    }
    if (commandId === 'mesh-select-uv-orientation') {
      const count = withNativeMeshActionSource(source, () => modelToolApiRef.current?.selectUvOrientation() ?? 0);
      setState((prev) => ({
        ...prev,
        status: count > 0
          ? `collected ${count} same-orientation faces and their UV islands`
          : 'select one face before collecting its UV orientation',
      }));
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
        if (commandId === 'mesh-view') api.selMode(0);
        else if (commandId === 'mesh-vertex') api.selMode(1);
        else if (commandId === 'mesh-edge') api.selMode(2);
        else if (commandId === 'mesh-face') api.selMode(3);
        else if (commandId === 'mesh-move') api.gizmo(0);
        else if (commandId === 'mesh-scale') api.gizmo(1);
        else if (commandId === 'mesh-rotate') api.gizmo(2);
        else if (commandId === 'mesh-paint') api.paint();
        else if (commandId === 'mesh-path-plane') api.pathPlane();
        else if (commandId === 'mesh-path-edges') api.pathEdges();
        else if (commandId === 'mesh-curve-pull') api.curvePull();
        else if (commandId === 'mesh-focus') api.focus();
        else if (commandId === 'mesh-wire') api.wire();
        else if (commandId === 'mesh-measurements') api.measurements();
        else if (commandId === 'mesh-player-scale') api.playerScale();
        else if (commandId === 'mesh-xray') api.xray();
        else if (commandId === 'mesh-persistent-additive') api.persistentAdditive();
        else if (commandId === 'mesh-cam-lock') api.camLock();
        else if (commandId === 'mesh-cam-store') api.camStore();
        else if (commandId === 'mesh-cam-recall') api.camRecall();
        else if (commandId === 'mesh-sym-x') api.toggleMirror(0);
        else if (commandId === 'mesh-sym-y') api.toggleMirror(1);
        else if (commandId === 'mesh-sym-z') api.toggleMirror(2);
        else if (commandId === 'mesh-extrude') (state.modelTool.selMode === 3 ? api.extrudeFace() : api.extrudeEdge());
        else if (commandId === 'mesh-extrude-face') api.extrudeFace();
        else if (commandId === 'mesh-face-polygon') api.facePolygon();
        else if (commandId === 'mesh-create-face') api.createFace();
        else if (commandId === 'mesh-invert') api.invertSelection();
        else if (commandId === 'mesh-weld') api.weld();
        else if (commandId === 'mesh-bevel') api.bevel();
        else if (commandId === 'mesh-loopcut') api.loopCut();
        else if (commandId === 'mesh-cut') api.basicCut();
        else if (commandId === 'mesh-paint-fill') api.brushTool('fill');
        else if (commandId === 'mesh-paint-brush') api.brushTool('brush');
        else if (commandId === 'mesh-paint-pen') api.brushTool('pen');
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
          if (current.selectedPieceIds.length > 1) duplicateSelectedPieces();
          else if (current.selectedPieceId) copyPiece(current.selectedPieceId);
          else setState((prev) => ({ ...prev, status: 'select a placed piece to copy' }));
          return;
        }
        if (command.id === 'delete-selection' || command.id === WORLD_PIECE_DELETE_COMMAND_ID) {
          if (current.selectedPieceIds.length > 1) {
            const ids = new Set(current.selectedPieceIds);
            setState((prev) => recordWorldEdit(prev, {
              ...prev,
              worldPieces: prev.worldPieces.filter((piece) => !ids.has(piece.id)),
              selectedPieceId: null,
              selectedPieceIds: [],
              contextOpen: false,
              status: `deleted ${ids.size} selected pieces`,
            }, `delete ${ids.size} pieces`));
            return;
          }
          invokeApplicationCommand(WORLD_PIECE_DELETE_COMMAND_ID, {
            documentId: current.activeMapStem,
            pieceId: current.selectedPieceId ?? '',
          }, source);
          return;
        }
        if (current.selectedPieceId) {
          if (current.selectedPieceIds.length > 1) {
            const ids = new Set(current.selectedPieceIds);
            setState((prev) => recordWorldEdit(prev, {
              ...prev,
              worldPieces: rotatePieceSelection(prev.worldPieces, [...ids], current.selectedPieceId, 1),
              contextOpen: false,
              status: `rotated ${ids.size} selected pieces 90° as one unit`,
            }, `rotate ${ids.size} pieces`));
            return;
          }
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
        if (characterRigHistoryActive) { rigUndoRedo(false); return; }
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
        if (characterRigHistoryActive) { rigUndoRedo(true); return; }
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
      saveActiveModelNow('Saved', 'explicit');
      return;
    }
    if (command.id.startsWith('export-build-piece-') || command.id.startsWith('export-prop') || command.id.startsWith('export-flora-')) {
      // Export → Build Piece → <kind> (req_2583) / Export → Prop (req_2712):
      // register the OPEN model as a placeable and arm it. THE MANIFEST IS THE
      // RECORD (USER RULING req_2718): the export writes `placeable` (+ the
      // compiled RIG skeleton for props) into the model's own package on disk,
      // and every boot re-derives the palette from that scan — localstore only
      // caches. The status ALWAYS reports — a silent no-op is what made this
      // feel dead before.
      const floraLane: FloraLane | null = command.id.startsWith('export-flora-')
        ? command.id.slice('export-flora-'.length) as FloraLane
        : null;
      const propTarget = floraLane ? null : propExportTargetForCommand(command.id);
      const exportTarget = propTarget
        ? null
        : buildPieceExportTarget(command.id.slice('export-build-piece-'.length));
      const kind: PlaceableKind | null = propTarget ? 'prop' : (exportTarget?.kind ?? null);
      if (!kind && !floraLane) {
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
      const docWritten = saveLiveModelBeforeExport((request) => saveModelDocumentNow(
        pkg.id,
        request.reason,
        request.intent,
      ));
      if (!docWritten) {
        setState((prev) => ({ ...prev, openMenu: null, actionMenu: 'File', status: 'Export stopped: the explicit model save did not commit the live resident.' }));
        return;
      }
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
      const placeable: ModelPlaceable = floraLane
        ? { as: 'flora', lane: floraLane }
        : kind === 'prop'
          ? { as: 'prop', role: propTarget?.role ?? 'scenery' }
          : { as: 'build-piece', kind: kind!, ...(exportTarget?.edit ? { edit: exportTarget.edit } : {}) };
      const bounds = authoredMeshBounds(modelId, pkg.id);
      const rig = state.modelRigs[pkg.id] ?? (pkg.skeleton ? skeletonToPropRig(pkg.skeleton) : {});
      const skeleton = kind === 'prop' && bounds ? propRigToSkeleton(modelId, modelId, rig, bounds) : pkg.skeleton;
      const textureSlots = state.modelTextureSlots[pkg.id] ?? pkg.textureSlots ?? [];
      const lights = normalizeModelLights(state.modelLights[pkg.id] ?? pkg.lights ?? []);
      const pkgExported: ModelPackage = { ...pkg, placeable, skeleton, textureSlots, lights };
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
        disk = updateManifestPlaceable(pkg.kind, pkg.id, { placeable, skeleton, textureSlots, lights })
          ? 'manifest updated'
          : 'MANIFEST WRITE FAILED — export is session-only';
      }
      upsertSavedPackage(pkgExported); // the live roster carries the declaration this session
      if (floraLane) {
        const species: AuthoredFloraSpecies = {
          id: authoredFloraIdFor(modelId),
          modelId,
          pkgId: pkg.id,
          label: pkg.name,
          lane: floraLane,
          hex: pkg.color,
        };
        const armedMapPaint = {
          ...stateRef.current.mapPaint,
          active: true,
          channel: 'flora' as const,
          mode: 'paint' as const,
          floraSpeciesId: species.id,
        };
        const hostPaintPatch = applyMapPaintEffects(stateRef.current.mapPaint, armedMapPaint) ?? {};
        setState((prev) => ({
          ...prev,
          openMenu: null,
          actionMenu: 'Build',
          authoredBuildPieces: prev.authoredBuildPieces.filter((entry) => entry.pkgId !== pkg.id),
          authoredFloraSpecies: [...prev.authoredFloraSpecies.filter((entry) => entry.pkgId !== pkg.id), species],
          modelDupes: prev.modelDupes.some((model) => model.id === pkg.id)
            ? prev.modelDupes.map((model) => model.id === pkg.id ? pkgExported : model)
            : firstMaterialize ? [...prev.modelDupes, pkgExported] : prev.modelDupes,
          mapPaint: { ...armedMapPaint, ...hostPaintPatch },
          status: vcount > 0
            ? `Exported "${pkg.name}" as ${floraLane} flora (${vcount} verts) — ${disk}. Flora brush armed.`
            : `Exported "${pkg.name}" as ${floraLane} flora, but its geometry is unreachable (0 verts). Save the model and retry.`,
        }));
        return;
      }
      if (!kind) return;
      const piece: AuthoredBuildPiece = {
        id: authoredIdFor(modelId, kind), modelId, pkgId: pkg.id, label: pkg.name, kind, hex: pkg.color,
        ...(exportTarget?.edit ? { edit: exportTarget.edit } : {}),
        ...(propTarget ? { propRole: propTarget.role } : {}),
        ...(textureSlots.length > 0 ? { textureSlots } : {}),
      };
      // Export arms the CURRENT base atlas — exactly the look visible in Studio.
      // Stored paintings remain separate stable variants in the palette and can
      // be armed deliberately; they never silently replace the current look.
      const armedPieceId = preferredAuthoredPaletteId(piece);
      const kindLabel = kind === 'prop'
        ? `${propTarget?.label ?? 'Scenery Prop'} [${describePropRig(rig)}]`
        : `${exportTarget?.label ?? kind} build piece`;
      setState((prev) => ({
        ...prev,
        openMenu: null,
        actionMenu: 'Build',
        authoredBuildPieces: [...prev.authoredBuildPieces.filter((p) => p.id !== piece.id), piece],
        authoredFloraSpecies: prev.authoredFloraSpecies.filter((entry) => entry.pkgId !== pkg.id),
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
      selectNativeModelSession(PLAYTEST_DOCUMENT);
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
      selectNativeModelSession(ANIMATION_DOCUMENT);
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

    if (command.id === 'open-color-studio') {
      const current = stateRef.current;
      selectNativeModelSession(materialDocument(assetById(current.activeAssetId, current.assetOverrides)));
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

      if (command.id === 'world-view-store') {
        const pose = liveIsoPose();
        if (!pose) {
          next = { ...next, status: 'no world view to store yet — move the camera once first' };
        } else {
          const result = storeWorldView(prev.worldViews, worldViewPoseFrom(pose, prev.floorIndex), () => `view-${prev.seq}`);
          next = result.stored === null
            ? { ...next, status: `saved views are full (${WORLD_VIEW_LIMITS.maxViews}) — remove one first` }
            : {
              ...next,
              worldViews: result.views,
              activeWorldViewId: result.stored.id,
              status: `stored ${result.stored.name} — H recalls it, or click its pin on the map (M)`,
            };
        }
      } else if (command.id === 'world-view-recall') {
        const view = activeWorldView(prev.worldViews, prev.activeWorldViewId);
        if (!view) {
          next = { ...next, status: 'no saved views on this map yet — Store View pins where you are' };
        } else {
          next = {
            ...next,
            activeWorldViewId: view.id,
            floorIndex: view.floor,
            worldViewRecallNonce: prev.worldViewRecallNonce + 1,
            status: `recalled ${view.name}`,
          };
        }
      } else if (command.id === 'toggle-minimap') {
        const mapOverviewOpen = !prev.mapOverviewOpen;
        next = {
          ...next,
          mapOverviewOpen,
          status: mapOverviewOpen
            ? 'linked 2D city map — drag to pan, wheel to zoom, right-click to move the 3D camera'
            : 'returned to the 3D world view',
        };
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
  const WORLD_UNDO_KEYS = ['worldPieces', 'worldFlora', 'worldPrefabs', 'objects', 'authoredBuildPieces', 'authoredFloraSpecies', 'selectedPieceId', 'selectedPieceIds', 'selectedObjectId', 'armedPieceId'] as const;
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
    setState((prev) => {
      // Picking from a quick collection keeps the collection open; ordinary
      // tree/gallery selection navigates to and remembers the real folder.
      const inCollection = prev.contentFolder === 'materials-favorites' || prev.contentFolder === 'materials-recent';
      const destination = inCollection ? prev.contentFolder : folderForAsset(asset);
      return {
        ...prev,
        activeAssetId: asset.id,
        activeTab: asset.tab,
        contentFolder: destination,
        libraryCollectionReturnFolder: inCollection ? prev.libraryCollectionReturnFolder : destination,
        recentLibraryKeys: rememberRecentLibraryItem(prev.recentLibraryKeys ?? [], `asset:${asset.id}`),
        status: `selected ${asset.name} - context preserved`,
      };
    });
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
        libraryCollectionReturnFolder: folderForAsset(assetById(object.assetId, prev.assetOverrides)),
        recentLibraryKeys: rememberRecentLibraryItem(prev.recentLibraryKeys ?? [], `asset:${object.assetId}`),
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
      && (piece.floor ?? 0) === floor
      && (piece.scale ?? 1) === (destination.scale ?? piece.scale ?? 1);
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
        // The gizmo's scale rides the move transform (req_3367); an absent scale
        // keeps the piece's current one (planPieceMove never resets it).
        ...(destination.scale !== undefined ? { scale: destination.scale } : {}),
      },
    }, 'viewport');
  };

  const selectPiece = (id: string | null, intent: PieceSelectionIntent = 'replace') => {
    setState((prev) => {
      // A modifier miss preserves the set being built; a plain miss clears it.
      if (!id && intent !== 'replace') return prev;
      if (!id) return {
        ...prev,
        selectedPieceId: null,
        selectedPieceIds: [],
        status: 'cleared world selection',
      };
      if (intent === 'toggle') {
        const wasSelected = prev.selectedPieceIds.includes(id);
        const selectedPieceIds = wasSelected
          ? prev.selectedPieceIds.filter((selectedId) => selectedId !== id)
          : [...prev.selectedPieceIds, id];
        return {
          ...prev,
          selectedPieceId: wasSelected ? selectedPieceIds[selectedPieceIds.length - 1] ?? null : id,
          selectedPieceIds,
          status: `${wasSelected ? 'removed' : 'added'} ${prev.worldPieces.find((piece) => piece.id === id)?.pieceId ?? id} · ${selectedPieceIds.length} piece${selectedPieceIds.length === 1 ? '' : 's'}`,
        };
      }
      const selectedPieceIds = intent === 'connected' ? connectedPieceIds(prev.worldPieces, id) : [id];
      return {
        ...prev,
        selectedPieceId: id,
        selectedPieceIds,
        status: intent === 'connected'
          ? `selected touching component · ${selectedPieceIds.length} piece${selectedPieceIds.length === 1 ? '' : 's'}`
          : `selected ${prev.worldPieces.find((piece) => piece.id === id)?.pieceId ?? id}`,
      };
    });
  };

  const paintWorldFlora = (samples: readonly FloraPaintSample[], brush: WorldFloraBrush) => {
    if (!samples.length) return;
    setState((prev) => {
      const result = applyFloraPaintSamples(prev.worldPieces, prev.worldFlora, samples, brush, prev.seq);
      if (result.added === 0 && result.removed === 0) return { ...prev, status: 'flora stroke changed nothing' };
      return recordWorldEdit(prev, {
        ...prev,
        seq: result.sequence,
        worldPieces: result.pieces,
        worldFlora: result.worldFlora,
        status: brush.mode === 'erase'
          ? `erased ${result.removed} flora patch${result.removed === 1 ? '' : 'es'}`
          : `painted ${result.added} flora patch${result.added === 1 ? '' : 'es'} at ${Math.round(brush.density * 100)}% density`,
      }, `${brush.mode} flora`);
    });
  };

  const captureSelectedPrefab = (label: string) => {
    setPrefabCaptureOpen(false);
    setState((prev) => {
      const selected = prev.worldPieces.filter((piece) => prev.selectedPieceIds.includes(piece.id));
      if (selected.length === 0) return { ...prev, status: 'prefab capture cancelled — the selection disappeared' };
      try {
        const id = mintWorldPrefabId(label, prev.worldPrefabs);
        const prefab = prefabFromPieces(id, label, selected);
        return recordWorldEdit(prev, {
          ...prev,
          worldPrefabs: [...prev.worldPrefabs, prefab],
          armedPieceId: prefab.id,
          armedYawDegrees: 0,
          armedStamp: null,
          activeCommandId: 'place-piece',
          actionMenu: 'Build',
          contextOpen: false,
          status: `created prefab “${prefab.label}” from ${prefab.pieces.length} semantic pieces — armed to stamp`,
        }, `create prefab ${prefab.label}`);
      } catch (error) {
        return { ...prev, status: `prefab capture failed: ${(error as Error).message}` };
      }
    });
  };

  // ── Saved camera views (req_4168) ──────────────────────────────────────────
  // A 25×25-chunk map is 3 km on a side; returning to the block you were working
  // on has to be a jump. Store (the View menu verb) pins the whole authoring
  // context; recall restores it INCLUDING the storey, because landing a floor off
  // is the miss the pin exists to prevent. The list lives in world.json, so the
  // map you come back to next week still knows where you were standing.
  const recallWorldViewById = (id: string) => {
    setState((prev) => {
      const view = prev.worldViews.find((candidate) => candidate.id === id);
      if (!view) return prev;
      return {
        ...prev,
        activeWorldViewId: view.id,
        floorIndex: view.floor,
        worldViewRecallNonce: prev.worldViewRecallNonce + 1,
        status: `recalled ${view.name}`,
      };
    });
  };

  const removeWorldViewById = (id: string) => {
    setState((prev) => {
      const view = prev.worldViews.find((candidate) => candidate.id === id);
      if (!view) return prev;
      return {
        ...prev,
        worldViews: removeWorldView(prev.worldViews, id),
        activeWorldViewId: prev.activeWorldViewId === id ? null : prev.activeWorldViewId,
        status: `removed ${view.name}`,
      };
    });
  };

  const renameWorldViewById = (id: string, name: string) => {
    setState((prev) => ({ ...prev, worldViews: renameWorldView(prev.worldViews, id, name) }));
  };

  // Bare 1..9 on the world surface (req_4172): jump straight to the Nth pin. A
  // slot past the end of the list is a no-op with a readout, not a silent miss —
  // pressing 5 with four views saved should say so.
  const recallWorldViewSlot = (slot: number) => {
    const view = stateRef.current.worldViews[slot - 1];
    if (!view) {
      setState((prev) => ({ ...prev, status: `no view in slot ${slot} — ${prev.worldViews.length} saved on this map` }));
      return;
    }
    recallWorldViewById(view.id);
  };

  const storeWorldViewNow = () => runCommand('world-view-store', 'panel');

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

  const attachCharacterRig = (pkgId: string): ModelPackage | null => {
    const current = stateRef.current;
    const pkg = effectiveModelPackage(pkgId, current.modelOverrides, current.modelDupes);
    if (!pkg) return null;
    const objectIds = (current.modelParts[pkg.id] ?? [])
      .slice()
      .sort((left, right) => (left.lo ?? Number.MAX_SAFE_INTEGER) - (right.lo ?? Number.MAX_SAFE_INTEGER))
      .map((part) => part.id);
    const bodyRow = objectIds.length === 0
      ? characterRigBodyPartRow(
          pkg.id,
          pkg,
          pkg.primitive
            ? { kind: pkg.primitive, mesh: primitivePartMesh(pkg.primitive) }
            : pkg.viewerPath && isViewerFile(pkg.viewerPath)
              ? { sourcePath: pkg.viewerPath }
              : {},
        )
      : null;
    if (bodyRow) objectIds.push(bodyRow.id);
    try {
      const activeDocument = current.workspaceDocuments.find((document) =>
        document.id === current.activeWorkspaceDocumentId);
      const resident = residentModelForRigAttachRef.current;
      if (activeDocument?.kind !== 'model' || activeDocument.sourceId !== pkg.id ||
          !resident || resident.documentId !== activeDocument.id || resident.modelId !== pkg.id) {
        throw new Error('the visible model has not finished native adoption; its ordinary mesh remains unchanged and saveable');
      }
      const established = establishCharacterRigCapability({
        package: pkg,
        orderedObjectIds: objectIds,
        resident,
        expectedLifecycleId: rigAttachResidentLifecycleId,
        packagePath: characterRigPackagePath(pkg),
        open: (payload) => characterRigApiRef.current!.open(payload),
      });
      const attached = established.package;
      setCharacterRigSnapshot(established.snapshot);
      setState((prev) => ({
        ...prev,
        modelDupes: prev.modelDupes.some((model) => model.id === attached.id)
          ? prev.modelDupes.map((model) => model.id === attached.id ? attached : model)
          : [...prev.modelDupes, attached],
        // Explicitly opting an unpartitioned resident mesh into rigging gives it
        // one durable body object with the exact id authored into the descriptor.
        // ModelView keeps the same key across this projection change, so live
        // host edits are not replaced by the file/primitive seed.
        ...(bodyRow ? {
          modelParts: { ...prev.modelParts, [attached.id]: [bodyRow] },
          modelActivePartId: bodyRow.id,
        } : {}),
        modelDirty: { ...prev.modelDirty, [attached.id]: true },
        rightPane: 'rig',
        rightPanelCollapsed: false,
        status: `Humanoid rig attached to “${attached.name}” — geometry and model category are unchanged; choose Player or NPC only when exporting.`,
      }));
      return attached;
    } catch (error) {
      setCharacterRigSnapshot(null);
      setState((prev) => ({
        ...prev,
        status: `Humanoid rig could not attach: ${error instanceof Error ? error.message : String(error)} — no rig capability was installed; the ordinary model remains saveable.`,
      }));
      return null;
    }
  };

  const setModelTextureSlots = (pkgId: string, textureSlots: ModelTextureSlot[]) => {
    setState((prev) => ({
      ...prev,
      modelTextureSlots: { ...prev.modelTextureSlots, [pkgId]: textureSlots },
      modelDirty: { ...prev.modelDirty, [pkgId]: true },
      status: `${textureSlots.length} face texture role${textureSlots.length === 1 ? '' : 's'}`,
    }));
  };

  const setModelLights = (pkgId: string, lights: LightRig[]) => {
    const normalized = normalizeModelLights(lights);
    setState((prev) => ({
      ...prev,
      modelLights: { ...prev.modelLights, [pkgId]: normalized },
      modelDirty: { ...prev.modelDirty, [pkgId]: true },
      status: `${normalized.length} emitted light${normalized.length === 1 ? '' : 's'}`,
    }));
  };

  const markModelTextureMembershipDirty = (pkgId: string, message: string, dirty = true) => {
    setState((prev) => ({
      ...prev,
      ...(dirty ? { modelDirty: { ...prev.modelDirty, [pkgId]: true } } : {}),
      status: message,
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
    const current = stateRef.current;
    if (current.worldPieces.some((piece) => piece.id === pieceId)) {
      const selectedIds = current.selectedPieceIds.includes(pieceId) ? current.selectedPieceIds : [pieceId];
      const selected = selectedIds
        .map((id) => current.worldPieces.find((piece) => piece.id === id))
        .filter((piece): piece is NonNullable<typeof piece> => !!piece);
      const created = facadeFromSelection(selected, `facade-${current.seq}`, side);
      const existing = created ? current.worldFacades.find((candidate) => candidate.pieceIds.length === created.pieceIds.length
        && candidate.pieceIds.every((id) => created.pieceIds.includes(id))
        && candidate.normal.x === created.normal.x && candidate.normal.z === created.normal.z) : undefined;
      const facade = existing ?? created;
      if (facade) selectNativeModelSession({
        id: `doc-facade-${facade.id}`,
        kind: 'facade',
        title: 'Facade',
        subtitle: `${facade.widthMeters.toFixed(1)}×${facade.heightMeters.toFixed(1)}m`,
        sourceId: facade.id,
      });
    }
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
        activeDomain: 'paint',
        leftPanelCollapsed: false,
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
        armedStamp: piece.slots || piece.overrides || piece.stickers || piece.surfaceFlora || piece.spinDegPerSec
          ? {
              slots: piece.slots ? Object.fromEntries(Object.entries(piece.slots).map(([role, ref]) => [role, { ...ref }])) : undefined,
              overrides: piece.overrides ? { ...piece.overrides } : undefined,
              stickers: piece.stickers?.map((sticker) => ({ ...sticker })),
              surfaceFlora: piece.surfaceFlora?.map((patch) => ({ ...patch })),
              spinDegPerSec: piece.spinDegPerSec,
            }
          : null,
        selectedPieceId: null,
        selectedPieceIds: [],
        activeCommandId: 'place-piece',
        actionMenu: 'Build',
        status: `copied ${piece.pieceId} — click to stamp copies, Esc to put it down`,
      };
    });
  };

  const duplicateSelectedPieces = () => {
    const current = stateRef.current;
    const selected = current.worldPieces.filter((piece) => current.selectedPieceIds.includes(piece.id));
    if (selected.length < 2) return;
    const volumes = selected.map(pieceSelectionVolume).filter((volume): volume is NonNullable<typeof volume> => !!volume);
    const minX = Math.min(...volumes.map((volume) => volume.cx - Math.abs(volume.widthAxis[0]) * volume.halfWidth - Math.abs(volume.depthAxis[0]) * volume.halfDepth));
    const maxX = Math.max(...volumes.map((volume) => volume.cx + Math.abs(volume.widthAxis[0]) * volume.halfWidth + Math.abs(volume.depthAxis[0]) * volume.halfDepth));
    const width = Number.isFinite(minX) && Number.isFinite(maxX) ? maxX - minX : PIECE_MODULE_METERS;
    const offsetX = Math.max(PIECE_MODULE_METERS, Math.ceil((width + PIECE_MODULE_METERS) / PIECE_MODULE_METERS) * PIECE_MODULE_METERS);
    placePieces(selected.map((piece) => ({
      ...piece,
      id: '',
      x: piece.x + offsetX,
      generatedSite: undefined,
      slots: piece.slots ? Object.fromEntries(Object.entries(piece.slots).map(([role, ref]) => [role, { ...ref }])) : undefined,
      overrides: piece.overrides ? { ...piece.overrides } : undefined,
      stickers: piece.stickers?.map((sticker) => ({ ...sticker })),
      surfaceFlora: piece.surfaceFlora?.map((patch) => ({ ...patch })),
    })), { mode: 'click', inputAtMs: Date.now(), pointerX: 0, pointerY: 0 });
  };

  const pressLeftPanel = (pressed: LeftPanelId) => {
    setState((prev) => {
      const documentKind = prev.workspaceDocuments.find((doc) => doc.id === prev.activeWorkspaceDocumentId)?.kind ?? 'world';
      const paintActive = documentKind === 'facade' || (documentKind === 'model' && prev.modelTool.paint);
      const panes = leftPanelsFor(documentKind, paintActive);
      const active = resolvedPanelId(panes, prev.activeDomain);
      const result = pressPanelButton(active, pressed, prev.leftPanelCollapsed);
      const changedPane = prev.activeDomain !== pressed;
      const selectedPane = panes.find((pane) => pane.id === pressed);
      // The rail has one library destination. Returning from Paint reopens the
      // exact explorer folder instead of treating Assets as a jump to /Game.
      const contentFolder = prev.contentFolder;
      const tab = tabForContentFolder(contentFolder);
      return {
        ...prev,
        activeDomain: result.active,
        leftPanelCollapsed: result.collapsed,
        contentFolder,
        libraryCollectionReturnFolder: changedPane && selectedPane?.renderer === 'library' && !isLibraryCollectionFolder(contentFolder)
          ? contentFolder
          : prev.libraryCollectionReturnFolder,
        activeTab: tab ?? prev.activeTab,
        assetPage: changedPane && selectedPane?.renderer === 'library' ? 0 : prev.assetPage,
        expandedFolders: selectedPane?.renderer === 'library'
          ? { ...prev.expandedFolders, [contentFolder]: true }
          : prev.expandedFolders,
        status: result.collapsed ? `${selectedPane?.label ?? pressed} collapsed` : `${selectedPane?.label ?? pressed} open`,
      };
    });
  };

  // req_3446: the PIECE FOCUS `selected` material row jumps here. Unlike a rail
  // press (which toggle-collapses an already-active pane), this always ENDS with
  // the Materials library open — the row's promise is "show me the picker".
  const browseMaterials = () => setState((prev) => ({
    ...prev,
    activeDomain: 'assets',
    leftPanelCollapsed: false,
    contentFolder: 'materials',
    libraryCollectionReturnFolder: 'materials',
    activeTab: tabForContentFolder('materials') ?? prev.activeTab,
    assetPage: 0,
    expandedFolders: { ...prev.expandedFolders, materials: true },
    status: 'Materials library — click a material to make it the one slot clicks bind',
  }));

  const pressRightPanel = (pressed: RightPanelId) => {
    setState((prev) => {
      const documentKind = prev.workspaceDocuments.find((doc) => doc.id === prev.activeWorkspaceDocumentId)?.kind ?? 'world';
      const active = resolvedPanelIdOrNull(rightPanelsFor(documentKind), prev.rightPane);
      if (active === null) return {
        ...prev,
        rightPanelCollapsed: true,
        status: 'This document has no focus panel',
      };
      const result = pressPanelButton(active, pressed, prev.rightPanelCollapsed);
      return {
        ...prev,
        rightPane: result.active,
        rightPanelCollapsed: result.collapsed,
        status: result.collapsed ? `${pressed} focus collapsed` : `${pressed} focus open`,
      };
    });
  };

  const selectContentFolder = (contentFolder: ContentFolderId) => {
    setState((prev) => {
      const documentKind = prev.workspaceDocuments.find((doc) => doc.id === prev.activeWorkspaceDocumentId)?.kind ?? 'world';
      const fallback = resolvedPanelId(leftPanelsFor(documentKind), prev.activeDomain);
      const navigation = navigateLibraryCollection(
        prev.contentFolder,
        prev.libraryCollectionReturnFolder ?? DEFAULT_CONTENT_FOLDER,
        contentFolder,
      );
      const tab = tabForContentFolder(navigation.folder);
      const selectedModel = visibleModelPackages(prev.modelOverrides, prev.modelDupes)
        .find((model) => model.folderId === navigation.folder);
      return {
        ...prev,
        activeDomain: leftPanelForFolder(documentKind, navigation.folder, fallback),
        leftPanelCollapsed: false,
        contentFolder: navigation.folder,
        libraryCollectionReturnFolder: navigation.returnFolder,
        activeTab: tab ?? prev.activeTab,
        assetPage: 0,
        expandedFolders: { ...prev.expandedFolders, [navigation.folder]: true },
        recentLibraryKeys: selectedModel
          ? rememberRecentLibraryItem(prev.recentLibraryKeys ?? [], `model:${selectedModel.id}`)
          : prev.recentLibraryKeys,
        status: `content browser: ${contentFolderLabel(navigation.folder)}`,
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
  const openModelFileDocument = (path: string, importedOverride?: ModelPackage) => {
    // Import for keeps: copy the file into its own Model Package (content browser +
    // every future launch). A failed copy still opens the model, but session-only —
    // and the status says so LOUDLY instead of pretending it was saved.
    const imported = importedOverride ?? importModelFilePackage(path);
    const pkg = imported ?? fileModelPackage(path);
    const doc = modelDocument(pkg);
    const partPath = pkg.viewerPath ?? path;
    selectNativeModelSession(doc);
    setState((prev) => {
      const projected = projectModelIntoRecentLibrary(prev.modelDupes, prev.recentLibraryKeys ?? [], pkg);
      const seeded = prev.modelParts[pkg.id] ?? [filePartSeed(partPath, pkg.name)];
      return {
        ...prev,
        modelDupes: projected.models,
        recentLibraryKeys: projected.recentKeys,
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

  // File → Import Model: the OS picker (zenity) for a .glb/.obj/.stl anywhere on disk,
  // routed through the same native import path as in-project explorer rows.
  // The ONE import door: models open as documents; images run the quantize
  // probe and land in the dual-preview decision dialog (pixel texture vs
  // exact image — see ImportImageDialog).
  const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
  const importModelFromDisk = async () => {
    const path = await pickFile({
      title: 'Import a model or image',
      filters: [
        { name: '3D models', patterns: ['*.glb', '*.obj', '*.stl'] },
        { name: 'Images', patterns: ['*.png', '*.jpg', '*.jpeg', '*.webp'] },
        { name: 'All files', patterns: ['*'] },
      ],
    });
    if (!path) return;
    if (IMAGE_EXT_RE.test(path)) {
      probeImageImport(path);
      return;
    }
    if (isStlFile(path)) {
      const name = path.split('/').pop() ?? path;
      setStlConversionName(name);
      setState((prev) => ({ ...prev, status: `converting ${name} from STL to GLB…` }));
      const conversion = await convertStlToGlb(path);
      setStlConversionName(null);
      if (!conversion.ok) {
        setState((prev) => ({ ...prev, status: `could not convert ${name}: ${conversion.error}` }));
        return;
      }
      const imported = importStlModelFilePackage(path, conversion.outputPath);
      openModelFileDocument(conversion.outputPath, imported ?? undefined);
      if (imported) remove(conversion.outputPath);
      return;
    }
    if (!isViewerFile(path)) {
      setState((prev) => ({ ...prev, status: `cannot import ${path.split('/').pop()} — pick a .glb/.obj/.stl model or a .png/.jpg/.webp image` }));
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
    selectNativeModelSession(doc);
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

  // The Ink dock's "open in Color Studio" — jump from a dipped shader ink to
  // its editing page (selecting the matching library asset when there is one).
  const openColorStudioForSpec = (specId: string) => {
    const spec = shaderSpec(specId);
    if (!spec) return;
    const previous = stateRef.current;
    const match = catalogAssets.find((a) => a.recipe === specId);
    const asset = match ?? assetById(previous.activeAssetId, previous.assetOverrides);
    const doc = materialDocument(asset);
    selectNativeModelSession(doc);
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
    invokeApplicationCommand(COLOR_STUDIO_MATERIAL_SELECT_COMMAND_ID, { specId: spec.id, variant: 0 }, 'paint dock');
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
  const addPart = (kind: PrimitiveKind, source = 'dock') => {
    const previous = stateRef.current;
    // Paint and topology are different journals over different resident state. Leave
    // Paint synchronously BEFORE opening the size dialog, so the eventual append can
    // never replace a live paint target and Ctrl+Z afterward belongs to Mesh undo.
    // Updating the shell mirror now closes the effect-roundtrip race where a very fast
    // Apply still saw paint=true after ModelView had already disarmed it.
    if (previous.modelTool.paint) modelToolApiRef.current?.paint();
    addPartSourceRef.current = source;
    const next: EditorState = {
      ...previous,
      openMenu: null,
      contextOpen: false,
      actionMenu: 'Edit',
      modelTool: previous.modelTool.paint ? { ...previous.modelTool, paint: false } : previous.modelTool,
      newMeshPrompt: { kind, mode: 'add' },
      status: previous.modelTool.paint ? 'Paint closed safely — choose the part to add.' : previous.status,
    };
    stateRef.current = next;
    setState(next);
  };
  // Range of a part in the host mesh: its stored [lo, hi) (set on seed/append). The host mesh
  // is authoritative — these ids are stable across deletes and appends within a session.
  const partRange = (part: ModelPart): { lo: number; hi: number } | null =>
    part.lo != null && part.hi != null ? { lo: part.lo, hi: part.hi } : null;
  const writeHostPartJournalNote = (modelId: string, parts: readonly ModelPart[]): void => {
    (globalThis as any).__mesh_journal_note?.(modelOutlinerNote(modelId, modelPartRecords(parts)));
  };

  // 'add' verb — APPEND the primitive as a new PART to the model in view (preserving every prior
  // edit; no JS recompose). Reached from Edit → Mesh → Add Primitive and the outliner +.
  // Returns the new part's authored group range so a non-UI caller (the Agent Seat)
  // can select and name it in the same beat. UI callers ignore the value; every
  // refusal path returns null rather than throwing, because the seat reports the
  // refusal reason back to its agent instead of half-adding a part.
  const addPrimitivePart = (kind: PrimitiveKind, params: PrimitiveParams, source = 'dock'): { lo: number; hi: number } | null => {
    // Defensive half of the mode boundary: all UI paths leave Paint in addPart(), but
    // automation or a stale caller must be refused instead of mutating the paint target.
    const live = stateRef.current;
    if (live.modelTool.paint) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'Add Part refused while Paint is active — exit Paint first; painting was not changed.' }));
      return null;
    }
    const activeModel = activePartsModelId(live);
    if (!activeModel) {
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'Open a model first — Add Primitive appends a part to the model in view.' }));
      return null;
    }
    const parts = live.modelParts[activeModel] ?? [];
    const part = makePart(kind, parts, live.seq, params);
    const api = modelToolApiRef.current;
    const appendRoute = choosePartAppendRoute(Boolean(api), parts.length);
    // A document that has never established ModelView may seed its first row. Once
    // rows exist, however, their live native mesh is the only authority: library
    // imports deliberately have no cart-side primitive mesh to recompose, so treating
    // them as empty would overwrite them with this one new cube.
    if (appendRoute === 'seed-empty') {
      const seedRange = composeModelParts([{ ...part, visible: true }]).ranges[0];
      const placed: ModelPart = { ...part, lo: seedRange?.lo ?? 0, hi: seedRange?.hi ?? 0 };
      // There is no resident host mesh to scope until ModelView remounts, but the
      // outliner selection still changes transactionally with its new base row.
      selectedPartIdsRef.current = [placed.id];
      setSelectedPartIds([placed.id]);
      setState((prev) => ({ ...prev, seq: prev.seq + 1, modelParts: { ...prev.modelParts, [activeModel]: [...(prev.modelParts[activeModel] ?? []), placed] }, modelActivePartId: placed.id, newMeshPrompt: null, status: `added ${placed.name} to the empty model` }));
      return { lo: placed.lo, hi: placed.hi };
    }
    if (appendRoute === 'refuse' || !api) {
      setState((prev) => ({
        ...prev,
        newMeshPrompt: null,
        status: `Add Part stopped — ${parts.length} existing part(s) were kept, but their live mesh is unavailable. Reopen the model and try again.`,
      }));
      return null;
    }
    const geo = composeModelParts([{ ...part, visible: true }]);
    const range = geo.positions.length > 0
      ? withNativeMeshActionSource(source, () => api.appendPart(geo.positions, geo.faceGroups, part.color, parts.length))
      : null;
    if (!range) {
      // The viewer's error line carries the host's SPECIFIC refusal (part-count
      // mismatch etc., req_3461) — the status echoes so neither surface is silent.
      setState((prev) => ({ ...prev, newMeshPrompt: null, status: 'Add Part refused by the live mesh — see the viewer message; save + reopen rebuilds the outliner and mesh from disk.' }));
      return null;
    }
    const placed: ModelPart = { ...part, lo: range.lo, hi: range.hi };
    const nextParts = [...parts, placed];
    // Adding a row hands the edit transaction to that new geometry, exactly like
    // Duplicate already does. modelActivePartId alone only highlights the React row;
    // the native gizmo/topology scope must receive the appended range synchronously.
    selectedPartIdsRef.current = [placed.id];
    setSelectedPartIds([placed.id]);
    pushPartSetToHost({ visible: true, paint: live.modelTool.paint, selMode: live.modelTool.selMode }, nextParts, [placed.id], placed.id);
    setState((prev) => ({ ...prev, seq: prev.seq + 1, modelParts: { ...prev.modelParts, [activeModel]: [...(prev.modelParts[activeModel] ?? []), placed] }, modelActivePartId: placed.id, newMeshPrompt: null, status: `added ${placed.name}` }));
    const bridge = (globalThis as any).__modelFocusBridge;
    if (bridge?.paintLive) bridge.refreshUv?.();
    return { lo: placed.lo, hi: placed.hi };
  };

  // The Agent Seat's `add` verb (req_3586). It routes through addPrimitivePart rather
  // than the host append door so the outliner row and the host mesh stay ONE truth —
  // req_3465 is the bug a divergent part table causes. The seat speaks METERS (the R4
  // scale contract); PrimitiveParams is already meters by the time it reaches here
  // (NewMeshDialog converts u → meters at its own boundary), so nothing is rescaled.
  const seatAddPrimitive = (spec: SeatPrimitiveSpec): { lo: number; hi: number } | null => {
    if (!PRIMITIVE_MESHES.some((entry) => entry.kind === spec.kind)) return null;
    return addPrimitivePart(spec.kind as PrimitiveKind, { size: spec.size, height: spec.height, resolution: spec.sides }, 'seat');
  };
  const seatNewPrimitive = (spec: SeatPrimitiveSpec): boolean => {
    if (!PRIMITIVE_MESHES.some((entry) => entry.kind === spec.kind)) return false;
    createNewMeshDocument(spec.kind as PrimitiveKind, {
      size: spec.size,
      height: spec.height,
      resolution: spec.sides,
    });
    return true;
  };
  const seatDetachSelection = (name: string): { lo: number; hi: number } | null => {
    const current = stateRef.current;
    const modelId = activePartsModelId(current);
    const api = modelToolApiRef.current;
    if (!modelId || !api || !name.trim()) return null;
    const range = withNativeMeshActionSource('seat', () => api.detachSelection());
    if (!range) return null;
    const parts = current.modelParts[modelId] ?? [];
    const placed: ModelPart = {
      id: `part:detach:${current.seq}`,
      name: name.trim(),
      visible: true,
      color: PART_TINTS[parts.length % PART_TINTS.length]!,
      lo: range.lo,
      hi: range.hi,
    };
    const handoff = planDetachedPartHandoff(modelId, parts, placed);
    selectedPartIdsRef.current = handoff.selectedIds;
    setSelectedPartIds(handoff.selectedIds);
    pushPartSetToHost(
      { visible: true, paint: current.modelTool.paint, selMode: current.modelTool.selMode },
      handoff.parts,
      handoff.selectedIds,
      handoff.primaryId,
    );
    (globalThis as any).__mesh_journal_note?.(handoff.journalNote);
    setState((previous) => ({
      ...previous,
      seq: previous.seq + 1,
      modelParts: { ...previous.modelParts, [modelId]: handoff.parts },
      modelActivePartId: handoff.primaryId,
      modelDirty: { ...previous.modelDirty, [modelId]: true },
      status: `agent detached selection → ${placed.name} [${range.lo},${range.hi})`,
    }));
    return range;
  };
  const seatPartPercept = (modelId?: string): SeatPartPercept => {
    const current = stateRef.current;
    const id = modelId ?? activePartsModelId(current);
    if (!id) return { model: null, activePartId: null, parts: [] };
    const rows = current.modelParts[id] ?? [];
    const activePartId = id === activePartsModelId(current) && rows.some((row) => row.id === current.modelActivePartId)
      ? current.modelActivePartId
      : null;
    return {
      model: id,
      activePartId,
      parts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind ?? null,
        visible: row.visible,
        lo: row.lo ?? null,
        hi: row.hi ?? null,
        groupPath: partGroupPath(row),
      })),
    };
  };
  // Publish it on the global door ModelView's seat adapter reads. Mount-once is correct:
  // addPrimitivePart reads live state through stateRef/modelToolApiRef, never a closure.
  useEffect(() => {
    (globalThis as any).__seatShellBridge = {
      newPrimitive: seatNewPrimitive,
      addPrimitive: seatAddPrimitive,
      detachSelection: seatDetachSelection,
      persist: () => saveActiveModelNow('Saved by Agent Seat', 'explicit'),
      partPercept: (modelId?: string) => seatPartPercept(modelId),
      rigPercept: () => {
        const api = characterRigApiRef.current;
        const target = api?.currentOpenTarget?.();
        const visibleModelId = activeSessionModelIdRef.current;
        if (!api || !target || target.modelId !== visibleModelId) return null;
        try {
          // Seat replies are event-driven, never per-frame. Refreshing here
          // makes topology/anatomy debt ambient on the very next reply even
          // when the edit came through a mesh verb rather than a rig command.
          const snapshot = api.snapshot();
          characterRigSnapshotRef.current = snapshot;
          return rigStatusFromSnapshot(snapshot);
        } catch {
          const snapshot = characterRigSnapshotRef.current;
          return snapshot ? rigStatusFromSnapshot(snapshot) : null;
        }
      },
      registerPathPart: (range: { lo: number; hi: number }, kind: 'plane' | 'edges') => registerPathPlanePart(range, kind),
      shellAction: (action: string, args: Record<string, unknown>, targetModelId?: string) => seatShellActionRef.current(action, args, targetModelId),
    };
    return () => { (globalThis as any).__seatShellBridge = null; };
  }, []);

  const seatPerceptFor = (modelId: string | null): SeatPercept | null => {
    if (seatSessionWedgedRef.current) return null;
    if (!modelId || modelId === activeSessionModelIdRef.current) return (globalThis as any).__agentSeat?.look() ?? null;
    return withBackgroundModelSession(modelId, () => backgroundSeatFor(modelId).look(), () => null);
  };
  const backgroundSeatFor = (modelId: string): AgentSeat => {
    const existing = backgroundSeatByModelRef.current.get(modelId);
    if (existing) return existing;
    const seat = createAgentSeat({
      partPercept: () => seatPartPercept(modelId),
      readSkillDoc: readSeatCorpusDoc,
      noteState: { read: (model) => readSeatNotes(model), write: (model, book) => writeSeatNotes(model, book) },
      corpus: seatCorpusAdapter,
      shellAction: (action, args) => seatShellActionRef.current(action, args, modelId),
      persist: () => saveModelDocumentNow(modelId, 'Saved by Agent Seat', 'explicit'),
      shotOffscreen: (path, width, height, pose) =>
        (globalThis as any).__model_shot_offscreen?.(path, width, height, ...(pose ?? [])) === 1,
    });
    backgroundSeatByModelRef.current.set(modelId, seat);
    return seat;
  };

  // The Seat controls model creation, so its transport must outlive ModelView.
  // A model-less editor still answers `look`, and `new` creates the first real
  // document instead of requiring the person to prepare a disposable bootstrap.
  useEffect(() => {
    const currentSeat = (): AgentSeat | null => (globalThis as any).__agentSeat ?? null;
    const refreshSeatUi = () => (globalThis as any).__agentSeatRefresh?.();
    const bootstrap = { newPrimitive: seatNewPrimitive };
    const unsubscribe = subscribe('system:notification', (payload: any) => {
      if (payload?.kind !== 'agent-seat' || typeof payload?.replyPath !== 'string' ||
          !payload.replyPath.startsWith('/tmp/reactjit-seat-') || !payload.replyPath.endsWith('.json')) return;
      const request = payload.request as SeatRequest | undefined;
      if (!request || typeof request.action !== 'string') return;
      const writeReply = (reply: SeatReply) => (globalThis as any).__fs_write?.(
        payload.replyPath,
        JSON.stringify(payload.brief === true ? compactSeatReply(reply) : reply),
      );
      // One payload-level claim token/model target stamps every row, so a batch
      // authenticates once (req_3850). Row-level values win when present.
      const stampClaim = (row: SeatRequest): SeatRequest => ({
        ...row,
        token: row.token ?? (typeof payload.token === 'string' ? payload.token : undefined),
        model: row.model ?? (typeof payload.model === 'string' ? payload.model : undefined),
      });
      type SeatRowRun = {
        reply: SeatReply;
        before: SeatPercept | null;
        after: SeatPercept | null;
        target: string | null;
        background: boolean;
      };
      const runSeatRow = (
        row: SeatRequest,
        guard?: { expectedByModel: Map<string, number>; index: number },
      ): SeatRowRun => {
        const stamped = stampClaim(row);
        const active = activeSessionModelIdRef.current;
        const target = seatRequestTarget(stamped, active);
        const background = !!target && target !== active;
        const refuse = (reason: string, percept: SeatPercept | null = null): SeatRowRun => ({
          reply: { ok: false, op: row.action, percept, reason },
          before: percept,
          after: percept,
          target,
          background,
        });
        if (seatSessionWedgedRef.current) {
          return refuse(`${SEAT_SESSION_WEDGED_REASON} (target model ${target ?? 'none'})`);
        }
        const runWithSeat = (seat: AgentSeat | null): SeatRowRun => {
          const before = seat?.look() ?? null;
          if (guard) {
            const key = target ?? '';
            const expectedGeneration = guard.expectedByModel.get(key);
            if (expectedGeneration === undefined && before) {
              guard.expectedByModel.set(key, before.generation);
            } else if (expectedGeneration !== undefined) {
              const generationReason = before
                ? seatBatchGenerationReason(expectedGeneration, before.generation, guard.index, target ?? 'none')
                : `batch closed before row ${guard.index + 1} on model ${target ?? 'none'} — the target has no live percept`;
              if (generationReason) return refuse(generationReason, before);
            }
          }
          let reply = executeSeatRequestAtShell(seat, stamped, bootstrap);
          const after = seat?.look() ?? reply.percept;
          if (background && !reply.ok) {
            const reason = row.action === 'save'
              ? `background save could not persist target model ${target}; the package write or visible-document conflict gate refused it`
              : reply.reason?.includes(target!)
                ? reply.reason
                : `${reply.reason ?? `${row.action} was refused on the background lane`} (target model ${target})`;
            reply = { ...reply, percept: after, reason };
          }
          if (background && reply.ok && row.action !== 'save'
              && before && after && before.generation !== after.generation) {
            markModelDirty(target!);
          }
          return { reply, before, after, target, background };
        };
        if (!background) return runWithSeat(currentSeat());
        const open = stateRef.current.workspaceDocuments.some((doc) => doc.kind === 'model' && doc.sourceId === target);
        if (!open) return refuse(`model ${target} is not an open document tab — open it first`);
        const refusal = backgroundSeatRefusal(row.action, row.args ?? {})
          ?? (row.action === 'batch' ? 'nested batches cannot hold a background session across the row cadence' : null)
          ?? (row.action === 'group-visibility' || row.action === 'group-duplicate'
            ? "part geometry ops mirror through the visible viewer's part-range table; they cannot target a background model yet"
            : null);
        if (refusal) return refuse(`${refusal} (target model ${target}, active ${active ?? 'none'})`);
        return withBackgroundModelSession(
          target!,
          () => runWithSeat(backgroundSeatFor(target!)),
          (reason) => refuse(reason),
        );
      };
      const stampedRequest = stampClaim(request);
      const payloadTarget = seatRequestTarget(stampedRequest, activeSessionModelIdRef.current);
      if (seatSessionWedgedRef.current) {
        writeReply({
          ok: false,
          op: request.action,
          percept: null,
          reason: `${SEAT_SESSION_WEDGED_REASON} (target model ${payloadTarget ?? 'none'})`,
        });
        return;
      }
      const expected = Number(payload.generation);
      const current = seatPerceptFor(payloadTarget);
      if (Number.isFinite(expected) && (!current || expected !== current.generation)) {
        writeReply({
          ok: false,
          op: request.action,
          percept: current,
          reason: current
            ? `stale generation ${expected} for model ${payloadTarget ?? 'none'}; live generation is ${current.generation}`
            : `stale generation ${expected} for model ${payloadTarget ?? 'none'}; the target has no live percept`,
        });
        return;
      }
      const batch = request.action === 'batch' && Array.isArray(request.args?.requests)
        ? request.args.requests as SeatRequest[]
        : null;
      if (!batch) {
        const hadSeat = currentSeat() !== null;
        const routed = runSeatRow(request);
        const reply = routed.reply;
        if (!routed.background) refreshSeatUi();
        // Creating the first document schedules ModelView's mount. Do not tell the
        // caller `new` is complete until the mesh-capable Seat is actually ready.
        if (!hadSeat && request.action === 'new' && reply.ok) {
          const started = Date.now();
          const finishBootstrap = () => {
            const live = currentSeat()?.look() ?? null;
            if (live || Date.now() - started >= 2_000) {
              writeReply({ ...reply, percept: live });
              return;
            }
            setTimeout(finishBootstrap, 25);
          };
          finishBootstrap();
        } else writeReply(reply);
        return;
      }
      const replies: SeatReply[] = [];
      let index = 0;
      const expectedByModel = new Map<string, number>();
      let bootstrapStartedAt: number | null = null;
      const finishBatch = () => {
        const ok = replies.every((reply) => reply.ok);
        writeReply({
          ok,
          op: 'batch',
          result: replies,
          percept: seatPerceptFor(payloadTarget),
          ...(ok ? {} : { reason: `batch stopped at first rejection for target model ${payloadTarget ?? 'none'}` }),
        });
      };
      const runNext = () => {
        const seat = currentSeat();
        const live = seat?.look() ?? null;
        if (bootstrapStartedAt !== null && !live && Date.now() - bootstrapStartedAt < 2_000) {
          setTimeout(runNext, 25);
          return;
        }
        bootstrapStartedAt = null;
        if (index >= batch.length) {
          finishBatch();
          return;
        }
        const rowRequest = batch[index++]!;
        const hadSeat = seat !== null;
        const routed = runSeatRow(rowRequest, { expectedByModel, index: index - 1 });
        const row = routed.reply;
        replies.push(row);
        if (!routed.background) refreshSeatUi();
        const key = routed.target ?? '';
        if (row.percept) expectedByModel.set(key, row.percept.generation);
        else if (rowRequest.action === 'new') expectedByModel.delete(key);
        if (!hadSeat && rowRequest.action === 'new' && row.ok) bootstrapStartedAt = Date.now();
        if (!row.ok) index = batch.length;
        setTimeout(runNext, 100); // visible modeling cadence is a seat feature
      };
      runNext();
    });
    return unsubscribe;
  }, []);

  // A Pen Plane / Pen Edges part is generated against the live host camera, so its
  // geometry never takes a cart-side seed detour. Register only the metadata/range that
  // the host append reports, then focus the new row like every other Add Part flow.
  const registerPathPlanePart = (range: { lo: number; hi: number }, kind: 'plane' | 'edges' = 'plane') => {
    const current = stateRef.current;
    const modelId = activePartsModelId(current);
    const toolName = kind === 'edges' ? 'Pen Edges' : 'Path Plane';
    if (!modelId || range.hi <= range.lo) {
      setState((prev) => ({ ...prev, status: `${toolName} was created, but no active model could own its outliner row` }));
      return;
    }
    const parts = current.modelParts[modelId] ?? [];
    const number = parts.filter((part) => part.id.startsWith('part:path:')).length + 1;
    const placed: ModelPart = {
      id: `part:path:${current.seq}`,
      name: `${toolName} ${number}`,
      visible: true,
      color: kind === 'edges' ? '#58e8a6' : '#ad77ff',
      lo: range.lo,
      hi: range.hi,
    };
    const nextParts = [...parts, placed];
    selectedPartIdsRef.current = [placed.id];
    setSelectedPartIds([placed.id]);
    pushPartSetToHost({ visible: true, paint: current.modelTool.paint, selMode: current.modelTool.selMode }, nextParts, [placed.id], placed.id);
    setState((prev) => ({
      ...prev,
      seq: prev.seq + 1,
      modelParts: { ...prev.modelParts, [modelId]: [...(prev.modelParts[modelId] ?? []), placed] },
      modelActivePartId: placed.id,
      status: kind === 'edges'
        ? `created ${placed.name} — wire only, pull its verts with the move gizmo`
        : `created ${placed.name} from the closed pen path`,
    }));
  };

  // 'new' verb — ALWAYS a fresh model document seeded with this one part (mount composes it), even
  // when a model is already open. This is what makes New ≠ Add: File → New Mesh never appends to
  // whatever's in view; it spawns its own document (req_2542).
  const createNewMeshDocument = (kind: PrimitiveKind, params: PrimitiveParams) => {
    // Collision-free id: skips open docs AND saved library packages — once
    // primitive:cube:1 is materialized on disk it is a model forever, and the
    // old open-doc count would have reused its id after a restart (req_2620 S).
    // Minted OUTSIDE the updater and retired immediately: a document closed
    // before its first save leaves no tab, no package, and no file, so this
    // ledger is the only thing that stops the id coming back (req_3773).
    const mid = nextPrimitiveDocId(kind, stateRef.current.workspaceDocuments);
    rememberMintedModelId(mid);
    const pkg = primitiveModelPackage(mid);
    const doc = modelDocument(pkg);
    selectNativeModelSession(doc);
    setState((prev) => {
      const projected = projectModelIntoRecentLibrary(prev.modelDupes, prev.recentLibraryKeys ?? [], pkg);
      const base = makePart(kind, [], prev.seq, params);
      const range = composeModelParts([base]).ranges[0];
      const part: ModelPart = { ...base, lo: range?.lo ?? 0, hi: range?.hi ?? 0 };
      return {
        ...prev, seq: prev.seq + 1,
        modelDupes: projected.models,
        recentLibraryKeys: projected.recentKeys,
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
    const seeded = buildPieceStarterParts(starterId);
    if (seeded.length === 0) {
      setState((prev) => ({ ...prev, openMenu: null, status: `${starter.name} has no catalog geometry` }));
      return;
    }
    // Minted + retired before the document exists — see createNewMeshDocument.
    const mid = nextBuildStarterDocId(starterId, stateRef.current.workspaceDocuments);
    rememberMintedModelId(mid);
    const pkg = buildStarterModelPackage(mid);
    const doc = modelDocument(pkg);
    selectNativeModelSession(doc);
    setState((prev) => {
      const projected = projectModelIntoRecentLibrary(prev.modelDupes, prev.recentLibraryKeys ?? [], pkg);
      const rangeById = new Map(composeModelParts(seeded).ranges.map((range) => [range.id, range]));
      const parts = seeded.map((part) => {
        const range = rangeById.get(part.id);
        return { ...part, lo: range?.lo ?? 0, hi: range?.hi ?? 0 };
      });
      return {
        ...prev,
        modelDupes: projected.models,
        recentLibraryKeys: projected.recentKeys,
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

  // The current WELDED, bound played model, if any. Retired segmented packages
  // keep their historical role declarations untouched, but never enter the
  // replacement/demotion path. Session dupes carry the freshest declarations.
  const currentPlayerCharacter = (): ModelPackage | null => {
    const current = new Map(MODEL_PACKAGES.map((model) => [model.id, model]));
    for (const model of stateRef.current.modelDupes) current.set(model.id, model);
    return boundPlayerCharacterPackage([...current.values()]);
  };

  // Character export is only a role declaration on an already valid native
  // bind snapshot. It never compiles a skeleton from part names and never runs
  // the solver: the same immutable RJMD/RJSK transaction used by Save lands
  // first, then that manifest advertises player/NPC placeability.
  const exportCharacterAs = (role: CharacterRole) => {
    if (refuseHistoricalPreviewMutation('export')) return;
    const doc = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId);
    const pkg = doc?.kind === 'model' ? effectiveModelPackage(doc.sourceId, state.modelOverrides, state.modelDupes) : null;
    if (!pkg || !hasCharacterRigCapability(pkg)) {
      setState((prev) => ({ ...prev, exportCharacterPrompt: null, status: 'Character export needs an open model with a humanoid rig attached.' }));
      return;
    }
    let currentRigSnapshot: CharacterRigSnapshot;
    try {
      const refreshed = characterRigApiRef.current?.snapshot();
      if (!refreshed) throw new Error('character rig session is not open');
      currentRigSnapshot = refreshed;
      setCharacterRigSnapshot(refreshed);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: `Character export could not refresh readiness: ${error instanceof Error ? error.message : String(error)}`,
      }));
      return;
    }
    if (!characterSnapshotExportReady(currentRigSnapshot)) {
      setState((prev) => ({ ...prev, status: 'Character export blocked — complete every readiness check in Character · Rig.' }));
      return;
    }
    const placeable: ModelPlaceable = { as: 'character', role };
    let committed: ReturnType<typeof materializeCharacterSaveSnapshot>;
    try {
      const prepared = characterRigApiRef.current?.prepareSave();
      if (!prepared) throw new Error('character rig session is not open');
      if (!characterPreparedSaveExportReady(prepared)) {
        throw new Error('resident character changed after readiness refresh and now needs a bind');
      }
      committed = materializeCharacterSaveSnapshot(
        { ...pkg, placeable },
        prepared,
        characterRigPartMetadata(
          prepared.descriptor.objectBindings,
          state.modelParts[pkg.id] ?? [],
          packageMeshDocParts(pkg) ?? [],
          { name: pkg.name, color: pkg.color },
        ),
      );
    } catch (error) {
      committed = { ok: false, id: pkg.id, dir: pkg.path, error: error instanceof Error ? error.message : String(error) };
    }
    if (!committed.ok || !committed.package) {
      setState((prev) => ({
        ...prev,
        exportCharacterPrompt: null,
        status: `Character export failed before manifest cutover: ${committed.error ?? 'unknown transaction error'}`,
      }));
      return;
    }
    consumeModelSaveAuthorizations(pkg.id);
    const pkgExported = committed.package;
    upsertSavedPackage(pkgExported);
    try {
      const refreshed = characterRigApiRef.current?.commitSave(savedCharacterBinding(pkgExported));
      if (refreshed) setCharacterRigSnapshot(refreshed);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: `Character files and manifest committed, but the resident save percept could not acknowledge them: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
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
      status: `Exported "${pkg.name}" as ${roleLabel} — saved RJMD v5 + RJSK v1 weights${demoted ? ` · "${demoted.name}" demoted to NPC` : ''}`,
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
    if (kind === 'playtest') {
      // Headless repro of the playtest tab (req_2780): the embodied world with
      // the exported player model (or the stand-in when none is declared).
      selectNativeModelSession(PLAYTEST_DOCUMENT);
      setState((prev) => ({
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, PLAYTEST_DOCUMENT),
        activeWorkspaceDocumentId: PLAYTEST_DOCUMENT.id,
      }));
    } else if (kind === 'animation') {
      // Headless repro of the capture tab (req_2786) — no cam in headless, so
      // the tracker chip reports honestly while the layout verifies.
      selectNativeModelSession(ANIMATION_DOCUMENT);
      setState((prev) => ({
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, ANIMATION_DOCUMENT),
        activeWorkspaceDocumentId: ANIMATION_DOCUMENT.id,
      }));
    } else if (kind?.startsWith('build:')) {
      const starterId = kind.slice('build:'.length) as BuildPieceStarterId;
      if (buildPieceStarter(starterId)) createBuildPieceStarterDocument(starterId);
    } else if (kind?.startsWith('open:')) {
      // req_3406: boot straight into a SAVED package — the repro path for
      // open-a-real-model bugs (the blank Lavalampsad viewport). The roster is
      // built synchronously at module init, so the lookup is immediate.
      const pkg = modelPackageByName(kind.slice('open:'.length));
      if (pkg) openModelDocument(pkg);
      else console.error(`[modeldoc-harness] open: no package named '${kind.slice('open:'.length)}' in the roster`);
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
  const selectionSurgeryRef = useRef<{ plan: SelectionOwnerPlan; cursor: number } | null>(null);
  // Focus is deliberately locked by default: stage clicks are often part of a
  // risky edit gesture, while selecting from the outliner remains explicit.
  const [stagePartFocusEnabled, setStagePartFocusEnabled] = useState(false);
  const stagePartFocusEnabledRef = useRef(stagePartFocusEnabled);
  stagePartFocusEnabledRef.current = stagePartFocusEnabled;
  const toggleStagePartFocus = () => {
    const next = !stagePartFocusEnabledRef.current;
    stagePartFocusEnabledRef.current = next;
    setStagePartFocusEnabled(next);
    setState((prev) => ({ ...prev, status: next
      ? 'stage selection on — viewport clicks can focus other parts'
      : 'stage selection locked — viewport clicks keep the current outliner focus' }));
  };
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
  const pushPartSetToHost = (
    view: { visible: boolean; paint: boolean; selMode: number },
    parts: ModelPart[],
    ids: string[],
    primaryId: string,
  ) => {
    const host = globalThis as any;
    const selectedRanges = ids
      .map((sid) => { const p = parts.find((pp) => pp.id === sid); return p ? partRange(p) : null; })
      .filter((r): r is { lo: number; hi: number } => r !== null);
    const prim = parts.find((p) => p.id === primaryId);
    if (view.visible) host.__modelActivePartRange = prim ? partRange(prim) : null; // the UV filter's truth (req_2619 P)
    // Paint is intentionally single-outliner even when a modeling multi-set is
    // highlighted. A union scope would make one stroke legally cross part
    // boundaries; the focused primary is the complete paint target contract.
    const primaryRange = prim ? partRange(prim) : null;
    const ranges = view.paint && primaryRange ? [primaryRange] : selectedRanges;
    if (ranges.length === 0) return;
    if (ranges.length === 1) {
      host.__mesh_edit_scope?.(ranges[0]!.lo, ranges[0]!.hi);
    } else {
      const pairs = new Uint32Array(ranges.length * 2);
      ranges.forEach((r, i) => { pairs[i * 2] = r.lo; pairs[i * 2 + 1] = r.hi; });
      host.__mesh_edit_scope_ranges?.(pairs);
    }
    if (view.paint) return; // paint owns the surface — primary scope only
    // Selecting the parts' faces is a FACE-mode gesture — the host door flips its pick
    // mode to face. In vertex/edge mode focus only scopes (dots/edges restrict to the
    // set), so the toolbar's mode and the host's pick mode never diverge (req_2645 SS).
    const m = view.selMode;
    if (m === 0 || m === 3) ranges.forEach((r, i) => host.__mesh_edit_select_group_range?.(r.lo, r.hi, i === 0 ? 0 : 1));
    else host.__mesh_edit_clear?.();
    // This selection is shell-driven, not an engine pointer event, so the native
    // callback will not fire on its own. Ping the viewer to mirror host mode/counts.
    if (view.visible) host.__meshEditSelChanged?.();
  };
  const selectionElementIds = (selection: ModelSelectionSnapshot): number[] => (
    selection.mode === 1
      ? selection.vertices.map((vertex) => vertex.id)
      : selection.mode === 2
        ? selection.edges.map((edge) => edge.id)
        : selection.mode === 3
          ? selection.triangles.map((triangle) => triangle.id)
          : []
  );
  const sameElementIds = (a: readonly number[], b: readonly number[]): boolean =>
    a.length === b.length && a.every((id, index) => id === b[index]);
  const focusSelectionOwner = () => {
    const current = stateRef.current;
    const modelId = activePartsModelId(current);
    const parts = modelId ? (current.modelParts[modelId] ?? []) : [];
    if (!modelId || parts.length === 0) {
      setState((prev) => ({ ...prev, status: 'selection surgery needs an open model with Outliner parts' }));
      return;
    }

    const selection = parseModelSelectionSnapshot((globalThis as any).__mesh_edit_selection?.());
    let session = selectionSurgeryRef.current;
    let cursor = 0;
    if (session && selection && selection.mode === session.plan.mode) {
      const activeGroup = session.plan.groups[session.cursor];
      if (activeGroup && sameElementIds(selectionElementIds(selection), activeGroup.elementIds)) {
        cursor = (session.cursor + 1) % session.plan.groups.length;
      } else {
        session = null;
      }
    } else {
      session = null;
    }

    if (!session) {
      const result = planSelectionOwnerSurgery(selection, parts);
      if (!result.ok) {
        selectionSurgeryRef.current = null;
        setState((prev) => ({ ...prev, status: `selection surgery: ${result.reason}` }));
        return;
      }
      const activeIndex = result.plan.groups.findIndex((group) => group.partId === current.modelActivePartId);
      cursor = activeIndex >= 0 ? activeIndex : 0;
      session = { plan: result.plan, cursor };
    }

    const target = session.plan.groups[cursor]!;
    if (!target.visible) {
      selectionSurgeryRef.current = session;
      setState((prev) => ({ ...prev, status: `selection surgery: ${target.partName} owns this selection but is hidden — show it, then locate again` }));
      return;
    }

    setSelectedPartIds([target.partId]);
    selectedPartIdsRef.current = [target.partId];
    pushPartSetToHost({ visible: true, paint: current.modelTool.paint, selMode: current.modelTool.selMode }, parts, [target.partId], target.partId);

    const host = globalThis as any;
    const selectElement = session.plan.mode === 1
      ? host.__mesh_edit_select_vertex
      : session.plan.mode === 2
        ? host.__mesh_edit_select_edge
        : host.__mesh_edit_select_face;
    let restored = 0;
    if (typeof selectElement === 'function') {
      for (const id of target.elementIds) {
        if (selectElement(id, restored > 0 ? 1 : 0) !== 1) break;
        restored += 1;
      }
    }
    if (restored !== target.elementIds.length) {
      host.__mesh_edit_clear?.();
      host.__meshEditSelChanged?.();
      selectionSurgeryRef.current = null;
      setState((prev) => ({ ...prev, modelActivePartId: target.partId, status: 'selection surgery stopped — topology changed while the selection was being restored; select it again' }));
      return;
    }

    session.cursor = cursor;
    selectionSurgeryRef.current = session.plan.groups.length > 1 ? session : null;
    host.__meshEditSelChanged?.();
    const label = selectionOwnerElementLabel(session.plan.mode, target.elementIds.length);
    const cycle = session.plan.groups.length > 1 ? ` · owner ${cursor + 1}/${session.plan.groups.length}; press again to cycle` : '';
    const ownershipVerb = target.elementIds.length === 1 ? 'belongs' : 'belong';
    setState((prev) => ({
      ...prev,
      modelActivePartId: target.partId,
      status: `selection surgery: ${label} ${ownershipVerb} to ${target.partName}${cycle}`,
    }));
  };
  const selectPart = (id: string) => {
    // Focus = SCOPE editing to the selected set. EXACTLY ONE primary is always focused
    // (req_2644): a plain click replaces the set with [id] (clicking the focused row
    // RE-ASSERTS it — never a toggle-off into scope(0,0)); shift-click toggles set
    // membership (req_2659) but the set never empties.
    selectionSurgeryRef.current = null;
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
    pushPartSetToHost({ visible: true, paint: state.modelTool.paint, selMode: state.modelTool.selMode }, parts, nextIds, primary);
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
      if (!part?.visible) return;
      if (!stagePartFocusEnabledRef.current) {
        setState((prev) => ({ ...prev, status: 'stage selection locked — unlock it in the Outliner to focus another part from the viewport' }));
        return;
      }
      selectPartRef.current(part.id);
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
    pushPartSetToHost({ visible: true, paint: state.modelTool.paint, selMode: state.modelTool.selMode }, parts, visibleIds, primary);
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
    if (refuseHistoricalPreviewMutation('visibility')) return;
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
    let journalParts = parts.slice();
    // Do not depend on a React effect having run since load/rename. The native
    // snapshot taken by the first duplicate must carry the exact pre-op names.
    writeHostPartJournalNote(mid, journalParts);
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
      const placed: ModelPart = {
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
      };
      placedRows.push(placed);
      // A selected-set mirror is N native journal entries. Stamp the metadata
      // after EACH append so the next snapshot describes the same N-part mesh;
      // waiting until the batch ends is what let undo fall into Part 1/2/3….
      journalParts = [...journalParts, placed];
      writeHostPartJournalNote(mid, journalParts);
      lines.push(`${mirrorAxis >= 0 ? 'mirrored' : 'duplicated'} ${part.name} → [${r.lo},${r.hi})`);
    }
    if (placedRows.length === 0) {
      setState((prev) => ({ ...prev, status: lines.join(' · ') || 'duplicate needs a focused part with a stamped range' }));
      return;
    }
    const nextParts = journalParts;
    const focusedIds = placedRows.map((part) => part.id);
    const primaryId = placedRows[placedRows.length - 1]!.id;

    // Duplication hands the edit transaction to its result. Updating only the
    // highlighted row + selected-id set leaves the HOST scoped to the source,
    // so the next gizmo/topology action edits the old part until the duplicate
    // is clicked manually. Reuse the same complete focus push as an outliner
    // click: active range, edit scope, face selection, and viewer counts.
    selectedPartIdsRef.current = focusedIds;
    setSelectedPartIds(focusedIds);
    pushPartSetToHost({ visible: true, paint: state.modelTool.paint, selMode: state.modelTool.selMode }, nextParts, focusedIds, primaryId);
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
    pushPartSetToHost({ visible: true, paint: state.modelTool.paint, selMode: state.modelTool.selMode }, materialized.parts, focusedIds, primaryId);
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

  // Agent Seat form of the same path-array authority. The visible dialog only
  // gathers these parameters; geometry still bottoms out in ModelToolApi.pathArray
  // and metadata still comes from materializePathArrayRows.
  const applySeatPathArray = (sourceIds: string[], rawParams: PathArrayParams): SeatShellReceipt => {
    const live = stateRef.current;
    const mid = activePartsModelId(live);
    const api = modelToolApiRef.current;
    const parts = mid ? (live.modelParts[mid] ?? []) : [];
    const sources = sourceIds.map((id) => parts.find((part) => part.id === id)).filter((part): part is ModelPart => Boolean(part));
    if (!mid || !api || sources.length === 0 || sources.length !== sourceIds.length) return { ok: false, reason: 'valid source part ids are required' };
    if (sources.some((part) => !part.visible || !partRange(part))) return { ok: false, reason: 'every source part must be visible with a stamped host range' };
    const params = sanitizePathArrayParams(rawParams);
    const ranges = sources.map((part) => partRange(part)!) as { lo: number; hi: number }[];
    const hostResult = withNativeMeshActionSource('seat', () => api.pathArray(ranges, params));
    const expectedRanges = (params.bays - 1) * sources.length;
    if (!hostResult || hostResult.ranges.length !== expectedRanges) {
      if (hostResult) withNativeMeshActionSource('seat', () => api.undoMesh());
      return { ok: false, reason: 'path array failed or returned incomplete host ranges; the operation was rolled back' };
    }
    const materialized = materializePathArrayRows(parts, sourceIds, hostResult.ranges, live.seq);
    if (!materialized || materialized.created.length !== expectedRanges) {
      withNativeMeshActionSource('seat', () => api.undoMesh());
      return { ok: false, reason: 'path array metadata failed validation; the operation was rolled back' };
    }
    const focusedIds = materialized.created.map((part) => part.id);
    const primaryId = focusedIds[focusedIds.length - 1]!;
    selectedPartIdsRef.current = focusedIds;
    setSelectedPartIds(focusedIds);
    pushPartSetToHost({ visible: true, paint: live.modelTool.paint, selMode: live.modelTool.selMode }, materialized.parts, focusedIds, primaryId);
    const next = {
      ...live,
      seq: materialized.nextSeq,
      modelParts: { ...live.modelParts, [mid]: materialized.parts },
      modelActivePartId: primaryId,
      modelDirty: { ...live.modelDirty, [mid]: true },
      status: `Agent Seat built ${params.bays}-bay path in ${materialized.groupName}`,
    };
    stateRef.current = next;
    setState(next);
    return { ok: true, result: { ids: focusedIds, primary: primaryId, group: materialized.groupName } };
  };

  // Detach the face-mode selection into a NEW part (host group remap — geometry and
  // paint stay put). The panel becomes the focused part, ready to grab with the gizmo.
  const runDetachSelection = (source = 'dock') => {
    const current = stateRef.current;
    const mid = activePartsModelId(current);
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
    const parts = current.modelParts[mid] ?? [];
    const n = parts.filter((p) => p.id.startsWith('part:detach:')).length + 1;
    const placed: ModelPart = { id: `part:detach:${current.seq}`, name: `Detached ${n}`, visible: true, color: PART_TINTS[parts.length % PART_TINTS.length]!, lo: r.lo, hi: r.hi };
    const handoff = planDetachedPartHandoff(mid, parts, placed);
    // This is deliberately synchronous. Ctrl+A / gizmo move can arrive before a
    // React effect; both must already see the detached range and the next journal
    // snapshot must already carry the appended Outliner row.
    selectedPartIdsRef.current = handoff.selectedIds;
    setSelectedPartIds(handoff.selectedIds);
    pushPartSetToHost(
      { visible: true, paint: current.modelTool.paint, selMode: current.modelTool.selMode },
      handoff.parts,
      handoff.selectedIds,
      handoff.primaryId,
    );
    (globalThis as any).__mesh_journal_note?.(handoff.journalNote);
    const next = {
      ...current,
      seq: current.seq + 1,
      modelParts: { ...current.modelParts, [mid]: handoff.parts },
      modelActivePartId: handoff.primaryId,
      modelDirty: { ...current.modelDirty, [mid]: true },
      status: `detached selection → ${placed.name} [${r.lo},${r.hi})`,
    };
    stateRef.current = next;
    setState(next);
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
    pushPartSetToHost({ visible: true, paint: state.modelTool.paint, selMode: state.modelTool.selMode }, workingParts, [survivor.id], survivor.id);
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
  // merge-faces plus the whole-topology tris-to-quads dry-run session. Immediate
  // verbs journal here; tris-to-quads opens the viewer-owned confirm/cancel preview.
  const runFaceOp = (kind: 'flip' | 'glass' | 'solidify' | 'merge-faces' | 'tris-to-quads', source = 'dock') => {
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
    } else if (kind === 'merge-faces') {
      ok = withNativeMeshActionSource(source, () => api?.mergeFaces() ?? false);
      okMsg = 'merged the selection into one face';
      failMsg = 'merge faces: select 2+ faces (face mode) first';
    } else {
      ok = withNativeMeshActionSource(source, () => api?.trisToQuads() ?? false);
      okMsg = 'scanning the whole topology for the maximum quad set — review the live dry run';
      failMsg = 'tris to quads: open a model in Face mode first';
    }
    setState((prev) => ({ ...prev, status: ok ? okMsg : failMsg }));
  };

  // Cross-model reuse: append a saved package document into the OPEN model,
  // preserving its authored part ranges. File-backed packages host-parse their
  // copied .glb/.obj. Pick the same model again to reuse it any number of times.
  const importModelAsParts = (pkg: ModelPackage, source = 'dock') => {
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
    let journalParts = existing.slice();
    const doc = packageMeshDoc(pkg);
    const meta = packageMeshDocParts(pkg) ?? [];
    if (doc && doc.vertices.length >= 24) {
      for (let index = 0; index < doc.ranges.length; index += 1) {
        const imported = modelPartImportPayload(doc, index);
        if (!imported) continue;
        const row = meta[index];
        const color = row?.color ?? nextColor();
        const expectedPartCount = existing.length + added.length;
        if (source === 'headless') console.error(`[partops] import append ${pkg.id} range ${index} expects ${expectedPartCount} resident part(s)`);
        const r = withNativeMeshActionSource(source, () => api.appendPart(imported.positions, imported.faceGroups, color, expectedPartCount));
        if (!r) continue;
        const placed: ModelPart = {
          id: `part:imp:${state.seq}:${added.length}`,
          name: doc.ranges.length === 1 ? pkg.name : `${pkg.name} · ${row?.name ?? `part ${index + 1}`}`,
          kind: row?.kind as PrimitiveKind | undefined,
          mesh: imported.mesh,
          visible: true,
          color,
          lo: r.lo,
          hi: r.hi,
        };
        added.push(placed);
        journalParts = [...journalParts, placed];
        writeHostPartJournalNote(mid, journalParts);
      }
    } else if (pkg.primitive) {
      const built = primitiveMeshData(pkg.primitive);
      const color = nextColor();
      const r = built.positions.length > 0
        ? withNativeMeshActionSource(source, () => api.appendPart(built.positions, built.faceGroups, color, existing.length + added.length))
        : null;
      if (r) {
        const placed: ModelPart = { id: `part:imp:${state.seq}:0`, name: pkg.name, kind: pkg.primitive, mesh: primitivePartMesh(pkg.primitive), visible: true, color, lo: r.lo, hi: r.hi };
        added.push(placed);
        writeHostPartJournalNote(mid, [...journalParts, placed]);
      }
    } else if (pkg.viewerPath && isViewerFile(pkg.viewerPath)) {
      const color = nextColor();
      const r = withNativeMeshActionSource(source, () => api.appendModelFile(pkg.viewerPath, color, existing.length + added.length));
      if (r) {
        const placed: ModelPart = { id: `part:imp:${state.seq}:0`, name: pkg.name, sourcePath: pkg.viewerPath, visible: true, color, lo: r.lo, hi: r.hi };
        added.push(placed);
        writeHostPartJournalNote(mid, [...journalParts, placed]);
      }
    }
    if (added.length === 0) {
      setState((prev) => ({ ...prev, status: `could not import ${pkg.name} — its package has no usable mesh document or .glb/.obj` }));
      return;
    }
    setImportPartOpen(false);
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
  const readHostRedoLabel = (): string => {
    try {
      const j = (globalThis as any).__mesh_history?.();
      if (typeof j !== 'string' || !j) return '';
      const label = JSON.parse(j)?.redoLabel;
      return typeof label === 'string' ? label : '';
    } catch {
      return '';
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
  // Re-scope the focused SET to its refreshed ranges: the move gizmo must always
  // drive the selected parts' true faces, never a stale span. Multi-select
  // (req_2659) re-pushes the whole union; the UV filter's active-range global
  // follows the primary.
  const rescopeStampedRows = (prev: EditorState, stamped: ModelPart[]) => {
    const active = stamped.find((p) => p.id === prev.modelActivePartId) ?? stamped[0];
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
  };
  // The parts-metadata note the host journal carries for its CURRENT state. After an
  // undo/redo the host restored the note along with the geometry (journalInstall), so
  // this is the row table that was live at the restored state — readable no matter
  // which path drove the undo (shell hotkey, Agent Seat door, harness op).
  const readHostJournalNoteParts = (mid: string): ModelPart[] | null => {
    try {
      const j = (globalThis as any).__mesh_journal_note?.();
      if (typeof j !== 'string' || !j) return null;
      const o = JSON.parse(j);
      if (o?.modelId !== mid || !Array.isArray(o.parts)) return null;
      return (o.parts as ModelPart[]).map((p) => {
        const seed = partMeshSeedsRef.current[p.id];
        return seed ? { ...p, mesh: seed } : p;
      });
    } catch {
      return null;
    }
  };
  // Rebuild the row table from what the mesh itself knows: one follow-patch sweep
  // gives every displayed face its part index + semantic region, and the semantic
  // table names the regions. Rows whose [lo,hi) exactly matches a live range keep
  // their identity (name/color/visibility/seed); every other range gets a fresh row
  // named after its dominant region. This is the recovery floor: it cannot invent
  // geometry, only re-describe the host's authoritative partition.
  const partRowsFromGeometry = (ranges: { lo: number; hi: number }[], oldRows: ModelPart[]): ModelPart[] => {
    const host = globalThis as any;
    const regionNames = new Map<number, string>();
    try {
      const stateJson = host.__mesh_semantic_state?.();
      if (typeof stateJson === 'string' && stateJson) {
        const table = JSON.parse(stateJson)?.table;
        for (const r of table?.regions ?? []) {
          if (typeof r?.id === 'number' && typeof r?.name === 'string') regionNames.set(r.id, r.name);
        }
      }
    } catch { /* unnamed model — rows fall back to Part N */ }
    // Sweep displayed faces in pages; tally faces + dominant region per part index.
    const faceCount = Number(host.__model_face_count?.() ?? 0);
    const tally = ranges.map(() => ({ faces: 0, regions: new Map<number, number>() }));
    for (let at = 0; at < faceCount; at += 128) {
      const ids = new Uint32Array(Math.min(128, faceCount - at));
      for (let i = 0; i < ids.length; i += 1) ids[i] = at + i;
      try {
        const page = JSON.parse(host.__mesh_follow_patch?.(ids, 0) || 'null');
        for (const tri of page?.triangles ?? []) {
          const part = tally[tri?.part];
          if (!part) continue;
          part.faces += 1;
          if (typeof tri.region === 'number' && regionNames.has(tri.region)) {
            part.regions.set(tri.region, (part.regions.get(tri.region) ?? 0) + 1);
          }
        }
      } catch { break; }
    }
    const usedNames = new Map<string, number>();
    return ranges.map((range, index) => {
      const kept = oldRows.find((p) => p.lo === range.lo && p.hi === range.hi);
      if (kept) return kept;
      let name = '';
      let best = 0;
      for (const [id, faces] of tally[index]!.regions) {
        if (faces > best) { best = faces; name = regionNames.get(id) ?? ''; }
      }
      if (!name) name = `Part ${index + 1}`;
      const nth = (usedNames.get(name) ?? 0) + 1;
      usedNames.set(name, nth);
      return {
        id: `part:rebuild:${stateRef.current.seq}:${index}`,
        name: nth > 1 ? `${name} ${nth}` : name,
        visible: tally[index]!.faces > 0,
        color: PART_TINTS[index % PART_TINTS.length]!,
        lo: range.lo,
        hi: range.hi,
      };
    });
  };
  // ── The row ↔ range reconciler (req_3763) ────────────────────────────────────
  // Counts equal → rank re-stamp (renumbering ops preserve part order). Counts
  // differ → the rows CANNOT self-heal by rank; the old guard froze here forever
  // (once the counts diverged nothing could ever re-converge them — the req_3756/
  // 3757/3758/3759 corruption). Now a mismatch reconciles LOUDLY against host
  // truth: first from the journal note the host restored (an undo/redo that
  // crossed a structural boundary outside the shell's own undo path — the Agent
  // Seat's __mesh_undo bypass), else rebuilt from geometry + semantic regions.
  const partReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcilePartRows = (reason: string) => {
    const s = stateRef.current;
    const mid = activePartsModelId(s);
    if (!mid) return;
    const ranges = readHostPartRanges();
    if (!ranges || ranges.length === 0) return;
    const rows = s.modelParts[mid] ?? [];
    if (rows.length === ranges.length) {
      // The mid-flight structural op landed its own row meanwhile — cheap re-stamp.
      const stamped = stampRowsByRank(rows, ranges);
      setState((prev) => {
        rescopeStampedRows(prev, stamped);
        return { ...prev, modelParts: { ...prev.modelParts, [mid]: stamped } };
      });
      return;
    }
    const noteParts = readHostJournalNoteParts(mid);
    const fromNote = noteParts && noteParts.length === ranges.length;
    // A native-door undo can bypass meshUndoRedo entirely. When it undid the
    // append-only Mirror/Duplicate Part operation, the redo label still names
    // that exact inverse; preserve the surviving rows instead of anonymizing
    // them merely because an old snapshot carried no usable note.
    const fromAppendInverse = fromNote ? null : recoverAppendedPartUndoRows(rows, ranges, readHostRedoLabel());
    const recovery = fromNote ? 'journal note' : fromAppendInverse ? 'append inverse' : 'geometry';
    const next = stampRowsByRank(fromNote ? noteParts : fromAppendInverse ?? partRowsFromGeometry(ranges, rows), ranges);
    console.error(`[partsync] reconciled rows=${rows.length} → parts=${ranges.length} via ${recovery} (${reason})`);
    if (next.length < rows.length) authorizedPartShrinkTargetRef.current.set(mid, next.length);
    else authorizedPartShrinkTargetRef.current.delete(mid);
    const activeId = next.some((p) => p.id === s.modelActivePartId) ? s.modelActivePartId : (next[0]?.id ?? null);
    const keepSelected = selectedPartIdsRef.current.filter((sid) => next.some((p) => p.id === sid));
    selectedPartIdsRef.current = keepSelected.length > 0 ? keepSelected : (activeId ? [activeId] : []);
    setSelectedPartIds(selectedPartIdsRef.current);
    setState((prev) => {
      rescopeStampedRows({ ...prev, modelActivePartId: activeId }, next);
      return {
        ...prev,
        modelParts: { ...prev.modelParts, [mid]: next },
        modelActivePartId: activeId,
        status: `outliner reconciled to the mesh — ${next.length} part(s), was ${rows.length} row(s) (${fromNote ? 'restored from the undo journal' : fromAppendInverse ? 'preserved from the append-only undo' : 'rebuilt from geometry'})`,
      };
    });
    markActiveModelDirty();
  };
  // A count mismatch is AMBIGUOUS at announce time: a structural op's own handler
  // may be about to land its row (append/detach/delete add and remove rows with the
  // op's range). Defer one beat; if the counts still disagree, reconcile for real —
  // reconcilePartRows re-reads live state either way and degrades to a plain
  // re-stamp when the counts have already re-converged.
  const schedulePartRowReconcile = (reason: string) => {
    if (partReconcileTimerRef.current) return;
    partReconcileTimerRef.current = setTimeout(() => {
      partReconcileTimerRef.current = null;
      reconcilePartRows(reason);
    }, 280);
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
        if (rows.length === 0 || rows.length !== ranges.length) {
          // NEVER a silent latch (req_3763): either a structural handler lands the
          // row within the beat, or the deferred reconcile re-converges loudly.
          schedulePartRowReconcile(`ranges announced ${ranges.length} vs ${rows.length} row(s)`);
          return prev;
        }
        const stamped = stampRowsByRank(rows, ranges);
        rescopeStampedRows(prev, stamped);
        return { ...prev, modelParts: { ...prev.modelParts, [mid]: stamped } };
      });
    };
    // Manual recovery door: the Agent Seat / harness / console can force a
    // reconcile pass without waiting for the next range announcement.
    (globalThis as any).__editor_reconcile_parts = () => reconcilePartRows('manual door');
    return () => {
      (globalThis as any).__modelPartRangesChanged = undefined;
      (globalThis as any).__editor_reconcile_parts = undefined;
    };
  }, []);

  // ── Mesh undo/redo (host journal; req_2520) ──────────────────────────────────
  // Seed meshes by part id, kept for the session so a restored part row regains its
  // seed (the journal note carries part METADATA only — meshes never ride the note).
  const partMeshSeedsRef = useRef<Record<string, EditMesh>>({});
  const meshUndoRedo = (redo: boolean, source = 'native') => {
    const api = modelToolApiRef.current;
    const current = stateRef.current;
    const mid = activePartsModelId(current);
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
    const hostRanges = mid ? readHostPartRanges() : null;
    if (!redo && mid && hostRanges && (!restored || restored.length !== hostRanges.length)) {
      const inverse = recoverAppendedPartUndoRows(current.modelParts[mid] ?? [], hostRanges, r.label);
      if (inverse) {
        console.error(`[partsync] ${verb} ${r.label} preserved ${inverse.length} authored row(s) through the append-only inverse`);
        restored = inverse;
      }
    }
    if (restored && mid) {
      // UNDO SAFETY (req_2644): the journal restored the HOST's part ranges along with
      // the geometry — re-stamp the restored rows' lo/hi from that read-back instead of
      // trusting only the note (a stale note must never outvote the mesh). A note whose
      // COUNT disagrees with the host is stale outright: applying its rows anyway is
      // how a desync used to install itself (req_3763) — reconcile instead.
      if (hostRanges && hostRanges.length !== restored.length) {
        console.error(`[partsync] ${verb} note carries ${restored.length} row(s) but the host restored ${hostRanges.length} part(s) — reconciling instead of applying the stale note`);
        setState((prev) => ({ ...prev, status: `${verb} ${r.label}` }));
        markActiveModelDirty();
        schedulePartRowReconcile(`${verb} note/${restored.length} vs host/${hostRanges.length}`);
        return;
      }
      if (hostRanges && hostRanges.length === restored.length) {
        restored = stampRowsByRank(restored, hostRanges);
      }
      api!.setPartRangesMirror((hostRanges ?? restored.filter((p) => p.lo != null && p.hi != null).map((p) => ({ lo: p.lo!, hi: p.hi! }))));
      const currentPartCount = current.modelParts[mid]?.length ?? 0;
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
  // The keydown subscription mounts once, so the slot jump rides a live ref like
  // every other command it dispatches.
  const recallWorldViewSlotRef = useRef(recallWorldViewSlot);
  recallWorldViewSlotRef.current = recallWorldViewSlot;
  seatShellActionRef.current = (action, args, targetModelId) => {
    const live = stateRef.current;
    const modelId = targetModelId ?? activePartsModelId(live);
    const background = !!targetModelId && targetModelId !== activeSessionModelIdRef.current;
    const parts = modelId ? (live.modelParts[modelId] ?? []) : [];
    const stringArray = (value: unknown): string[] => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
    const fail = (reason: string): SeatShellReceipt => ({ ok: false, reason });
    const ok = (result?: unknown): SeatShellReceipt => ({ ok: true, ...(result === undefined ? {} : { result }) });
    const invokeOutliner = (commandId: string, commandArgs: unknown): string | null => {
      const outcome = invokeApplicationCommand(commandId, commandArgs, 'seat');
      return outcome.status === 'rejected' ? outcome.reason : null;
    };
    try {
      if (action === 'editor-status') {
        const block = blockingNowRef.current(live);
        const activeDocument = live.workspaceDocuments.find((document) => document.id === live.activeWorkspaceDocumentId) ?? null;
        // One explicit readiness word (req_4052). The transcripts show agents pre-sleeping
        // a guessed number of seconds before their first real call, because a refusal
        // never said whether WAITING would help. `starting` and `dialog-blocked` clear on
        // their own and `tools/seat --wait` will poll through them; `ready` means the
        // shell is answering and any later refusal is about the request, not the timing.
        const readiness = block
          ? 'dialog-blocked'
          : activeSessionModelIdRef.current || activeDocument ? 'ready' : 'starting';
        return ok({
          state: readiness,
          status: live.status,
          blocking: block ? { id: block.id, label: block.label } : null,
          unsavedDocumentName,
          activeWorkspaceDocumentId: live.activeWorkspaceDocumentId,
          activeSurface: activeSurface(live),
          activeDocument: activeDocument ? {
            id: activeDocument.id,
            kind: activeDocument.kind,
            sourceId: activeDocument.sourceId,
          } : null,
          activeSessionModelId: activeSessionModelIdRef.current,
          activePartsModelId: activePartsModelId(live),
          modelDirty: modelId ? Boolean(live.modelDirty[modelId]) : null,
          paintLayoutStale: (globalThis as any).__model_paint_layout_stale?.() === 1,
          modelFocusShape: (globalThis as any).__modelFocusBridge?.shape ?? null,
        });
      }
      // Part-ownership truth (req_4189). The shell's Outliner rows and the host's
      // native range table can diverge silently: every range-scoped op keeps working
      // off the shell's numbers while the host already believes most faces are
      // unowned, and the divergence only becomes visible when some later op
      // renormalizes and bakes the host's view in — collapsing every row at once.
      // The context menu shows a human this state; an agent had no door onto it at
      // all, which is why the fault reads as "the editor spontaneously broke".
      // Report BOTH tables in one reply: either alone cannot show a disagreement.
      if (action === 'part-ownership') {
        const raw = (globalThis as any).__mesh_history_log?.();
        if (typeof raw !== 'string' || raw.length === 0) return fail('no resident mesh journal — open a model first');
        let log: any;
        try { log = JSON.parse(raw); } catch { return fail('the host journal log was not valid JSON'); }
        const current = log?.current ?? null;
        if (!current) return fail('the host journal log carried no current state');
        const hostRanges: { lo: number; hi: number }[] = (current.parts ?? [])
          .map((part: any) => ({ lo: Number(part.lo), hi: Number(part.hi) }));
        const shellRows = parts.map((part) => ({ id: part.id, name: part.name, lo: part.lo ?? null, hi: part.hi ?? null }));
        const agrees = shellRows.length === hostRanges.length
          && shellRows.every((row, index) => row.lo === hostRanges[index]?.lo && row.hi === hostRanges[index]?.hi);
        return ok({
          agrees,
          modelId,
          residentSessionModelId: activeSessionModelIdRef.current,
          authoredGroups: current.authoredGroups ?? null,
          triangles: current.triangles ?? null,
          unownedFaces: current.unownedFaces ?? null,
          multiplyOwnedFaces: current.multiplyOwnedFaces ?? null,
          ownershipValid: current.ownershipValid ?? null,
          rangesValid: current.rangesValid ?? null,
          hostParts: current.parts ?? [],
          shellRows,
          editScopeRanges: log?.scope?.ranges ?? null,
        });
      }
      if (action === 'lore') {
        const operation = String(args.operation ?? 'history');
        if (operation === 'status') {
          const response = recoveryStatusV1({ version: 1 });
          return response.ok ? ok(response) : { ok: false, result: response, reason: response.detail };
        }
        if (!modelId) return fail('open a model document first');
        if (operation === 'snapshot') {
          if (activeSessionModelIdRef.current !== modelId) return fail('Lore snapshot needs this model to own the resident native session');
          const identity = meshSessionIdentity({ version: 1, modelId });
          if (!identity.ok) return { ok: false, result: identity, reason: identity.detail };
          const objectIds = loreSnapshotObjectIds(parts);
          if (objectIds) publishSessionObjectIds({
            version: 1,
            modelId,
            sessionToken: identity.sessionToken,
            expectedGeneration: identity.generation,
            ranges: objectIds.map((objectId, rank) => ({ rank, objectId })),
          });
          const response = captureRecoverySnapshotV1({
            version: 1,
            modelId,
            sessionToken: identity.sessionToken,
            expectedGeneration: identity.generation,
            kind: 'panic',
            push: false,
            label: typeof args.label === 'string' ? args.label : 'Agent Seat panic snapshot',
            ...(typeof args.note === 'string' && args.note ? { note: args.note } : {}),
          });
          return response.ok ? ok(response) : { ok: false, result: response, reason: response.detail };
        }
        if (operation === 'history') {
          const response = recoveryHistoryV1({
            version: 1,
            modelId,
            ...(typeof args.cursor === 'string' && args.cursor ? { cursor: args.cursor } : {}),
            ...(Number.isInteger(args.limit) ? { limit: Number(args.limit) } : {}),
          });
          return response.ok ? ok(response) : { ok: false, result: response, reason: response.detail };
        }
        const snapshotId = typeof args.snapshotId === 'string' ? args.snapshotId : '';
        const expectedRevision = typeof args.expectedRevision === 'string' ? args.expectedRevision : '';
        const expectedSha256 = typeof args.expectedSha256 === 'string' ? args.expectedSha256 : '';
        if (!snapshotId || !expectedRevision || !expectedSha256) {
          return fail(`Lore ${operation} needs snapshotId, expectedRevision, and expectedSha256 from a history row`);
        }
        if (operation === 'preview') {
          return fail('Lore preview is a paired Versions-pane session; open it from Recovery → Versions so Scene3D and Lore capabilities close together');
        }
        if (operation === 'pin') {
          const response = recoveryPinV1({
            version: 1,
            modelId,
            snapshotId,
            expectedRevision,
            expectedSha256,
            pinned: args.pinned === true,
            push: false,
          });
          return response.ok ? ok(response) : { ok: false, result: response, reason: response.detail };
        }
        if (operation === 'restore') {
          if (background) return fail('Lore restore needs this model to own the resident native session');
          const expectedObjectNamespaceHash = typeof args.expectedObjectNamespaceHash === 'string'
            ? args.expectedObjectNamespaceHash
            : '';
          if (!expectedObjectNamespaceHash) {
            return fail('Lore restore needs expectedObjectNamespaceHash from the exact history row');
          }
          return commitBlobSnapshotRestore(modelId, {
            snapshotId,
            expectedRevision,
            expectedSha256,
            expectedObjectNamespaceHash,
          });
        }
        return fail('Lore operation must be snapshot, history, preview, pin, restore, or status');
      }
      if (action === 'face-table') {
        if (background) return fail('face inspection belongs to the visible model document; open that model first');
        if (!modelId || activeSessionModelIdRef.current !== modelId) {
          return fail('face inspection needs this model to own the resident native session');
        }
        const pkg = effectiveModelPackage(modelId, live.modelOverrides, live.modelDupes);
        if (!pkg) return fail(`no model package "${modelId}"`);
        const source = String(args.source ?? 'resident');
        const sort = (args.sort ?? { column: 'area', direction: 'asc' }) as FaceTableRequestV1['sort'];
        const filters = Array.isArray(args.filters) ? args.filters as FaceTableRequestV1['filters'] : [];
        const paging = {
          ...(typeof args.cursor === 'string' && args.cursor ? { cursor: args.cursor } : {}),
          ...(args.limit === undefined ? {} : { limit: Number(args.limit) }),
        };
        const identity = source === 'resident' || source === 'diff'
          ? meshSessionIdentity({ version: 1, modelId })
          : null;
        if (identity && !identity.ok) {
          return { ok: false, result: identity, reason: identity.detail };
        }
        if (identity?.ok) {
          const objectIds = loreSnapshotObjectIds(parts);
          if (!objectIds) return fail('face inspection needs one stable object id for every resident part range');
          const publication = publishSessionObjectIds({
            version: 1,
            modelId,
            sessionToken: identity.sessionToken,
            expectedGeneration: identity.generation,
            ranges: objectIds.map((objectId, rank) => ({ rank, objectId })),
          });
          if (!publication.ok) return { ok: false, result: publication, reason: publication.detail };
        }
        const packageDir = resolvePackageDir(pkg.kind, pkg.id);
        const geometryPath = modelPackageGeometryPath(packageDir, pkg.skeleton);
        const savedSha256 = String((globalThis as any).__file_sha256?.(geometryPath) ?? '').trim().toLowerCase();
        let response;
        if (source === 'resident' && identity?.ok) {
          response = inspectFaceTable({
            version: 1, modelId, source,
            sessionToken: identity.sessionToken,
            expectedGeneration: identity.generation,
            sort, filters, ...paging,
          });
        } else if (source === 'saved') {
          if (!/^[0-9a-f]{64}$/.test(savedSha256)) return fail('saved face inspection needs a readable package geometry artifact');
          response = inspectFaceTable({
            version: 1, modelId, source,
            geometryPath, expectedSha256: savedSha256,
            sort, filters, ...paging,
          });
        } else if (source === 'preview') {
          response = inspectFaceTable({
            version: 1, modelId, source,
            previewToken: String(args.previewToken ?? ''),
            expectedSha256: String(args.expectedSha256 ?? ''),
            sort, filters, ...paging,
          });
        } else if (source === 'diff' && identity?.ok) {
          if (!/^[0-9a-f]{64}$/.test(savedSha256)) return fail('resident/saved diff needs a readable package geometry artifact');
          const request: FaceDiffRequestV1 = {
            version: 1, source, modelId,
            sessionToken: identity.sessionToken,
            expectedGeneration: identity.generation,
            geometryPath,
            expectedSavedSha256: savedSha256,
            sort, filters, ...paging,
          };
          response = inspectFaceTable(request);
        } else {
          return fail('face-table source must be resident, saved, preview, or diff');
        }
        if (!response.ok) return { ok: false, result: response, reason: response.detail };
        if (response.source === 'diff') return ok(response);
        const semanticRows = ((globalThis as any).__modelFocusBridge?.semantics?.rows ?? [])
          .filter((row: any) => row?.kind === 'face' && Number.isInteger(row.id));
        return ok(joinFaceTableDisplayNames(response, {
          objects: parts.map((part) => ({ objectId: part.id, name: part.name ?? null })),
          materials: (pkg.textureSlots ?? []).map((slot, material) => ({ material, name: slot.label ?? null })),
          semantics: semanticRows.map((row: any) => ({ region: row.id, name: typeof row.name === 'string' ? row.name : null })),
        }));
      }
      if (action === 'face-select') {
        if (background) return fail('face selection belongs to the visible model document; open that model first');
        if (!modelId || activeSessionModelIdRef.current !== modelId) {
          return fail('face selection needs this model to own the resident native session');
        }
        const response = selectFaceAddress({
          version: 1,
          modelId,
          plane: args.plane as Parameters<typeof selectFaceAddress>[0]['plane'],
          target: args.target as Parameters<typeof selectFaceAddress>[0]['target'],
          additive: args.additive === true,
          frame: args.frame !== false,
        });
        return response.ok ? ok(response) : { ok: false, result: response, reason: response.detail };
      }
      if (action === 'rig-status') {
        if (background) return fail('character rig status belongs to the visible model document; open that model before inspecting its resident rig');
        if (!modelId) return fail('no model in view — open a model document first');
        const pkg = effectiveModelPackage(modelId, live.modelOverrides, live.modelDupes);
        if (!pkg) return fail(`no model package "${modelId}"`);
        if (!hasCharacterRigCapability(pkg)) return ok({
          model: pkg.id,
          name: pkg.name,
          capability: 'absent',
          state: 'detached',
          rows: null,
          weightsStale: false,
          fitReview: false,
          bindReview: false,
        });
        const api = characterRigApiRef.current;
        const target = api?.currentOpenTarget?.();
        if (!api || !target || target.modelId !== pkg.id) return ok({
          model: pkg.id,
          name: pkg.name,
          capability: 'attached',
          state: api?.currentOpenFault?.() ? 'blocked' : 'opening',
          rows: null,
          weightsStale: false,
          fitReview: false,
          bindReview: true,
          fault: api?.currentOpenFault?.() ?? null,
        });
        const snapshot = api.snapshot();
        setCharacterRigSnapshot(snapshot);
        return ok({ model: pkg.id, name: pkg.name, capability: 'attached', ...rigStatusFromSnapshot(snapshot) });
      }
      if (action === 'auto-rig') {
        if (background) return fail('Auto-Rig belongs to the visible model document');
        const operation = String(args.operation ?? 'status');
        const lane = externalAutoRigStateRef.current;
        if (operation === 'status') {
          if (lane.phase === 'running') return fail('Auto-Rig is still running');
          if (lane.phase === 'preview') return ok(lane);
          return fail(live.status.startsWith('Auto-Rig failed:') ? live.status : 'no Auto-Rig preview is active');
        }
        if (operation === 'start' || operation === 'reroll') {
          if (lane.phase === 'running') return fail('Auto-Rig is still running');
          void runExternalAutoRig();
          return ok({ state: 'started', roll: lane.modelId === modelId ? lane.roll + 1 : 1 });
        }
        if (operation === 'accept') {
          if (lane.phase !== 'preview' || lane.modelId !== modelId) return fail('no Auto-Rig preview is active for this model');
          acceptExternalAutoRig();
          return externalAutoRigStateRef.current.phase === 'idle'
            ? ok({ state: 'accepted', roll: lane.roll })
            : fail(stateRef.current.status);
        }
        return fail('Auto-Rig operation must be start, reroll, status, or accept');
      }
      // A page of saved triangles is a lookup, not a dump: past this the reply stops
      // answering a question and becomes a transcript the agent has to re-parse.
      const PACKAGE_TRIANGLE_PAGE = 64;
      // The saved-state lane (req_4052). Before this, the only way to see what a save
      // actually wrote was semantic-status (aggregate counts) or a cold reopen — so
      // agents read mesh/doc.blob themselves with a hand-written struct.unpack and a
      // hardcoded header offset. That reader was already wrong: it assumed RJMD v4's
      // 40-byte header while the format is v5 with 48, and nothing told anyone. The
      // seat is the only correct parser of its own format, so it exposes one.
      if (action === 'package') {
        const operation = String(args.operation ?? 'info');
        if (operation === 'list') {
          const kind = typeof args.kind === 'string' ? args.kind : null;
          return ok({
            models: visibleModels
              .filter((candidate) => !kind || candidate.kind === kind)
              .map((candidate) => ({
                id: candidate.id,
                name: candidate.name,
                kind: candidate.kind,
                saved: resolvePackageDir(candidate.kind, candidate.id) !== null,
                characterRig: hasCharacterRigCapability(candidate),
              })),
          });
        }
        const requested = typeof args.model === 'string' && args.model.length > 0 ? args.model : modelId;
        if (!requested) return fail('no model in view — open a model document or pass model:"<id>"');
        const pkg = modelPackageById(requested);
        if (!pkg) return fail(`no model package "${requested}" — pass the model id from look's percept`);
        const dir = resolvePackageDir(pkg.kind, pkg.id);
        if (!dir) return fail(`"${pkg.name}" has never been saved — there is no package on disk to read`);
        // Read from disk, not from the decode cache: the whole point is to see what
        // the last save actually wrote.
        invalidateMeshDoc(dir);
        const doc = packageMeshDoc(pkg);
        if (!doc) {
          if (meshDocIsUnreadable(dir)) {
            const decode = meshDocUnreadableDiagnostic(dir);
            return {
              ok: false,
              reason: decode
                ? `${dir}/mesh/doc.blob rejected by this editor's RJMD reader [${decode.code}]: ${decode.reason}`
                : `${dir}/mesh/doc.blob exists but did not decode with this editor's RJMD reader`,
              result: { model: pkg.id, name: pkg.name, kind: pkg.kind, dir, decode },
            };
          }
          return fail(`${dir} carries no readable model document`);
        }
        const savedTable = doc.semanticTable ?? null;
        const savedRegions = savedTable?.regions ?? [];
        const savedTriangles = doc.vertices.length / (MESHDOC_VERTEX_STRIDE * 3);
        const savedFaceCount = (values: Uint32Array | null | undefined) => (values ? new Set(values).size : null);
        const identity = {
          model: pkg.id,
          name: pkg.name,
          kind: pkg.kind,
          dir,
          formatVersion: doc.formatVersion ?? null,
          legacy: doc.formatVersion === undefined,
        };
        if (operation === 'info') {
          const parts = packageMeshDocParts(pkg) ?? [];
          const storedSkeleton = readManifest(pkg.kind, pkg.id)?.skeleton;
          const storedDescriptor = storedSkeleton?.characterRig ?? null;
          const storedMeshes = storedSkeleton?.meshes;
          const storedBinding = storedMeshes?.kind === 'skinned' ? storedMeshes.binding ?? null : null;
          return ok({
            ...identity,
            triangles: savedTriangles,
            vertices: doc.vertices.length / MESHDOC_VERTEX_STRIDE,
            authoredFaces: savedFaceCount(doc.faceGroups),
            logicalVertices: doc.hasLogicalVertices ? doc.logicalVertexCount ?? null : null,
            regions: savedRegions.length,
            namedTriangles: doc.semanticRegions
              ? [...doc.semanticRegions].filter((id) => id !== NO_SEMANTIC_ID).length
              : null,
            ranges: doc.ranges.length,
            storedRangeCount: doc.storedRangeCount ?? null,
            recoveredPartRanges: doc.recoveredPartRanges === true,
            rangeObjectIds: doc.rangeObjectIds?.length ?? null,
            glassFirstVertex: doc.glassFirstVertex ?? null,
            bbox: meshDocBounds(doc),
            parts: parts.map((part) => ({ name: part.name, objectId: part.objectId ?? null, kind: part.kind ?? null, visible: part.visible })),
            characterRig: storedDescriptor ? {
              state: storedDescriptor.state,
              bones: storedSkeleton?.bones.length ?? 0,
              external: storedDescriptor.externalProvenance ?? null,
              semanticBindings: storedDescriptor.semanticBindings.length,
              binding: storedBinding,
              bindingPath: storedBinding ? `${dir}/${storedBinding.path}` : null,
            } : null,
          });
        }
        if (operation === 'regions') {
          const triangleCounts = new Map<number, number>();
          for (const id of doc.semanticRegions ?? []) triangleCounts.set(id, (triangleCounts.get(id) ?? 0) + 1);
          return ok({
            ...identity,
            regions: savedRegions.map((region) => ({
              id: region.id,
              name: region.name,
              parent: region.parent ?? null,
              createdBy: region.createdBy ?? null,
              triangles: triangleCounts.get(region.id) ?? 0,
            })),
            unnamedTriangles: triangleCounts.get(NO_SEMANTIC_ID) ?? 0,
          });
        }
        if (operation === 'diff') {
          const resident = readSeatPercept();
          if (!resident) return fail('no live mesh to compare the saved package against');
          const residentNames = new Map(resident.table.regions.map((region) => [region.name, region] as const));
          const savedNames = new Map(savedRegions.map((region) => [region.name, region] as const));
          const residentFaces = new Map(resident.regions.map((region) => [region.id, region.faces] as const));
          const savedFaces = new Map<number, number>();
          for (const id of doc.semanticRegions ?? []) savedFaces.set(id, (savedFaces.get(id) ?? 0) + 1);
          const drift = [...savedNames.keys()]
            .filter((name) => residentNames.has(name))
            .map((name) => ({
              name,
              saved: savedFaces.get(savedNames.get(name)!.id) ?? 0,
              resident: residentFaces.get(residentNames.get(name)!.id) ?? 0,
            }))
            .filter((row) => row.saved !== row.resident)
            .map((row) => ({ ...row, delta: row.resident - row.saved }));
          return ok({
            ...identity,
            dirty: Boolean(live.modelDirty[requested]),
            triangles: { saved: savedTriangles, resident: resident.faces, delta: resident.faces - savedTriangles },
            authoredFaces: { saved: savedFaceCount(doc.faceGroups), resident: resident.authoredFaces },
            regions: {
              saved: savedRegions.length,
              resident: resident.table.regions.length,
              addedSinceSave: [...residentNames.keys()].filter((name) => !savedNames.has(name)),
              removedSinceSave: [...savedNames.keys()].filter((name) => !residentNames.has(name)),
              drift,
            },
            // A resident mesh that matches on every count still differs if a vertex
            // moved, so say what was compared rather than implying byte identity.
            compared: 'triangle, authored-face, and per-region face counts plus the region name set',
            inSync: savedTriangles === resident.faces &&
              savedRegions.length === resident.table.regions.length &&
              drift.length === 0,
          });
        }
        if (operation === 'ranges') {
          // `ranges: N` cannot answer "did this part survive the save with its quads
          // intact" — the per-range GROUP count is what separates a quad mesh from soup
          // inside one part, and it is what agents were counting by hand (req_4077).
          const parts = packageMeshDocParts(pkg) ?? [];
          return ok({
            ...identity,
            ranges: meshDocRangeStats(doc).map((range, at) => ({
              ...range,
              part: parts[at]?.name ?? null,
              trianglesPerGroup: range.groups > 0 ? range.triangles / range.groups : null,
            })),
          });
        }
        if (operation === 'triangles') {
          // Paged on purpose: a whole mesh of corner floats is not an answer, it is a
          // transcript. Ask for the triangles the question is about.
          const requested = Array.isArray(args.indices)
            ? args.indices.map(Number).filter((index) => Number.isInteger(index) && index >= 0)
            : [];
          const lo = Number(args.lo);
          const limit = Math.max(1, Math.min(Number(args.limit) || 16, PACKAGE_TRIANGLE_PAGE));
          const indices = requested.length > 0
            ? requested.slice(0, PACKAGE_TRIANGLE_PAGE)
            : Array.from({ length: limit }, (unused, at) => (Number.isInteger(lo) ? lo : 0) + at);
          const rows = indices.map((index) => meshDocTriangle(doc, index)).filter((row) => row !== null);
          if (rows.length === 0) return fail(`no saved triangle in ${indices.slice(0, 4).join(', ')}… — the document holds ${savedTriangles}`);
          return ok({ ...identity, savedTriangles, triangles: rows });
        }
        if (operation === 'compare') {
          const otherId = String(args.other ?? '').trim();
          if (!otherId) return fail('package compare needs a second model id — it diffs two SAVED packages (use `diff` for saved vs resident)');
          const otherPkg = modelPackageById(otherId);
          const otherDir = otherPkg ? resolvePackageDir(otherPkg.kind, otherPkg.id) : null;
          if (!otherPkg || !otherDir) return fail(`no saved package "${otherId}"`);
          invalidateMeshDoc(otherDir);
          const otherDoc = packageMeshDoc(otherPkg);
          if (!otherDoc) {
            // Same diagnostic quality as `info`. A comparison that fails because the
            // OTHER package is corrupt must say which package and why — "no readable
            // document" sends the agent looking in the wrong file.
            const decode = meshDocIsUnreadable(otherDir) ? meshDocUnreadableDiagnostic(otherDir) : null;
            return {
              ok: false,
              reason: decode
                ? `${otherDir}/mesh/doc.blob rejected by this editor's RJMD reader [${decode.code}]: ${decode.reason}`
                : `${otherDir} carries no readable model document`,
              result: { model: otherPkg.id, name: otherPkg.name, dir: otherDir, decode },
            };
          }
          return ok({
            a: { model: pkg.id, name: pkg.name, dir },
            b: { model: otherPkg.id, name: otherPkg.name, dir: otherDir },
            tolerance: Number.isFinite(Number(args.tolerance)) ? Number(args.tolerance) : undefined,
            ...compareMeshDocs(doc, otherDoc, Number.isFinite(Number(args.tolerance)) ? Number(args.tolerance) : undefined),
          });
        }
        return fail(`unknown package operation "${operation}" — list, info, regions, ranges, triangles, diff, or compare`);
      }
      if (action === 'model-open') {
        const requested = String(args.model ?? args.id ?? '').trim();
        const pkg = visibleModels.find((candidate) => candidate.id === requested || candidate.name === requested);
        if (!pkg) return fail(`no model package "${requested}"`);
        openModelDocument(pkg);
        return ok({ model: pkg.id, name: pkg.name, kind: pkg.kind });
      }
      if (action === 'model-export' && String(args.id ?? '') === 'export-character' && (args.role === 'player' || args.role === 'npc')) {
        exportCharacterAs(args.role);
        return ok({ id: 'export-character', role: args.role });
      }
      if (action === 'command' || action === 'viewport' || action === 'paint-tool' || action === 'model-export' || action === 'model-starter') {
        const id = String(args.id ?? '');
        const command = commandById(id);
        if (!id || command.id !== id) return fail(`unknown editor command "${id}"`);
        runCommandRef.current(id, 'seat');
        return ok({ id, name: command.name });
      }
      if (action === 'thumbnail') {
        // The staged product shot (req_4044). It renders the VISIBLE viewport's
        // orbit scene, so it belongs to the model on screen — a background lane
        // has no framed view to shoot.
        if (background) return fail('a thumbnail is shot from the visible viewport; a background model is not the document on screen');
        const staged = stageThumbnailRef.current();
        return staged.ok ? ok({ path: staged.path }) : fail(staged.reason ?? 'thumbnail was not staged');
      }
      if (action === 'part-select') {
        if (!modelId) return fail('open a multipart model first');
        const ids = stringArray(args.ids ?? (typeof args.id === 'string' ? [args.id] : []));
        const selected = ids.filter((id) => parts.some((part) => part.id === id && part.visible));
        if (selected.length !== ids.length || selected.length === 0) return fail('every selected part must exist and be visible');
        const requestedPrimary = typeof args.primary === 'string' ? args.primary : selected[selected.length - 1]!;
        const primary = selected.includes(requestedPrimary) ? requestedPrimary : selected[selected.length - 1]!;
        if (background) {
          pushPartSetToHost({ visible: false, paint: false, selMode: 3 }, parts, selected, primary);
          return ok({ ids: selected, primary, focus: 'native-scope-only' });
        }
        selectedPartIdsRef.current = selected;
        setSelectedPartIds(selected);
        pushPartSetToHost({ visible: true, paint: live.modelTool.paint, selMode: live.modelTool.selMode }, parts, selected, primary);
        const next = { ...live, modelActivePartId: primary, status: `Agent Seat selected ${selected.length} part(s)` };
        stateRef.current = next;
        setState(next);
        return ok({ ids: selected, primary });
      }
      if (action === 'part-rename') {
        const id = String(args.id ?? '');
        const name = String(args.name ?? '').trim();
        if (!modelId || !parts.some((part) => part.id === id) || !name) return fail('part id and non-empty name are required');
        const reason = invokeOutliner(MODEL_PART_RENAME_COMMAND_ID, { modelId, partId: id, name });
        if (reason) return fail(reason);
        return ok({ id, name });
      }
      if (action === 'part-visibility') {
        if (!modelId) return fail('open a multipart model first');
        const ids = stringArray(args.ids ?? (typeof args.id === 'string' ? [args.id] : []));
        const visible = args.visible !== false;
        const targets = parts.filter((part) => ids.includes(part.id) && part.visible !== visible);
        if (ids.length === 0 || targets.length === 0) return fail('no matching part needs that visibility change');
        applyPartVisibility(modelId, parts, ids, !visible, `${targets.length} Agent Seat part(s)`, 'seat');
        return ok({ ids, visible });
      }
      if (action === 'part-delete') {
        if (!modelId) return fail('open a multipart model first');
        const ids = stringArray(args.ids ?? (typeof args.id === 'string' ? [args.id] : []));
        if (ids.length === 0 || ids.some((id) => !parts.some((part) => part.id === id))) return fail('valid part id(s) are required');
        selectedPartIdsRef.current = ids;
        setSelectedPartIds(ids);
        deletePart(ids[0]!, 'seat');
        return ok({ ids });
      }
      if (action === 'part-duplicate') {
        const id = String(args.id ?? live.modelActivePartId ?? '');
        const part = parts.find((row) => row.id === id);
        const axisRaw = args.axis;
        const axis = axisRaw === 'x' ? 0 : axisRaw === 'y' ? 1 : axisRaw === 'z' ? 2 : -1;
        if (!part) return fail('part not found');
        duplicatePartRows([part], axis, undefined, 'seat');
        return ok({ id, axis });
      }
      if (action === 'part-merge') {
        const ids = stringArray(args.ids);
        if (ids.length < 2 || ids.some((id) => !parts.some((part) => part.id === id))) return fail('two or more valid part ids are required');
        selectedPartIdsRef.current = ids;
        setSelectedPartIds(ids);
        mergeSelectedParts('seat');
        return ok({ ids });
      }
      if (action === 'part-path-array') {
        const ids = stringArray(args.ids);
        if (!args.params || typeof args.params !== 'object') return fail('source part ids and path-array params are required');
        return applySeatPathArray(ids, args.params as PathArrayParams);
      }
      if (action === 'part-import') {
        const packageId = String(args.id ?? '');
        const pkg = visibleModels.find((model) => model.id === packageId || model.name === packageId);
        if (!pkg) return fail(`model package "${packageId}" was not found`);
        importModelAsParts(pkg, 'seat');
        return ok({ id: pkg.id, name: pkg.name });
      }
      if (action === 'parts-group' || action === 'parts-ungroup') {
        if (!modelId) return fail('open a multipart model first');
        const ids = stringArray(args.ids);
        if (ids.length === 0) return fail('part ids required');
        const reason = invokeOutliner(action === 'parts-group' ? MODEL_PARTS_GROUP_COMMAND_ID : MODEL_PARTS_UNGROUP_COMMAND_ID, { modelId, partIds: ids });
        if (reason) return fail(reason);
        return ok({ ids });
      }
      if (action === 'group-rename' || action === 'group-dissolve') {
        if (!modelId) return fail('open a multipart model first');
        const groupId = String(args.id ?? '');
        if (!groupId) return fail('group id required');
        if (action === 'group-rename') {
          const name = String(args.name ?? '').trim();
          if (!name) return fail('group name required');
          const reason = invokeOutliner(MODEL_GROUP_RENAME_COMMAND_ID, { modelId, groupId, name });
          if (reason) return fail(reason);
        } else {
          const reason = invokeOutliner(MODEL_GROUP_DISSOLVE_COMMAND_ID, { modelId, groupId });
          if (reason) return fail(reason);
        }
        return ok({ groupId });
      }
      if (action === 'group-visibility') {
        const groupId = String(args.id ?? '');
        if (!groupId || !parts.some((part) => partGroupPath(part).some((group) => group.id === groupId))) return fail('group not found');
        toggleVisiblePartGroup(groupId);
        return ok({ groupId });
      }
      if (action === 'group-duplicate') {
        const groupId = String(args.id ?? '');
        if (!groupId) return fail('group id required');
        duplicatePartGroup(groupId);
        return ok({ groupId });
      }
      if (action === 'outliner-move') {
        if (!modelId || !args.item || !args.target) return fail('item and target descriptors are required');
        const reason = invokeOutliner(MODEL_OUTLINER_MOVE_COMMAND_ID, { modelId, item: args.item, target: args.target });
        if (reason) return fail(reason);
        return ok();
      }
      if (action === 'role-name') {
        const partId = String(args.partId ?? '');
        const role = String(args.role ?? '').trim();
        if (!modelId || !partId || !role || !parts.some((part) => part.id === partId)) return fail('valid partId and role are required');
        const reason = invokeOutliner(MODEL_PART_RENAME_COMMAND_ID, { modelId, partId, name: role });
        if (reason) return fail(reason);
        return ok({ partId, role });
      }
      if (action === 'model-rename') {
        const id = String(args.id ?? modelId ?? '');
        const name = String(args.name ?? '').trim();
        if (!id || !name) return fail('model id and name are required');
        renameModel(id, name);
        return ok({ id, name });
      }
      if (action === 'model-import') {
        const path = String(args.path ?? '').trim();
        if (!path) return fail('a .glb, .obj, or .stl path is required');
        if (isStlFile(path)) {
          void (async () => {
            const conversion = await convertStlToGlb(path);
            if (!conversion.ok) {
              setState((prev) => ({ ...prev, status: `Agent Seat STL import failed: ${conversion.error}` }));
              return;
            }
            const imported = importStlModelFilePackage(path, conversion.outputPath);
            openModelFileDocument(conversion.outputPath, imported ?? undefined);
            if (imported) remove(conversion.outputPath);
          })();
          return ok({ path, pending: true });
        }
        if (!isViewerFile(path)) return fail('model import accepts .glb, .obj, or .stl');
        openModelFileDocument(path);
        return ok({ path });
      }
      if (action === 'texture-slot') {
        if (!modelId) return fail('open a model first');
        const pkg = visibleModels.find((model) => model.id === modelId);
        const slots = live.modelTextureSlots[modelId] ?? pkg?.textureSlots ?? [];
        const operation = String(args.operation ?? 'read');
        if (operation === 'read') return ok(slots);
        if (operation === 'replace') {
          const normalized = normalizeModelTextureSlots(args.slots);
          if (!normalized) return fail('slots must be an array');
          setModelTextureSlots(modelId, normalized);
          return ok(normalized);
        }
        if (operation === 'create') {
          const purpose = args.purpose === 'screen' || args.purpose === 'flora' ? args.purpose : 'material';
          const result = createTextureSlotFromSelection(slots, (index) => Number((globalThis as any).__mesh_texture_slot_assign?.(index) ?? 0), {
            purpose,
            label: typeof args.label === 'string' ? args.label : undefined,
          });
          if (!result.slot) return fail('select one or more faces in Face mode first');
          setModelTextureSlots(modelId, [...result.slots]);
          return ok({ slot: result.slot, assignedFaces: result.assignedFaces });
        }
        if (operation === 'clear-selected') {
          const changed = Number((globalThis as any).__mesh_texture_slot_clear?.() ?? 0);
          return changed > 0 ? ok({ changed }) : fail('selected faces do not carry a texture slot');
        }
        const index = Number(args.index);
        if (!Number.isInteger(index) || index < 0 || index >= slots.length) return fail('a valid texture-slot index is required');
        if (operation === 'assign') {
          const changed = Number((globalThis as any).__mesh_texture_slot_assign?.(index) ?? 0);
          return changed > 0 ? ok({ changed }) : fail('select one or more faces in Face mode first');
        }
        if (operation === 'select') {
          const changed = Number((globalThis as any).__mesh_texture_slot_select?.(index) ?? 0);
          return changed > 0 ? ok({ changed }) : fail('that texture slot has no faces');
        }
        if (operation === 'remove') {
          (globalThis as any).__mesh_texture_slot_remove?.(index);
          const next = slots.filter((_, at) => at !== index);
          setModelTextureSlots(modelId, next);
          return ok(next);
        }
        if (operation === 'rename' || operation === 'patch') {
          const current = slots[index]!;
          const patch = args.patch && typeof args.patch === 'object' ? args.patch as Record<string, unknown> : args;
          const normalized = normalizeModelTextureSlots(slots.map((slot, at) => at === index ? { ...slot, ...patch, id: current.id } : slot));
          if (!normalized) return fail('texture-slot patch was invalid');
          setModelTextureSlots(modelId, normalized);
          return ok(normalized[index]);
        }
        return fail(`unknown texture-slot operation "${operation}"`);
      }
      if (action === 'rig') {
        if (!modelId) return fail('open a model first');
        const parsed = parseCharacterRigSeatAction(args);
        if (!parsed.ok) return fail(parsed.error);
        if (parsed.value.kind === 'legacy-prop') {
          const pkg = visibleModels.find((model) => model.id === modelId);
          const operation = parsed.value.operation;
          if (operation === 'read') return ok({
            rig: live.modelRigs[modelId] ?? (pkg?.skeleton ? skeletonToPropRig(pkg.skeleton) : {}),
            lights: normalizeModelLights(live.modelLights[modelId] ?? pkg?.lights ?? []),
          });
          if (operation === 'replace') {
            if (!args.rig || typeof args.rig !== 'object') return fail('rig must be an object');
            setModelRig(modelId, args.rig as PropRig);
            return ok(args.rig);
          }
          if (!Array.isArray(args.lights)) return fail('lights must be an array');
          const lights = normalizeModelLights(args.lights as LightRig[]);
          setModelLights(modelId, lights);
          return ok(lights);
        }
        if (background) return fail('character rig operations belong to the visible model document; open that model before changing its resident rig');
        const rigAction: CharacterRigSeatAction = parsed.value.action;
        const pkg = effectiveModelPackage(modelId, live.modelOverrides, live.modelDupes);
        if (!pkg) return fail(`no model package "${modelId}"`);
        if (rigAction.operation === 'attach-humanoid') {
          if (hasCharacterRigCapability(pkg)) return ok({ model: pkg.id, capability: 'already-attached' });
          const orderedObjectIds = (live.modelParts[pkg.id] ?? [])
            .slice()
            .sort((left, right) => (left.lo ?? Number.MAX_SAFE_INTEGER) - (right.lo ?? Number.MAX_SAFE_INTEGER))
            .map((part) => part.id);
          let preflight = null;
          if (orderedObjectIds.length > 0) {
            try {
              preflight = characterRigApiRef.current?.preflightAttach(orderedObjectIds) ?? null;
            } catch (error) {
              return fail(`humanoid rig attachment preflight failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (preflight && !preflight.accepted) {
              return {
                ok: false,
                reason: `attach-humanoid refused — first object ${preflight.candidateBodyObjectId} is not the largest connected mesh`,
                result: {
                  preflight,
                  plan: [
                    `move stable object ${preflight.recommendedBodyObjectId} to the first geometry range`,
                    'rerun attach-humanoid; no rig descriptor was installed',
                  ],
                },
              };
            }
          }
          const attached = attachCharacterRig(pkg.id);
          const attachedBodyObjectId = attached?.skeleton?.characterRig?.objectBindings
            .find((binding) => binding.mode === 'body')?.objectId ?? null;
          return attached
            ? ok({
                model: attached.id,
                capability: 'attached',
                bodyObjectId: attachedBodyObjectId,
                preflight,
                sessionState: 'open',
              })
            : fail('humanoid rig attachment was refused; the editor status contains the exact package error');
        }
        if (!hasCharacterRigCapability(pkg)) {
          return fail('this model has no humanoid rig capability — run attach-humanoid first; package kind is irrelevant');
        }
        const api = characterRigApiRef.current;
        const target = api?.currentOpenTarget?.();
        if (!api || !target || target.modelId !== pkg.id) {
          return fail(api?.currentOpenFault?.() ?? 'the native character rig session is opening; retry after rig-status reports resident rows');
        }
        const adoptRigSnapshot = (snapshot: CharacterRigSnapshot, dirty = false) => {
          setCharacterRigSnapshot(snapshot);
          if (dirty) markModelDirty(pkg.id);
          return snapshot;
        };
        const currentRigStatus = () => {
          const snapshot = adoptRigSnapshot(api.snapshot());
          return { snapshot, status: rigStatusFromSnapshot(snapshot) };
        };
        const blockedGateReceipt = (verb: string, rows: Record<string, unknown>): SeatShellReceipt => ({
          ok: false,
          reason: `${verb} refused — ${Object.keys(rows).join(', ')}`,
          result: { failingRows: rows },
        });
        const primaryGateFailures = (status: ReturnType<typeof rigStatusFromSnapshot>): Record<string, unknown> => {
          const failures: Record<string, unknown> = {};
          if (status.rows.connected_body.status !== 'ready') failures.connected_body = status.rows.connected_body;
          if (status.rows.required_semantics.status !== 'ready') failures.required_semantics = status.rows.required_semantics;
          if (status.rows.canonical_skeleton !== 'ready') failures.canonical_skeleton = status.rows.canonical_skeleton;
          return failures;
        };

        if (rigAction.operation === 'coverage') return ok(currentRigStatus().snapshot.semanticCoverage);
        if (rigAction.operation === 'select-detached') return ok(api.inspect({ kind: 'selectDetached' }));
        if (rigAction.operation === 'select-uncovered') return ok(api.inspect({ kind: 'selectUncovered' }));
        if (rigAction.operation === 'boundary-audit') return ok(api.inspect({ kind: 'boundaryAudit' }));
        if (rigAction.operation === 'probe') return ok(api.inspect({ kind: 'probe', logicalVertexId: rigAction.vertex }));
        if (rigAction.operation === 'weights-summary') return ok(api.inspect({ kind: 'weightsSummary', boneId: rigAction.bone }));
        if (rigAction.operation === 'weights-symmetry') return ok(api.inspect({
          kind: 'weightsSymmetry',
          ...(rigAction.tolerance === undefined ? {} : { tolerance: rigAction.tolerance }),
        }));
        if (rigAction.operation === 'skeleton') return ok(api.inspect({ kind: 'skeleton' }));
        if (rigAction.operation === 'bend-test') {
          const test = ({
            shoulder: 'shoulder_abduction', elbow: 'elbow_flex', wrist: 'wrist_flex',
            hip: 'hip_flex', knee: 'knee_flex',
          } as const)[rigAction.test];
          return ok(api.inspect({ kind: 'bendTest', test, side: rigAction.side }));
        }
        if (rigAction.operation === 'bone-role') {
          const membership = humanoidSemanticMembershipFromKey(rigAction.role);
          if (!membership) return fail(`unknown stable humanoid role "${rigAction.role}"`);
          const snapshot = adoptRigSnapshot(api.command({
            kind: 'setSemanticBinding',
            boneId: rigAction.bone,
            role: membership.role,
            ...(membership.side ? { side: membership.side } : {}),
          }), true);
          return ok({ bone: rigAction.bone, role: rigAction.role, status: rigStatusFromSnapshot(snapshot) });
        }
        if (rigAction.operation === 'role') {
          const membership = humanoidSemanticMembershipFromKey(rigAction.role);
          if (!membership) return fail(`unknown stable humanoid role "${rigAction.role}"`);
          const receipt = withNativeMeshActionSource('seat', () =>
            modelToolApiRef.current?.assignHumanoidSemantic(membership) ?? null);
          if (!receipt?.applied) return fail(receipt?.reason ?? 'select one or more BODY faces before assigning anatomy');
          markModelDirty(pkg.id);
          const snapshot = adoptRigSnapshot(api.snapshot());
          return ok({ role: receipt.roleKey, changed: receipt.changed, status: rigStatusFromSnapshot(snapshot) });
        }
        if (rigAction.operation === 'object-mode') {
          const binding = rigAction.mode === 'rigid'
            ? { objectId: rigAction.id, mode: rigAction.mode, boneId: rigAction.bone } as const
            : { objectId: rigAction.id, mode: rigAction.mode } as const;
          const snapshot = adoptRigSnapshot(api.command({ kind: 'setObjectBinding', binding }), true);
          return ok({ binding, status: rigStatusFromSnapshot(snapshot) });
        }
        if (rigAction.operation === 'fit') {
          const before = currentRigStatus();
          const failures = primaryGateFailures(before.status);
          if (Object.keys(failures).length > 0) return blockedGateReceipt('rig fit', failures);
          adoptRigSnapshot(api.command({ kind: 'fitSkeleton' }), true);
          return ok(api.inspect({ kind: 'skeleton' }));
        }
        if (rigAction.operation === 'joint') {
          const snapshot = 'lock' in rigAction
            ? adoptRigSnapshot(api.command({ kind: 'setJointLock', boneId: rigAction.bone, locked: rigAction.lock }), true)
            : adoptRigSnapshot(api.command({
                kind: 'setJointGlobalTransform',
                boneId: rigAction.bone,
                origin: rigAction.origin,
                ...(rigAction.frame ? { frame: rigAction.frame } : {}),
              }), true);
          return ok({ bone: rigAction.bone, status: rigStatusFromSnapshot(snapshot), skeleton: api.inspect({ kind: 'skeleton' }) });
        }
        if (rigAction.operation === 'mirror-joints') {
          adoptRigSnapshot(api.command({ kind: 'mirrorJoints', source: rigAction.source }), true);
          return ok(api.inspect({ kind: 'skeleton' }));
        }
        if (rigAction.operation === 'scale-skeleton') {
          const snapshot = adoptRigSnapshot(api.command({
            kind: 'scaleExternalSkeleton',
            factor: rigAction.factor,
          }), true);
          return ok({
            factor: rigAction.factor,
            status: rigStatusFromSnapshot(snapshot),
            skeleton: api.inspect({ kind: 'skeleton' }),
          });
        }
        if (rigAction.operation === 'bind') {
          const before = currentRigStatus();
          const failures = primaryGateFailures(before.status);
          if (Object.keys(failures).length > 0) return blockedGateReceipt('rig bind', failures);
          const boundary = api.inspect<CharacterRigBoundaryAudit>({ kind: 'boundaryAudit' });
          if (boundary.raggedCount > 0) return blockedGateReceipt('rig bind', {
            boundary_audit: {
              status: 'blocked',
              ragged: boundary.raggedCount,
              interfaces: boundary.entries.filter((row) => row.ragged).map((row) => `${row.proximalRole}->${row.distalRole}`),
            },
          });
          const snapshot = adoptRigSnapshot(api.command({ kind: 'autoBind' }), true);
          return ok({ status: rigStatusFromSnapshot(snapshot), saved: false });
        }
        if (rigAction.operation === 'prune-weights') {
          // req_4304: re-apply the joint-span law to the resident rows in
          // place — the repair for bindings adopted before the law existed.
          const snapshot = adoptRigSnapshot(api.command({ kind: 'pruneWeights' }), true);
          return ok({ status: rigStatusFromSnapshot(snapshot), saved: false });
        }
        if (rigAction.operation === 'save') {
          const before = currentRigStatus();
          if (before.snapshot.state !== 'bound' || before.snapshot.weightsStale) {
            return fail('character rig save refused — the resident external weights are not current and bound');
          }
          if (!saveActiveModelNow('Saved character rig by Agent Seat', 'explicit')) {
            return fail(stateRef.current.status);
          }
          return ok({ model: pkg.id, state: before.snapshot.state, saved: true });
        }
        if (rigAction.operation === 'undo' || rigAction.operation === 'redo') {
          const snapshot = adoptRigSnapshot(rigAction.operation === 'undo' ? api.undo() : api.redo(), true);
          return ok({ status: rigStatusFromSnapshot(snapshot), history: snapshot.history });
        }
        return fail(`unknown character rig operation "${(rigAction as CharacterRigSeatAction).operation}"`);
      }
      const bridge = (globalThis as any).__modelFocusBridge;
      if (action === 'uv-state') {
        if (!bridge?.uv) return fail('UV focus bridge unavailable');
        if (Array.isArray(args.indices)) {
          const indices = [...new Set(args.indices
            .map(Number)
            .filter((index: number) => Number.isInteger(index) && index >= 0 && index < bridge.uv.islands.length))];
          return ok({
            key: bridge.uv.key,
            revision: bridge.uv.revision,
            w: bridge.uv.w,
            h: bridge.uv.h,
            selectedIslands: bridge.uv.selectedIslands,
            rows: indices.map((index) => ({ index, rect: bridge.uv.islands[index], intent: bridge.uv.intents[index] })),
          });
        }
        return ok(bridge.uv);
      }
      if (action === 'uv-select') {
        if (!bridge) return fail('UV focus bridge unavailable');
        const mode = String(args.mode ?? 'islands');
        if (mode === 'island') return bridge.selectUvIsland(Number(args.index), args.additive === true) ? ok() : fail('UV island selection rejected');
        if (mode === 'islands') return bridge.selectUvIslands(new Uint32Array((args.indices as number[]) ?? [])) ? ok() : fail('UV island-set selection rejected');
        if (mode === 'face') return bridge.selectUvFace(Number(args.index), args.additive === true) ? ok() : fail('UV face selection rejected');
        if (mode === 'orientation') { const count = bridge.selectUvOrientation(); return count > 0 ? ok({ count }) : fail('select one oriented face first'); }
        return fail(`unknown UV selection mode "${mode}"`);
      }
      if (action === 'uv-layout') {
        const values = Array.isArray(args.rects) ? args.rects.map(Number) : [];
        return bridge?.applyUvLayout?.(new Uint32Array(values)) ? ok({ values: values.length }) : fail('UV layout rejected');
      }
      if (action === 'uv-prestack' || action === 'uv-stitch' || action === 'uv-two-sheet') {
        if (!bridge?.uv) return fail('UV focus bridge unavailable');
        const operation = String(args.operation ?? 'plan');
        if (action === 'uv-two-sheet' && operation === 'export-guides') {
          const applied = seatAppliedTwoSheetRef.current;
          const token = String(args.token ?? '');
          if (!applied || applied.token !== token) return fail('applied two-sheet token is missing or expired');
          const hero = bridge.exportUvGenerationZoneGuide(
            applied.zones.hero.islands.map((index) => applied.rects[index]!),
            applied.zones.hero.zone,
            'hero',
            args.numbered === true,
          );
          const uniform = bridge.exportUvGenerationZoneGuide(
            applied.zones.uniform.islands.map((index) => applied.rects[index]!),
            applied.zones.uniform.zone,
            'uniform',
            args.numbered === true,
          );
          return hero.path && uniform.path ? ok({ hero, uniform }) : fail(hero.path ? uniform.note : hero.note);
        }
        if (operation === 'apply') {
          const pending = seatUvPlanRef.current;
          const token = String(args.token ?? '');
          const expectedKind = action === 'uv-prestack' ? 'prestack' : action === 'uv-stitch' ? 'stitch' : 'two-sheet';
          if (!pending || pending.kind !== expectedKind || pending.token !== token) {
            return fail('UV plan token is missing or no longer current; run plan again');
          }
          if (bridge.uv.key !== pending.uvKey || bridge.uv.revision !== pending.uvRevision) {
            seatUvPlanRef.current = null;
            return fail('UV plan expired because the live atlas changed; run plan again');
          }
          const corners = flattenUvFaceCorners(pending.rects);
          if (!corners || !bridge.applyUvGeometry(corners, pending.historyAction)) {
            seatUvPlanRef.current = null;
            return fail('UV plan was rejected by the live atlas');
          }
          if (pending.kind === 'two-sheet' && pending.zones) {
            seatAppliedTwoSheetRef.current = { token: pending.token, rects: pending.rects, zones: pending.zones };
          }
          seatUvPlanRef.current = null;
          return ok({ ...pending.summary, applied: true });
        }
        if (operation !== 'plan') return fail('UV operation must be plan or apply');

        const uv = bridge.uv;
        const token = `uv-${action}-${uv.revision}-${++seatUvPlanSerialRef.current}`;
        if (action === 'uv-two-sheet') {
          const numericIndices = (value: unknown): number[] => Array.isArray(value)
            ? value.map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < uv.islands.length)
            : [];
          const stringPatterns = (value: unknown): string[] => Array.isArray(value)
            ? value.filter((pattern): pattern is string => typeof pattern === 'string' && pattern.trim().length > 0)
            : [];
          const plan = planTwoSheetUvLayout(uv.islands, uv.w, uv.h, {
            intents: uv.intents,
            heroIslands: numericIndices(args.heroIslands),
            uniformIslands: numericIndices(args.uniformIslands),
            heroSemantics: stringPatterns(args.heroSemantics),
            uniformSemantics: stringPatterns(args.uniformSemantics),
            ...(args.automaticHeroAreaCoverage === undefined ? {} : { automaticHeroAreaCoverage: Number(args.automaticHeroAreaCoverage) }),
            ...(args.heroZoneFraction === undefined ? {} : { heroZoneFraction: Number(args.heroZoneFraction) }),
            ...(args.normalizeMaxAreaTexels === undefined ? {} : { normalizeMaxAreaTexels: Number(args.normalizeMaxAreaTexels) }),
            ...(args.minimumReadableAreaTexels === undefined ? {} : { minimumReadableAreaTexels: Number(args.minimumReadableAreaTexels) }),
            ...(args.maximumReadabilityBoost === undefined ? {} : { maximumReadabilityBoost: Number(args.maximumReadabilityBoost) }),
          });
          const summary = {
            token,
            fits: plan.fits,
            reason: plan.reason,
            densityLaw: plan.densityLaw,
            sourceIslands: plan.sourceIslands,
            sourceFootprints: plan.sourceFootprints,
            prestackedFootprints: plan.prestackedFootprints,
            uniqueFootprints: plan.uniqueFootprints,
            stackedIslands: plan.stackedIslands,
            changedIslands: plan.changedIslands,
            heroFootprints: plan.heroFootprints,
            uniformFootprints: plan.uniformFootprints,
            aspectClasses: plan.aspectClasses,
            heroScale: plan.heroScale,
            minimumReadableAreaRequested: plan.minimumReadableAreaRequested,
            minimumReadableAreaAchieved: plan.minimumReadableAreaAchieved,
            readabilityBoostedFootprints: plan.readabilityBoostedFootprints,
            readabilityCappedFootprints: plan.readabilityCappedFootprints,
            zones: plan.zones,
          };
          seatUvPlanRef.current = plan.fits ? {
            token, kind: 'two-sheet', uvKey: uv.key, uvRevision: uv.revision,
            rects: plan.rects, historyAction: 'stack', summary,
            zones: {
              hero: { zone: plan.zones.hero, islands: [...plan.heroIslands] },
              uniform: { zone: plan.zones.uniform, islands: [...plan.uniformIslands] },
            },
          } : null;
          return ok(summary);
        }
        if (action === 'uv-prestack') {
          const mode = String(args.mode ?? 'normalize');
          if (mode !== 'exact' && mode !== 'normalize') return fail('prestack mode must be exact or normalize');
          const requestedArea = args.normalizeMaxAreaTexels === undefined
            ? UV_LAYOUT_TUNING.repeatNormalizeDefaultMaxAreaTexels
            : Number(args.normalizeMaxAreaTexels);
          if (!Number.isFinite(requestedArea) || requestedArea < 0) return fail('normalizeMaxAreaTexels must be a non-negative number');
          const equivalenceKeys = uv.intents.map((intent: { material?: number | null; semanticNames?: readonly string[] }, island: number) => {
            const material = intent.material == null ? 'material:none' : `material:${intent.material}`;
            const semantics = uvRepeatSemanticFamily(intent.semanticNames, island);
            return `${material}|${semantics}`;
          });
          const plan = mode === 'normalize'
            ? planProgressiveRepeatedUvStacks(uv.islands, uv.w, uv.h, { normalizeMaxAreaTexels: requestedArea, equivalenceKeys })
            : planRepeatedUvStacks(uv.islands, 'exact', uv.w, uv.h, { equivalenceKeys });
          const inspectedIndices = new Set((Array.isArray(args.indices) ? args.indices : [])
            .map(Number)
            .filter((index: number) => Number.isInteger(index) && index >= 0 && index < uv.islands.length));
          const summary = {
            token,
            mode,
            sourceIslands: plan.sourceIslands,
            sourceFootprints: plan.sourceFootprints,
            uniqueFootprints: plan.uniqueFootprints,
            families: plan.groups.length,
            stackedIslands: plan.stackedIslands,
            changedIslands: plan.changedIslands,
            normalizedIslands: plan.normalizedIslands,
            normalizationProtectedIslands: plan.normalizationProtectedIslands,
            unclassifiedIslands: plan.unclassifiedIslands,
            normalizeMaxAreaTexels: plan.normalizeMaxAreaTexels,
            ...(inspectedIndices.size === 0 ? {} : {
              inspectedFamilies: plan.groups.filter((group) => group.islands.some((index) => inspectedIndices.has(index))),
            }),
          };
          seatUvPlanRef.current = {
            token, kind: 'prestack', uvKey: uv.key, uvRevision: uv.revision,
            rects: plan.rects, historyAction: 'stack', summary,
          };
          return ok(summary);
        }

        const indices = (Array.isArray(args.indices) ? args.indices : uv.selectedIslands)
          .map(Number)
          .filter((index: number) => Number.isInteger(index) && index >= 0 && index < uv.islands.length);
        const uniqueIndices = [...new Set<number>(indices)];
        const active = Number(args.active === undefined ? uniqueIndices[0] : args.active);
        if (uniqueIndices.length < 2 || !Number.isInteger(active) || !uniqueIndices.includes(active)) {
          return fail('stitch plan needs two or more island indices and an active member');
        }
        const plan = stitchUvIslands(uv.islands, uniqueIndices, active, uv.w, uv.h);
        const summary = {
          token,
          sourceIslands: uv.islands.length,
          sourceFootprints: countUvTextureFootprints(uv.islands),
          uniqueFootprints: countUvTextureFootprints(plan.rects),
          indices: uniqueIndices,
          selectedIslands: uniqueIndices.length,
          active,
          stitchedIslands: plan.stitched,
          unmatchedIslands: plan.unmatched,
          blockedIslands: plan.blocked,
          seamEdges: plan.seamEdges,
          seamVertices: plan.seamVertices,
          evaluatedCandidates: plan.evaluatedCandidates,
        };
        seatUvPlanRef.current = {
          token, kind: 'stitch', uvKey: uv.key, uvRevision: uv.revision,
          rects: plan.rects, historyAction: 'stitch', summary,
        };
        return ok(summary);
      }
      if (action === 'uv-geometry') {
        const values = Array.isArray(args.corners) ? args.corners.map(Number) : [];
        const historyAction = String(args.historyAction ?? 'move');
        return bridge?.applyUvGeometry?.(new Float32Array(values), historyAction) ? ok({ values: values.length }) : fail('UV geometry rejected');
      }
      if (action === 'uv-history') {
        if (!bridge) return fail('UV focus bridge unavailable');
        const operation = String(args.operation ?? 'read');
        if (operation === 'read') return ok(bridge.readUvHistory());
        const message = operation === 'undo' ? bridge.undoUvHistory() : operation === 'redo' ? bridge.redoUvHistory() : null;
        return message === null ? fail('operation must be read, undo, or redo') : ok({ message });
      }
      if (action === 'uv-atlas') {
        if (!bridge) return fail('UV focus bridge unavailable');
        const operation = String(args.operation ?? '');
        if (operation === 'reset') return ok({ message: bridge.resetUvLayout() });
        if (operation === 'reload') return ok({ message: bridge.reloadUvAtlas() });
        if (operation === 'save') return ok(bridge.saveUvAtlas());
        if (operation === 'export-wireframe') return ok(bridge.exportUvWireframe());
        if (operation === 'export-guide') return ok(bridge.exportUvGenerationGuide(undefined, args.numbered === true));
        if (operation === 'import') { void bridge.importUvAtlas(typeof args.path === 'string' ? args.path : undefined); return ok({ pending: true }); }
        if (operation === 'resize') { void bridge.resizeUvAtlas(Number(args.width), Number(args.height)); return ok({ pending: true }); }
        if (operation === 'add-layer') { void bridge.addUvTextureLayer(Number(args.x ?? 0), Number(args.y ?? 0), typeof args.path === 'string' ? args.path : undefined); return ok({ pending: true }); }
        if (operation === 'compile-layers') { void bridge.compileUvTextureLayers(); return ok({ pending: true }); }
        return fail(`unknown UV atlas operation "${operation}"`);
      }
      if (action === 'uv-layer') {
        if (!bridge || typeof args.id !== 'string' || !args.edit) return fail('layer id and edit are required');
        return ok({ message: bridge.editUvTextureLayer(args.id, args.edit) });
      }
      if (action === 'paint-variant' && String(args.operation) === 'load') {
        return bridge?.loadPaintVariant?.(args.variant) ? ok() : fail('paint variant load rejected');
      }
      return fail(`shell action "${action}" is not implemented yet`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

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
    // A slot persisted across a code update may name a removed command or a view
    // toggle that is no longer classified as an input tool. Neither is replayable.
    if (!deviceToolReplayable(remembered, surface)) return;
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
      let geometryChanged = false;
      for (const report of nativeMeshActionDrain()) {
        geometryChanged = true;
        const mapped = modelIdByMeshTokenRef.current.get(report.documentToken);
        const modelId = mapped || `native-model-token:${report.documentToken}`;
        if (report.kind === 'integrity-alert') {
          // The host's commit roll call proved a part-ledger fault right after the
          // op that caused it (req_3484). It healed what it could prove; the shell's
          // half is re-reading every mirror from host truth and saying so HERE —
          // never a terminal-only whisper that surfaces as a refused Add ten ops later.
          const healed = report.beforeParts !== report.afterParts;
          modelToolApiRef.current?.resyncFromHost?.();
          setState((prev) => ({
            ...prev,
            status: healed
              ? `⚠ mesh integrity: the last edit left ${report.beforeParts} declared part(s) against the live faces — host healed to ${report.afterParts}; mirrors resynced`
              : '⚠ mesh integrity: part-ledger fault detected after the last edit — mirrors resynced from host truth; if the outliner disagrees, save + reopen the model',
          }));
        }
        dispatchNativeMeshAction(report, modelId);
      }
      if (geometryChanged) (globalThis as any).__modelFocusBridge?.refreshGeometry?.();
    };
    drain();
    const timer = setInterval(drain, 250);
    return () => clearInterval(timer);
  }, []);

  // ── RJIT_PARTOPS: headless outliner harness (req_2659) ────────────────────────
  // Drives the REAL outliner handlers by row index — the shell-side twin of
  // RJIT_MESHOPS (which drives host doors). ';'-separated ops:
  //   sel:i · shiftsel:i (the shift-click accumulate path, shift asserted on the live
  //   modifier record for the call) · add:kind · import:model-id · eye:i · dup:i · mirror:i,axis ·
  //   del:i · merge · thumb (stage the viewport as the package thumbnail) · undo · redo ·
  //   wait:frames · report (rows + selected set + primary) ·
  //   audit (adds face counts + host selection) · dump:/abs/path (machine-readable audit) ·
  //   undodump:/abs/path (synchronous restored-note probe, before deferred reconciliation).
  // Handlers are per-render closures — the ref keeps the once-installed timer calling
  // the CURRENT ones (the same mount-frozen-closure trap as the meshops harness).
  const partOpsRef = useRef({ selectPart, addPrimitivePart, importModelAsParts, toggleVisiblePart, duplicatePartById, deletePart, mergeSelectedParts, meshUndoRedo });
  partOpsRef.current = { selectPart, addPrimitivePart, importModelAsParts, toggleVisiblePart, duplicatePartById, deletePart, mergeSelectedParts, meshUndoRedo };
  useEffect(() => {
    const opsText = (globalThis as any).__env_get?.('RJIT_PARTOPS') as string | null | undefined;
    if (!opsText) return;
    const ops = opsText.split(';').map((t) => t.trim()).filter(Boolean);
    let step = 0;
    const runOp = (op: string) => {
      const separator = op.indexOf(':');
      const name = separator >= 0 ? op.slice(0, separator) : op;
      const arg = separator >= 0 ? op.slice(separator + 1) : undefined;
      const s = stateRef.current;
      const mid = activePartsModelId(s);
      const parts = mid ? (s.modelParts[mid] ?? []) : [];
      const argFields = (arg ?? '').split(',').map((field) => field.trim());
      const idx = Number(argFields[0] ?? -1);
      const id = parts[idx]?.id ?? null;
      const h = partOpsRef.current;
      if (name === 'sel' && id) h.selectPart(id);
      else if (name === 'shiftsel' && id) {
        const m = currentModifiers() as { shift: boolean };
        m.shift = true; // assert the live modifier record for this one call — the REAL shift branch runs
        try { h.selectPart(id); } finally { m.shift = false; }
      } else if (name === 'add' && PRIMITIVE_MESHES.some((primitive) => primitive.kind === arg)) {
        h.addPrimitivePart(arg as PrimitiveKind, { size: 1, height: 1, resolution: 1 });
      } else if (name === 'import' && arg) {
        const pkg = effectiveModelPackage(arg, s.modelOverrides, s.modelDupes);
        if (pkg) h.importModelAsParts(pkg, 'headless');
        else console.error(`[partops] import package not found: ${arg}`);
      } else if (name === 'eye' && id) h.toggleVisiblePart(id);
      else if (name === 'dup' && id) h.duplicatePartById(id, -1);
      else if (name === 'mirror' && id) {
        const axis = argFields[1] === 'y' ? 1 : argFields[1] === 'z' ? 2 : 0;
        h.duplicatePartById(id, axis);
      }
      else if (name === 'del' && id) h.deletePart(id);
      else if (name === 'thumb') {
        // Headless proof for the staged product shot (req_4044): shoots the
        // current viewport into the package exactly like the Model Focus verb.
        const staged = stageThumbnailRef.current();
        console.error(`[partops] thumb → ${JSON.stringify(staged)}`);
      }
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
        let hostRanges = null;
        try { hostRanges = JSON.parse(host.__mesh_part_ranges?.() ?? 'null'); } catch { /* malformed host read stays null */ }
        console.error(`[partops] audit → ${JSON.stringify({ rows, selection, hostRanges, status: s.status })}`);
      } else if (name === 'dump' && arg) {
        const host = globalThis as any;
        let hostRanges = null;
        let journalNote = null;
        try { hostRanges = JSON.parse(host.__mesh_part_ranges?.() ?? 'null'); } catch { /* malformed host read stays null */ }
        try { journalNote = JSON.parse(host.__mesh_journal_note?.() ?? 'null'); } catch { /* malformed host read stays null */ }
        const rows = parts.map(({ mesh: _mesh, ...part }) => part);
        host.__fs_write?.(arg, JSON.stringify({ rows, hostRanges, journalNote, status: s.status }));
      } else if (name === 'undodump' && arg) {
        h.meshUndoRedo(false);
        const host = globalThis as any;
        host.__fs_write?.(arg, host.__mesh_journal_note?.() ?? '');
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
        else if (block.id === 'name-selection') setNameSelectionOpen(false);
        else if (block.id === 'prefab-capture') setPrefabCaptureOpen(false);
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
    // Saved-view slots (req_4172) resolve before the command table: a digit on the
    // world surface is a jump with an argument, which no menu verb can carry.
    const slot = worldViewSlotForKey(s, key, mods);
    if (slot !== null) {
      recallWorldViewSlotRef.current(slot);
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
    selectNativeModelSession(doc);
    setState((prev) => ({
      ...prev,
      workspaceDocuments: upsertDocument(prev.workspaceDocuments, doc),
      activeWorkspaceDocumentId: doc.id,
      recentLibraryKeys: rememberRecentLibraryItem(prev.recentLibraryKeys ?? [], `model:${model.id}`),
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
        // outliner (and the edits) back after a cold restart. v2 parts.json rows join
        // ranges by stable object id; only legacy v1 metadata pairs by rank.
        const meta = modelDocumentMetadataByRange({
          rangeCount: meshDoc.ranges.length,
          rangeObjectIds: meshDoc.rangeObjectIds,
          savedParts: savedMeta,
        });
        parts = meshDoc.ranges.map((r, i) => ({
          id: meshDoc.rangeObjectIds?.[i] ?? meta[i]?.objectId ?? `part:doc:${mid}:${i}`,
          name: meta[i]?.name ?? (meshDoc.ranges.length === 1 ? (pkg?.name ?? 'part 1') : `part ${i + 1}`),
          kind: meta[i]?.kind as PrimitiveKind | undefined,
          visible: meta[i]?.visible ?? true,
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
      // A seed doc's ranges come from recomposing its part SEEDS — correct on a COLD
      // mount, where the viewer really does rebuild the mesh from those seeds, and
      // fiction the moment the session is live and edited (req_4189). Extrude, cut and
      // every other face-minting verb grow a part far past its seed: a 19-extrude frame
      // seeded by one cube recomposes to 6 groups. This effect re-runs on every activate
      // AND on every remount — a cart hot reload is a remount — so it would silently
      // overwrite every row with its seed span while the host's table stayed correct.
      // The rows then push that fiction into __mesh_edit_scope_ranges and the model
      // becomes unworkable, with nothing in the mesh journal for undo to put back.
      // The host is authoritative whenever THIS model owns the resident session, so
      // prefer its live table and keep the seed recompose for the cold case only.
      const hostRanges = activeSessionModelIdRef.current === mid ? readHostPartRanges() : null;
      if (hostRanges && hostRanges.length === parts.length) {
        withRanges = stampRowsByRank(parts, hostRanges);
      } else {
        const rangeById = new Map(composeModelParts(parts).ranges.map((r) => [r.id, r]));
        withRanges = parts.map((p) => { const r = rangeById.get(p.id); return { ...p, lo: r?.lo, hi: r?.hi }; });
      }
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

  // A cold RJMD apply replaced the native mesh from disk. Replace the shell's
  // disposable hot rows from the SAME saved snapshot in one state commit, so a
  // pre-reload detach/merge projection cannot be offered back to Save. This is
  // a result handshake from ModelView, never a render-time count heuristic.
  const acceptColdRjmdApply = (modelId: string, modelSourceKey: string) => {
    const current = stateRef.current;
    if (modelSourceKey !== modelId || activePartsModelId(current) !== modelId) {
      console.error(`[modeldoc] refused cold RJMD row hydration for ${modelId}: source key ${modelSourceKey} does not own the active document`);
      return;
    }
    const pkg = effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes);
    const doc = pkg ? packageMeshDoc(pkg) : null;
    if (!pkg || !doc || doc.vertices.length < 8) {
      console.error(`[modeldoc] refused cold RJMD row hydration for ${modelId}: the saved document is no longer readable`);
      return;
    }
    const hydration = hydrateModelDocumentPartsAfterMount({
      mountResult: 'cold-rjmd',
      modelId,
      modelName: pkg.name,
      currentParts: current.modelParts[modelId] ?? [],
      currentActivePartId: current.modelActivePartId,
      ranges: doc.ranges,
      rangeObjectIds: doc.rangeObjectIds,
      savedParts: packageMeshDocParts(pkg) ?? [],
      fallbackColors: PART_TINTS,
    });
    if (!hydration.applied) return;

    if (partReconcileTimerRef.current) {
      clearTimeout(partReconcileTimerRef.current);
      partReconcileTimerRef.current = null;
    }
    consumeModelSaveAuthorizations(modelId);
    savedMeshDepthRef.current[modelId] = 0;
    const next: EditorState = {
      ...current,
      modelParts: { ...current.modelParts, [modelId]: hydration.parts },
      modelActivePartId: hydration.activePartId,
      modelDirty: { ...current.modelDirty, [modelId]: false },
      status: `cold-open restored ${hydration.parts.length} saved part${hydration.parts.length === 1 ? '' : 's'} from RJMD`,
    };
    const selection = hydration.activePartId ? [hydration.activePartId] : [];
    selectedPartIdsRef.current = selection;
    setSelectedPartIds(selection);
    stateRef.current = next;
    setState(next);
  };

  // Leaving a model doc writes it only when autosave is enabled, it is dirty,
  // and a valid manifest already exists. A new unsaved model never acquires a
  // disk identity from background policy. The custom close control uses this
  // same synchronous artifact boundary before the viewer unmounts.
  const autosaveActiveModelDoc = (s: EditorState): { id: string; name: string; ok: boolean } | null => {
    if (!persistenceSettings.autosave) return null;
    const doc = s.workspaceDocuments.find((d) => d.id === s.activeWorkspaceDocumentId);
    if (doc?.kind !== 'model' || !doc.sourceId) return null;
    const pkg = effectiveModelPackage(doc.sourceId, s.modelOverrides, s.modelDupes);
    if (!pkg || !s.modelDirty[pkg.id] || !isMaterialized(pkg.kind, pkg.id)) return null;
    // A document switch is still a Save. Reuse the sole commit boundary so a
    // character can only travel through native prepareSave + immutable RJMD /
    // RJSK read-back + manifest-last replacement; props retain their existing
    // meshdoc path through the same dispatcher. A refusal keeps the dirty
    // document mounted instead of silently crossing the navigation boundary.
    return { id: pkg.id, name: pkg.name, ok: saveModelDocumentNow(pkg.id, 'Autosaved', 'background') };
  };

  /** Discard is a real rollback, not a dirty-chip reset. Drop the host-resume
   * claim and the React working copy so reopening hydrates the saved package.
   * A never-materialized model has no durable identity, so its pending override
   * and session catalog row leave with the working copy too. */
  const discardModelWorkingCopy = (modelId: string, status?: string) => {
    releaseModelDocSession();
    const current = stateRef.current;
    const pkg = effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes);
    const materialized = Boolean(pkg && isMaterialized(pkg.kind, pkg.id));
    const discarded = discardModelWorkingCopyState(current, modelId, materialized);
    const next = status ? { ...discarded, status } : discarded;
    stateRef.current = next;
    persistState(next);
    setState(next);
    // Force the viewer through its ordinary cold package mount. Releasing the
    // host lease alone is insufficient while the same keyed ModelView remains
    // mounted; the revision makes Keep DISK a real reload, including journal loss.
    setModelReloadRevision((revision) => revision + 1);
  };

  const refreshWorldBibleForOpen = () => {
    const alreadyLoaded = worldBibleController.snapshot().loaded;
    worldBibleController.ensureLoaded();
    // A watcher only exists while the wiki surface is mounted. Re-opening an
    // already-loaded Bible must therefore reconcile edits made while another
    // document (or /play) had the surface unmounted.
    if (alreadyLoaded) worldBibleController.refreshDisk();
  };

  const activateWorldBible = () => {
    refreshWorldBibleForOpen();
    const autosave = autosaveActiveModelDoc(stateRef.current);
    if (autosave && !autosave.ok) return;
    const autosaved = autosave?.ok ? autosave : null;
    if (playing) navigate.push('/editor');
    selectNativeModelSession(WORLD_BIBLE_DOCUMENT);
    setState((prev) => ({
      ...prev,
      workspaceDocuments: upsertDocument(prev.workspaceDocuments, WORLD_BIBLE_DOCUMENT),
      activeWorkspaceDocumentId: WORLD_BIBLE_DOCUMENT_ID,
      activeDomain: 'world-bible',
      leftPanelCollapsed: false,
      materialFocused: false,
      contextOpen: false,
      modelDirty: autosaved ? { ...prev.modelDirty, [autosaved.id]: false } : prev.modelDirty,
      status: autosaved ? `Autosaved "${autosaved.name}"` : prev.status,
    }));
  };

  const openWorldBible = () => {
    const current = stateRef.current;
    const currentDoc = current.workspaceDocuments.find((doc) => doc.id === current.activeWorkspaceDocumentId);
    const currentModelId = currentDoc?.kind === 'model' ? currentDoc.sourceId : null;
    if (!persistenceSettings.autosave && currentModelId && current.modelDirty[currentModelId]) {
      requestUnsavedDecision(
        currentDoc?.title ?? 'Model',
        () => { if (saveActiveModelNow('Saved', 'explicit')) activateWorldBible(); },
        () => { discardModelWorkingCopy(currentModelId); activateWorldBible(); },
      );
      return;
    }
    activateWorldBible();
  };

  const selectWorkspaceDocument = (activeWorkspaceDocumentId: string, bypassUnsavedPrompt = false) => {
    if (!bypassUnsavedPrompt && !persistenceSettings.autosave && state.activeWorkspaceDocumentId !== activeWorkspaceDocumentId) {
      const currentDoc = state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId);
      const currentModelId = currentDoc?.kind === 'model' ? currentDoc.sourceId : null;
      if (currentModelId && state.modelDirty[currentModelId]) {
        requestUnsavedDecision(
          currentDoc?.title ?? 'Model',
          () => { if (saveActiveModelNow('Saved', 'explicit')) selectWorkspaceDocument(activeWorkspaceDocumentId, true); },
          () => {
            discardModelWorkingCopy(currentModelId);
            selectWorkspaceDocument(activeWorkspaceDocumentId, true);
          },
        );
        return;
      }
    }
    const nextDoc = state.workspaceDocuments.find((item) => item.id === activeWorkspaceDocumentId);
    if (!nextDoc) return;
    if (activeWorkspaceDocumentId === WORLD_BIBLE_DOCUMENT_ID) refreshWorldBibleForOpen();
    const autosave = state.activeWorkspaceDocumentId === activeWorkspaceDocumentId ? null : autosaveActiveModelDoc(state);
    if (autosave && !autosave.ok) return;
    const autosaved = autosave?.ok ? autosave : null;
    if (state.activeWorkspaceDocumentId !== activeWorkspaceDocumentId) selectNativeModelSession(nextDoc);
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
    if (!bypassUnsavedPrompt && documentId === WORLD_BIBLE_DOCUMENT_ID && worldBibleHasDrafts()) {
      requestWorldBibleReview();
      selectNativeModelSession(WORLD_BIBLE_DOCUMENT);
      setState((prev) => ({
        ...prev,
        workspaceDocuments: upsertDocument(prev.workspaceDocuments, WORLD_BIBLE_DOCUMENT),
        activeWorkspaceDocumentId: WORLD_BIBLE_DOCUMENT_ID,
        activeDomain: 'world-bible',
        leftPanelCollapsed: false,
        status: 'Unsaved draft',
      }));
      requestUnsavedDecision(
        'World Bible draft',
        () => setState((prev) => ({ ...prev, status: 'Review open' })),
        () => {
          if (!worldBibleController.flushRecovery()) {
            setState((prev) => ({ ...prev, status: 'Draft recovery failed; tab remains open' }));
            return;
          }
          closeWorkspaceDocument(documentId, true);
          setState((prev) => ({ ...prev, status: 'Draft kept' }));
        },
        () => setState((prev) => ({ ...prev, status: 'Close canceled' })),
        { save: 'Review changes', discard: 'Keep draft & close' },
      );
      return;
    }
    // Prompt whenever closing WOULD LOSE WORK. Autosave alone is not that proof:
    // it is bounded to models that already exist on disk, so a brand-new model —
    // exactly the one whose edits are least recoverable — was closed silently
    // with nothing written anywhere (req_3773). The gate is what autosave will
    // actually cover, not whether the setting is on.
    if (!bypassUnsavedPrompt && state.activeWorkspaceDocumentId === documentId) {
      const currentDoc = state.workspaceDocuments.find((doc) => doc.id === documentId);
      const currentModelId = currentDoc?.kind === 'model' ? currentDoc.sourceId : null;
      const currentPkg = currentModelId
        ? effectiveModelPackage(currentModelId, state.modelOverrides, state.modelDupes)
        : null;
      const autosaveCovers = persistenceSettings.autosave
        && Boolean(currentPkg && isMaterialized(currentPkg.kind, currentPkg.id));
      if (currentModelId && state.modelDirty[currentModelId] && !autosaveCovers) {
        requestUnsavedDecision(
          currentDoc?.title ?? 'Model',
          () => { if (saveActiveModelNow('Saved', 'explicit')) closeWorkspaceDocument(documentId, true); },
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
    const autosave = state.activeWorkspaceDocumentId === documentId ? autosaveActiveModelDoc(state) : null;
    if (autosave && !autosave.ok) return;
    const autosaved = autosave?.ok ? autosave : null;
    // Release this document's claim on the host's live mesh. A lease outliving
    // its document is what let the NEXT document resume a closed model's mesh
    // and outliner (req_3773/req_3774); a background close leaves the active
    // document's claim alone because the twig names one document only.
    const closingDoc = state.workspaceDocuments.find((doc) => doc.id === documentId);
    const closingPkg = closingDoc?.kind === 'model' && closingDoc.sourceId
      ? effectiveModelPackage(closingDoc.sourceId, state.modelOverrides, state.modelDupes)
      : null;
    if (closingDoc?.kind === 'model' && closingDoc.sourceId) backgroundSeatByModelRef.current.delete(closingDoc.sourceId);
    if (closingPkg) releaseModelDocSession(modelDocSessionId(closingPkg.kind, closingPkg.id));
    if (state.activeWorkspaceDocumentId === documentId) {
      selectNativeModelSession(state.workspaceDocuments.find((doc) => doc.id === WORLD_DOCUMENT_ID) ?? null);
    }
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
  const libraryMenuModel = libraryMenuModelId
    ? visibleModels.find((model) => model.id === libraryMenuModelId) ?? null
    : null;
  // The tree HOLDS ITS SHAPE while a rename is typing (req_3246): its Models rows
  // are name-sorted, so every keystroke would re-rank the renamed row through the
  // keyed sibling list — a reorder this reconciler answers with ghost/dropped rows
  // (the array-sibling hazard). One rebuild when the rename settles.
  const settledTreeRef = useRef<ContentNode[] | null>(null);
  const contentTreeNodes = useMemo(() => {
    if (state.modelRenamingId && settledTreeRef.current) return settledTreeRef.current;
    settledTreeRef.current = liveContentTree(visibleModels);
    return settledTreeRef.current;
  }, [visibleModels, state.modelRenamingId]);

  // MANIFEST IS DISK TRUTH (req_2620 S/U): favorite/delete/rename write through to
  // the model's on-disk manifest when the package is materialized, so they survive
  // a cold restart. The session override stays as the live mirror either way; for
  // a not-yet-saved model the override is the PENDING value the first save writes
  // (save-snapshot resolves through effectiveModelPackage).
  const favoriteModel = (id: string) => {
    if (blobActivePreviewRef.current?.modelId === id && refuseHistoricalPreviewMutation('model_mutation')) return;
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
  };

  // Delete REMOVES the package from disk (req_3370, USER RULING — the old
  // hidden:true soft-delete kept every "deleted" folder squatting the models
  // tree; git history is the undo). The session still marks the id hidden so
  // an open roster entry vanishes immediately; an unmaterialized model has
  // nothing on disk and just hides. A failed removal falls back to the old
  // manifest hide and SAYS so.
  const deleteModel = (id: string) => {
    if (blobActivePreviewRef.current?.modelId === id && refuseHistoricalPreviewMutation('model_mutation')) return;
    setState((prev) => {
      const pkg = effectiveModelPackage(id, prev.modelOverrides, prev.modelDupes);
      const removed = pkg ? removeModelPackage(pkg.kind, id) : false;
      const durable = !removed && pkg ? updateManifestIdentity(pkg.kind, id, { hidden: true }) : false;
      return {
        ...prev,
        modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], hidden: true } },
        recentLibraryKeys: prev.recentLibraryKeys.filter((key) => key !== `model:${id}`),
        status: removed
          ? 'deleted model (package removed from disk)'
          : durable
            ? 'deleted model (disk removal FAILED — hidden in its manifest instead)'
            : 'deleted model (hidden from browser)',
      };
    });
  };

  const startRenameModel = (id: string) => setState((prev) => ({ ...prev, modelRenamingId: id, status: 'renaming model' }));
  // Rename writes through to the manifest AS YOU TYPE for a materialized model
  // (tiny JSON, human keystroke rate) so the name on disk is never behind the name
  // on screen; an unmaterialized doc keeps the name pending (dirty chip) until its
  // first save applies it. The open doc tab retitles in the same update.
  // The FOLDER move does not ride the keystrokes (req_3246): moving a package home
  // copies every blob in it, so the rename-follow settles once after typing ends —
  // finishRenameModel for the library's rename bar, and a debounced settle below
  // for the focus panel's name field, which has no end-of-rename event (req_3369:
  // its renames never settled, so folders kept stale names like props/Model_26
  // holding a model named "body").
  const renameSettleTimerRef = useRef<any>(null);
  const RENAME_SETTLE_DEBOUNCE_MS = 1200;
  // The model's browser picture is a SHOT THE AUTHOR STAGES (req_4044): frame the
  // model in the viewport, press the verb, and that exact view becomes the package's
  // thumbnail. It renders the live orbit scene offscreen at the current camera —
  // nothing about the window, and no auto-framed guess at the model's front.
  const THUMBNAIL_SHOT_PX = 512;
  const stageActiveModelThumbnail = (): ThumbnailStageResult => {
    const s = stateRef.current;
    const id = activeSessionModelIdRef.current;
    const pkg = id ? effectiveModelPackage(id, s.modelOverrides, s.modelDupes) : null;
    if (!pkg) {
      const reason = 'no model document is open to shoot';
      setState((prev) => ({ ...prev, status: reason }));
      return { ok: false, reason };
    }
    const staged = stageModelThumbnail(pkg, (path) =>
      (globalThis as any).__model_shot_offscreen?.(path, THUMBNAIL_SHOT_PX, THUMBNAIL_SHOT_PX) === 1);
    if (staged.ok) upsertSavedPackage(pkg); // the roster is what every card reads
    setState((prev) => ({
      ...prev,
      // Replace an existing projection only — staging a shot never promotes a
      // package into the dupes list that was not already there.
      modelDupes: staged.ok && prev.modelDupes.some((item) => item.id === pkg.id)
        ? upsertModelPackageProjection(prev.modelDupes, pkg)
        : prev.modelDupes,
      status: staged.ok
        ? `staged this view as "${pkg.name}"'s thumbnail`
        : `thumbnail not staged: ${staged.reason ?? 'unknown error'}`,
    }));
    return staged;
  };
  // The seat dispatch is defined above this closure; the ref keeps it calling the
  // CURRENT one (the same mount-frozen-closure rule the other shell refs follow).
  stageThumbnailRef.current = stageActiveModelThumbnail;
  const renameModel = (id: string, name: string) => {
    if (blobActivePreviewRef.current?.modelId === id && refuseHistoricalPreviewMutation('rename')) return;
    setState((prev) => {
      const pkg = effectiveModelPackage(id, prev.modelOverrides, prev.modelDupes);
      const durable = pkg ? updateManifestIdentity(pkg.kind, id, { name }, { deferRenameFollow: true }) : false;
      return {
        ...prev,
        modelOverrides: { ...prev.modelOverrides, [id]: { ...prev.modelOverrides[id], name } },
        workspaceDocuments: prev.workspaceDocuments.map((doc) => (doc.kind === 'model' && doc.sourceId === id ? { ...doc, title: name } : doc)),
        modelDirty: durable ? prev.modelDirty : { ...prev.modelDirty, [id]: true },
      };
    });
    if (renameSettleTimerRef.current) clearTimeout(renameSettleTimerRef.current);
    renameSettleTimerRef.current = setTimeout(() => {
      renameSettleTimerRef.current = null;
      const s = stateRef.current;
      const pkg = effectiveModelPackage(id, s.modelOverrides, s.modelDupes);
      if (pkg) settleRenamedPackageDir(pkg.kind, id);
    }, RENAME_SETTLE_DEBOUNCE_MS);
  };
  const finishRenameModel = () =>
    setState((prev) => {
      const id = prev.modelRenamingId;
      const pkg = id ? effectiveModelPackage(id, prev.modelOverrides, prev.modelDupes) : null;
      if (id && pkg) settleRenamedPackageDir(pkg.kind, id);
      return { ...prev, modelRenamingId: null, status: 'renamed model' };
    });

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
      const projected = projectModelIntoRecentLibrary(prev.modelDupes, prev.recentLibraryKeys ?? [], dupe);
      return {
        ...prev,
        modelDupes: projected.models,
        recentLibraryKeys: projected.recentKeys,
        seq: prev.seq + 1,
        status: copied
          ? `duplicated ${model.name} → ${dupe.path}`
          : `duplicated ${model.name} (in session only — open it and save to keep it)`,
      };
    });

  // ── Guided role naming (req_3263) ───────────────────────────────────────────
  // The vehicle-only formal-lazy pass over the segmented car formation. Character
  // anatomy is semantic data owned by its rig session and never enters this
  // name-based path. For a car, the session asks for each missing role and the
  // user clicks the part that takes it.
  const startRoleNamer = (contractId: RoleContractId) => {
    const live = stateRef.current;
    const mid = activePartsModelId(live);
    const rows = mid ? (live.modelParts[mid] ?? []) : [];
    const pkg = mid ? effectiveModelPackage(mid, live.modelOverrides, live.modelDupes) : null;
    if (!mid || !pkg || pkg.kind !== 'vehicle' || rows.length === 0) {
      setState((prev) => ({ ...prev, status: 'vehicle role naming needs an open multi-part vehicle model' }));
      return;
    }
    const plan = roleNamerPlan(contractId, rows.map((row) => row.name));
    if (plan.open.length === 0) {
      setRoleNamerSession(null);
      setState((prev) => ({ ...prev, status: `every ${contractId} role is already named (${plan.claimed.size}/${plan.contract.roles.length})` }));
      return;
    }
    setRoleNamerSession({ contractId, modelId: mid, queue: plan.open, at: 0 });
    setState((prev) => ({ ...prev, status: `role naming: ${plan.claimed.size} of ${plan.contract.roles.length} already named — click the part that is "${plan.open[0]}"` }));
  };
  const advanceRoleNamer = (assignedRole: string | null) => {
    const session = roleNamerRef.current;
    if (!session) return;
    const nextAt = session.at + 1;
    if (nextAt >= session.queue.length) {
      setRoleNamerSession(null);
      setState((prev) => ({ ...prev, status: assignedRole ? `named "${assignedRole}" — role naming complete` : 'role naming complete' }));
      return;
    }
    setRoleNamerSession({ ...session, at: nextAt });
    const ask = `click the part that is "${session.queue[nextAt]}"`;
    setState((prev) => ({ ...prev, status: assignedRole ? `named "${assignedRole}" — ${ask}` : `skipped — ${ask}` }));
  };
  const assignRoleToPart = (partId: string) => {
    const session = roleNamerRef.current!;
    // The session is pinned to the model it started on — a doc switch mid-pass
    // must never rename parts of a different model.
    if (activePartsModelId(stateRef.current) !== session.modelId) {
      setRoleNamerSession(null);
      setState((prev) => ({ ...prev, status: 'role naming cancelled — the active model changed' }));
      return;
    }
    const role = session.queue[session.at]!;
    selectPart(partId);
    renamePart(partId, role);
    advanceRoleNamer(role);
  };
  const cancelRoleNamer = () => {
    setRoleNamerSession(null);
    setState((prev) => ({ ...prev, status: 'role naming stopped' }));
  };

  // The ONE outliner handler set (Workspace + Inspector mount the same object). Part
  // mutations are guarded: they must not fire over an unresolved blocking session
  // (req_2626 HH — e.g. adding/deleting parts mid loop-cut stacks state on a captured
  // base mesh). onStampRanges stays unguarded — it's the viewer REPORTING ranges, not input.
  const outlinerHandlers = {
    // A live role-naming session turns the row click into the assignment.
    // Read through the ref: the row's registered handler may predate the session.
    onSelectPart: guarded((id: string) => (roleNamerRef.current ? assignRoleToPart(id) : selectPart(id))),
    onFocusSelectionOwner: guarded(focusSelectionOwner),
    onRenamePart: guardedModelMutation(renamePart),
    onToggleVisiblePart: guardedModelMutation(toggleVisiblePart),
    onDeletePart: guardedModelMutation(deletePart),
    onSelectPartGroup: guarded(selectPartGroup),
    onRenamePartGroup: guardedModelMutation(renamePartGroup),
    onToggleVisiblePartGroup: guardedModelMutation(toggleVisiblePartGroup),
    onDuplicatePartGroup: guardedModelMutation(duplicatePartGroup),
    onDissolvePartGroup: guardedModelMutation(dissolvePartGroup),
    onGroupSelectedParts: guardedModelMutation(groupSelectedParts),
    onUngroupSelectedParts: guardedModelMutation(ungroupSelectedParts),
    onMoveOutlinerItem: guardedModelMutation(moveOutlinerItem),
    onAddPart: guardedModelMutation(addPart),
    onDuplicatePart: guardedModelMutation((id: string) => duplicatePartById(id, -1)),
    onImportModel: guardedModelMutation(() => setImportPartOpen(true)),
    onStampRanges: stampModelPartRanges,
    onColdRjmdApplied: acceptColdRjmdApply,
    onPathPlaneCreated: registerPathPlanePart,
    roleNamer: roleNamerSession
      ? {
          role: roleNamerSession.queue[roleNamerSession.at]!,
          done: roleNamerSession.at,
          total: roleNamerSession.queue.length,
          contract: roleNamerSession.contractId,
        }
      : null,
    onStartRoleNamer: guarded(startRoleNamer),
    onSkipRole: () => advanceRoleNamer(null),
    onCancelRoleNamer: cancelRoleNamer,
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
  // The live recall request (req_4168): the ACTIVE pin plus the nonce every Recall
  // bumps. Derived rather than stored so a renamed or removed pin can never leave a
  // stale copy of itself queued at the viewport.
  const activeWorldViewPin = state.worldViews.find((view) => view.id === state.activeWorldViewId) ?? null;
  const worldViewRecall = activeWorldViewPin && state.worldViewRecallNonce > 0
    ? { view: activeWorldViewPin, nonce: state.worldViewRecallNonce }
    : null;
  const facadePaintActive = activeDocumentKind === 'facade';
  const activePaintBrush = facadePaintActive ? state.facadePaint.brush : state.modelTool.brush;
  const activePaintTool = facadePaintActive ? state.facadePaint.tool : state.modelTool.brushTool;
  const activePaintDetail = facadePaintActive ? state.facadePaint.detail : state.modelTool.detail;
  const setActivePaintBrush = (brush: typeof activePaintBrush) => {
    if (facadePaintActive) setState((prev) => ({ ...prev, facadePaint: { ...prev.facadePaint, brush } }));
    else modelToolApiRef.current?.setBrush(brush);
  };
  // deej mapping: fader 1 = brush size (the board's 1..128 working range),
  // fader 2 = flow. Only fires on physical movement, and only while
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
  const paintSpine = {
    onSetCurrent: (color: typeof state.colorSpineCurrent) => setColorSpineCurrent(color, 'paint dock'),
    onAddToTray: () => addColorSpineToTray('paint dock'),
    onPickTray: (color: typeof state.colorSpineCurrent) => pickColorSpineTray(color, 'paint dock'),
    onScenePick: (color: typeof state.colorSpineCurrent, css: string) => pickColorSpineScene(color, css, 'paint dock'),
    onLoadLibrarySet: (colors: typeof state.colorSpinePalette) => loadColorSpineLibrarySet(colors, 'paint dock'),
  };
  const activeFacade = facadePaintActive
    ? state.worldFacades.find((facade) => facade.id === activeWorkspaceDocument.sourceId) ?? null
    : null;
  const activePaintLayers = facadePaintActive
    ? (activeFacade ? <FacadePaintLayersSection facade={activeFacade} onLayers={updateFacadeLayers} /> : null)
    : <ModelPaintLayersSection refreshKey={modelMutationRevision} onDocumentMutated={markActiveModelDirty} />;
  const activePaintSidePanel = !paintUiActive ? null
    : activeLeftPanelDefinition.renderer === 'paint' ? (
      <PaintPanel
        brush={activePaintBrush}
        brushTool={activePaintTool}
        tools={facadePaintActive ? FACADE_PAINT_TOOLS : MODEL_PAINT_TOOLS}
        onBrush={setActivePaintBrush}
        onBrushTool={(tool) => facadePaintActive
          ? setState((prev) => ({ ...prev, facadePaint: { ...prev.facadePaint, tool } }))
          : modelToolApiRef.current?.brushTool(tool)}
        resolution={{
          label: facadePaintActive ? 'Preview' : 'Atlas',
          value: activePaintDetail <= 1 ? 'fill only' : `${activePaintDetail} px/m`,
          onCycle: facadePaintActive ? cycleFacadeDetail : () => modelToolApiRef.current?.cycleDetail(),
        }}
        safety={facadePaintActive ? undefined : {
          value: state.modelTool.safety === 0 ? 'Clip' : 'Lock',
          onCycle: () => modelToolApiRef.current?.cycleSafety(),
        }}
        supportsEraseBlend={facadePaintActive}
        layers={activePaintLayers}
        current={state.colorSpineCurrent}
        palette={state.colorSpinePalette}
        recents={state.colorSpineRecents}
        scenePick={state.colorSpineScenePick}
        paletteFor={paintPaletteFor}
        onEditMaterial={openColorStudioForSpec}
        spine={paintSpine}
      />
    ) : null;
  const activeWorldBibleSidePanel = activeLeftPanelDefinition.renderer === 'world-bible'
    ? <WorldBibleIndexPanel />
    : null;

  // World quick-menu payload (req_2733/req_2737): the LIVE selected piece (yaw/slots
  // track edits while the menu stays open — Rotate keeps it open) + the RANKED
  // material catalog its picker searches (favorites/recents/used first, the content
  // browser's own ordering). Only materialized while the menu is open; Delete
  // closes it by construction (the piece leaves state, the gate below goes null).
  const worldQuickPiece = worldMenu.isOpen ? state.worldPieces.find((p) => p.id === state.selectedPieceId) : undefined;
  const worldQuickMaterials = worldQuickPiece
    ? applyAssetOverrides(ASSETS, state.assetOverrides).filter((asset) => asset.tab === 'Skins').sort(rankAssets)
    : [];
  // The model's stored PAINTINGS for the quick menu (req_3443): the palette lists
  // one entry per model; which painting a placed instance wears is chosen HERE.
  // baseSkinId (req_3459): the saved painting the model's current base look IS,
  // so the menu can collapse a "Current" chip that duplicates a named painting.
  const worldQuickPaintings = (() => {
    if (!worldQuickPiece) return { skins: [], baseSkinId: null as string | null };
    const ap = authoredPieceFor(worldQuickPiece.pieceId);
    const pkg = ap ? modelPackageById(ap.pkgId) : null;
    if (!pkg) return { skins: [], baseSkinId: null as string | null };
    return { skins: listPaintSkins(pkg), baseSkinId: basePaintingSkinId(pkg) };
  })();

  const closeHostWindow = () => (globalThis as any).__window_close?.();
  const saveDirtyWorkspaceForClose = (): boolean => {
    const current = stateRef.current;
    const doc = current.workspaceDocuments.find((item) => item.id === current.activeWorkspaceDocumentId);
    const modelId = doc?.kind === 'model' ? doc.sourceId : null;
    const pkg = modelId ? effectiveModelPackage(modelId, current.modelOverrides, current.modelDupes) : null;
    if (pkg && current.modelDirty[pkg.id] && !saveActiveModelNow('Saved before exit', 'explicit')) return false;
    if (manualWorldDirty && !saveWorldNowAll('Saved before exit')) return false;
    return true;
  };
  const closeEditorNormally = () => {
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
      if (pkg && modelDirty && isMaterialized(pkg.kind, pkg.id) && !saveActiveModelNow('Autosaved before exit', 'background')) return;
      if (!saveWorldNowAll('Autosaved before exit')) return;
    }
    closeHostWindow();
  };
  const closeEditor = () => {
    if (worldBibleHasDrafts()) {
      requestWorldBibleReview();
      if (playing) navigate.push('/editor');
      requestUnsavedDecision(
        'World Bible draft',
        () => {
          selectNativeModelSession(WORLD_BIBLE_DOCUMENT);
          setState((prev) => ({
            ...prev,
            workspaceDocuments: upsertDocument(prev.workspaceDocuments, WORLD_BIBLE_DOCUMENT),
            activeWorkspaceDocumentId: WORLD_BIBLE_DOCUMENT_ID,
            activeDomain: 'world-bible',
            leftPanelCollapsed: false,
            materialFocused: false,
            status: 'Review open',
          }));
        },
        () => {
          if (!worldBibleController.flushRecovery()) {
            setState((prev) => ({ ...prev, status: 'Draft recovery failed; exit canceled' }));
            return;
          }
          // Keep the previously active document in place until this choice so
          // the ordinary close path can still see and prompt for a dirty model
          // or world after the World Bible recovery copy is durable.
          closeEditorNormally();
        },
        () => setState((prev) => ({ ...prev, status: 'Exit canceled' })),
        { save: 'Review changes', discard: 'Keep draft & exit' },
      );
      return;
    }
    closeEditorNormally();
  };

  return (
    <C.HW_App>
      <RenderProbe id="Chrome">
        <Chrome
          state={state}
          activeCommand={activeCommand}
          onMenu={guarded((menu: Menu) => setState((prev) => ({ ...prev, actionMenu: menu, openMenu: prev.openMenu === menu ? null : menu })))}
          onCommand={runCommand}
          onWorldBible={guarded(openWorldBible)}
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
          <LeftRail
            documentKind={activeDocumentKind}
            paintActive={paintUiActive}
            activePane={activeLeftPanel}
            collapsed={state.leftPanelCollapsed}
            onPane={pressLeftPanel}
          />
        </RenderProbe>
        {!state.leftPanelCollapsed ? <RenderProbe id={activeWorldBibleSidePanel ? 'World Bible Index' : activePaintSidePanel ? 'Paint Side Panel' : 'Content Browser'}>
          {activeWorldBibleSidePanel ?? activePaintSidePanel ?? <LibraryPanel
            state={state}
            catalogAssets={catalogAssets}
            assets={filteredAssets}
            mode={panelMode}
            activeAsset={activeAsset}
            activeObject={activeObject}
            contentFolder={effectiveContentFolder}
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
            onModelRename={renameModel}
            onModelFinishRename={finishRenameModel}
            onModelFavorite={favoriteModel}
            onModelContext={(model, event) => {
              setLibraryMenuModelId(model.id);
              libraryModelMenu.triggerProps.onRightClick(event);
            }}
          />}
        </RenderProbe> : null}
        <RenderProbe id="Workspace">
          <Workspace
            state={workspaceState}
            mapSwitchPending={mapSwitchPending}
            activeAsset={activeAsset}
            selectedPartCount={selectedPartCount}
            onCommand={runCommand}
            onModelToolApi={(api: ModelToolApi) => { modelToolApiRef.current = api; }}
            onModelToolState={(modelTool: ModelToolSnapshot) => setState((prev) => {
              const enteringPaint = modelTool.paint && !prev.modelTool.paint;
              return {
                ...prev,
                modelTool,
                ...(enteringPaint ? {
                  activeDomain: 'paint',
                  leftPanelCollapsed: false,
                  rightPane: 'inspector',
                  rightPanelCollapsed: false,
                } : null),
              };
            })}
            modelContextTrigger={modelMenu.triggerProps}
            outlinerHandlers={outlinerHandlers}
            modelOnDisk={activeModelOnDisk}
            modelReloadRevision={modelReloadRevision}
            onDiscardActiveModel={() => {
              if (activeModelId) discardModelWorkingCopy(activeModelId, 'Kept DISK — live edits and Ctrl+Z history were discarded');
            }}
            onSavePaintConflictLive={(options) => saveActiveModelNow('Saved after choosing Keep LIVE', 'explicit', true, options)}
            onRequireFirstModelSave={() => saveActiveModelNow('Saved before creating paint atlas', 'explicit')}
            onModelDocumentMutated={markActiveModelDirty}
            onResidentModelReady={(modelId, modelSourceKey) => {
              const current = stateRef.current;
              const document = current.workspaceDocuments.find((candidate) =>
                candidate.id === current.activeWorkspaceDocumentId);
              if (document?.kind !== 'model' || document.sourceId !== modelId) return;
              residentModelForRigAttachRef.current = {
                documentId: document.id,
                modelId,
                modelSourceKey,
                lifecycleId: rigAttachResidentLifecycleId,
              };
            }}
            characterRigApi={characterRigApiRef.current}
            characterRigSnapshot={characterRigSnapshot}
            onCharacterRigSnapshot={setCharacterRigSnapshot}
            onCharacterRigStatus={(status) => setState((prev) => ({ ...prev, status }))}
            externalAutoRigAvailable={Boolean(activeModelPkg && hasCharacterRigCapability(activeModelPkg) && characterRigSnapshot)}
            externalAutoRigState={externalAutoRigState.modelId === activeModelId ? externalAutoRigState : IDLE_EXTERNAL_AUTO_RIG}
            onExternalAutoRig={() => { void runExternalAutoRig(); }}
            onAcceptExternalAutoRig={acceptExternalAutoRig}
            onSnap={guarded(() => setState((prev) => ({ ...prev, snapIndex: (prev.snapIndex + 1) % SNAP_MODES.length, status: `snap: ${SNAP_MODES[(prev.snapIndex + 1) % SNAP_MODES.length]}` })))}
            onFloor={(delta: number) => invokeApplicationCommand(WORLD_FLOOR_STEP_COMMAND_ID, { delta }, 'action bar')}
            onWallsDown={guarded(() => setState((prev) => ({ ...prev, wallsDown: !prev.wallsDown, status: prev.wallsDown ? 'walls up — this floor\'s walls show again' : 'walls down — this floor\'s walls hidden for interior editing' })))}
            onRetopoTint={guarded((id) => {
              const result = modelToolApiRef.current?.retopoTint(id) ?? { changed: -1, persisted: false };
              const changed = result.changed;
              setState((prev) => ({
                ...prev,
                status: changed > 0
                  ? `${id < 0 ? `removed teaching tint from ${changed} faces` : `tinted ${changed} faces as band ${id + 1}`}${result.persisted ? ' — saved in model package' : ' — PACKAGE WRITE FAILED'}`
                  : changed === 0 ? 'select one or more faces before tinting' : 'retopology tint is unavailable — restart into the rebuilt editor',
              }));
            })}
            onRetopoGhost={guarded(() => {
              const requested = !retopoGhostVisibleRef.current;
              const ghost = modelToolApiRef.current?.retopoGhost(requested) ?? null;
              setState((prev) => ({
                ...prev,
                status: ghost
                  ? `source ghost ${ghost.visible ? 'ON — live edits remain underneath the frozen source' : 'off'} — ${ghost.covered}/${ghost.faces} original faces mapped${ghost.persisted ? ' — saved in model package' : ' — PACKAGE WRITE FAILED'}`
                  : 'no frozen source ghost yet — tint the original soup before editing',
              }));
            })}
            onRetopoClear={guarded(() => {
              const result = modelToolApiRef.current?.retopoClear() ?? { cleared: false, persisted: false };
              setState((prev) => ({ ...prev, status: result.cleared
                ? `cleared the retopology guide${result.persisted ? ' from the model package' : ' live — PACKAGE WRITE FAILED'}`
                : 'no retopology tint map is active' }));
            })}
            retopoGhostVisible={state.modelTool.retopoGhostVisible}
            onMapPaint={patchMapPaint}
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
            onPaintFlora={paintWorldFlora}
            onStampSticker={stampSticker}
            onStickerArm={(patch) => setState((prev) => ({ ...prev, stickerArm: { ...prev.stickerArm, ...patch } }))}
            onFacadeStroke={recordFacadeStroke}
            onFacadePaint={(patch) => setState((prev) => ({ ...prev, facadePaint: { ...prev.facadePaint, ...patch } }))}
            onFacadeStamp={recordFacadeStamp}
            onFacadeClear={clearFacadePaint}
            onFacadeSave={saveFacadePainting}
            onArmPiece={armPiece}
            viewRecall={worldViewRecall}
            onRecallView={recallWorldViewById}
            onExitMaterialFocus={() => {
              selectNativeModelSession(state.workspaceDocuments.find((doc) => doc.id === WORLD_DOCUMENT_ID) ?? null);
              setState((prev) => ({ ...prev, materialFocused: false, activeWorkspaceDocumentId: WORLD_DOCUMENT_ID, status: `returned to world with ${assetById(prev.activeAssetId, prev.assetOverrides).name}` }));
            }}
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
        {activeDocumentKind !== 'knowledge' ? <RenderProbe id="Inspector">
          <Inspector
            state={state}
            activeObject={activeObject}
            activeAsset={assetById(activeObject.assetId, state.assetOverrides)}
            onPane={pressRightPanel}
            onStatus={(status: string) => setState((prev) => ({ ...prev, status }))}
            onSemanticRegionRemoved={() => {
              if (activeModelId) authorizedSemanticClearRef.current.add(activeModelId);
              markActiveModelDirty();
            }}
            onCollapse={() => setState((prev) => ({ ...prev, rightPanelCollapsed: true, status: 'focus panel collapsed' }))}
            onPreset={() => setState((prev) => ({ ...prev, presetMenuOpen: !prev.presetMenuOpen, status: prev.presetMenuOpen ? 'surface preset menu closed' : 'surface preset menu opened' }))}
            onPresetOption={(surfacePreset) => setState((prev) => ({ ...prev, surfacePreset, presetMenuOpen: false, status: `surface preset: ${surfacePreset}` }))}
            onModelBrush={(brush) => modelToolApiRef.current?.setBrush(brush)}
            // Durable identity (req_2620 S/T): the model card's name field renames
            // through the SAME write-through path as the library right-click; the
            // Save verb runs the SAME 'save-snapshot' command as File → Save.
            onRenameModel={renameModel}
            onSaveModel={() => runCommand('save-snapshot', 'focus-panel')}
            onStageThumbnail={stageActiveModelThumbnail}
            modelOnDisk={activeModelOnDisk}
            characterRigApi={characterRigApiRef.current}
            characterRigSnapshot={characterRigSnapshot}
            onCharacterRigSnapshot={setCharacterRigSnapshot}
            blobExplorer={blobExplorerProps}
            onCharacterRigMutated={() => {
              const modelId = activeSessionModelIdRef.current;
              if (modelId) markModelDirty(modelId);
            }}
            onSelectCharacterRigFaces={(indices) => modelToolApiRef.current?.selectFaces([...indices]) ?? 0}
            onAssignHumanoidSemantic={assignHumanoidSemantic}
            onAttachCharacterRig={attachCharacterRig}
            onSetModelRig={setModelRig}
            onSetModelTextureSlots={setModelTextureSlots}
            onSetModelLights={setModelLights}
            onModelTextureMembershipChanged={markModelTextureMembershipDirty}
            onOpenLiveMaterialPicker={(modelId, slotIndex) => setLiveMaterialPicker({ modelId, slotIndex })}
            // PIECE FOCUS material slots (req_3449): the panel names only the
            // ROLE — the target piece is the live selection at click time.
            onAssignSlot={(role) => { const id = stateRef.current.selectedPieceId; if (id) assignPieceSlot(id, role); }}
            onClearSlot={(role) => { const id = stateRef.current.selectedPieceId; if (id) clearPieceSlot(id, role); }}
            worldViews={{
              views: state.worldViews,
              activeId: state.activeWorldViewId,
              onStore: storeWorldViewNow,
              onRecall: recallWorldViewById,
              onRename: renameWorldViewById,
              onRemove: removeWorldViewById,
            }}
            onBrowseMaterials={browseMaterials}
            // PIECE FOCUS instance editing (req_3442, stale-proofed req_3449):
            // Pressable handlers register once and re-register only on clean-prop
            // diffs, so these intents carry NO piece identity — every click
            // resolves the selected piece from stateRef, then lands in the same
            // transaction commands as the viewport and hotkeys.
            pieceEdit={{
              onStepField: (field, direction) => {
                const current = stateRef.current;
                const piece = current.worldPieces.find((p) => p.id === current.selectedPieceId);
                if (!piece) return;
                const step = stepPieceField(piece, field, direction);
                if (!step) return;
                if (step.kind === 'spin') {
                  if (step.rate === (piece.spinDegPerSec ?? 0)) return;
                  invokeApplicationCommand(WORLD_PIECE_SPIN_COMMAND_ID, {
                    documentId: current.activeMapStem,
                    pieceId: piece.id,
                    spinDegPerSec: step.rate,
                  }, 'focus-panel');
                } else {
                  movePiece(piece.id, step.destination);
                }
              },
              onRotateSelected: (quarterTurns) => {
                const current = stateRef.current;
                if (!current.selectedPieceId) return;
                invokeApplicationCommand(WORLD_PIECE_ROTATE_COMMAND_ID, {
                  documentId: current.activeMapStem,
                  pieceId: current.selectedPieceId,
                  quarterTurns,
                }, 'focus-panel');
              },
              onCopySelected: () => {
                const id = stateRef.current.selectedPieceId;
                if (id) copyPiece(id);
              },
              onDeleteSelected: () => {
                const current = stateRef.current;
                if (!current.selectedPieceId) return;
                invokeApplicationCommand(WORLD_PIECE_DELETE_COMMAND_ID, {
                  documentId: current.activeMapStem,
                  pieceId: current.selectedPieceId,
                }, 'focus-panel');
              },
              onOpenPieceModel: (pkgId) => {
                const pkg = effectiveModelPackage(pkgId, stateRef.current.modelOverrides, stateRef.current.modelDupes);
                if (pkg) openModelDocument(pkg);
                else setState((prev) => ({ ...prev, status: `open model: no package '${pkgId}' in the library` }));
              },
              // PAINTINGS chips (req_3458): the same world.piece.skin swap the
              // quick menu runs, on the live selection. The worn check reads the
              // CURRENT piece so an already-worn chip press stays silent.
              onSetPaintingSelected: (skinId) => {
                const current = stateRef.current;
                const piece = current.worldPieces.find((p) => p.id === current.selectedPieceId);
                if (!piece || paintSkinIdOf(piece.pieceId) === skinId) return;
                invokeApplicationCommand(WORLD_PIECE_SKIN_COMMAND_ID, {
                  documentId: current.activeMapStem,
                  pieceId: piece.id,
                  skinId,
                }, 'focus-panel');
              },
            }}
            // World-globals tuning (GLOBALS req_2770): the playtest tab's panel.
            onSetGlobal={guarded(setWorldGlobal)}
            onResetGlobal={guarded(resetWorldGlobal)}
            outlinerHandlers={outlinerHandlers}
            stagePartFocusEnabled={stagePartFocusEnabled}
            onToggleStagePartFocus={toggleStagePartFocus}
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
        </RenderProbe> : null}
      </C.HW_Body>
      <RenderProbe id="Bottom Dock">
        <BuildDock
          state={state}
          journal={journal}
          liveUndoDepths={liveUndoDepths}
          onBuild={guarded(() => setState((prev) => ({ ...prev, buildDialogOpen: true, eventbusPopoverOpen: false, perfPopoverOpen: false, memoryPopoverOpen: false, status: `opened build journal ${journal.activeBuild}` })))}
          onEventbus={guarded(() => setState((prev) => ({ ...prev, eventbusPopoverOpen: !prev.eventbusPopoverOpen, perfPopoverOpen: false, memoryPopoverOpen: false, status: prev.eventbusPopoverOpen ? 'eventbus review closed' : 'eventbus review opened' })))}
          // Toolbar undo/redo route EXACTLY like Ctrl+Z — through runCommand, which
          // sends a model doc to its current native owner (rig, paint, or mesh)
          // and the world to the real world undo stacks (req_2620 W). Never the
          // old feed-splice placebo.
          onUndo={() => runCommand('undo-local', 'dock')}
          onRedo={() => runCommand('redo-local', 'dock')}
          onPerf={guarded(() => setState((prev) => ({ ...prev, perfPopoverOpen: !prev.perfPopoverOpen, memoryPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.perfPopoverOpen ? 'performance churn closed' : 'performance churn opened' })))}
          onMemory={guarded(() => setState((prev) => ({ ...prev, memoryPopoverOpen: !prev.memoryPopoverOpen, perfPopoverOpen: false, eventbusPopoverOpen: false, buildDialogOpen: false, status: prev.memoryPopoverOpen ? 'memory accumulation closed' : 'memory accumulation opened' })))}
          nativeUpdateReady={nativeUpdateNotice !== null}
          nativeUpdateOpen={nativeUpdateNotice?.collapsed === false}
          onNativeUpdate={() => setNativeUpdateNotice((current) => current ? { ...current, collapsed: !current.collapsed } : null)}
          loreStatus={blobService}
          onLore={() => setState((current) => {
            const document = current.workspaceDocuments.find((row) => row.id === current.activeWorkspaceDocumentId);
            return document?.kind === 'model'
              ? { ...current, rightPane: 'recovery', rightPanelCollapsed: false, status: `Lore recovery ${blobService.state}` }
              : { ...current, status: `Lore recovery ${blobService.state} — open a model to inspect snapshots` };
          })}
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
      {nativeUpdateNotice && !nativeUpdateNotice.collapsed ? (
        <RenderProbe id="Native Update Notice">
          <NativeUpdateNotice
            notice={nativeUpdateNotice}
            onLater={() => setNativeUpdateNotice((current) => current ? { ...current, collapsed: true } : null)}
            onApply={() => {
              const current = nativeUpdateNotice;
              if (!current) return;
              const editor = stateRef.current;
              const dirtyModels = Object.entries(editor.modelDirty).filter(([, dirty]) => dirty).map(([id]) => id);
              if (dirtyModels.length > 0 || manualWorldDirty) {
                const reason = dirtyModels.length > 0
                  ? `RESTART BLOCKED · ${dirtyModels.length} dirty model${dirtyModels.length === 1 ? '' : 's'} only exist in the running editor. Applying this rebuild would discard those resident edits.`
                  : 'RESTART BLOCKED · the world has unsaved edits that would be discarded by this rebuild.';
                setNativeUpdateNotice((notice) => notice?.token === current.token
                  ? { ...notice, safetyMessage: reason }
                  : notice);
                setState((prev) => ({
                  ...prev,
                  status: `Native update still waiting — save ${dirtyModels.length > 0 ? `${dirtyModels.length} dirty model${dirtyModels.length === 1 ? '' : 's'}` : 'the dirty world'} first`,
                }));
                return;
              }
              const blocking = blockingNow(editor);
              if (blocking) {
                const reason = `RESTART BLOCKED · finish ${blocking.label} first.`;
                setNativeUpdateNotice((notice) => notice?.token === current.token
                  ? { ...notice, safetyMessage: reason }
                  : notice);
                setState((prev) => ({ ...prev, status: `Native update still waiting — finish ${blocking.label} first` }));
                return;
              }
              const wrote = (globalThis as any).__fs_write?.(
                current.approvalPath,
                nativeUpdateApprovalJson(current.token),
              ) === true;
              if (wrote) {
                setNativeUpdateNotice(null);
                setState((prev) => ({ ...prev, status: 'Applying the approved native update…' }));
              } else {
                setState((prev) => ({ ...prev, status: 'Could not send native update approval — the running editor was not touched' }));
              }
            }}
          />
        </RenderProbe>
      ) : null}
      {orphanHostsNotice && !orphanHostsNotice.collapsed ? (
        <RenderProbe id="Orphan Hosts Notice">
          <OrphanHostsNotice
            notice={orphanHostsNotice}
            onLater={() => setOrphanHostsNotice((current) => current ? { ...current, collapsed: true } : null)}
            onClean={() => {
              const current = orphanHostsNotice;
              if (!current) return;
              // The editor NEVER signals a process. It writes a one-shot approval and
              // the dev supervisor — the thing that owns process lifetime — does the
              // work, pid by exact pid, re-verifying each one first.
              const wrote = (globalThis as any).__fs_write?.(
                current.approvalPath,
                orphanCleanupApprovalJson(current.token, current.pids),
              ) === true;
              if (wrote) {
                setOrphanHostsNotice(null);
                setState((prev) => ({ ...prev, status: `Retiring ${current.pids.length} orphaned dev host(s)…` }));
              } else {
                setState((prev) => ({ ...prev, status: 'Could not send the cleanup approval — no process was signalled' }));
              }
            }}
          />
        </RenderProbe>
      ) : null}
      {unsavedDocumentName ? (
        <RenderProbe id="Unsaved Changes Dialog">
          <UnsavedChangesDialog
            documentName={unsavedDocumentName}
            saveLabel={unsavedActionLabels.save}
            discardLabel={unsavedActionLabels.discard}
            cancelLabel={unsavedActionLabels.cancel}
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
      {nameSelectionOpen ? (
        <RenderProbe id="Name Selection Dialog">
          <NameSelectionDialog
            kind={state.modelTool.selMode === 2 ? 'edge' : 'face'}
            selectedCount={state.modelTool.sel}
            existingNames={residentRegionNames()}
            onCancel={() => { setNameSelectionOpen(false); setState((prev) => ({ ...prev, status: 'name selection cancelled' })); }}
            onApply={applyNameSelection}
          />
        </RenderProbe>
      ) : null}
      {prefabCaptureOpen ? (
        <RenderProbe id="Prefab Dialog">
          <PrefabDialog
            pieceCount={state.selectedPieceIds.length}
            onCancel={() => { setPrefabCaptureOpen(false); setState((prev) => ({ ...prev, status: 'prefab capture cancelled' })); }}
            onCreate={captureSelectedPrefab}
          />
        </RenderProbe>
      ) : null}
      {state.exportCharacterPrompt ? (
        <ExportCharacterDialog
          modelName={activeModelPkg?.name ?? 'model'}
          currentPlayerName={currentPlayerCharacter()?.name ?? null}
          readiness={characterRigSnapshot?.readiness ?? []}
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
          <C.HW_MenuDismiss onPress={() => setState((prev) => ({ ...prev, openMenu: null }))} />
          <DropdownMenu state={state} onCommand={runCommand} onToggleLight={(which) => modelToolApiRef.current?.toggleLight(which)} />
        </RenderProbe>
      ) : null}
      {importPlan ? (
        <RenderProbe id="Import Image Dialog">
          <ImportImageDialog plan={importPlan} onPick={commitImageImport} onCancel={() => setImportPlan(null)} />
        </RenderProbe>
      ) : null}
      {stlConversionName ? (
        <RenderProbe id="STL Conversion Dialog">
          <StlConversionDialog filename={stlConversionName} />
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
      {/* Live-material picker (req_3401): the Rig row's `pick` verb binds a
          texture slot's live material BY LOOK — same picker organ as the map
          brush. A pick patches the slot and STAYS OPEN so looks compare live
          on the mesh; the scrim closes it. */}
      {liveMaterialPicker ? (() => {
        const pkg = visibleModels.find((m) => m.id === liveMaterialPicker.modelId);
        const slots = state.modelTextureSlots[liveMaterialPicker.modelId] ?? pkg?.textureSlots ?? [];
        const slot = slots[liveMaterialPicker.slotIndex];
        if (!slot) return null;
        return (
          <RenderProbe id="Live Material Picker">
            <MaterialPickerPopover
              title={`${slot.label} wears:`}
              boundFn={slot.liveMaterial?.fn ?? null}
              boundVariant={slot.liveMaterial?.variant ?? 0}
              materials={REGION_MATERIALS}
              onPick={(fn, variant) => {
                const next = slots.map((s, at) => {
                  if (at !== liveMaterialPicker.slotIndex) return s;
                  const { liveMaterial: prior, ...rest } = s;
                  return { ...rest, liveMaterial: { fn, variant, ...(prior?.scale ? { scale: prior.scale } : {}) } };
                });
                setModelTextureSlots(liveMaterialPicker.modelId, next);
              }}
              onClose={() => setLiveMaterialPicker(null)}
              anchor={{ right: 360, top: 120 }}
            />
          </RenderProbe>
        );
      })() : null}
      {/* Content-browser model menu — late root mount is the clipping boundary,
          exactly like the model-stage and world-piece menus below. */}
      {libraryMenuModel ? (
        <libraryModelMenu.ContextMenu onDismiss={() => setLibraryMenuModelId(null)}>
          <ModelActionMenu
            model={libraryMenuModel}
            onRename={startRenameModel}
            onFavorite={favoriteModel}
            onDuplicate={duplicateModel}
            onDelete={deleteModel}
            onClose={() => {
              libraryModelMenu.close();
              setLibraryMenuModelId(null);
            }}
          />
        </libraryModelMenu.ContextMenu>
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
            paintings={worldQuickPaintings.skins}
            basePaintingId={worldQuickPaintings.baseSkinId}
            onSetPainting={(id, skinId) => invokeApplicationCommand(WORLD_PIECE_SKIN_COMMAND_ID, {
              documentId: stateRef.current.activeMapStem,
              pieceId: id,
              skinId,
            }, 'context')}
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
