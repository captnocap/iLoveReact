import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { activeMenuFor, MENUS } from '../data/commands';
import RouteToggle from '../RouteToggle';
import type { Command, Menu, EditorState } from '../data/types';

export default function Chrome(props: {
  state: EditorState;
  activeCommand: Command;
  onMenu: (menu: Menu) => void;
  onCommand: (id: string, source: string) => void;
  /** Contextual controls appended INTO the chrome row (between the menus and Compile) —
   *  the paint bar rides here while painting instead of floating in the viewport
   *  (req_2547: "we have a whole toolbar right above to take advantage of"). */
  children?: any;
}) {
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
      {props.children}
      <C.HW_Compile onPress={() => props.onCommand('compile-rle', 'chrome')}>
        <Icon name="Download" size={13} color={accentFor('primary')} />
        <C.HW_PillTextOn>Compile</C.HW_PillTextOn>
      </C.HW_Compile>
      <RouteToggle />
    </C.HW_Chrome>
  );
}
