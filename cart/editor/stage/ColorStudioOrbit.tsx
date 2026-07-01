import { C } from '../workspace.cls';
import { fitsWellNow, oklchName, rampForge, sceneSwatches } from '../data/colorSpine';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import ColorSpineHeader from './ColorSpineHeader';
import ColorSpineTray from './ColorSpineTray';

const ORBIT_RAMP_STEPS = 7;

export default function ColorStudioOrbit(props: {
  current: OklchColor;
  palette: OklchColor[];
  scenePick: string | null;
  onSetCurrent: (color: OklchColor) => void;
  onAddToTray: () => void;
  onPickTray: (color: OklchColor) => void;
  onScenePick: (color: OklchColor, css: string) => void;
}) {
  const fits = fitsWellNow(props.current);
  const ramp = rampForge(props.current, ORBIT_RAMP_STEPS);
  const scene = sceneSwatches(props.scenePick);

  return (
    <C.HW_ColorPreviewPanel>
      <C.HW_ColorStudioBody style={{ flexDirection: 'column', padding: 14, gap: 14 }}>
        <ColorSpineHeader current={props.current} onAddToTray={props.onAddToTray} />
        <C.HW_OrbitStage>
          <C.HW_OrbitCenter style={{ backgroundColor: oklchToHex(props.current) }}>
            <C.HW_OrbitCenterLabel>{oklchName(props.current)}</C.HW_OrbitCenterLabel>
          </C.HW_OrbitCenter>

          <C.HW_OrbitAxisLabel style={{ left: '50%', top: 6, marginLeft: -28 }}>HARMONY</C.HW_OrbitAxisLabel>
          <C.HW_OrbitHarmonyRow style={{ left: '50%', top: 24, marginLeft: -95 }}>
            {fits.map((fit, index) => (
              <C.HW_OrbitHarmonyDot key={index} onPress={() => props.onSetCurrent(fit.color)} style={{ backgroundColor: fit.css }} />
            ))}
          </C.HW_OrbitHarmonyRow>

          <C.HW_OrbitAxisLabel style={{ right: 8, top: '50%', marginTop: -6 }}>RAMP</C.HW_OrbitAxisLabel>
          <C.HW_OrbitRampColumn style={{ right: 28, top: '50%', marginTop: -66 }}>
            {ramp.map((step, index) => (
              <C.HW_OrbitRampStep key={index} onPress={() => props.onSetCurrent(step.color)} style={{ backgroundColor: step.css }} />
            ))}
          </C.HW_OrbitRampColumn>

          <C.HW_OrbitAxisLabel style={{ left: '50%', bottom: 34, marginLeft: -40 }}>IN YOUR SCENE</C.HW_OrbitAxisLabel>
          <C.HW_OrbitSceneRow style={{ left: '50%', bottom: 10, marginLeft: -105 }}>
            {scene.map((swatch, index) => (
              <C.HW_OrbitSceneSwatch
                key={index}
                onPress={() => props.onScenePick(swatch.color, swatch.css)}
                style={{ backgroundColor: swatch.css, borderColor: swatch.picked ? '#6ee7a8' : undefined, borderWidth: swatch.picked ? 2 : 1 }}
              />
            ))}
          </C.HW_OrbitSceneRow>

          <C.HW_OrbitHint style={{ left: 10, top: 128 }}>change the center →{'\n'}orbit re-derives</C.HW_OrbitHint>
        </C.HW_OrbitStage>
        <ColorSpineTray palette={props.palette} onPick={props.onPickTray} />
      </C.HW_ColorStudioBody>
    </C.HW_ColorPreviewPanel>
  );
}
