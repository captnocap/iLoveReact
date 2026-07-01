import { C } from '../workspace.cls';
import { mixPigments } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';

export default function ColorLensMix(props: { onPick: (color: OklchColor) => void }) {
  const pigments = mixPigments();
  return (
    <C.HW_LensBody>
      <C.HW_MixPigmentRow>
        {pigments.map((pigment) => (
          <C.HW_MixPigmentChip key={pigment.name} onPress={() => props.onPick(pigment.color)} style={{ backgroundColor: pigment.css }} />
        ))}
      </C.HW_MixPigmentRow>
    </C.HW_LensBody>
  );
}
