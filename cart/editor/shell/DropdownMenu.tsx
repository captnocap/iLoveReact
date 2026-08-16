import { useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { ScrollView } from '../../../runtime/primitives';
import { C, accentFor } from '../workspace.cls';
import {
  commandById, commandEnabled, menuNodes, submenuEnabled,
  MENU_DROPDOWN_WIDTH, menuDropdownLeft, type MenuNode,
} from '../data/commands';
import { activeSurface } from '../data/surfaces';
import type { EditorState, LightId } from '../data/types';
import {
  APPLICATION_COMMAND_MENU_TUNING,
  dispatchApplicationCommandMenuRow,
  type ApplicationCommandMenuInvoke,
  type ApplicationCommandMenuRow,
} from './applicationCommandMenu';

// The viewer light-rig switches, hosted under View → Lighting when a model is open. The model
// shader supports one directional + ambient: Flat = even paint-true light; Key = the directional;
// Fill = lift the dark side (raises ambient).
const LIGHT_MENU: { id: LightId; label: string; field: 'litFlat' | 'litKey' | 'litFill' }[] = [
  { id: 'flat', label: 'Flat (even, paint-true)', field: 'litFlat' },
  { id: 'key', label: 'Key light', field: 'litKey' },
  { id: 'fill', label: 'Fill (lift shadows)', field: 'litFill' },
];

// Dropdown for the active top-bar menu. Mounted at the app root (see AppFrame) so it paints over
// the body and hit-tests correctly; positioned under its menu-bar button via menuDropdownLeft.
// The rows come from the declarative menu tree (commands.menuNodes): command rows, non-interactive
// section headers, and inline-expandable submenus that can nest (File → New Mesh, Mesh → Paint →
// Paint Resolution). Every command/submenu grays-with-reason off its surface — never hidden.

const rowIndent = (depth: number) => (depth > 0 ? { style: { paddingLeft: 12 + depth * 18 } } : {});

function CommandRow({ id, depth, state, onCommand }: { id: string; depth: number; state: EditorState; onCommand: (id: string, source: string) => void }) {
  const command = commandById(id);
  const en = commandEnabled(command, state);
  if (!en.on) {
    return (
      <C.HW_MenuDropRowOff {...rowIndent(depth)}>
        <Icon name={command.icon} size={13} color={accentFor('textDim')} />
        <C.HW_MenuDropTextOff>{command.name}</C.HW_MenuDropTextOff>
        <C.HW_Spacer />
        <C.HW_MenuDropReason>{en.reason}</C.HW_MenuDropReason>
      </C.HW_MenuDropRowOff>
    );
  }
  return (
    <C.HW_MenuDropRow onPress={() => onCommand(command.id, 'menu')} {...rowIndent(depth)}>
      <Icon name={command.icon} size={13} color={accentFor(command.native ? 'primary' : 'textDim')} />
      <C.HW_MenuDropText>{command.name}</C.HW_MenuDropText>
      <C.HW_Spacer />
      <C.HW_MenuDropSub>{command.key}</C.HW_MenuDropSub>
    </C.HW_MenuDropRow>
  );
}

function RegistryCommandRow(props: {
  row: ApplicationCommandMenuRow;
  onCommand: ApplicationCommandMenuInvoke;
}) {
  const command = props.row.command;
  if (!props.row.enabled) {
    return (
      <C.HW_MenuDropRowOff>
        <Icon name={command.icon} size={13} color={accentFor('textDim')} />
        <C.HW_MenuDropTextOff>{command.label}</C.HW_MenuDropTextOff>
        <C.HW_Spacer />
        <C.HW_MenuDropReason>{props.row.reason ?? 'unavailable'}</C.HW_MenuDropReason>
      </C.HW_MenuDropRowOff>
    );
  }
  return (
    <C.HW_MenuDropRow onPress={() => dispatchApplicationCommandMenuRow(props.row, props.onCommand)}>
      <Icon name={command.icon} size={13} color={accentFor(command.native ? 'primary' : 'textDim')} />
      <C.HW_MenuDropText>{command.label}</C.HW_MenuDropText>
      <C.HW_Spacer />
      <C.HW_MenuDropSub>{command.defaultKey ?? ''}</C.HW_MenuDropSub>
    </C.HW_MenuDropRow>
  );
}

export default function DropdownMenu({ state, onCommand, onToggleLight, applicationRows = [], onApplicationCommand }: {
  state: EditorState;
  onCommand: (id: string, source: string) => void;
  onToggleLight: (which: LightId) => void;
  applicationRows?: readonly ApplicationCommandMenuRow[];
  onApplicationCommand?: ApplicationCommandMenuInvoke;
}) {
  // Which submenu ids are expanded. A Set (not one id) so nested flyouts can be open together
  // (Mesh → Paint open, and Paint Resolution open within it).
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());
  const toggleSub = (id: string) => setOpenSubs((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const renderNodes = (nodes: MenuNode[], depth: number): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    for (const node of nodes) {
      if (node.kind === 'section') {
        rows.push(
          <C.HW_MenuSectionRow key={`sec:${node.label}:${depth}`} {...rowIndent(depth)}>
            <C.HW_MenuSectionText>{node.label}</C.HW_MenuSectionText>
          </C.HW_MenuSectionRow>,
        );
      } else if (node.kind === 'cmd') {
        rows.push(<CommandRow key={node.id} id={node.id} depth={depth} state={state} onCommand={onCommand} />);
      } else {
        const enabled = submenuEnabled(node.scope, state);
        const open = enabled && openSubs.has(node.id);
        if (!enabled) {
          rows.push(
            <C.HW_MenuDropRowOff key={`sub:${node.id}`} {...rowIndent(depth)}>
              <Icon name={node.icon} size={13} color={accentFor('textDim')} />
              <C.HW_MenuDropTextOff>{node.label}</C.HW_MenuDropTextOff>
              <C.HW_Spacer />
              <C.HW_MenuDropReason>only in the {node.scope} editor</C.HW_MenuDropReason>
            </C.HW_MenuDropRowOff>,
          );
        } else {
          rows.push(
            <C.HW_MenuDropRow key={`sub:${node.id}`} onPress={() => toggleSub(node.id)} {...rowIndent(depth)}>
              <Icon name={node.icon} size={13} color={accentFor('primary')} />
              <C.HW_MenuDropText>{node.label}</C.HW_MenuDropText>
              <C.HW_Spacer />
              <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
            </C.HW_MenuDropRow>,
          );
          if (open) rows.push(...renderNodes(node.children, depth + 1));
        }
      }
    }
    return rows;
  };

  const menu = state.openMenu;
  const rows = menu ? renderNodes(menuNodes(menu), 0) : [];
  if (onApplicationCommand) {
    rows.push(...applicationRows.map((row) => (
      <RegistryCommandRow key={row.command.id} row={row} onCommand={onApplicationCommand} />
    )));
  }

  // Lighting: live toggles (the generic CommandRow can't show an on/off state), so it stays a
  // hand-rolled group. Only meaningful with a model in view — appended under View there.
  if (menu === 'View' && activeSurface(state) === 'model') {
    const open = openSubs.has('Lighting');
    rows.push(
      <C.HW_MenuDropRow key="sub:Lighting" onPress={() => toggleSub('Lighting')}>
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
      {/* Every menu body scrolls past the cap (req_4663) — a fully-expanded family
          must never run the panel off the monitor and strand commands unreachable. */}
      <ScrollView showScrollbar style={{ maxHeight: APPLICATION_COMMAND_MENU_TUNING.maxBodyHeight }}>
        {rows}
      </ScrollView>
    </C.HW_MenuDropdown>
  );
}
