// SECTION E — Stage (see shell/regions.ts SECTIONS): the flexing center
// viewport — world / model / playtest / animation / material-focus surfaces +
// their in-viewport docks (BuildBar, MapPaintDock). Section F (StageTabs)
// renders below the viewport inside this same panel.
import { useMemo, type ReactNode } from 'react';
import { C } from '../workspace.cls';
import type { Asset, EditorState, ModelToolApi, ModelToolSnapshot, Rgb } from '../data/types';
import type { WorldView } from '../world/worldViews';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import type { OklchColor } from '../../../runtime/paint/colors';
import { effectiveModelPackage } from '../data/content';
import { WORLD_DOCUMENT_ID, modelDocument, worldDocument } from '../data/documents';
import ContextMenu from '../shell/ContextMenu';
import AnimationCaptureSurface from './AnimationCaptureSurface';
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
import { playerCharacterPackage } from '../world/playerCharacterLoader';
import { characterRigViewportShouldOwnInput } from './characterRigViewport';

export default function Stage(props: {
  state: EditorState;
  mapSwitchPending: boolean;
  activeAsset: Asset | null;
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
  onRequireFirstModelSave: () => boolean;
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
  /** Draw Wall (req_4473): one committed semantic wall span from the viewport. */
  onDrawWall: (commit: import('../world/wallTools').WallDrawCommit) => void;
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
  // A retired segmented package may retain its historical player declaration
  // on disk, but it cannot shadow the current bound welded target in capture.
  const capturePlayer = playerCharacterPackage(playtestCharacterPackages);
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
          onDrawWall={props.onDrawWall}
        />
        {worldActive ? null : activeDocument.kind === 'home' ? (
          props.homeSurface
        ) : activeDocument.kind === 'knowledge' ? (
          <WorldBibleSurface />
        ) : activeDocument.kind === 'animation' ? (
          <AnimationCaptureSurface targetPackage={capturePlayer} />
        ) : activeDocument.kind === 'playtest' ? (
          <PlaytestSurface
            globals={props.state.worldGlobals}
            pieces={props.state.worldPieces}
            authoredPieces={props.state.authoredBuildPieces}
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
        {activeDocument.kind === 'world' && !props.state.mapOverviewOpen && !props.state.mapPaint.active && worldToolFor(props.state.activeCommandId) === 'place' ? (
          <BuildBar armedPieceId={props.state.armedPieceId} prefabs={props.state.worldPrefabs} onArm={props.onArmPiece} />
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
