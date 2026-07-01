import { C } from '../workspace.cls';
import type { MockState } from '../data/types';

const VIEW_OPTIONS: Array<{ id: MockState['colorStudioView']; label: string }> = [
  { id: 'materialPalette', label: 'Material Palette' },
  { id: 'workbench', label: 'Workbench' },
  { id: 'orbit', label: 'No-Modes' },
];

export default function ColorStudioViewTabs(props: { view: MockState['colorStudioView']; onSelect: (view: MockState['colorStudioView']) => void }) {
  return (
    <C.HW_SpineViewTrack>
      {VIEW_OPTIONS.map((option) => {
        const Tab = option.id === props.view ? C.HW_SpineViewTabOn : C.HW_SpineViewTab;
        const Label = option.id === props.view ? C.HW_SpineViewTabLabelOn : C.HW_SpineViewTabLabel;
        return (
          <Tab key={option.id} onPress={() => props.onSelect(option.id)}>
            <Label>{option.label}</Label>
          </Tab>
        );
      })}
    </C.HW_SpineViewTrack>
  );
}
