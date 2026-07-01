import { Fragment } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { COMMANDS, activeMenuFor, meshToolCommands, meshToolActive, meshTopoCommands } from '../data/commands';
import { FLOORS, SNAP_MODES } from '../data/content';
import type { Command, EditorState, ViewMode } from '../data/types';

// A model document owns the host-native mesh editor — the toolbar becomes the
// home for its tools (icon-only), with select / gizmo / toggle groups divided.
const MESH_GROUP_DIVIDER = new Set(['mesh-move', 'mesh-paint']);

export default function ToolOptions(props: {
  state: EditorState;
  activeCommand: Command;
  onCommand: (id: string, source: string) => void;
  onTool: (id: string) => void;
  onSnap: () => void;
  onFloor: () => void;
  onViewMode: (mode: ViewMode) => void;
}) {
  const activeDoc = props.state.workspaceDocuments.find((doc) => doc.id === props.state.activeWorkspaceDocumentId)
    ?? props.state.workspaceDocuments[0]!;

  if (activeDoc.kind === 'model') {
    return (
      <C.HW_ToolOptions>
        <C.HW_PillOn>
          <C.HW_OptionLabel>MESH</C.HW_OptionLabel>
          <C.HW_PillTextOn>{meshToolCommands().length} tools</C.HW_PillTextOn>
        </C.HW_PillOn>
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
      </C.HW_ToolOptions>
    );
  }

  const activeMenu = activeMenuFor(props.state);
  const actionCommands = COMMANDS.filter((command) => command.menu === activeMenu && command.surface !== 'model');
  return (
    <C.HW_ToolOptions>
      <C.HW_PillOn>
        <C.HW_OptionLabel>{activeMenu.toUpperCase()}</C.HW_OptionLabel>
        <C.HW_PillTextOn>{actionCommands.length} commands</C.HW_PillTextOn>
      </C.HW_PillOn>
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
      <C.HW_Pill onPress={props.onFloor}>
        <Icon name="Layers" size={12} color={accentFor('textSecondary')} />
        <C.HW_PillText>{FLOORS[props.state.floorIndex]}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Spacer />
      {(['3D', '2D'] as ViewMode[]).map((mode) => {
        const Pill = props.state.viewMode === mode ? C.HW_PillOn : C.HW_Pill;
        const Label = props.state.viewMode === mode ? C.HW_PillTextOn : C.HW_PillText;
        return <Pill key={mode} onPress={() => props.onViewMode(mode)}><Label>{mode}</Label></Pill>;
      })}
    </C.HW_ToolOptions>
  );
}
