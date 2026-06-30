import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { COMMANDS, commandById } from '../data/commands';
import type { MockState } from '../data/types';

export default function ContextMenu({ state, onCommand }: { state: MockState; onCommand: (id: string, source: string) => void }) {
  const rows = COMMANDS.filter((command) => command.context);
  return (
    <C.HW_ContextMenu>
      <C.HW_ContextHead>
        <C.HW_Kicker>CONTEXT</C.HW_Kicker>
        <C.HW_Spacer />
        <C.HW_KeyText>{commandById(state.activeCommandId).name}</C.HW_KeyText>
      </C.HW_ContextHead>
      {rows.map((command) => (
        <C.HW_ContextRow key={command.id} onPress={() => onCommand(command.id, 'context')}>
          <Icon name={command.icon} size={12} color={accentFor(command.id === state.activeCommandId ? 'primary' : 'textDim')} />
          <C.HW_ContextText>{command.name}</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{command.key}</C.HW_KeyText>
        </C.HW_ContextRow>
      ))}
    </C.HW_ContextMenu>
  );
}
