import { C } from '../workspace.cls';
import type { Asset, ColorStudioMaterialKey, MockState } from '../data/types';
import ContextMenu from '../shell/ContextMenu';
import DropdownMenu from '../shell/DropdownMenu';
import MaterialFocusSurface from './MaterialFocusSurface';
import IsoMap from './IsoMap';
import MiniMap from './MiniMap';

export default function Stage(props: {
  state: MockState;
  activeAsset: Asset;
  onCommand: (id: string, source: string) => void;
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
      <C.HW_Stage onPress={props.state.materialFocused ? () => undefined : props.onStage} onRightClick={props.onContext}>
      <C.HW_CanvasGrid />
      {props.state.materialFocused ? (
        <MaterialFocusSurface
          state={props.state}
          activeAsset={props.activeAsset}
          onExit={props.onExitMaterialFocus}
          onAction={props.onMaterialAction}
          onSelectMaterial={props.onSelectColorStudioMaterial}
          onVariant={props.onColorStudioVariant}
          onSeed={props.onColorStudioSeed}
          onQuality={props.onColorStudioQuality}
          onSlot={props.onColorStudioSlot}
          onFill={props.onColorStudioFill}
          onReset={props.onColorStudioReset}
        />
      ) : (
        <>
          <IsoMap state={props.state} onObject={props.onObject} />
          {props.state.contextOpen ? <ContextMenu state={props.state} onCommand={props.onCommand} /> : null}
          <MiniMap state={props.state} onObject={props.onObject} />
        </>
      )}
      {props.state.openMenu ? <DropdownMenu state={props.state} onCommand={props.onCommand} /> : null}
    </C.HW_Stage>
  );
}
