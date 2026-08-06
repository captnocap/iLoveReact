// SECTION E — Stage (see shell/regions.ts SECTIONS): the flexing center
// viewport — world / model / playtest / animation / material-focus surfaces +
// their in-viewport docks (BuildBar, MapPaintDock). Section F (StageTabs)
// renders below the viewport inside this same panel.
import { C } from '../workspace.cls';
import type { Asset, EditorState, ModelToolApi, ModelToolSnapshot, Rgb } from '../data/types';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import type { OklchColor } from '../../../runtime/paint/colors';
import { modelPackageById } from '../data/content';
import { modelDocument } from '../data/documents';
import ContextMenu from '../shell/ContextMenu';
import AnimationCaptureSurface from './AnimationCaptureSurface';
import MaterialFocusSurface from './MaterialFocusSurface';
import ModelDocumentSurface, { type OutlinerHandlers } from './ModelDocumentSurface';
import PlaytestSurface from './PlaytestSurface';
import StageTabs from './StageTabs';
import WorldEditorSurface from './WorldEditorSurface';
import FacadePainterSurface from './FacadePainterSurface';
import BuildBar from './BuildBar';
import MapPaintDock from './MapPaintDock';
import { worldToolFor } from '../world/worldTool';
import WorldBibleSurface from '../worldBible/WorldBibleSurface';
import type { PieceSelectionIntent } from '../world/selection';
import type { FloraPaintSample, WorldFloraBrush } from '../world/surfaceFlora';

export default function Stage(props: {
  state: EditorState;
  activeAsset: Asset;
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
  onSavePaintConflictLive: () => boolean;
  onRequireFirstModelSave: () => boolean;
  onModelDocumentMutated: () => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  onPlacePiece: (pieces: PlacedPiece[], gesture: PlacementGesture) => void;
  onMovePiece: (id: string, destination: PlacedPiece) => void;
  onSelectPiece: (id: string | null, intent: PieceSelectionIntent) => void;
  onPieceContext: (id: string, x: number, y: number, role: string | null) => void;
  onPaintFaces: (targets: readonly PieceMaterialTarget[]) => void;
  onStampSticker: (id: string, role: string, local: { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number }) => void;
  onPaintFlora: (samples: readonly FloraPaintSample[], brush: WorldFloraBrush) => void;
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
  onColorSpineLoadLibrarySet: (colors: OklchColor[]) => void;
}) {
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId)
    ?? props.state.workspaceDocuments[0]!;
  const activeModel = activeDocument.kind === 'model' && activeDocument.sourceId
    ? modelPackageById(activeDocument.sourceId)
    : null;
  // The outliner drives multi-part models: present only when this model carries parts state
  // (primitive-authored). Combines the live parts with the stable handlers from AppFrame.
  const activeParts = activeModel ? props.state.modelParts[activeModel.id] : undefined;
  const outliner = activeModel && activeParts
    ? { parts: activeParts, activePartId: props.state.modelActivePartId, ...props.outlinerHandlers }
    : null;
  // Tab titles are DERIVED from the live model, not the doc's frozen snapshot — a model's
  // name (e.g. a generic "Model 3") can change out from under an old persisted doc, and the
  // tab must follow it rather than show a stale seed name like "Cone 1" (req_2406).
  const tabDocuments = props.state.workspaceDocuments.map((doc) => {
    if (doc.kind !== 'model' || !doc.sourceId) return doc;
    const live = modelPackageById(doc.sourceId);
    return live ? modelDocument(live) : doc;
  });
  return (
    <C.HW_StagePanel>
      <C.HW_StageViewport>
        {activeDocument.kind === 'world' || activeDocument.kind === 'model' || activeDocument.kind === 'playtest' || activeDocument.kind === 'animation' || activeDocument.kind === 'knowledge' ? null : <C.HW_CanvasGrid />}
        {activeDocument.kind === 'knowledge' ? (
          <WorldBibleSurface />
        ) : activeDocument.kind === 'animation' ? (
          <AnimationCaptureSurface />
        ) : activeDocument.kind === 'playtest' ? (
          <PlaytestSurface
            globals={props.state.worldGlobals}
            pieces={props.state.worldPieces}
            authoredPieces={props.state.authoredBuildPieces}
            worldFlora={props.state.worldFlora}
            floraSpecies={props.state.authoredFloraSpecies}
            prefabs={props.state.worldPrefabs}
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
        ) : activeDocument.kind === 'world' ? (
          <WorldEditorSurface
            mapOverviewOpen={props.state.mapOverviewOpen}
            onToggleMap={() => props.onCommand('toggle-minimap', 'stage')}
            paintActive={props.state.mapPaint.active}
            mapPaint={props.state.mapPaint}
            mapStem={props.state.activeMapStem}
            mapZones={props.state.mapPaint.zones}
            floor={props.state.floorIndex}
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
          />
        ) : activeDocument.kind === 'model' ? (
          <ModelDocumentSurface
            model={activeModel}
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
          />
        ) : (
          <MaterialFocusSurface
            state={props.state}
            activeAsset={props.activeAsset}
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
          />
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
