import { Fragment } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { COMMANDS, activeMenuFor, meshToolCommands, meshToolActive, meshTopoCommands, meshPaintCommands } from '../data/commands';
import { SNAP_MODES } from '../data/content';
import type { Command, EditorState, ViewMode } from '../data/types';
import MapPaintBar from './MapPaintBar';

// A model document owns the host-native mesh editor — the toolbar becomes the
// home for its tools (icon-only), with select / gizmo / toggle groups divided.
const MESH_GROUP_DIVIDER = new Set(['mesh-move', 'mesh-paint']);

export default function ToolOptions(props: {
  state: EditorState;
  activeCommand: Command;
  onCommand: (id: string, source: string) => void;
  onTool: (id: string) => void;
  onMapPaint: (patch: Partial<EditorState['mapPaint']>) => void;
  onSnap: () => void;
  onFloor: (delta: number) => void;
  onViewMode: (mode: ViewMode) => void;
}) {
  const activeDoc = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId)
    ?? props.state.workspaceDocuments[0]!;

  if (activeDoc.kind === 'model') {
    return (
      <C.HW_ToolOptions>
        {meshToolCommands().map((command) => {
          const active = meshToolActive(command.id, props.state.modelTool);
          const Btn = active ? C.HW_IconButtonOn : C.HW_IconButton;
          return (
            <Fragment key={command.id}>
              {MESH_GROUP_DIVIDER.has(command.id) ? <C.HW_OptionDivider /> : null}
              <Btn tooltip={`${command.name} (${command.key})`} onPress={() => props.onCommand(command.id, 'action bar')}>
                <Icon name={command.icon} size={14} color={accentFor(active ? 'primary' : 'textDim')} />
              </Btn>
            </Fragment>
          );
        })}
        {/* Contextual topology ops — surface as quick icons only when the edge
            selection makes them valid (also in the right-click context menu). */}
        {meshTopoCommands(props.state.modelTool).map((command) => (
          <Fragment key={command.id}>
            <C.HW_OptionDivider />
            <C.HW_IconButton tooltip={`${command.name} (${command.key})`} onPress={() => props.onCommand(command.id, 'action bar')}>
              <Icon name={command.icon} size={14} color={accentFor('primary')} />
            </C.HW_IconButton>
          </Fragment>
        ))}
        {/* Paint sub-tools — the two brush behaviours (fill · free-form) as icon buttons, then
            the face-safety and detail toggles as state-reading pills. Only while painting. */}
        {meshPaintCommands(props.state.modelTool).map((command, i) => {
          const active = meshToolActive(command.id, props.state.modelTool);
          const Btn = active ? C.HW_IconButtonOn : C.HW_IconButton;
          return (
            <Fragment key={command.id}>
              {i === 0 ? <C.HW_OptionDivider /> : null}
              <Btn tooltip={`${command.name} (${command.key})`} onPress={() => props.onCommand(command.id, 'action bar')}>
                <Icon name={command.icon} size={14} color={accentFor(active ? 'primary' : 'textDim')} />
              </Btn>
            </Fragment>
          );
        })}
        {props.state.modelTool.paint ? (
          <Fragment>
            <C.HW_OptionDivider />
            <C.HW_Pill tooltip="Face safety — Clip paints the face under the dab; Lock masks the stroke to the pressed face" onPress={() => props.onCommand('mesh-paint-safety', 'action bar')}>
              <C.HW_OptionLabel>SAFE</C.HW_OptionLabel>
              <C.HW_PillText>{props.state.modelTool.safety === 0 ? 'Clip' : 'Lock'}</C.HW_PillText>
            </C.HW_Pill>
            <C.HW_Pill tooltip="Free-form detail — texels per triangle patch (higher = crisper strokes on low-poly)" onPress={() => props.onCommand('mesh-paint-detail', 'action bar')}>
              <C.HW_OptionLabel>DETAIL</C.HW_OptionLabel>
              <C.HW_PillText>{props.state.modelTool.detail <= 1 ? '—' : String(props.state.modelTool.detail)}</C.HW_PillText>
            </C.HW_Pill>
          </Fragment>
        ) : null}
      </C.HW_ToolOptions>
    );
  }

  // MAPPAINT req_2484: the Map Paint tool lives IN this action bar — the
  // viewport stays clean (the brush beam is the only in-world chrome). While
  // painting, its controls own the row (a modal bar, like the model branch);
  // toggling PAINT off brings the build controls back.
  const mapPaint = props.state.mapPaint;
  if (mapPaint.active) {
    return (
      <C.HW_ToolOptions>
        <MapPaintBar state={mapPaint} onPatch={props.onMapPaint} />
      </C.HW_ToolOptions>
    );
  }

  const activeMenu = activeMenuFor(props.state);
  const actionCommands = COMMANDS.filter((command) => command.menu === activeMenu && command.surface !== 'model');
  return (
    <C.HW_ToolOptions>
      <MapPaintBar state={mapPaint} onPatch={props.onMapPaint} />
      <C.HW_OptionDivider />
      {actionCommands.map((command) => {
        const Btn = props.state.activeCommandId === command.id ? C.HW_IconButtonOn : C.HW_IconButton;
        return (
          <Btn key={command.id} onPress={() => command.tool ? props.onTool(command.id) : props.onCommand(command.id, 'action bar')}>
            <Icon name={command.icon} size={14} color={accentFor(props.state.activeCommandId === command.id ? 'primary' : 'textDim')} />
          </Btn>
        );
      })}
      <C.HW_OptionDivider />
      <C.HW_PillOn onPress={props.onSnap}>
        <C.HW_OptionLabel>SNAP</C.HW_OptionLabel>
        <C.HW_PillTextOn>{SNAP_MODES[props.state.snapIndex]}</C.HW_PillTextOn>
      </C.HW_PillOn>
      <C.HW_Pill onPress={() => props.onTool('move-selection')}>
        <C.HW_OptionLabel>TOOL</C.HW_OptionLabel>
        <C.HW_PillText>{props.activeCommand.key}</C.HW_PillText>
      </C.HW_Pill>
      {/* FLOORCTL req_2485: the ONE floor control — drives the viewport's real
          active storey (the floating Ground chip died with the old world pane).
          Label matches the level vocabulary: Ground, Floor 1, Floor 2, … */}
      <C.HW_IconButton tooltip="Down a floor" onPress={() => props.onFloor(-1)}>
        <C.HW_PillText>▼</C.HW_PillText>
      </C.HW_IconButton>
      <C.HW_Pill tooltip="The active storey — placements land on this floor's slab">
        <Icon name="Layers" size={12} color={accentFor('textSecondary')} />
        <C.HW_PillText>{props.state.floorIndex === 0 ? 'Ground' : `Floor ${props.state.floorIndex}`}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_IconButton tooltip="Up a floor" onPress={() => props.onFloor(1)}>
        <C.HW_PillText>▲</C.HW_PillText>
      </C.HW_IconButton>
      <C.HW_Spacer />
      {(['3D', '2D'] as ViewMode[]).map((mode) => {
        const Pill = props.state.viewMode === mode ? C.HW_PillOn : C.HW_Pill;
        const Label = props.state.viewMode === mode ? C.HW_PillTextOn : C.HW_PillText;
        return <Pill key={mode} onPress={() => props.onViewMode(mode)}><Label>{mode}</Label></Pill>;
      })}
    </C.HW_ToolOptions>
  );
}
