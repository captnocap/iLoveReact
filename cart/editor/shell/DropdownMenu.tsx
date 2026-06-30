import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { COMMANDS, MENU_DROPDOWN_WIDTH, menuDropdownLeft } from '../data/commands';
import type { MockState } from '../data/types';

export default function DropdownMenu({ state, onCommand }: { state: MockState; onCommand: (id: string, source: string) => void }) {
  const rows = COMMANDS.filter((command) => command.menu === state.openMenu);
  return (
    <C.HW_MenuDropdown style={{ left: menuDropdownLeft(state.openMenu), width: MENU_DROPDOWN_WIDTH }}>
      <C.HW_MenuDropHead>
        <Icon name="Wrench" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>{state.openMenu} capabilities</C.HW_HeadTitle>
        <C.HW_Spacer />
        <C.HW_Kicker>SSOT</C.HW_Kicker>
      </C.HW_MenuDropHead>
      {rows.map((command) => (
        <C.HW_MenuDropRow key={command.id} onPress={() => onCommand(command.id, 'menu')}>
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
      ))}
    </C.HW_MenuDropdown>
  );
}
