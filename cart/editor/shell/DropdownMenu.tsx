import { useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { COMMANDS, MENU_DROPDOWN_WIDTH, menuDropdownLeft } from '../data/commands';
import type { Command, EditorState, LightId } from '../data/types';

// The viewer light-rig switches, hosted under View → Lighting. The model shader supports one
// directional + ambient, so these are the switches that actually change the render: Flat = even
// paint-true light; Key = the directional; Fill = lift the dark side (raises ambient).
const LIGHT_MENU: { id: LightId; label: string; field: 'litFlat' | 'litKey' | 'litFill' }[] = [
  { id: 'flat', label: 'Flat (even, paint-true)', field: 'litFlat' },
  { id: 'key', label: 'Key light', field: 'litKey' },
  { id: 'fill', label: 'Fill (lift shadows)', field: 'litFill' },
];

// Dropdown for the active top-bar menu. Mounted at the app root (see AppFrame)
// so it paints over the body and hit-tests correctly; positioned under its
// menu-bar button via menuDropdownLeft. Rows tagged with a `submenu` fold under an
// expandable parent flyout (File → New Mesh → Cube); everything else is top-level.

function MenuRow({ command, indent, onCommand }: { command: Command; indent?: boolean; onCommand: (id: string, source: string) => void }) {
  // NOTE: never pass style={undefined} — the classifier merge (mergeUserProps) treats a
  // present `style` key as an override, so undefined WIPES the class default (flexDirection
  // row → the row collapses to a column). Only include the prop when we actually indent.
  return (
    <C.HW_MenuDropRow onPress={() => onCommand(command.id, 'menu')} {...(indent ? { style: { paddingLeft: 30 } } : {})}>
      <Icon name={command.icon} size={13} color={accentFor(command.native ? 'primary' : 'textDim')} />
      <C.HW_MenuDropText>{command.name}</C.HW_MenuDropText>
      <C.HW_Spacer />
      <C.HW_MenuDropSub>{command.key}</C.HW_MenuDropSub>
    </C.HW_MenuDropRow>
  );
}

export default function DropdownMenu({ state, onCommand, onToggleLight }: { state: EditorState; onCommand: (id: string, source: string) => void; onToggleLight: (which: LightId) => void }) {
  // Which submenu group is expanded (e.g. 'New Mesh'). Null = none open.
  const [openSub, setOpenSub] = useState<string | null>(null);
  // Model-surface tools live on the stage toolbar + context menu, not the menu bar.
  const all = COMMANDS.filter((command) => command.menu === state.openMenu && command.surface !== 'model');
  const topLevel = all.filter((command) => !command.submenu);
  const groups: string[] = [];
  for (const command of all) {
    if (command.submenu && !groups.includes(command.submenu)) groups.push(command.submenu);
  }

  const rows: JSX.Element[] = topLevel.map((command) => (
    <MenuRow key={command.id} command={command} onCommand={onCommand} />
  ));
  for (const group of groups) {
    const open = openSub === group;
    rows.push(
      <C.HW_MenuDropRow key={`sub:${group}`} onPress={() => setOpenSub(open ? null : group)}>
        <Icon name="Boxes" size={13} color={accentFor('primary')} />
        <C.HW_MenuDropText>{group}</C.HW_MenuDropText>
        <C.HW_Spacer />
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
      </C.HW_MenuDropRow>,
    );
    if (open) {
      for (const command of all.filter((c) => c.submenu === group)) {
        rows.push(<MenuRow key={command.id} command={command} indent onCommand={onCommand} />);
      }
    }
  }

  // Lighting lives under View when a model document is open — a nested, collapsible group so it's
  // findable but tucked away (never a flat wall). Custom stateful rows: the generic MenuRow is
  // command-driven and can't show a live toggle's on/off. Toggling keeps the dropdown open.
  const activeDoc = state.workspaceDocuments.find((doc) => doc.id === state.activeWorkspaceDocumentId);
  if (state.openMenu === 'View' && activeDoc?.kind === 'model') {
    const open = openSub === 'Lighting';
    rows.push(
      <C.HW_MenuDropRow key="sub:Lighting" onPress={() => setOpenSub(open ? null : 'Lighting')}>
        <Icon name="Sun" size={13} color={accentFor('primary')} />
        <C.HW_MenuDropText>Lighting</C.HW_MenuDropText>
        <C.HW_Spacer />
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
      </C.HW_MenuDropRow>,
    );
    if (open) {
      for (const L of LIGHT_MENU) {
        const disabled = L.id !== 'flat' && state.modelTool.litFlat;
        const on = state.modelTool[L.field] && !disabled;
        rows.push(
          <C.HW_MenuDropRow key={`light:${L.id}`} onPress={() => { if (!disabled) onToggleLight(L.id); }} style={{ paddingLeft: 30 }}>
            <Icon name={on ? 'Lightbulb' : 'LightbulbOff'} size={13} color={accentFor(on ? 'primary' : 'textDim')} />
            <C.HW_MenuDropText>{L.label}</C.HW_MenuDropText>
            <C.HW_Spacer />
            <C.HW_MenuDropSub>{disabled ? '—' : on ? 'on' : 'off'}</C.HW_MenuDropSub>
          </C.HW_MenuDropRow>,
        );
      }
    }
  }

  return (
    <C.HW_MenuDropdown style={{ left: menuDropdownLeft(state.openMenu), width: MENU_DROPDOWN_WIDTH }}>
      <C.HW_MenuDropHead>
        <C.HW_HeadTitle>{state.openMenu}</C.HW_HeadTitle>
      </C.HW_MenuDropHead>
      {rows}
    </C.HW_MenuDropdown>
  );
}
