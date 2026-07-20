// SECTION A — Window Chrome (see shell/regions.ts SECTIONS): brand + menu bar +
// active map + Editor/Play toggle + window controls. The top strip of the editor.
import { Icon } from '../../../runtime/icons/Icon';
import { callHost } from '../../../runtime/ffi';
import { C, accentFor } from '../workspace.cls';
import { activeMenuFor, MENUS } from '../data/commands';
import RouteToggle from '../RouteToggle';
import type { Command, Menu, EditorState } from '../data/types';

function WindowControls({ onClose }: { onClose: () => void }) {
  return (
    <C.HW_WindowControls>
      <C.HW_WindowButton tooltip="Minimize" onPress={() => callHost<void>('__window_minimize', undefined)}>
        <Icon name="Minus" size={13} color={accentFor('textSecondary')} />
      </C.HW_WindowButton>
      <C.HW_WindowButton tooltip="Maximize" onPress={() => callHost<void>('__window_maximize', undefined)}>
        <Icon name="Square" size={11} color={accentFor('textSecondary')} />
      </C.HW_WindowButton>
      <C.HW_WindowClose tooltip="Close" onPress={onClose}>
        <Icon name="X" size={13} color={accentFor('textSecondary')} />
      </C.HW_WindowClose>
    </C.HW_WindowControls>
  );
}

export default function Chrome(props: {
  state: EditorState;
  activeCommand: Command;
  onMenu: (menu: Menu) => void;
  onCommand: (id: string, source: string) => void;
  onWorldBible: () => void;
  onClose: () => void;
}) {
  const activeMenu = activeMenuFor(props.state);
  return (
    <C.HW_Chrome windowDrag>
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
      <C.HW_Pill onPress={props.onWorldBible} tooltip="Open World Bible">
        <Icon name="BookOpen" size={12} color={accentFor('primary')} />
      </C.HW_Pill>
      <C.HW_Pill onPress={() => props.onCommand('open-map', 'chrome')} tooltip={`Active map: ${props.state.activeMapName} (${props.state.activeMapStem}) — open map workspaces`}>
        <Icon name="MapPinned" size={12} color={accentFor('primary')} />
        <C.HW_PillText>{props.state.activeMapName}</C.HW_PillText>
      </C.HW_Pill>
      <RouteToggle />
      <WindowControls onClose={props.onClose} />
    </C.HW_Chrome>
  );
}
