import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { LibraryTab, WorldObject } from '../data/types';

export default function ContextToolControls({ mode, activeObject }: { mode: LibraryTab; activeObject: WorldObject }) {
  return (
    <C.HW_ToolPanel>
      <C.HW_GroupTitle>
        <Icon name={mode === 'Build' ? 'Box' : 'Package'} size={12} color={accentFor('primary')} />
        <C.HW_GroupText>{mode === 'Build' ? 'PLACEMENT CONTROLS' : 'PROP CONTROLS'}</C.HW_GroupText>
      </C.HW_GroupTitle>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>focus</C.HW_ToolLabel>
        <C.HW_ToolValue>{activeObject.name}</C.HW_ToolValue>
      </C.HW_ToolRow>
    </C.HW_ToolPanel>
  );
}
