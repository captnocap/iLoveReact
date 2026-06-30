import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { activeMenuFor, MENUS } from '../data/commands';
import type { Command, Menu, MockState } from '../data/types';

export default function Chrome(props: {
  state: MockState;
  activeCommand: Command;
  onMenu: (menu: Menu) => void;
  onCommand: (id: string, source: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const undoCount = props.state.history.filter((event) => event.undoable).length;
  const activeMenu = activeMenuFor(props.state);
  return (
    <C.HW_Chrome>
      <C.HW_Brand>
        <Icon name="Box" size={15} color={accentFor('primary')} />
        <C.HW_BrandText>SHITTY GAMES</C.HW_BrandText>
      </C.HW_Brand>
      <C.HW_MenuBar>
        {MENUS.map((menu) => {
          const ActiveItem = activeMenu === menu ? C.HW_MenuItemOn : C.HW_MenuItem;
          const ActiveText = activeMenu === menu ? C.HW_MenuTextOn : C.HW_MenuText;
          return (
            <ActiveItem key={menu} onPress={() => props.onMenu(menu)}>
              <ActiveText>{menu}</ActiveText>
            </ActiveItem>
          );
        })}
      </C.HW_MenuBar>
      <C.HW_Spacer />
      <C.HW_Pill>
        <Icon name={props.activeCommand.icon} size={12} color={accentFor('primary')} />
        <C.HW_PillText>{props.activeCommand.name}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Pill onPress={props.onUndo}>
        <Icon name="Undo2" size={12} color={accentFor(undoCount > 0 ? 'textSecondary' : 'textFaint')} />
        <C.HW_PillText>{String(undoCount).padStart(3, '0')}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Pill onPress={props.onRedo}>
        <Icon name="Redo2" size={12} color={accentFor(props.state.redo.length > 0 ? 'textSecondary' : 'textFaint')} />
        <C.HW_PillText>{String(props.state.redo.length).padStart(3, '0')}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Compile onPress={() => props.onCommand('compile-rle', 'chrome')}>
        <Icon name="Download" size={13} color={accentFor('primary')} />
        <C.HW_PillTextOn>Compile</C.HW_PillTextOn>
      </C.HW_Compile>
      <C.HW_StatusText>shell 0.42s</C.HW_StatusText>
    </C.HW_Chrome>
  );
}
