import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import { C, accentFor } from '../workspace.cls';
import { activeMenuFor, MENUS } from '../data/commands';
import { formatMs } from '../data/telemetry';
import type { Command, Menu, EditorState } from '../data/types';

export default function Chrome(props: {
  state: EditorState;
  activeCommand: Command;
  onMenu: (menu: Menu) => void;
  onCommand: (id: string, source: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const undoCount = props.state.history.filter((event) => event.undoable).length;
  const activeMenu = activeMenuFor(props.state);
  const { data: frame } = useTelemetry<{ app_tick_us?: number }>({ kind: 'frame', pollMs: 500 });
  const shellMs = frame?.app_tick_us ? frame.app_tick_us / 1000 : 0;
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
      <C.HW_Pill onPress={props.onUndo} tooltip="Undo">
        <Icon name="Undo2" size={13} color={accentFor(undoCount > 0 ? 'textSecondary' : 'textFaint')} />
      </C.HW_Pill>
      <C.HW_Pill onPress={props.onRedo} tooltip="Redo">
        <Icon name="Redo2" size={13} color={accentFor(props.state.redo.length > 0 ? 'textSecondary' : 'textFaint')} />
      </C.HW_Pill>
      <C.HW_Compile onPress={() => props.onCommand('compile-rle', 'chrome')}>
        <Icon name="Download" size={13} color={accentFor('primary')} />
        <C.HW_PillTextOn>Compile</C.HW_PillTextOn>
      </C.HW_Compile>
      <C.HW_StatusText>shell {shellMs > 0 ? formatMs(shellMs) : '—'}</C.HW_StatusText>
    </C.HW_Chrome>
  );
}
