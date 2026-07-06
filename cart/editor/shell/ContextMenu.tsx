import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { COMMANDS, commandById, commandEnabled } from '../data/commands';
import type { EditorState } from '../data/types';

// The world surface's right-click menu — the contextual world tools (place/move/paint/…). Rows go
// through commandEnabled so anything needing a selection (or not yet available) reads grayed with
// its reason instead of pretending to be actionable. Model surfaces use ModelContextMenu instead.
export default function ContextMenu({ state, onCommand }: { state: EditorState; onCommand: (id: string, source: string) => void }) {
  const rows = COMMANDS.filter((command) => command.context && command.scope === 'world');
  return (
    <C.HW_ContextMenu>
      <C.HW_ContextHead>
        <C.HW_Kicker>CONTEXT</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_KeyText>{commandById(state.activeCommandId).name}</C.HW_KeyText>
      </C.HW_ContextHead>
      {rows.map((command) => {
        const en = commandEnabled(command, state);
        if (!en.on) {
          return (
            <C.HW_ContextRow key={command.id} style={{ opacity: 0.4 }}>
              <Icon name={command.icon} size={12} color={accentFor('textDim')} />
              <C.HW_ContextText>{command.name}</C.HW_ContextText>
              <C.HW_Spacer />
              <C.HW_KeyText>{en.reason}</C.HW_KeyText>
            </C.HW_ContextRow>
          );
        }
        return (
          <C.HW_ContextRow key={command.id} onPress={() => onCommand(command.id, 'context')}>
            <Icon name={command.icon} size={12} color={accentFor(command.id === state.activeCommandId ? 'primary' : 'textDim')} />
            <C.HW_ContextText>{command.name}</C.HW_ContextText>
            <C.HW_Spacer />
            <C.HW_KeyText>{command.key}</C.HW_KeyText>
          </C.HW_ContextRow>
        );
      })}
    </C.HW_ContextMenu>
  );
}
