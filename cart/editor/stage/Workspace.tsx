import { C } from '../workspace.cls';
import type { Asset, ColorStudioMaterialKey, Command, EditorState, ModelToolApi, ModelToolSnapshot, ViewMode } from '../data/types';
import type { OutlinerHandlers } from './ModelDocumentSurface';
import type { ColorLens } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';
import ToolOptions from './ToolOptions';
import Stage from './Stage';

export default function Workspace(props: {
  state: EditorState;
  activeCommand: Command;
  activeAsset: Asset;
  onCommand: (id: string, source: string) => void;
  onModelToolApi: (api: ModelToolApi) => void;
  onModelToolState: (state: ModelToolSnapshot) => void;
  modelContextTrigger: { onRightClick: (e: { x: number; y: number }) => void };
  outlinerHandlers: OutlinerHandlers;
  onTool: (id: string) => void;
  onMapPaint: (patch: Partial<EditorState['mapPaint']>) => void;
  onSnap: () => void;
  onFloor: () => void;
  onViewMode: (mode: ViewMode) => void;
  onWorkspaceDocument: (id: string) => void;
  onCloseWorkspaceDocument: (id: string) => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  onExitMaterialFocus: () => void;
  onSelectColorStudioMaterial: (material: ColorStudioMaterialKey) => void;
  onColorStudioVariant: (variant: number) => void;
  onColorStudioSeed: () => void;
  onColorStudioQuality: (quality: number) => void;
  onColorStudioSlot: (slot: number) => void;
  onColorStudioFill: (color: string, source: string) => void;
  onColorStudioReset: () => void;
  onColorStudioView: (view: EditorState['colorStudioView']) => void;
  onColorSpineCurrent: (color: OklchColor) => void;
  onColorSpineAddToTray: () => void;
  onColorSpineTrayPick: (color: OklchColor) => void;
  onColorSpineLens: (lens: ColorLens) => void;
  onColorSpineLibraryFilter: (filter: 'match' | 'all') => void;
  onColorSpineRampSteps: (steps: number) => void;
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
