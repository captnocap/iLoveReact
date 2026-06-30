import { C } from '../workspace.cls';
import type { Asset, ColorStudioMaterialKey, Command, MockState, ViewMode } from '../data/types';
import ToolOptions from './ToolOptions';
import Stage from './Stage';

export default function Workspace(props: {
  state: MockState;
  activeCommand: Command;
  activeAsset: Asset;
  onCommand: (id: string, source: string) => void;
  onTool: (id: string) => void;
  onSnap: () => void;
  onFloor: () => void;
  onViewMode: (mode: ViewMode) => void;
  onStage: () => void;
  onContext: () => void;
  onObject: (id: string) => void;
  onExitMaterialFocus: () => void;
  onMaterialAction: (label: string) => void;
  onSelectColorStudioMaterial: (material: ColorStudioMaterialKey) => void;
  onColorStudioVariant: (variant: number) => void;
  onColorStudioSeed: () => void;
  onColorStudioQuality: (quality: number) => void;
  onColorStudioSlot: (slot: number) => void;
  onColorStudioFill: (color: string, source: string) => void;
  onColorStudioReset: () => void;
}) {
  return (
    <C.HW_Workspace>
      <ToolOptions {...props} />
      <Stage {...props} />
    </C.HW_Workspace>
  );
}
