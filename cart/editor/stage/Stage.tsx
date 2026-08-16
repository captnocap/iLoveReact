// SECTION E — Stage (see shell/regions.ts SECTIONS): the flexing center
// viewport — world / model / playtest / animation / material-focus surfaces +
// their in-viewport docks (BuildBar, MapPaintDock). Section F (StageTabs)
// renders below the viewport inside this same panel.
import { createElement, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { C } from '../workspace.cls';
import { Box, Text } from '../../../runtime/primitives';
import type { Asset, EditorState, ModelToolApi, ModelToolSnapshot, Rgb } from '../data/types';
import type { WorldView } from '../world/worldViews';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import type { OklchColor } from '../../../runtime/paint/colors';
import { effectiveModelPackage } from '../data/content';
import { WORLD_DOCUMENT_ID, modelDocument, worldDocument } from '../data/documents';
import ContextMenu from '../shell/ContextMenu';
import { AnimationWorkspace } from '../animation/AnimationWorkspace';
import { ANIMATION_CHANNEL_GROUPS } from '../animation/channelGroups';
import { ANIMATION_PREVIEW_WORLD_PROPS } from '../animation/previewWorld';
import MaterialFocusSurface from './MaterialFocusSurface';
import ModelDocumentSurface, { type OutlinerHandlers } from './ModelDocumentSurface';
import PlaytestSurface from './PlaytestSurface';
import StageTabs from './StageTabs';
import { deriveLabDocumentTitles } from '../material/materialLabPresentation';
import WorldEditorSurface from './WorldEditorSurface';
import FacadePainterSurface from './FacadePainterSurface';
import BuildBar from './BuildBar';
import MapPaintDock from './MapPaintDock';
import { worldToolFor } from '../world/worldTool';
import WorldBibleSurface from '../worldBible/WorldBibleSurface';
import type { PieceSelectionIntent } from '../world/selection';
import type { FloraPaintSample, WorldFloraBrush } from '../world/surfaceFlora';
import type { PaintLayoutKeepLiveOptions } from '../model/paintLayoutConflict';
import type { CharacterRigApi, CharacterRigSnapshot } from '../../../runtime/skeleton';
import { MODEL_PACKAGES, assetByIdOrNull } from '../data/catalog';
import { characterRigViewportShouldOwnInput } from './characterRigViewport';
import type { AnimationWorkspaceBridge } from './Workspace';
import { pushPlayerCharacter, resolvePlayerCharacter } from '../world/playerCharacterLoader';
import { playerCharacterMountGate } from '../world/playerCharacterGate';

const ANIMATION_PREVIEW_MOUNT = Object.freeze({ pollMs: 32, maximumPolls: 120 });

/** The Foundry preview is one isolated native player stage. It shares the
 * WorldLoader character/motion/prop doors without loading the authored game
 * world. Its node identity is attached after host mount and detached with this
 * viewport only; queue/catalog lifetime remains in AppFrame. */
function AnimationPreviewWorld(props: Pick<AnimationWorkspaceBridge, 'targetPackage' | 'onPreviewMounted' | 'onPreviewUnmounted' | 'onPreviewError'>) {
  const targetResolution = useMemo(() => resolvePlayerCharacter(props.targetPackage), [props.targetPackage]);
  const stagedTarget = useMemo(() => pushPlayerCharacter(props.targetPackage), [props.targetPackage]);
  const targetGate = playerCharacterMountGate(targetResolution, stagedTarget);
  const loaderRef = useRef<any>(null);
  const mountedRef = useRef(props.onPreviewMounted);
  const unmountedRef = useRef(props.onPreviewUnmounted);
  const errorRef = useRef(props.onPreviewError);
  mountedRef.current = props.onPreviewMounted;
  unmountedRef.current = props.onPreviewUnmounted;
  errorRef.current = props.onPreviewError;
  useEffect(() => {
    if (!targetGate.ready) {
      errorRef.current(`Animation preview unavailable: ${targetGate.reason}`);
      return;
    }
    let attachedNodeId = 0;
    let polls = 0;
    let lastError = 'the WorldLoader host did not publish a native node id';
    let timer: ReturnType<typeof setInterval> | null = null;
    const acquire = (): boolean => {
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (!Number.isSafeInteger(nodeId) || nodeId < 1) return false;
      try {
        mountedRef.current(nodeId);
        attachedNodeId = nodeId;
        return true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        return false;
      }
    };
    if (!acquire()) {
      timer = setInterval(() => {
        polls += 1;
        if (acquire() || polls >= ANIMATION_PREVIEW_MOUNT.maximumPolls) {
          if (timer) clearInterval(timer);
          timer = null;
          if (attachedNodeId === 0) errorRef.current(`Animation preview unavailable: ${lastError}`);
        }
      }, ANIMATION_PREVIEW_MOUNT.pollMs);
    }
    return () => {
      if (timer) clearInterval(timer);
      if (attachedNodeId > 0) unmountedRef.current(attachedNodeId);
    };
  }, []);
  if (!targetGate.ready) {
    return (
      <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d141f' }}>
        <Box style={{ maxWidth: 560, padding: 16, gap: 7, borderWidth: 1, borderColor: '#70433b', borderRadius: 7, backgroundColor: '#271614' }}>
          <Text style={{ color: '#f0aa98', fontSize: 12, fontFamily: 'monospace', fontWeight: 700, textAlign: 'center' }}>ANIMATION PREVIEW BLOCKED</Text>
          <Text style={{ color: '#d6b0a8', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' }}>{targetGate.reason}</Text>
          <Text style={{ color: '#9f8a86', fontSize: 9, fontFamily: 'monospace', textAlign: 'center' }}>Fit, bind, save, and declare one welded player character.</Text>
        </Box>
      </Box>
    );
  }
  return createElement('WorldLoader', {
    ref: loaderRef,
    ...ANIMATION_PREVIEW_WORLD_PROPS,
    testID: 'editor-animation-foundry-preview',
    style: { width: '100%', height: '100%', backgroundColor: '#0d141f' },
  });
}

export default function Stage(props: {
  state: EditorState;
  mapSwitchPending: boolean;
  activeAsset: Asset | null;
  animation: AnimationWorkspaceBridge;
  /** The Home surface node — Stage places it, AppFrame builds it. */
  homeSurface: ReactNode;
  onWorkspaceDocument: (id: string) => void;
  onCloseWorkspaceDocument: (id: string) => void;
  onCommand: (id: string, source: string) => void;
  onMapPaint: (patch: Partial<EditorState['mapPaint']>) => void;
  onModelToolApi: (api: ModelToolApi) => void;
  onModelToolState: (state: ModelToolSnapshot) => void;
  modelContextTrigger: { onRightClick: (e: { x: number; y: number }) => void };
  outlinerHandlers: OutlinerHandlers;
  modelOnDisk: boolean;
  modelReloadRevision: number;
  onDiscardActiveModel: () => void;
  onSavePaintConflictLive: (options?: PaintLayoutKeepLiveOptions) => boolean;
  /** First save propagated by atlas creation — true, or the exact refusal (req_4551). */
  onRequireFirstModelSave: () => true | string;
  onModelDocumentMutated: () => void;
  onResidentModelReady: (modelId: string, modelSourceKey: string) => void;
  characterRigApi: CharacterRigApi | null;
  characterRigSnapshot: CharacterRigSnapshot | null;
  onCharacterRigSnapshot: (snapshot: CharacterRigSnapshot | null) => void;
  onCharacterRigStatus: (message: string) => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  /** Saved-view recall (req_4168): the pin to jump to plus the nonce that makes a
   *  repeat recall of the same pin re-fire. `onRecallView` is the minimap pin click. */
  viewRecall: { view: WorldView; nonce: number } | null;
  onRecallView: (id: string) => void;
  onPlacePiece: (pieces: PlacedPiece[], gesture: PlacementGesture) => void;
  onMovePiece: (id: string, destination: PlacedPiece) => void;
  onSelectPiece: (id: string | null, intent: PieceSelectionIntent) => void;
  onPieceContext: (id: string, x: number, y: number, role: string | null) => void;
  onPaintFaces: (targets: readonly PieceMaterialTarget[]) => void;
  onStampSticker: (id: string, role: string, local: { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number }) => void;
  onPaintFlora: (samples: readonly FloraPaintSample[], brush: WorldFloraBrush) => void;
  /** Draw Wall (req_4473): one committed semantic wall span from the viewport.
   * Returns whether the engine accepted it — a reject keeps the anchor put
   * (req_4479) so the user retries the same span, not a chained one. */
  onDrawWall: (commit: import('../world/wallTools').WallDrawCommit) => boolean;
  /** Place Door/Window (req_4513): palette-armed kit + verbs, routed to the viewport. */
  openingKit: import('../world/openingTools').OpeningKitArm | null;
  onCutOpening: (hit: { edgeId: string; side: 'a' | 'b'; slot: import('../world/architecture').WallCell }) => boolean;
  onSelectOpening: (hit: { edgeId: string; openingId: string }) => void;
  openingFootprints: Readonly<Record<string, import('../world/architecture').ArchitectureFootprint>>;
  openingDepthsU: Readonly<Record<string, number>>;
  /** Opening-kit resident adapters (req_4526) — mounted doors + the armed mesh ghost. */
  openingKitPieces: readonly import('../world/authoredRegistry').AuthoredBuildPiece[];
  /** The measured style's default wall measurements — the gizmo's seed (req_4479). */
  wallDefaults: { heightU: number; thicknessU: number } | null;
  /** A Select-tool click resolved to a wall face (req_4480). */
  onSelectWall: (hit: { edgeId: string; side: 'a' | 'b' }) => void;
  onFacadeStroke: (facadeId: string, stroke: import('../world/facades').FacadeStroke) => void;
  onFacadePaint: (patch: Partial<EditorState['facadePaint']>) => void;
  onFacadeStamp: (facadeId: string, stamp: import('../world/facades').FacadeStamp) => void;
  onFacadeClear: (facadeId: string) => void;
  onFacadeSave: (facadeId: string, strokesRgba: Uint8Array, width: number, height: number) => void;
  onArmPiece: (pieceId: string) => void;
  onExitMaterialFocus: () => void;
  onSelectColorStudioMaterial: (specId: string) => void;
  onColorStudioVariant: (variant: number) => void;
  onColorStudioSeed: () => void;
  onColorStudioQuality: (quality: number) => void;
  onColorStudioSlot: (slot: number) => void;
  onColorStudioFill: (rgb: Rgb, source: string) => void;
  onColorStudioReset: () => void;
  onColorStudioView: (view: EditorState['colorStudioView']) => void;
  onColorSpineCurrent: (color: OklchColor) => void;
  onColorSpineAddToTray: () => void;
  onColorSpineTrayPick: (color: OklchColor) => void;
  onColorSpineScenePick: (color: OklchColor, css: string) => void;
  onColorSpineLoadLibrarySet: (name: string, colors: OklchColor[]) => void;
  onCreateColorSet: () => void;
  onDeleteColorSet: (index: number) => void;
  labRecipe: import('../render3d/shaders/recipe').MaterialRecipe | null;
  labHandlers: import('./MaterialLabSurface').LabHandlers;
  onOpenInLab: (specId: string, variant?: number) => void;
}) {
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId)
    ?? props.state.workspaceDocuments[0]!;
  const activeModel = activeDocument.kind === 'model' && activeDocument.sourceId
    ? effectiveModelPackage(activeDocument.sourceId, props.state.modelOverrides, props.state.modelDupes)
    : null;
  // The outliner drives multi-part models: present only when this model carries parts state
  // (primitive-authored). Combines the live parts with the stable handlers from AppFrame.
  const activeParts = activeModel ? props.state.modelParts[activeModel.id] : undefined;
  const outliner = activeModel && activeParts
    ? { parts: activeParts, activePartId: props.state.modelActivePartId, ...props.outlinerHandlers }
    : null;
  // Session packages override the boot scan by stable package id so a freshly
  // exported bound player/NPC is the exact declaration `/play` stages now.
  const playtestCharacterPackages = useMemo(() => {
    const current = new Map(MODEL_PACKAGES.map((model) => [model.id, model]));
    for (const model of props.state.modelDupes) current.set(model.id, model);
    return [...current.values()].filter((model) => model.placeable?.as === 'character');
  }, [props.state.modelDupes]);
  const animationTargetMeshes = props.animation.targetPackage?.skeleton?.meshes;
  const animationPreviewKey = props.animation.targetPackage && animationTargetMeshes?.kind === 'skinned'
    ? `${props.animation.targetPackage.id}:${animationTargetMeshes.geometryPath ?? ''}:${animationTargetMeshes.binding?.artifactHash ?? ''}`
    : 'animation-player-unavailable';
  // Tab titles are DERIVED from the live model, not the doc's frozen snapshot — a model's
  // name (e.g. a generic "Model 3") can change out from under an old persisted doc, and the
  // tab must follow it rather than show a stale seed name like "Cone 1" (req_2406).
  const modelDerivedDocuments = props.state.workspaceDocuments.map((doc) => {
    // Same law for the world tab: it is named by the map ACTUALLY open in it,
    // not by a frozen 'main.gamefile' that never existed (req_4435).
    if (doc.id === WORLD_DOCUMENT_ID) return worldDocument(props.state.activeMapName);
    if (doc.kind !== 'model' || !doc.sourceId) return doc;
    const live = effectiveModelPackage(doc.sourceId, props.state.modelOverrides, props.state.modelDupes);
    return live ? modelDocument(live) : doc;
  });
  const liveLabRecipe = props.state.labActiveRecipeId
    ? props.state.labRecipes.find((recipe) => recipe.id === props.state.labActiveRecipeId) ?? null
    : null;
  const tabDocuments = deriveLabDocumentTitles(modelDerivedDocuments, props.state.activeWorkspaceDocumentId, liveLabRecipe);
  const characterRigViewportActive = characterRigViewportShouldOwnInput(
    activeModel,
    props.state.rightPane,
    props.state.rightPanelCollapsed,
    props.state.modelTool,
  );
  const worldActive = activeDocument.kind === 'world';
  // The material surface's subject is THE DOCUMENT's material, resolved live —
  // never state.activeAssetId, which is null whenever nothing is picked.
  const materialFocusAsset = activeDocument.kind === 'material' && activeDocument.sourceId
    ? assetByIdOrNull(activeDocument.sourceId, props.state.assetOverrides)
    : props.activeAsset;
  return (
    <C.HW_StagePanel>
      <C.HW_StageViewport>
        {activeDocument.kind === 'world' || activeDocument.kind === 'model' || activeDocument.kind === 'playtest' || activeDocument.kind === 'animation' || activeDocument.kind === 'knowledge' || activeDocument.kind === 'home' ? null : <C.HW_CanvasGrid />}
        <WorldEditorSurface
          active={worldActive}
          interactionLocked={props.mapSwitchPending}
          mapOverviewOpen={props.state.mapOverviewOpen}
          onToggleMap={() => props.onCommand('toggle-minimap', 'stage')}
          paintActive={props.state.mapPaint.active}
          mapPaint={props.state.mapPaint}
          mapStem={props.state.activeMapStem}
          mapZones={props.state.mapPaint.zones}
          floor={props.state.floorIndex}
          viewRecall={props.viewRecall}
          views={props.state.worldViews}
          onRecallView={props.onRecallView}
          wallsDown={props.state.wallsDown}
          activeCommandId={props.state.activeCommandId}
          pieces={props.state.worldPieces}
          selectedIds={props.state.selectedPieceIds}
          armedPieceId={props.state.armedPieceId}
          armedYawDegrees={props.state.armedYawDegrees}
          authoredPieces={props.state.authoredBuildPieces}
          prefabs={props.state.worldPrefabs}
          worldFlora={props.state.worldFlora}
          floraSpecies={props.state.authoredFloraSpecies}
          onPlace={props.onPlacePiece}
          onMove={props.onMovePiece}
          onSelect={props.onSelectPiece}
          onPieceContext={props.onPieceContext}
          onPaintFaces={props.onPaintFaces}
          onStampSticker={props.onStampSticker}
          onPaintFlora={props.onPaintFlora}
          architecture={props.state.architecture}
          architectureSelection={props.state.architectureSelection}
          onDrawWall={props.onDrawWall}
          wallDefaults={props.wallDefaults}
          onSelectWall={props.onSelectWall}
          openingKit={props.openingKit}
          onCutOpening={props.onCutOpening}
          onSelectOpening={props.onSelectOpening}
          openingFootprints={props.openingFootprints}
          openingDepthsU={props.openingDepthsU}
          openingKitPieces={props.openingKitPieces}
        />
        {worldActive ? null : activeDocument.kind === 'home' ? (
          props.homeSurface
        ) : activeDocument.kind === 'knowledge' ? (
          <WorldBibleSurface />
        ) : activeDocument.kind === 'animation' ? (
          <AnimationWorkspace
            projection={props.animation.projection}
            channelGroups={ANIMATION_CHANNEL_GROUPS}
            previewNode={<AnimationPreviewWorld
              key={animationPreviewKey}
              targetPackage={props.animation.targetPackage}
              onPreviewMounted={props.animation.onPreviewMounted}
              onPreviewUnmounted={props.animation.onPreviewUnmounted}
              onPreviewError={props.animation.onPreviewError}
            />}
            callbacks={props.animation.callbacks}
          />
        ) : activeDocument.kind === 'playtest' ? (
          <PlaytestSurface
            globals={props.state.worldGlobals}
            pieces={props.state.worldPieces}
            authoredPieces={props.state.authoredBuildPieces}
            openingKitPieces={props.openingKitPieces}
            worldFlora={props.state.worldFlora}
            floraSpecies={props.state.authoredFloraSpecies}
            prefabs={props.state.worldPrefabs}
            characterPackages={playtestCharacterPackages}
          />
        ) : activeDocument.kind === 'facade' ? (
          (() => {
            const facade = props.state.worldFacades.find((f) => f.id === activeDocument.sourceId);
            return facade ? (
              <FacadePainterSurface
                facade={facade}
                stickerArm={props.state.stickerArm}
                onStroke={props.onFacadeStroke}
                paintState={props.state.facadePaint}
                onPaintState={props.onFacadePaint}
                onStamp={props.onFacadeStamp}
                onClear={props.onFacadeClear}
                onSave={props.onFacadeSave}
              />
            ) : null;
          })()
        ) : activeDocument.kind === 'model' ? (
          <ModelDocumentSurface
            model={activeModel}
            documentId={activeDocument.id}
            lights={activeModel ? (props.state.modelLights[activeModel.id] ?? activeModel.lights ?? []) : []}
            textureSlots={activeModel ? (props.state.modelTextureSlots[activeModel.id] ?? activeModel.textureSlots ?? []) : []}
            triggerProps={props.modelContextTrigger}
            onToolApi={props.onModelToolApi}
            onToolState={props.onModelToolState}
            outliner={outliner}
            modelOnDisk={props.modelOnDisk}
            modelDirty={activeModel ? Boolean(props.state.modelDirty[activeModel.id]) : false}
            reloadRevision={props.modelReloadRevision}
            onDiscardLive={props.onDiscardActiveModel}
            onKeepLive={props.onSavePaintConflictLive}
            onRequireFirstSave={props.onRequireFirstModelSave}
            onDocumentMutated={props.onModelDocumentMutated}
            onResidentModelReady={props.onResidentModelReady}
            characterRigApi={props.characterRigApi}
            characterRigSnapshot={props.characterRigSnapshot}
            onCharacterRigSnapshot={props.onCharacterRigSnapshot}
            onCharacterRigStatus={props.onCharacterRigStatus}
            characterRigViewportActive={characterRigViewportActive}
          />
        ) : materialFocusAsset ? (
          <MaterialFocusSurface
            state={props.state}
            activeAsset={materialFocusAsset}
            labRecipe={props.labRecipe}
            labHandlers={props.labHandlers}
            onExit={props.onExitMaterialFocus}
            onSelectMaterial={props.onSelectColorStudioMaterial}
            onVariant={props.onColorStudioVariant}
            onSeed={props.onColorStudioSeed}
            onQuality={props.onColorStudioQuality}
            onSlot={props.onColorStudioSlot}
            onFill={props.onColorStudioFill}
            onReset={props.onColorStudioReset}
            onView={props.onColorStudioView}
            onSpineCurrent={props.onColorSpineCurrent}
            onSpineAddToTray={props.onColorSpineAddToTray}
            onSpineTrayPick={props.onColorSpineTrayPick}
            onSpineScenePick={props.onColorSpineScenePick}
            onSpineLoadLibrarySet={props.onColorSpineLoadLibrarySet}
            onCreateSet={props.onCreateColorSet}
            onDeleteSet={props.onDeleteColorSet}
            onOpenInLab={props.onOpenInLab}
          />
        ) : (
          // No material document and nothing picked — the stage says so rather
          // than staging whatever the catalog lists first (req_4435).
          <C.HW_StageEmpty>
            <C.HW_StageEmptyLine>Nothing open here — pick a material in the Asset Explorer, or choose a document tab.</C.HW_StageEmptyLine>
          </C.HW_StageEmpty>
        )}
        {activeDocument.kind === 'material' && props.state.contextOpen ? <ContextMenu state={props.state} onCommand={props.onCommand} /> : null}
        {/* Sims build bar (req_2563) — overlays the bottom of the viewport in
            Build (Place) mode. Last child so it paints + hit-tests over the
            world surface's pointer-capture Pressable. */}
        {activeDocument.kind === 'world' && !props.state.mapOverviewOpen && !props.state.mapPaint.active
          && (worldToolFor(props.state.activeCommandId) === 'place' || worldToolFor(props.state.activeCommandId) === 'cutOpening') ? (
          <BuildBar armedPieceId={props.state.armedPieceId} armedOpeningKitId={props.state.armedOpeningKitId} prefabs={props.state.worldPrefabs} onArm={props.onArmPiece} />
        ) : null}
        {activeDocument.kind === 'world' && !props.state.mapOverviewOpen && (props.state.mapPaint.active || props.state.mapPaint.texturePickerOpen) ? (
          <MapPaintDock state={props.state.mapPaint} customFlora={props.state.authoredFloraSpecies} onPatch={props.onMapPaint} />
        ) : null}
      </C.HW_StageViewport>
      <StageTabs
        documents={tabDocuments}
        activeId={activeDocument.id}
        onDocument={props.onWorkspaceDocument}
        onCloseDocument={props.onCloseWorkspaceDocument}
      />
    </C.HW_StagePanel>
  );
}
