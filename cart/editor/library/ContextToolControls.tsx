import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { LibraryTab, WorldObject } from '../data/types';

export default function ContextToolControls({ mode, activeObject, onAction }: { mode: LibraryTab; activeObject: WorldObject; onAction: (label: string) => void }) {
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
      <C.HW_ToolRow>
        <C.HW_ToolLabel>snap</C.HW_ToolLabel>
        <C.HW_ChipRow>
          {['grid', 'edge', 'surface'].map((snap, index) => {
            const Chip = index === 0 ? C.HW_PresetChipOn : C.HW_PresetChip;
            return <Chip key={snap} onPress={() => onAction(`snap ${snap}`)}><C.HW_ToolValue>{snap}</C.HW_ToolValue></Chip>;
          })}
        </C.HW_ChipRow>
      </C.HW_ToolRow>
      <C.HW_ButtonRow>
        <C.HW_SmallButton onPress={() => onAction('save prefab')}><C.HW_FormValue>save prefab</C.HW_FormValue></C.HW_SmallButton>
        <C.HW_SmallButton onPress={() => onAction('favorite asset')}><C.HW_FormValue>favorite</C.HW_FormValue></C.HW_SmallButton>
      </C.HW_ButtonRow>
    </C.HW_ToolPanel>
  );
}
