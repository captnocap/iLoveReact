import { C } from '../workspace.cls';
import type { Asset, EditorState, ModelToolApi, ModelToolSnapshot, Rgb } from '../data/types';
import type { OutlinerHandlers } from './ModelDocumentSurface';
import type { OklchColor } from '../../../runtime/paint/colors';
import type { PlacedPiece, PlacementGesture } from '../world/pieces';
import ToolOptions from './ToolOptions';
import Stage from './Stage';

export default function Workspace(props: {
  state: EditorState;
  activeAsset: Asset;
  onCommand: (id: string, source: string) => void;
  onModelToolApi: (api: ModelToolApi) => void;
  onModelToolState: (state: ModelToolSnapshot) => void;
  modelContextTrigger: { onRightClick: (e: { x: number; y: number }) => void };
  outlinerHandlers: OutlinerHandlers;
  modelOnDisk: boolean;
  onRequireFirstModelSave: () => boolean;
  onModelDocumentMutated: () => void;
  onMapPaint: (patch: Partial<EditorState['mapPaint']>) => void;
  onSnap: () => void;
  onFloor: (delta: number) => void;
  /** toggle hiding the ACTIVE floor's walls (storey cutaway extra, req_2567) */
  onWallsDown: () => void;
  /** The paint controls segment for the action bar (ToolOptions renders it while painting). */
  paintBar?: any;
  selectedPartCount: number;
  onWorkspaceDocument: (id: string) => void;
  onCloseWorkspaceDocument: (id: string) => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  /** World-piece model callbacks (req_2563 Phase 1) — routed down to WorldEditorSurface. */
  onPlacePiece: (pieces: PlacedPiece[], gesture: PlacementGesture) => void;
  onMovePiece: (id: string, destination: PlacedPiece) => void;
  onSelectPiece: (id: string | null) => void;
  onPieceContext: (id: string, x: number, y: number) => void;
  onPaintFace: (id: string, role: string) => void;
  onStampSticker: (id: string, role: string, local: { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number }) => void;
  onFacadeStroke: (facadeId: string, stroke: import('../world/facades').FacadeStroke) => void;
  onFacadeStamp: (facadeId: string, stamp: import('../world/facades').FacadeStamp) => void;
  onFacadeClear: (facadeId: string) => void;
  onFacadeSave: (facadeId: string, strokesRgba: Uint8Array) => void;
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
  return (
    <C.HW_Workspace>
      <ToolOptions {...props} />
      <Stage {...props} />
    </C.HW_Workspace>
  );
}
