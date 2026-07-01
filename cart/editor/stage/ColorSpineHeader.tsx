import { C } from '../workspace.cls';
import { oklchName, oklchReadout } from '../data/colorSpine';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';

export default function ColorSpineHeader(props: { current: OklchColor; onAddToTray: () => void }) {
  return (
    <C.HW_SpineHeader>
      <C.HW_SpineSwatch style={{ backgroundColor: oklchToHex(props.current) }} />
      <C.HW_SpineText>
        <C.HW_KeyText>CURRENT</C.HW_KeyText>
        <C.HW_HeadTitle>{oklchName(props.current)}</C.HW_HeadTitle>
        <C.HW_ColorCode>{oklchReadout(props.current)}</C.HW_ColorCode>
      </C.HW_SpineText>
      <C.HW_SpineAddButton onPress={props.onAddToTray}>
        <C.HW_PillText>+ palette</C.HW_PillText>
      </C.HW_SpineAddButton>
    </C.HW_SpineHeader>
  );
}
