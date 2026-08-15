// SECTION A — Window Chrome (see shell/regions.ts SECTIONS). Three groups, in
// this order, because they answer three different questions (req_4464):
//
//   BRAND + MENUS + SWITCHER   what can I do here / WHERE AM I WORKING
//   MAP PILL + ROUTE TOGGLE    which map / which route
//   WINDOW CONTROLS            the window
//
// It used to be one undifferentiated row — a book icon, a map pill, Editor and
// Play all jammed together at the right with nothing to say which was which,
// and no front door at all to the model studio, the animation foundry or the
// material lab. The switcher is that front door; the divider is the seam
// between "where I work" and "what I am working on".
import { Icon } from '../../../runtime/icons/Icon';
import { callHost } from '../../../runtime/ffi';
import { C, accentFor } from '../workspace.cls';
import { activeMenuFor, MENUS } from '../data/commands';
import RouteToggle from '../RouteToggle';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import type { DestinationId } from './destinations';
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
  /** Which destination the open document means we are standing in. */
  destination: DestinationId | null;
  onMenu: (menu: Menu) => void;
  onCommand: (id: string, source: string) => void;
  onDestination: (id: DestinationId) => void;
  onClose: () => void;
}) {
  const activeMenu = activeMenuFor(props.state);
  return (
    <C.HW_Chrome windowDrag>
      {/* The mark only. "SHITTY GAMES" spelled out cost ~100px of the bar to
          tell you the name of the application you are already inside — the
          Home masthead and the window title both say it. That width buys the
          destination strip its labels instead (req_4464). */}
      <C.HW_Brand>
        <Icon name="Box" size={15} color={accentFor('primary')} />
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
      <C.HW_SwitcherDivider />
      <WorkspaceSwitcher active={props.destination} onGo={props.onDestination} />
      <C.HW_Spacer />
      <C.HW_Pill onPress={() => props.onCommand('open-map', 'chrome')} tooltip={`Active map: ${props.state.activeMapName} (${props.state.activeMapStem}) — open map workspaces`}>
        <Icon name="MapPinned" size={12} color={accentFor('primary')} />
        <C.HW_PillText>{props.state.activeMapName}</C.HW_PillText>
      </C.HW_Pill>
      <RouteToggle />
      <WindowControls onClose={props.onClose} />
    </C.HW_Chrome>
  );
}
