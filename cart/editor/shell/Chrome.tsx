import { Icon } from '../../../runtime/icons/Icon';
import { callHost } from '../../../runtime/ffi';
import { C, accentFor } from '../workspace.cls';
import { activeMenuFor, commandById, commandEnabled, MENUS } from '../data/commands';
import RouteToggle from '../RouteToggle';
import type { Command, Menu, EditorState } from '../data/types';

function WindowControls() {
  return (
    <C.HW_WindowControls>
      <C.HW_WindowButton tooltip="Minimize" onPress={() => callHost<void>('__window_minimize', undefined)}>
        <Icon name="Minus" size={13} color={accentFor('textSecondary')} />
      </C.HW_WindowButton>
      <C.HW_WindowButton tooltip="Maximize" onPress={() => callHost<void>('__window_maximize', undefined)}>
        <Icon name="Square" size={11} color={accentFor('textSecondary')} />
      </C.HW_WindowButton>
      <C.HW_WindowClose tooltip="Close" onPress={() => callHost<void>('__window_close', undefined)}>
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
}) {
  const activeMenu = activeMenuFor(props.state);
  // The Compile pill mirrors the File → Compile command's state — grayed + inert while the RLE
  // pipeline isn't wired (available: false), instead of firing a "compile unavailable" no-op.
  const compile = commandEnabled(commandById('compile-rle'), props.state);
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
      <C.HW_Pill onPress={() => props.onCommand('open-map', 'chrome')} tooltip={`Active map: ${props.state.activeMapStem} — open map workspaces`}>
        <Icon name="MapPinned" size={12} color={accentFor('primary')} />
        <C.HW_PillText>{props.state.activeMapStem}</C.HW_PillText>
      </C.HW_Pill>
      <C.HW_Compile
        {...(compile.on ? { onPress: () => props.onCommand('compile-rle', 'chrome') } : { style: { opacity: 0.4 } })}
        tooltip={compile.on ? 'Compile RLE game data' : `Compile — ${compile.reason}`}
      >
        <Icon name="Download" size={13} color={accentFor(compile.on ? 'primary' : 'textDim')} />
        <C.HW_PillTextOn>Compile</C.HW_PillTextOn>
      </C.HW_Compile>
      <RouteToggle />
      <WindowControls />
    </C.HW_Chrome>
  );
}
