import { useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { COMMANDS, MENU_DROPDOWN_WIDTH, menuDropdownLeft } from '../data/commands';
import type { Command, EditorState } from '../data/types';

// Dropdown for the active top-bar menu. Mounted at the app root (see AppFrame)
// so it paints over the body and hit-tests correctly; positioned under its
// menu-bar button via menuDropdownLeft. Rows tagged with a `submenu` fold under an
// expandable parent flyout (File → New Mesh → Cube); everything else is top-level.

function MenuRow({ command, indent, onCommand }: { command: Command; indent?: boolean; onCommand: (id: string, source: string) => void }) {
  return (
    <C.HW_MenuDropRow onPress={() => onCommand(command.id, 'menu')} style={indent ? { paddingLeft: 30 } : undefined}>
      <Icon name={command.icon} size={13} color={accentFor(command.native ? 'primary' : 'textDim')} />
      <C.HW_MenuDropText>{command.name}</C.HW_MenuDropText>
      <C.HW_Spacer />
      <C.HW_MenuDropSub>{command.key}</C.HW_MenuDropSub>
      {command.context ? (
        <C.HW_CheckCell><Icon name="MousePointerClick" size={9} color={accentFor('primary')} /></C.HW_CheckCell>
      ) : <C.HW_CheckCellOff />}
      {command.native ? (
        <C.HW_CheckCell><Icon name="Cpu" size={9} color={accentFor('primary')} /></C.HW_CheckCell>
      ) : <C.HW_CheckCellOff />}
      {command.undoable ? (
        <C.HW_CheckCell><Icon name="History" size={9} color={accentFor('primary')} /></C.HW_CheckCell>
      ) : <C.HW_CheckCellOff />}
    </C.HW_MenuDropRow>
  );
}

export default function DropdownMenu({ state, onCommand }: { state: EditorState; onCommand: (id: string, source: string) => void }) {
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

  return (
    <C.HW_MenuDropdown style={{ left: menuDropdownLeft(state.openMenu), width: MENU_DROPDOWN_WIDTH }}>
      <C.HW_MenuDropHead>
        <C.HW_HeadTitle>{state.openMenu}</C.HW_HeadTitle>
      </C.HW_MenuDropHead>
      {rows}
    </C.HW_MenuDropdown>
  );
}
