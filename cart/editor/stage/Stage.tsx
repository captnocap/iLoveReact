import { C } from '../workspace.cls';
import type { Asset, ColorStudioMaterialKey, MockState } from '../data/types';
import { modelPackageById } from '../data/content';
import ContextMenu from '../shell/ContextMenu';
import DropdownMenu from '../shell/DropdownMenu';
import MaterialFocusSurface from './MaterialFocusSurface';
import ModelDocumentSurface from './ModelDocumentSurface';
import StageTabs from './StageTabs';
import WorldEditorSurface from './WorldEditorSurface';

export default function Stage(props: {
  state: MockState;
  activeAsset: Asset;
  onWorkspaceDocument: (id: string) => void;
  onCloseWorkspaceDocument: (id: string) => void;
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
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId)
    ?? props.state.workspaceDocuments[0]!;
  const activeModel = activeDocument.kind === 'model' && activeDocument.sourceId
    ? modelPackageById(activeDocument.sourceId)
    : null;
  return (
    <C.HW_StagePanel>
      <C.HW_StageViewport>
        {activeDocument.kind === 'world' || activeDocument.kind === 'model' ? null : <C.HW_CanvasGrid />}
        {activeDocument.kind === 'world' ? (
          <WorldEditorSurface />
        ) : activeDocument.kind === 'model' ? (
          <ModelDocumentSurface model={activeModel} />
        ) : (
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
        )}
        {activeDocument.kind === 'material' && props.state.contextOpen ? <ContextMenu state={props.state} onCommand={props.onCommand} /> : null}
        {props.state.openMenu ? <DropdownMenu state={props.state} onCommand={props.onCommand} /> : null}
      </C.HW_StageViewport>
      <StageTabs
        documents={props.state.workspaceDocuments}
        activeId={activeDocument.id}
        onDocument={props.onWorkspaceDocument}
        onCloseDocument={props.onCloseWorkspaceDocument}
      />
    </C.HW_StagePanel>
  );
}
