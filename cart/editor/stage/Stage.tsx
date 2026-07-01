import { C } from '../workspace.cls';
import type { Asset, ColorStudioMaterialKey, EditorState, ModelToolApi, ModelToolSnapshot } from '../data/types';
import type { ColorLens } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';
import { modelPackageById } from '../data/content';
import ContextMenu from '../shell/ContextMenu';
import MaterialFocusSurface from './MaterialFocusSurface';
import ModelDocumentSurface from './ModelDocumentSurface';
import StageTabs from './StageTabs';
import WorldEditorSurface from './WorldEditorSurface';

export default function Stage(props: {
  state: EditorState;
  activeAsset: Asset;
  onWorkspaceDocument: (id: string) => void;
  onCloseWorkspaceDocument: (id: string) => void;
  onCommand: (id: string, source: string) => void;
  onModelToolApi: (api: ModelToolApi) => void;
  onModelToolState: (state: ModelToolSnapshot) => void;
  modelContextTrigger: { onRightClick: (e: { x: number; y: number }) => void };
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
          <ModelDocumentSurface
            model={activeModel}
            triggerProps={props.modelContextTrigger}
            onToolApi={props.onModelToolApi}
            onToolState={props.onModelToolState}
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
            onSpineLens={props.onColorSpineLens}
            onSpineLibraryFilter={props.onColorSpineLibraryFilter}
            onSpineRampSteps={props.onColorSpineRampSteps}
            onSpineScenePick={props.onColorSpineScenePick}
            onSpineLoadLibrarySet={props.onColorSpineLoadLibrarySet}
          />
        )}
        {activeDocument.kind === 'material' && props.state.contextOpen ? <ContextMenu state={props.state} onCommand={props.onCommand} /> : null}
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
