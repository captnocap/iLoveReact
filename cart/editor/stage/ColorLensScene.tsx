import { C } from '../workspace.cls';
import { sceneSwatches } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';

export default function ColorLensScene(props: { scenePick: string | null; onPick: (color: OklchColor, css: string) => void }) {
  const swatches = sceneSwatches(props.scenePick);
  return (
    <C.HW_LensBody>
      <C.HW_SceneStrip>
        {swatches.map((swatch, index) => (
          <C.HW_SceneSwatch
            key={index}
            onPress={() => props.onPick(swatch.color, swatch.css)}
            style={{ backgroundColor: swatch.css, borderColor: swatch.picked ? '#6ee7a8' : undefined, borderWidth: swatch.picked ? 2 : 1 }}
          />
        ))}
      </C.HW_SceneStrip>
    </C.HW_LensBody>
  );
}
