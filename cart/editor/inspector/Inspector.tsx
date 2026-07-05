import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { commandById } from '../data/commands';
import { FLOORS, PRESETS, RIGHT_PANES, SNAP_MODES, effectiveModelPackage } from '../data/content';
import { missionCounts, objectMetricRows } from '../data/readouts';
import type { Asset, EditorState, WorldObject } from '../data/types';
import type { MaterialRef } from '../world/pieces';
import { assetById } from '../data/catalog';
import ReadOnlySection from './ReadOnlySection';
import PieceBody from './PieceBody';
import PresetSection from './PresetSection';
import MissionSection from './MissionSection';
import ModelDetailBody from '../library/ModelDetailBody';
import ModelBrushDock, { type ColorSpineHandlers } from './ModelBrushDock';
import ModelOutliner from '../stage/ModelOutliner';
import type { OutlinerHandlers } from '../stage/ModelDocumentSurface';
import type { Brush } from '../../../runtime/paint/model';

// The FOCUS PANEL's pane-switch rail — the fixed 40px icon column on the
// panel's right edge (REGIONS.focusPanel.railWidth). One component, every
// branch: the rail is part of the region, not of any one panel mode.
function FocusRail(props: { activePane: string; onPane: (pane: string) => void }) {
  return (
    <C.HW_RightRail>
      {RIGHT_PANES.map(([pane, icon]) => {
        const Btn = props.activePane === pane ? C.HW_RailButtonOn : C.HW_RailButton;
        return (
          <Btn key={pane} onPress={() => props.onPane(pane)}>
            <Icon name={icon} size={14} color={accentFor(props.activePane === pane ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
    </C.HW_RightRail>
  );
}

export default function Inspector(props: {
  state: EditorState;
  activeObject: WorldObject;
  activeAsset: Asset;
  onPane: (pane: string) => void;
  onCommand: (id: string, source: string) => void;
  onPreset: () => void;
  onPresetOption: (preset: string) => void;
  onModelBrush: (brush: Brush) => void;
  // Durable model identity (req_2620 S/T): the model card's editable name writes
  // through AppFrame's one rename path (manifest = disk truth); Save runs the same
  // 'save-snapshot' command as File → Save; onDisk feeds the save-state chip.
  onRenameModel: (id: string, name: string) => void;
  onSaveModel: () => void;
  modelOnDisk: boolean;
  // World-piece focus-panel edits (req_2563 Phase 3/4).
  onSetPieceOverride: (id: string, path: string, value: number | boolean) => void;
  onClearPieceOverride: (id: string, path: string) => void;
  onAssignSlot: (id: string, role: string) => void;
  onClearSlot: (id: string, role: string) => void;
  colorSpine: ColorSpineHandlers;
  outlinerHandlers: OutlinerHandlers;
}) {
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId);
  // EFFECTIVE package (req_2620 S): session renames + dupes resolve here, so the
  // card shows the name the next save writes — never a stale synthesized one.
  const activeModel = activeDocument?.kind === 'model'
    ? effectiveModelPackage(activeDocument.sourceId, props.state.modelOverrides, props.state.modelDupes)
    : null;
  const activeCommand = commandById(props.state.activeCommandId);
  const counts = missionCounts(props.state);
  const pathRows = props.activeObject.kind === 'TILE'
    ? [
      ['walkable', '—'],
      ['surface preset', props.state.surfacePreset],
      ['floor', FLOORS[props.state.floorIndex]!],
    ]
    : props.activeObject.kind === 'PIECE' || props.activeObject.kind === 'PREFAB'
      ? [
        ['collision', 'solid'],
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['floor', FLOORS[props.state.floorIndex]!],
      ]
      : [
        ['snap domain', SNAP_MODES[props.state.snapIndex]!],
        ['placement', props.activeObject.kind.toLowerCase()],
        ['floor', FLOORS[props.state.floorIndex]!],
      ];
  const visibilityRows = props.activeObject.kind === 'PROP'
    ? [
      ['occlusion', '—'],
      ['bake', '—'],
      ['channel', props.activeObject.kind.toLowerCase()],
    ]
    : [
      ['conceal', '—'],
      ['lightThru', '—'],
      ['soundOcc', '—'],
    ];
  const showMission = props.state.rightPane === 'mission' || activeCommand.menu === 'Story';
  // World surface (req_2563): the focus panel is PIECE-aware — the real placed
  // piece (Select/Focus) or the armed catalog piece (Build), NOT the phantom
  // `objects` mock. This is what retires the "AC & Vents" ghost header.
  if (activeDocument?.kind === 'world') {
    const selectedPiece = props.state.worldPieces.find((p) => p.id === props.state.selectedPieceId) ?? null;
    const resolveMaterial = (ref: MaterialRef) => {
      if ('assetId' in ref) {
        const a = assetById(ref.assetId, props.state.assetOverrides);
        return { label: a.name, color: a.color };
      }
      return { label: `${ref.fn}·${ref.variant}`, color: '#7d858d' };
    };
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>{selectedPiece ? 'PIECE FOCUS' : 'BUILD'}</C.HW_Kicker>
            <C.HW_Spacer />
            <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            <PieceBody
              armedPieceId={props.state.armedPieceId}
              selected={selectedPiece}
              onSetOverride={props.onSetPieceOverride}
              onClearOverride={props.onClearPieceOverride}
              onAssignSlot={props.onAssignSlot}
              onClearSlot={props.onClearSlot}
              resolveMaterial={resolveMaterial}
              activeMaterialName={assetById(props.state.activeAssetId, props.state.assetOverrides).name}
            />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  if (activeModel) {
    const modelDirty = Boolean(props.state.modelDirty[activeModel.id]);
    // Save-state chip (req_2620 T): loud until the model is a real directory on
    // disk AND clean since the last materialize. One line, fixed rows — the name
    // field and the save row sit on the region's standard control grid
    // (REGIONS.grid.labelWidth label + REGIONS.grid.verbColWidth verb).
    const saveChip = !props.modelOnDisk ? 'NOT ON DISK' : modelDirty ? 'UNSAVED EDITS' : 'ON DISK';
    const saveChipTone = props.modelOnDisk && !modelDirty ? 'success' : 'warning';
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>MODEL FOCUS</C.HW_Kicker>
            <C.HW_Spacer />
            <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHead>
          {/* NO whole-panel scrolling (req_2627): the model focus body is a fixed
              column of budgeted slices — the outliner and paint-variant lists carry
              their OWN bounded nested scrolls. */}
          <C.HW_InspectorBodyFixed>
            {/* The model's NAME, editable in place (req_2620 S — the old studio's
                name field). Typing renames through the ONE write-through path:
                manifest for on-disk models, pending-until-first-save otherwise. */}
            <C.HW_RenameBar>
              <C.HW_FormLabel>name</C.HW_FormLabel>
              <C.HW_RenameInput value={activeModel.name} onChange={(name: string) => props.onRenameModel(activeModel.id, name)} />
            </C.HW_RenameBar>
            <C.HW_RenameBar>
              <C.HW_Tag style={{ backgroundColor: accentFor(saveChipTone) }}>
                <C.HW_TagText>{saveChip}</C.HW_TagText>
              </C.HW_Tag>
              <C.HW_Spacer />
              <C.HW_VerbFixed onPress={props.onSaveModel}>
                <Icon name="Save" size={12} color={accentFor('textDim')} />
                <C.HW_VerbText>Save</C.HW_VerbText>
              </C.HW_VerbFixed>
            </C.HW_RenameBar>
            <ModelDetailBody model={activeModel} />
            {/* The OUTLINER — parts of this multi-part model (add / select / hide / delete).
                Only primitive-authored models carry parts state. */}
            {props.state.modelParts[activeModel.id] ? (
              <ModelOutliner
                parts={props.state.modelParts[activeModel.id]!}
                activeId={props.state.modelActivePartId}
                onSelect={props.outlinerHandlers.onSelectPart}
                onToggleVisible={props.outlinerHandlers.onToggleVisiblePart}
                onDuplicate={props.outlinerHandlers.onDuplicatePart}
                onDelete={props.outlinerHandlers.onDeletePart}
                onAdd={props.outlinerHandlers.onAddPart}
                onImportModel={props.outlinerHandlers.onImportModel}
              />
            ) : null}
            {/* Brush controls moved OUT of this corner dock to the top PaintToolbar (req_2466):
                paint controls belong at the top as icons, not a bottom-right text-pill panel.
                The Inspector now stays focused on selection/material inspection. */}
          </C.HW_InspectorBodyFixed>
        </C.HW_Inspector>
        <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
      </C.HW_RightPanel>
    );
  }
  return (
    <C.HW_RightPanel>
      <C.HW_Inspector>
        <C.HW_PanelHead>
          <C.HW_Kicker>{props.state.rightPane.toUpperCase()}</C.HW_Kicker>
          <C.HW_Spacer />
          <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
        </C.HW_PanelHead>
        <C.HW_ObjectHead>
          <C.HW_Tag><C.HW_TagText>{props.activeObject.kind}</C.HW_TagText></C.HW_Tag>
          <C.HW_ObjectTitle>{props.activeObject.name}</C.HW_ObjectTitle>
          <C.HW_Spacer />
          <C.HW_Swatch style={{ backgroundColor: props.activeAsset.color }} />
        </C.HW_ObjectHead>
        <C.HW_MetricRow>
          {objectMetricRows(props.state, props.activeObject).map(([label, value]) => (
            <C.HW_Metric key={label}>
              <C.HW_MetricValue>{value}</C.HW_MetricValue>
              <C.HW_MetricLabel>{label}</C.HW_MetricLabel>
            </C.HW_Metric>
          ))}
        </C.HW_MetricRow>
        <ReadOnlySection title={`${props.activeObject.kind} FACTS`} color="primary" rows={[
          ['asset', props.activeAsset.name],
          ['tool', activeCommand.name],
          ['key', activeCommand.key],
        ]} />
        {props.activeObject.kind === 'TILE' ? (
          <PresetSection
            title="SURFACE DEFAULTS"
            color="warning"
            active={props.state.surfacePreset}
            options={PRESETS}
            open={props.state.presetMenuOpen}
            onPreset={props.onPreset}
            onOption={props.onPresetOption}
            rows={[
              ['actual friction', '—'],
              ['actual speed factor', '—'],
            ]}
          />
        ) : null}
        <ReadOnlySection title="PLACEMENT" color="primary" rows={pathRows} />
        <ReadOnlySection title="VISIBILITY" color="primary" rows={visibilityRows} />
        {showMission ? (
          <MissionSection
            rows={[
              ['in mission', 'editing'],
              ['trigger volumes', String(counts.triggers)],
              ['mission points', String(counts.points)],
              ['active sequence', '—'],
            ]}
            triggerCount={counts.triggers}
            pointCount={counts.points}
            onCommand={props.onCommand}
          />
        ) : null}
      </C.HW_Inspector>
      <FocusRail activePane={props.state.rightPane} onPane={props.onPane} />
    </C.HW_RightPanel>
  );
}
