import type { ReactNode } from 'react';
import { C } from '../workspace.cls';
import type { Asset, EditorState, ModelToolApi, ModelToolSnapshot, Rgb } from '../data/types';
import type { OutlinerHandlers } from './ModelDocumentSurface';
import type { OklchColor } from '../../../runtime/paint/colors';
import type { WorldView } from '../world/worldViews';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import type { PieceMaterialTarget } from '../world/pieceEditCommand';
import ToolOptions from './ToolOptions';
import Stage from './Stage';
import type { PieceSelectionIntent } from '../world/selection';
import type { PaintLayoutKeepLiveOptions } from '../model/paintLayoutConflict';
import type { CharacterRigApi, CharacterRigSnapshot } from '../../../runtime/skeleton';
import type { ExternalAutoRigUiState } from '../skeleton/externalAutoRig';

export default function Workspace(props: {
  state: EditorState;
  mapSwitchPending: boolean;
  activeAsset: Asset | null;
  /** The Home surface, composed by AppFrame (it owns the session + map list). */
  homeSurface: ReactNode;
  onCommand: (id: string, source: string) => void;
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
  externalAutoRigAvailable: boolean;
  externalAutoRigState: ExternalAutoRigUiState;
  onExternalAutoRig: () => void;
  onAcceptExternalAutoRig: () => void;
  onMapPaint: (patch: Partial<EditorState['mapPaint']>) => void;
  onSnap: () => void;
  onFloor: (delta: number) => void;
  /** toggle hiding the ACTIVE floor's walls (storey cutaway extra, req_2567) */
  onWallsDown: () => void;
  selectedPartCount: number;
  onWorkspaceDocument: (id: string) => void;
  onCloseWorkspaceDocument: (id: string) => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  /** World-piece model callbacks (req_2563 Phase 1) — routed down to WorldEditorSurface. */
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
  onColorSpineLoadLibrarySet: (colors: OklchColor[]) => void;
  onOpenInLab: (specId: string, variant?: number) => void;
}) {
  return (
    <C.HW_Workspace>
      <ToolOptions {...props} />
      <Stage {...props} />
    </C.HW_Workspace>
  );
}
