import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { commandById } from '../data/commands';
import { FLOORS, PRESETS, RIGHT_PANES, SNAP_MODES, modelPackageById } from '../data/content';
import { missionCounts, objectMetricRows } from '../data/readouts';
import type { Asset, EditorState, WorldObject } from '../data/types';
import ReadOnlySection from './ReadOnlySection';
import PresetSection from './PresetSection';
import MissionSection from './MissionSection';
import ModelDetailBody from '../library/ModelDetailBody';

export default function Inspector(props: {
  state: EditorState;
  activeObject: WorldObject;
  activeAsset: Asset;
  onPane: (pane: string) => void;
  onCommand: (id: string, source: string) => void;
  onPreset: () => void;
  onPresetOption: (preset: string) => void;
}) {
  const activeDocument = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId);
  const activeModel = activeDocument?.kind === 'model' && activeDocument.sourceId
    ? modelPackageById(activeDocument.sourceId)
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
  if (activeModel) {
    return (
      <C.HW_RightPanel>
        <C.HW_Inspector>
          <C.HW_PanelHead>
            <C.HW_Kicker>MODEL FOCUS</C.HW_Kicker>
            <C.HW_Spacer />
            <Icon name="PanelRightClose" size={12} color={accentFor('textFaint')} />
          </C.HW_PanelHead>
          <C.HW_InspectorBody>
            <ModelDetailBody model={activeModel} />
          </C.HW_InspectorBody>
        </C.HW_Inspector>
        <C.HW_RightRail>
          {RIGHT_PANES.map(([pane, icon]) => {
            const Btn = props.state.rightPane === pane ? C.HW_RailButtonOn : C.HW_RailButton;
            return (
              <Btn key={pane} onPress={() => props.onPane(pane)}>
                <Icon name={icon} size={14} color={accentFor(props.state.rightPane === pane ? 'primary' : 'textDim')} />
              </Btn>
            );
          })}
        </C.HW_RightRail>
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
      <C.HW_RightRail>
        {RIGHT_PANES.map(([pane, icon]) => {
          const Btn = props.state.rightPane === pane ? C.HW_RailButtonOn : C.HW_RailButton;
          return (
            <Btn key={pane} onPress={() => props.onPane(pane)}>
              <Icon name={icon} size={14} color={accentFor(props.state.rightPane === pane ? 'primary' : 'textDim')} />
            </Btn>
          );
        })}
      </C.HW_RightRail>
    </C.HW_RightPanel>
  );
}
