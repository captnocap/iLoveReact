import { C } from '../workspace.cls';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';

export default function ColorSpineTray(props: { palette: OklchColor[]; onPick: (color: OklchColor) => void }) {
  return (
    <C.HW_SpineTrayRow>
      <C.HW_KeyText>PALETTE</C.HW_KeyText>
      <C.HW_SpineTrayList>
        {props.palette.map((color, index) => (
          <C.HW_SpineTraySwatch key={index} onPress={() => props.onPick(color)} style={{ backgroundColor: oklchToHex(color) }} />
        ))}
      </C.HW_SpineTrayList>
      <C.HW_SpineTrayLegend>
        <C.HW_SpineTrayDot />
        <C.HW_KeyText>scene-locked</C.HW_KeyText>
      </C.HW_SpineTrayLegend>
    </C.HW_SpineTrayRow>
  );
}
