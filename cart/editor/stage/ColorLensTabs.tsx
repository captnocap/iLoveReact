import { C } from '../workspace.cls';
import { LENS_LABELS, LENS_ORDER, type ColorLens } from '../data/colorSpine';

export default function ColorLensTabs(props: { lens: ColorLens; onSelect: (lens: ColorLens) => void }) {
  return (
    <C.HW_LensTrack>
      {LENS_ORDER.map((lens) => {
        const Tab = lens === props.lens ? C.HW_LensTabOn : C.HW_LensTab;
        const Label = lens === props.lens ? C.HW_LensTabLabelOn : C.HW_LensTabLabel;
        return (
          <Tab key={lens} onPress={() => props.onSelect(lens)}>
            <Label>{LENS_LABELS[lens]}</Label>
          </Tab>
        );
      })}
    </C.HW_LensTrack>
  );
}
